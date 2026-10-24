import httpx
import json
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

import app.db as db
from app import github
from app.config import Settings, get_settings
from app.main import app
from app.git_provider import GitProvider, PullRequest
from app.github_adapter import GitHubAdapter
from app import git_providers


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


async def test_adapter_posts_pull_request_and_normalizes_response(monkeypatch):
    def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/repos/octocat/zeta/pulls"
        assert request.headers["Authorization"] == "Bearer test-token"
        assert json.loads(request.content) == {
            "title": "Accessibility fix", "head": "fix/a11y", "base": "main", "body": "Details",
        }
        return httpx.Response(201, json={"number": 12, "html_url": "https://github.com/octocat/zeta/pull/12"})

    monkeypatch.setattr(github, "_client", lambda token: httpx.AsyncClient(
        base_url=github.API, headers={"Authorization": f"Bearer {token}"},
        transport=httpx.MockTransport(handler),
    ))
    adapter = GitHubAdapter("test-token")
    assert isinstance(adapter, GitProvider)
    result = await adapter.create_pull_request(
        repo="octocat/zeta", title="Accessibility fix", head="fix/a11y", base="main", body="Details",
    )
    assert result.number == 12 and result.url.endswith("/pull/12")


def pr_body(**overrides):
    return {"repo": "octocat/zeta", "title": "Fix", "head": "fix/a11y", "base": "main", **overrides}


def test_pr_route_requires_connection_and_enabled_repo(client):
    assert client.post("/pull-requests", json=pr_body()).status_code == 409
    client.post("/integrations/github/connect")
    assert client.post("/pull-requests", json=pr_body()).status_code == 403
    assert client.post("/pull-requests", json=pr_body(provider="gitlab")).status_code == 422
    assert client.post("/pull-requests", json=pr_body(repo="bad/path/extra")).status_code == 422


def test_pr_route_selects_strategy_dynamically(client, monkeypatch):
    client.post("/integrations/github/connect")
    client.patch("/integrations/github/repos", json={"full_name": "octocat/zeta", "enabled": True})
    calls = []

    class AlternativeAdapter(GitProvider):
        async def create_pull_request(self, **kwargs):
            calls.append(kwargs)
            return PullRequest(number=7, url="https://example.com/pulls/7")

    async def factory(settings, connection):
        assert connection.account == "octocat"
        return AlternativeAdapter()

    monkeypatch.setitem(git_providers.PROVIDERS, "alternative", factory)
    response = client.post("/pull-requests", json=pr_body(provider="alternative"))
    assert response.status_code == 201
    assert response.json() == {"number": 7, "url": "https://example.com/pulls/7"}
    assert calls == [{"repo": "octocat/zeta", "title": "Fix", "head": "fix/a11y", "base": "main", "body": ""}]


def test_pr_route_surfaces_provider_errors(client, monkeypatch):
    client.post("/integrations/github/connect")
    client.patch("/integrations/github/repos", json={"full_name": "octocat/zeta", "enabled": True})

    async def fail(self, **kwargs):
        raise github.GitHubError(422, "GitHub said: No commits between branches")

    monkeypatch.setattr(GitHubAdapter, "create_pull_request", fail)
    response = client.post("/pull-requests", json=pr_body())
    assert response.status_code == 502
    assert response.json()["detail"] == "Git provider rejected the pull request."


@pytest.mark.parametrize("mode", ["pat", "oauth", "app"])
async def test_provider_factory_resolves_existing_auth_modes(monkeypatch, mode):
    from app.models import GithubConnection

    settings = make_settings(github_token="pat-token", github_app_id="1", github_app_slug="test",
                             github_app_private_key="test-key")
    connection = GithubConnection(mode=mode, account="octocat", installation_id=42, access_token="oauth-token")

    async def installation_token(settings, installation_id):
        assert installation_id == 42
        return "app-token"

    monkeypatch.setattr(github, "installation_token", installation_token)
    adapter = await git_providers.get_git_provider("github", settings, connection)
    assert isinstance(adapter, GitHubAdapter)
    assert adapter.token == f"{mode}-token"


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


def oauth_client(client):
    client.cfg["settings"] = make_settings(github_client_id="cid", github_client_secret="sec")
    app.dependency_overrides[get_settings] = lambda: client.cfg["settings"]


def test_oauth_connect_returns_github_authorize_url(client):
    oauth_client(client)
    r = client.post("/integrations/github/connect").json()
    assert r["connected"] is False and r["mode"] == "oauth"
    url = r["install_url"]
    assert url.startswith("https://github.com/login/oauth/authorize?")
    assert "client_id=cid" in url and "scope=repo" in url
    assert "oauth%2Fcallback" in url and "state=" in url


def test_oauth_callback_stores_token_and_redirects(client, monkeypatch):
    oauth_client(client)

    async def fake_exchange(s, code):
        assert code == "abc"
        return "gho_usertoken"

    monkeypatch.setattr(github, "exchange_code", fake_exchange)
    state = client.post("/integrations/github/connect").json()["install_url"].split("state=")[1]
    r = client.get("/integrations/github/oauth/callback", params={"code": "abc", "state": state}, follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"].endswith("/integrations/github?connected=1")
    status = client.get("/integrations/github").json()
    assert status["connected"] and status["account"] == "octocat" and status["mode"] == "oauth"
    assert "access_token" not in str(status)


def test_oauth_callback_rejects_install_state_and_handles_denial(client):
    oauth_client(client)
    bad = client.get("/integrations/github/oauth/callback", params={"code": "x", "state": "nope"})
    assert bad.status_code == 400
    state = client.post("/integrations/github/connect").json()["install_url"].split("state=")[1]
    r = client.get(
        "/integrations/github/oauth/callback", params={"error": "access_denied", "state": state}, follow_redirects=False
    )
    assert r.headers["location"].endswith("/integrations/github?error=access_denied")


async def test_exchange_code_errors(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": "bad_verification_code", "error_description": "The code passed is incorrect"})

    real = httpx.AsyncClient
    monkeypatch.setattr(github.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(github.GitHubError) as e:
        await github.exchange_code(make_settings(github_client_id="c", github_client_secret="s"), "bad")
    assert "incorrect" in e.value.message
