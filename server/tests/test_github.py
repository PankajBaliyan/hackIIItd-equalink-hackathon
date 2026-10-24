import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

import app.db as db
from app import github
from app.config import Settings, get_settings
from app.main import app


def make_settings(**kw) -> Settings:
    return Settings(_env_file=None, state_secret="test-secret", database_url="sqlite://", **kw)


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = {"settings": make_settings(github_token="ghp_test")}
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(cfg["settings"], "database_url", f"sqlite:///{tmp_path}/t.db")
    app.dependency_overrides[get_settings] = lambda: cfg["settings"]
    monkeypatch.setattr("app.main.get_settings", lambda: cfg["settings"])

    async def fake_user(token):
        return "octocat"

    async def fake_repos(token, installation):
        return ["octocat/zeta", "octocat/Alpha"]

    monkeypatch.setattr(github, "pat_user", fake_user)
    monkeypatch.setattr(github, "list_repos", lambda token, *, installation: fake_repos(token, installation))
    monkeypatch.setattr("app.db.get_settings", lambda: cfg["settings"])
    with TestClient(app) as c:
        c.cfg = cfg
        yield c
    app.dependency_overrides.clear()
    SQLModel.metadata.clear  # tables are per-file db, nothing to reset


def test_starts_disconnected(client):
    r = client.get("/integrations/github").json()
    assert r["connected"] is False and r["mode"] == "pat"


def test_connect_lists_repos_sorted_and_toggle_persists(client):
    r = client.post("/integrations/github/connect").json()
    assert r["connected"] and r["account"] == "octocat"
    assert [x["full_name"] for x in r["repos"]] == ["octocat/Alpha", "octocat/zeta"]
    assert not any(x["enabled"] for x in r["repos"])

    r = client.patch("/integrations/github/repos", json={"full_name": "octocat/zeta", "enabled": True}).json()
    assert {x["full_name"]: x["enabled"] for x in r["repos"]}["octocat/zeta"] is True
    again = client.get("/integrations/github").json()
    assert {x["full_name"]: x["enabled"] for x in again["repos"]}["octocat/zeta"] is True


def test_cannot_enable_unknown_repo(client):
    client.post("/integrations/github/connect")
    r = client.patch("/integrations/github/repos", json={"full_name": "evil/repo", "enabled": True})
    assert r.status_code == 404


def test_patch_requires_connection(client):
    r = client.patch("/integrations/github/repos", json={"full_name": "a/b", "enabled": True})
    assert r.status_code == 409


def test_disconnect_clears(client):
    client.post("/integrations/github/connect")
    client.patch("/integrations/github/repos", json={"full_name": "octocat/zeta", "enabled": True})
    assert client.delete("/integrations/github").json()["connected"] is False
    assert client.get("/integrations/github").json()["connected"] is False


def test_connect_without_config_is_400(client):
    client.cfg["settings"] = make_settings()
    app.dependency_overrides[get_settings] = lambda: client.cfg["settings"]
    r = client.post("/integrations/github/connect")
    assert r.status_code == 400 and "isn't configured" in r.json()["detail"]


def test_callback_rejects_bad_state(client):
    r = client.get("/integrations/github/callback", params={"installation_id": 1, "state": "nope"})
    assert r.status_code == 400


async def test_github_client_surfaces_api_errors(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Bad credentials"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        github, "_client", lambda token=None: httpx.AsyncClient(base_url=github.API, transport=transport)
    )
    with pytest.raises(github.GitHubError) as e:
        await github.pat_user("bad")
    assert e.value.status == 401 and "Bad credentials" in e.value.message
