"""Thin async client for the GitHub REST API (PAT and GitHub App auth)."""

import time

import httpx
import jwt

from app.config import Settings

API = "https://api.github.com"
HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
MAX_PAGES = 5  # 500 repos is plenty for a picker


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _client(token: str | None = None) -> httpx.AsyncClient:
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.AsyncClient(base_url=API, headers=headers, timeout=15)


async def _check(res: httpx.Response) -> dict:
    if res.is_success:
        return res.json()
    try:
        msg = res.json().get("message", res.text)
    except ValueError:
        msg = res.text
    raise GitHubError(res.status_code, f"GitHub said: {msg}")


def app_jwt(s: Settings) -> str:
    now = int(time.time())
    payload = {"iat": now - 60, "exp": now + 9 * 60, "iss": s.github_app_id}
    return jwt.encode(payload, s.app_private_key, algorithm="RS256")


async def installation_token(s: Settings, installation_id: int) -> str:
    async with _client(app_jwt(s)) as c:
        data = await _check(await c.post(f"/app/installations/{installation_id}/access_tokens"))
    return data["token"]


async def installation_account(s: Settings, installation_id: int) -> str:
    async with _client(app_jwt(s)) as c:
        data = await _check(await c.get(f"/app/installations/{installation_id}"))
    return data["account"]["login"]


async def pat_user(token: str) -> str:
    async with _client(token) as c:
        return (await _check(await c.get("/user")))["login"]


async def _paginate(c: httpx.AsyncClient, path: str, key: str | None, params: dict) -> list[dict]:
    out: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        data = await _check(await c.get(path, params={**params, "per_page": 100, "page": page}))
        items = data[key] if key else data
        out += items
        if len(items) < 100:
            break
    return out


async def list_repos(token: str, *, installation: bool) -> list[str]:
    """Full names of repos EquaLink could open PRs on (push access)."""
    async with _client(token) as c:
        if installation:
            repos = await _paginate(c, "/installation/repositories", "repositories", {})
        else:
            repos = await _paginate(
                c, "/user/repos", None, {"affiliation": "owner,collaborator,organization_member", "sort": "updated"}
            )
    return [
        r["full_name"]
        for r in repos
        if not r.get("archived") and (installation or r.get("permissions", {}).get("push"))
    ]


OAUTH_AUTHORIZE = "https://github.com/login/oauth/authorize"
OAUTH_TOKEN = "https://github.com/login/oauth/access_token"


def oauth_authorize_url(s: Settings, state: str) -> str:
    q = httpx.QueryParams(
        {"client_id": s.github_client_id, "redirect_uri": s.oauth_redirect_uri, "scope": "repo", "state": state}
    )
    return f"{OAUTH_AUTHORIZE}?{q}"


async def exchange_code(s: Settings, code: str) -> str:
    """Trade the one-time OAuth code for a user access token."""
    async with httpx.AsyncClient(timeout=15) as c:
        res = await c.post(
            OAUTH_TOKEN,
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_client_id,
                "client_secret": s.github_client_secret,
                "code": code,
                "redirect_uri": s.oauth_redirect_uri,
            },
        )
    data = res.json() if res.is_success else {}
    if "access_token" not in data:
        raise GitHubError(400, f"GitHub said: {data.get('error_description') or data.get('error') or res.text}")
    return data["access_token"]
