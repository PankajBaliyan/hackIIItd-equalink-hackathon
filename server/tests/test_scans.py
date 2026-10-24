import json

import pytest
from fastapi.testclient import TestClient

import app.db as db
from app import pipeline
from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_settings", lambda: cfg)
    started: list[str] = []
    monkeypatch.setattr(pipeline, "start", started.append)  # don't launch a browser in unit tests
    app.dependency_overrides[get_settings] = lambda: cfg
    with TestClient(app) as c:
        c.started = started
        yield c
    app.dependency_overrides.clear()


def test_create_scan_normalizes_url_and_queues(client):
    r = client.post("/scans", json={"url": "shopeasy.dev", "level": "AAA", "scope": "site", "repo": "me/shop"})
    assert r.status_code == 201
    scan = r.json()
    assert scan["url"] == "https://shopeasy.dev" and scan["mode"] == "repo" and scan["status"] == "queued"
    assert scan["created_at"].endswith("Z") and client.started == [scan["id"]]
    assert client.post("/scans", json={"url": "a.com"}).json()["mode"] == "url"


@pytest.mark.parametrize(
    "body",
    [{"url": "not a url"}, {"url": "a.com", "level": "AAAA"}, {"url": "a.com", "scope": "world"}, {"url": "a.com", "repo": "bad"}],
)
def test_create_scan_validation(client, body):
    assert client.post("/scans", json=body).status_code == 422


def test_list_get_and_missing(client):
    a = client.post("/scans", json={"url": "a.com"}).json()["id"]
    b = client.post("/scans", json={"url": "b.com"}).json()["id"]
    ids = [s["id"] for s in client.get("/scans").json()]
    assert ids[:2] == [b, a]
    d = client.get(f"/scans/{a}").json()
    assert d["scan"]["id"] == a and d["issues"] == [] and d["fixes"] == []
    assert client.get("/scans/nope").status_code == 404
    assert client.get("/scans/nope/events").status_code == 404


def test_ship_is_not_implemented(client):
    sid = client.post("/scans", json={"url": "a.com"}).json()["id"]
    assert client.post(f"/scans/{sid}/ship").status_code == 501


def test_imported_fixes_fall_through_live_scan_routes(client):
    detail = client.get("/scans/demo")
    assert detail.status_code == 200 and detail.json()["scan"]["id"] == "demo"
    assert client.post("/scans/demo/ship", json={}).status_code == 422


def test_events_replay_and_stop_at_terminal_stage(client):
    sid = client.post("/scans", json={"url": "a.com"}).json()["id"]
    with db.Session(db.engine()) as s:
        pipeline.emit(s, sid, "done", "scan complete: 0 issue(s)")
    with client.stream("GET", f"/scans/{sid}/events") as r:
        frames = [line[6:] for line in r.iter_lines() if line.startswith("data: ")]
    assert [json.loads(f)["stage"] for f in frames] == ["queued", "done"]


def test_events_resume_with_last_event_id(client):
    sid = client.post("/scans", json={"url": "a.com"}).json()["id"]
    with db.Session(db.engine()) as s:
        pipeline.emit(s, sid, "done", "finished")
    with client.stream("GET", f"/scans/{sid}/events", headers={"Last-Event-ID": "1"}) as r:
        frames = [line[6:] for line in r.iter_lines() if line.startswith("data: ")]
    assert [json.loads(f)["message"] for f in frames] == ["finished"]


def test_pipeline_helpers():
    assert pipeline.sc_from_tags(["cat.color", "wcag2aa", "wcag143"]) == "1.4.3"
    assert pipeline.sc_from_tags(["wcag2411"]) == "2.4.11"
    assert pipeline.sc_from_tags(["best-practice"]) == "n/a"
    assert pipeline.score({"critical": 0, "serious": 0, "moderate": 0, "minor": 0}) == 100
    assert pipeline.score({"critical": 2, "serious": 1, "moderate": 0, "minor": 0}) == 88
    assert pipeline.score({"critical": 50, "serious": 0, "moderate": 0, "minor": 0}) == 0


def test_private_targets_can_be_blocked():
    from fastapi import HTTPException

    cfg = Settings(_env_file=None, allow_private_targets=False)
    with pytest.raises(HTTPException):
        pipeline.check_target(cfg, "http://127.0.0.1:8000/")
    pipeline.check_target(Settings(_env_file=None), "http://127.0.0.1:8000/")  # allowed by default
