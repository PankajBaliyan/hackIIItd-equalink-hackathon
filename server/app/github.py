"""Thin async client for the GitHub REST API (PAT and GitHub App auth)."""

import time
from urllib.parse import quote

import httpx

from app.config import Settings

API = "https://api.github.com"
HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
MAX_PAGES = 5  # 500 repos is plenty for a picker


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _client(token: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.AsyncClient(base_url=API, headers=headers, timeout=15, transport=transport)


async def _check(res: httpx.Response) -> dict:
    if res.is_success:
        return res.json()
    try:
        body = res.json()
        msg = body.get("message", res.text)
        detail = "; ".join(e["message"] for e in body.get("errors", []) if isinstance(e, dict) and e.get("message"))
        if detail:
            msg = f"{msg}: {detail}"
    except ValueError:
        msg = res.text
    raise GitHubError(res.status_code, f"GitHub said: {msg}")





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
    """Full names of every repo this connection can see (the dashboard lists them all)."""
    async with _client(token) as c:
        if installation:
            repos = await _paginate(c, "/installation/repositories", "repositories", {})
        else:
            repos = await _paginate(
                c, "/user/repos", None, {"affiliation": "owner,collaborator,organization_member", "sort": "updated"}
            )
    return [r["full_name"] for r in repos]


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


def _pull(repo: str, p: dict) -> dict:
    state = "merged" if p.get("merged_at") else p["state"]
    return {
        "repo": repo, "number": p["number"], "title": p["title"], "state": state,
        "draft": bool(p.get("draft")), "author": (p.get("user") or {}).get("login", "ghost"),
        "head": p["head"]["ref"], "base": p["base"]["ref"], "url": p["html_url"],
        "created_at": p["created_at"], "updated_at": p["updated_at"], "body": p.get("body") or "",
    }


async def list_pulls(token: str, repo: str, state: str) -> list[dict]:
    async with _client(token) as c:
        data = await _check(
            await c.get(f"/repos/{repo}/pulls", params={"state": state, "per_page": 30, "sort": "updated", "direction": "desc"})
        )
    return [_pull(repo, p) for p in data]


async def list_branches(token: str, repo: str) -> tuple[str, list[str]]:
    async with _client(token) as c:
        info = await _check(await c.get(f"/repos/{repo}"))
        names = [b["name"] for b in await _paginate(c, f"/repos/{repo}/branches", None, {})]
    return info["default_branch"], names


async def compare(token: str, repo: str, base: str, head: str) -> dict:
    async with _client(token) as c:
        data = await _check(await c.get(f"/repos/{repo}/compare/{quote(base, safe='')}...{quote(head, safe='')}"))
    return {
        "ahead_by": data["ahead_by"], "behind_by": data["behind_by"], "status": data["status"],
        "commits": [
            {"sha": x["sha"][:7], "message": x["commit"]["message"].splitlines()[0]} for x in data["commits"][-20:]
        ],
        "files": [
            {"filename": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"]}
            for f in data.get("files", [])[:100]
        ],
    }


async def create_pull(token: str, repo: str, base: str, head: str, title: str, body: str, draft: bool) -> dict:
    async with _client(token) as c:
        data = await _check(
            await c.post(
                f"/repos/{repo}/pulls", json={"title": title, "head": head, "base": base, "body": body, "draft": draft}
            )
        )
    return _pull(repo, data)
async def default_branch(c: httpx.AsyncClient, full_name: str) -> str:
    return (await _check(await c.get(f"/repos/{full_name}")))["default_branch"]


async def repo_blobs(c: httpx.AsyncClient, full_name: str, ref: str) -> tuple[list[dict], bool]:
    """(files in the tree at `ref` as {path, size}, whether GitHub truncated the listing)."""
    data = await _check(await c.get(f"/repos/{full_name}/git/trees/{ref}", params={"recursive": "1"}))
    return [{"path": t["path"], "size": t.get("size", 0)} for t in data["tree"] if t["type"] == "blob"], bool(data.get("truncated"))


async def file_text(c: httpx.AsyncClient, full_name: str, path: str, ref: str) -> str:
    res = await c.get(
        f"/repos/{full_name}/contents/{quote(path)}", params={"ref": ref}, headers={"Accept": "application/vnd.github.raw+json"}
    )
    if not res.is_success:
        await _check(res)
    return res.text


def client(token: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return _client(token, transport)
