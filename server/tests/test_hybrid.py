import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

import app.db as database
from app import github, hybrid, routes_hybrid
from app.config import Settings, get_settings
from app.main import app
from app.models import EventRow, GithubConnection, IssueRow, RepoSetting, Scan
from app.github_adapter import GitHubAdapter

SOURCE = '<!doctype html><html lang="en"><head><title>Test</title><script>/* preserve me */</script></head><body><main><button></button></main></body></html>'
FIXED = SOURCE.replace('<button>', '<button aria-label="Save">')
RAW = '<button data-test="PRIVATE-INTRANET-MARKER"></button>'


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path}/hybrid.db",
                   tinyfish_api_key="test-key", hybrid_api_token="runner-token", github_token="pat-test",
                   hybrid_repo="org/repo", hybrid_file_path="index.html", w3c_sync_schedule=False)
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    app.dependency_overrides[get_settings] = lambda: cfg
    state = {"calls": [], "conflict": False, "ai_failed": False, "models": []}
    original_client = httpx.AsyncClient
    original_input = routes_hybrid.read_input
    original_source = GitHubAdapter.get_source_file

    async def capture_source(self, **kwargs):
        source = await original_source(self, **kwargs)
        state["source"] = source
        return source

    monkeypatch.setattr(GitHubAdapter, "get_source_file", capture_source)

    async def capture_input(request):
        body = await original_input(request)
        state["models"].append(body)
        return body

    monkeypatch.setattr(routes_hybrid, "read_input", capture_input)

    def handler(request):
        state["calls"].append((request.method, str(request.url)))
        if request.url.host == "agent.tinyfish.ai":
            sent = json.loads(request.content)
            assert sent["url"] == "https://example.com"
            assert "PRIVATE-INTRANET-MARKER" in sent["goal"] and "preserve me" in sent["goal"]
            assert request.headers["X-API-Key"] == "test-key"
            event = {"type": "COMPLETE", "status": "FAILED" if state["ai_failed"] else "COMPLETED",
                     "result": {"fixed_html": FIXED}}
            return httpx.Response(200, text="data: " + json.dumps(event) + "\n\n")
        assert request.url.host == "api.github.com", "No unmocked network is allowed"
        path = request.url.path
        if path.endswith("/contents/index.html"):
            if request.url.params.get("ref") == "base-sha" and state["conflict"]:
                return httpx.Response(200, json={"sha": "newer-file"})
            return httpx.Response(200, json={"type": "file", "encoding": "base64", "sha": "file-sha",
                                            "content": base64.b64encode(SOURCE.encode()).decode()})
        if path.endswith("/git/ref/heads/main"):
            return httpx.Response(200, json={"object": {"sha": "base-sha"}})
        if path.endswith("/git/commits/base-sha"):
            return httpx.Response(200, json={"tree": {"sha": "base-tree"}})
        if path.endswith("/git/trees"):
            data = json.loads(request.content)
            assert data["base_tree"] == "base-tree"
            assert data["tree"][0]["content"] == FIXED
            return httpx.Response(201, json={"sha": "fixed-tree"})
        if path.endswith("/git/commits"):
            assert json.loads(request.content)["parents"] == ["base-sha"]
            return httpx.Response(201, json={"sha": "fixed-commit"})
        if path.endswith("/git/refs"):
            assert json.loads(request.content)["ref"].startswith("refs/heads/equalink/hybrid-")
            return httpx.Response(201, json={"object": {"sha": "fixed-commit"}})
        if path.endswith("/pulls"):
            return httpx.Response(201, json={"number": 7, "html_url": "https://github.com/org/repo/pull/7"})
        raise AssertionError(f"Unexpected request: {request.method} {path}")

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)

    async def validation(original, fixed):
        assert original == SOURCE and fixed == FIXED

    monkeypatch.setattr(hybrid, "validate_fix", validation)
    with TestClient(app) as c:
        with Session(database.engine()) as db:
            db.add(GithubConnection(mode="pat", account="test"))
            db.add(RepoSetting(full_name="org/repo", enabled=True))
            db.commit()
        c.cfg, c.state = cfg, state
        yield c
    app.dependency_overrides.clear()


def post(client, **kwargs):
    return client.post("/api/hybrid-scan", headers={"Authorization": "Bearer runner-token"},
                       json={"url": "http://intranet.local/private", "raw_html": RAW}, **kwargs)


def test_hybrid_upload_generates_commits_and_returns_pr_without_persistence(client):
    response = post(client)
    assert response.status_code == 201, response.text
    assert response.json() == {"pr_url": "https://github.com/org/repo/pull/7"}
    assert client.state["models"][0].raw_html == ""
    assert client.state["source"].content == ""
    with Session(database.engine()) as db:
        for model in (Scan, IssueRow, EventRow):
            assert db.exec(select(model)).all() == []


def test_hybrid_requires_auth_and_config_before_external_calls(client):
    assert client.post("/api/hybrid-scan", json={"raw_html": RAW}).status_code == 401
    client.cfg.hybrid_file_path = "../index.html"
    assert post(client).status_code == 503
    assert client.state["calls"] == []


def test_validation_errors_do_not_echo_uploaded_content(client):
    response = client.post("/api/hybrid-scan", headers={"Authorization": "Bearer runner-token"},
                           json={"url": "bad", "raw_html": RAW})
    assert response.status_code == 422 and "PRIVATE-INTRANET-MARKER" not in response.text
    assert client.state["calls"] == []


@pytest.mark.parametrize("failure", ["ai", "validation", "conflict", "timeout"])
def test_failures_never_open_pr_and_release_upload(client, monkeypatch, failure):
    if failure == "ai":
        client.state["ai_failed"] = True
    elif failure == "conflict":
        client.state["conflict"] = True
    elif failure == "timeout":
        async def timeout(*args):
            raise TimeoutError
        monkeypatch.setattr(hybrid, "generate_fix", timeout)
    else:
        async def reject(*args):
            raise hybrid.HybridError("Proposed fixes did not pass accessibility re-validation.")
        monkeypatch.setattr(hybrid, "validate_fix", reject)
    response = post(client)
    assert response.status_code in (422, 502, 504)
    assert "PRIVATE-INTRANET-MARKER" not in response.text
    assert client.state["models"][0].raw_html == ""
    assert client.state["source"].content == ""
    assert not any(method == "POST" and "api.github.com" in url for method, url in client.state["calls"])


async def test_real_axe_validation_accepts_improvement_and_rejects_regression():
    # This uses local Chromium and synthetic HTML only; all network requests are blocked.
    await hybrid.validate_fix(SOURCE, FIXED)
    with pytest.raises(hybrid.HybridError):
        await hybrid.validate_fix(FIXED, SOURCE)


def test_script_changes_cannot_be_shipped():
    with pytest.raises(hybrid.HybridError):
        hybrid.ensure_scripts_preserved(SOURCE, FIXED.replace("/* preserve me */", "stealSecrets()"))


def test_large_upload_is_rejected_before_ai(client, monkeypatch):
    monkeypatch.setattr(hybrid, "MAX_HTML_BYTES", 16)
    assert post(client).status_code == 413
    assert client.state["calls"] == []


def test_disabled_repository_cannot_trigger_ai(client):
    with Session(database.engine()) as db:
        repo = db.get(RepoSetting, "org/repo")
        repo.enabled = False
        db.add(repo)
        db.commit()
    assert post(client).status_code == 403
    assert client.state["calls"] == []


async def test_cancellation_releases_source_and_upload(client, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from starlette.requests import Request

    async def cancel(*args):
        raise asyncio.CancelledError

    monkeypatch.setattr(hybrid, "generate_fix", cancel)
    async def receive():
        return {"type": "http.request", "body": json.dumps({"url": "http://intranet", "raw_html": RAW}).encode(), "more_body": False}

    request = Request({"type": "http", "method": "POST", "path": "/api/hybrid-scan", "headers": []}, receive)
    db = SimpleNamespace(get=lambda *args: SimpleNamespace(enabled=True, mode="pat"))
    with pytest.raises(asyncio.CancelledError):
        await routes_hybrid.hybrid_scan(request, db, client.cfg, "Bearer runner-token")
    assert client.state["source"].content == ""
    assert client.state["models"][0].raw_html == ""
