import pytest
from fastapi.testclient import TestClient

import app.db as db
from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    app.dependency_overrides[get_settings] = lambda: cfg
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_starts_empty(client):
    assert client.get("/sites").json() == []


def test_add_normalizes_and_lists_newest_first(client):
    a = client.post("/sites", json={"url": " shopeasy.dev ", "repo": "me/shop"})
    assert a.status_code == 201
    body = a.json()
    assert body["url"] == "https://shopeasy.dev" and body["host"] == "shopeasy.dev" and body["repo"] == "me/shop"
    client.post("/sites", json={"url": "https://www.example.org/docs#intro"})
    listed = client.get("/sites").json()
    assert [s["host"] for s in listed] == ["example.org", "shopeasy.dev"]
    assert listed[0]["url"] == "https://www.example.org/docs" and listed[0]["repo"] is None


@pytest.mark.parametrize("bad", ["", "not a url", "ftp://a.com", "javascript:alert(1)", "https://nodot"])
def test_rejects_bad_urls(client, bad):
    assert client.post("/sites", json={"url": bad}).status_code == 422


def test_rejects_bad_repo_and_duplicates(client):
    assert client.post("/sites", json={"url": "a.com", "repo": "no-slash"}).status_code == 422
    assert client.post("/sites", json={"url": "a.com"}).status_code == 201
    assert client.post("/sites", json={"url": "https://a.com"}).status_code == 409


def test_delete(client):
    sid = client.post("/sites", json={"url": "a.com"}).json()["id"]
    assert client.delete(f"/sites/{sid}").status_code == 204
    assert client.get("/sites").json() == []
    assert client.delete(f"/sites/{sid}").status_code == 404
