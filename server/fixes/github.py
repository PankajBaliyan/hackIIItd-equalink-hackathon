"""Commit all selected fixes atomically and return real GitHub PR metadata."""

import base64
import os
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from .github_service import BASE_URL


def client(token=None):
    token = (token or os.getenv("GITHUB_TOKEN", "")).strip()
    if not token:
        raise HTTPException(503, "Configure GITHUB_TOKEN in server/.env before opening a pull request.")
    return httpx.AsyncClient(base_url=BASE_URL, timeout=30, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
    })


async def call(api, method, path, **kwargs):
    response = await api.request(method, path, **kwargs)
    response.raise_for_status()
    return response.json()


async def open_pull_request(repo, branch, changes, body, token=None):
    """Use a fixed branch for retries; never partially commit a multi-file patch."""
    root = f"/repos/{repo}"
    owner = repo.split("/")[0]
    context = client() if token is None else client(token)
    async with context as api:
        existing = await call(api, "GET", f"{root}/pulls", params={
            "head": f"{owner}:{branch}", "state": "all",
        })
        if existing:
            return existing[0]
        base = (await call(api, "GET", root))["default_branch"]
        branch_response = await api.get(f"{root}/git/ref/heads/{branch}")
        if branch_response.status_code != 404:
            branch_response.raise_for_status()
        else:
            reference = await call(api, "GET", f"{root}/git/ref/heads/{base}")
            base_sha = reference["object"]["sha"]
            commit = await call(api, "GET", f"{root}/git/commits/{base_sha}")
            base_tree = await call(api, "GET", f"{root}/git/trees/{commit['tree']['sha']}", params={"recursive": "1"})
            entries = {entry["path"]: entry for entry in base_tree["tree"]}
            tree = []
            # Fetch every original at the SAME commit, and check all patches
            # before creating any remote commit or branch.
            for path, patches in sorted(changes.items()):
                entry = entries.get(path)
                if not entry or entry.get("type") != "blob" or entry.get("mode") not in ("100644", "100755"):
                    raise HTTPException(422, f"{path} must be a regular repository file present in the Git tree.")
                file = await call(api, "GET", f"{root}/contents/{quote(path, safe='/')}", params={"ref": base_sha})
                if not isinstance(file, dict) or file.get("encoding") != "base64":
                    raise HTTPException(422, f"{path} is not a supported UTF-8 file.")
                try:
                    content = base64.b64decode(file["content"]).decode("utf-8")
                except (ValueError, UnicodeError):
                    raise HTTPException(422, f"{path} is not a supported UTF-8 file.")
                for fix in patches:
                    if content.count(fix["original"]) != 1:
                        raise HTTPException(409, f"The original snippet must occur exactly once in {path} on main. Rescan the current source.")
                    content = content.replace(fix["original"], fix["patched"], 1)
                tree.append({"path": path, "mode": entry["mode"], "type": "blob", "content": content})
            new_tree = await call(api, "POST", f"{root}/git/trees", json={"base_tree": commit["tree"]["sha"], "tree": tree})
            new_commit = await call(api, "POST", f"{root}/git/commits", json={
                "message": "fix: automated WCAG accessibility remediation",
                "tree": new_tree["sha"], "parents": [base_sha],
            })
            await call(api, "POST", f"{root}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": new_commit["sha"]})
        return await call(api, "POST", f"{root}/pulls", json={
            "title": "fix: automated WCAG accessibility remediation",
            "head": branch, "base": base, "body": body,
        })
