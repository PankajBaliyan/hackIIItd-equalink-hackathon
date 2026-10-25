import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import app.db as db
from app import app_settings, pipeline
from app.config import Settings, get_settings
from app.main import app
from app.models import AppSetting, Scan


def make_client(monkeypatch, tmp_path, **env):
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db", **env)
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_settings", lambda: cfg)
    monkeypatch.setattr(pipeline, "start", lambda _id: None)
    app.dependency_overrides[get_settings] = lambda: cfg
    return cfg


@pytest.fixture
def client(monkeypatch, tmp_path):
    make_client(monkeypatch, tmp_path)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# --- validation -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,value",
    [
        ("default_level", "AAAA"), ("default_scope", "everything"), ("max_site_pages", 0), ("max_site_pages", 101),
        ("max_site_pages", "5"), ("max_site_pages", True), ("fix_max", -1), ("openai_model", ""), ("openai_model", "gpt 4"),
        ("min_severity", "low"), ("ai_review", "yes"), ("disabled_rules", ["Image Alt!"]), ("disabled_rules", [1]),
    ],
)
def test_invalid_values_are_rejected(key, value):
    with pytest.raises(ValueError):
        app_settings.EDITABLE[key](value)


def test_valid_values_are_normalised():
    e = app_settings.EDITABLE
    assert e["disabled_rules"](["Image-Alt", " label ", "image-alt", ""]) == "image-alt,label"
    assert e["disabled_rules"]("a-b, c") == "a-b,c" and e["disabled_rules"]([]) == ""
    assert e["openai_model"](" gpt-4.1 ") == "gpt-4.1" and e["fix_max"](0) == 0 and e["max_site_pages"](100) == 100


def test_keep_applies_the_minimum_severity_and_disabled_rules():
    s = Settings(_env_file=None, min_severity="serious", disabled_rules="label,image-alt")
    assert app_settings.keep(s, "color-contrast", "critical") and app_settings.keep(s, "color-contrast", "serious")
    assert not app_settings.keep(s, "color-contrast", "moderate") and not app_settings.keep(s, "color-contrast", "minor")
    assert not app_settings.keep(s, "label", "critical") and not app_settings.keep(s, "image-alt", "critical")
    assert app_settings.keep(Settings(_env_file=None), "anything", "minor")  # defaults keep everything


# --- API ------------------------------------------------------------------------------------------------------


def test_get_returns_values_defaults_and_server_info(client):
    d = client.get("/settings").json()
    assert d["values"] == d["defaults"] and d["changed"] == []
    assert d["values"]["default_level"] == "AA" and d["values"]["ai_review"] is True and d["values"]["disabled_rules"] == []
    assert d["server"]["openai"] == {"configured": False, "model": "gpt-4.1"}
    assert d["server"]["scan_engine"] == "auto" and d["server"]["allow_private_targets"] is True


def test_server_info_reports_whether_keys_are_set_but_never_the_keys(monkeypatch, tmp_path):
    make_client(monkeypatch, tmp_path, openai_api_key="sk-very-secret", tinyfish_api_key="tf-very-secret", github_client_id="gid", github_client_secret="gsecret")
    with TestClient(app) as c:
        text = c.get("/settings").text + c.get("/health").text
        d = c.get("/settings").json()
    app.dependency_overrides.clear()
    assert d["server"]["openai"]["configured"] and d["server"]["tinyfish"]["configured"] and d["server"]["github"]["mode"] == "oauth"
    for secret in ("sk-very-secret", "tf-very-secret", "gsecret"):
        assert secret not in text


def test_patch_saves_validates_and_only_touches_what_was_sent(client):
    r = client.patch("/settings", json={"default_level": "AAA", "max_site_pages": 7, "disabled_rules": ["Image-Alt", "label"], "ai_fixes": False})
    d = r.json()
    assert r.status_code == 200 and d["values"]["default_level"] == "AAA" and d["values"]["max_site_pages"] == 7
    assert d["values"]["disabled_rules"] == ["image-alt", "label"] and d["values"]["ai_fixes"] is False
    assert d["values"]["fix_max"] == 30 and sorted(d["changed"]) == ["ai_fixes", "default_level", "disabled_rules", "max_site_pages"]
    assert d["defaults"]["default_level"] == "AA"  # the environment value is still reported
    client.patch("/settings", json={"fix_max": 5})
    again = client.get("/settings").json()  # a second change keeps the first
    assert again["values"]["default_level"] == "AAA" and again["values"]["fix_max"] == 5


@pytest.mark.parametrize(
    "body,message",
    [
        ({"max_site_pages": 500}, "max site pages must be a whole number from 1 to 100"),
        ({"default_level": "Z"}, "default level must be one of A, AA, AAA"),
        ({"disabled_rules": ["Not A Rule"]}, "disabled rules not a rule id"),
        ({"openai_model": "a b"}, "openai model must be a model name"),
    ],
)
def test_patch_rejects_bad_values_with_a_readable_message_and_saves_nothing(client, body, message):
    r = client.patch("/settings", json={"fix_max": 3, **body})
    assert r.status_code == 422 and message in r.json()["detail"]
    assert client.get("/settings").json()["changed"] == []  # not even the valid fix_max from the same request


def test_null_resets_one_setting_and_delete_resets_all(client):
    client.patch("/settings", json={"default_scope": "site", "fix_max": 2})
    d = client.patch("/settings", json={"default_scope": None}).json()
    assert d["values"]["default_scope"] == "page" and d["changed"] == ["fix_max"]
    d = client.delete("/settings").json()
    assert d["changed"] == [] and d["values"] == d["defaults"]


def test_a_saved_value_that_no_longer_validates_is_ignored(client):
    with Session(db.engine()) as s:
        s.add(AppSetting(key="max_site_pages", value=json.dumps(9999)))
        s.add(AppSetting(key="not_a_setting", value=json.dumps(1)))
        s.commit()
    d = client.get("/settings").json()
    assert d["values"]["max_site_pages"] == 20 and d["changed"] == []


def test_new_scans_use_the_saved_defaults_unless_the_request_says_otherwise(client):
    client.patch("/settings", json={"default_level": "AAA", "default_scope": "site"})
    a = client.post("/scans", json={"url": "a.com"}).json()
    b = client.post("/scans", json={"url": "b.com", "level": "A", "scope": "page"}).json()
    assert (a["level"], a["scope"]) == ("AAA", "site") and (b["level"], b["scope"]) == ("A", "page")


def test_health_reports_which_keys_are_set(client):
    h = client.get("/health").json()
    assert h["ok"] and h["openai"] is False and h["tinyfish"] is False and h["scan_engine"] == "auto"
