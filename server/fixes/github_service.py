"""Standalone single-file GitHub helper for the Fixes module."""

import base64
import datetime
import os
from urllib.parse import quote

import httpx


BASE_URL = "https://api.github.com"


def encode_to_base64(content: str) -> str:
    """Encode UTF-8 text for GitHub's file contents API."""
    return base64.b64encode(content.encode("utf-8")).decode("ascii")


async def create_accessibility_pr(
    owner: str,
    repo: str,
    file_path: str,
    broken_html: str,
    fixed_html: str,
) -> str:
    """Patch a file from main on a new branch and return the pull request URL.

    Requires GITHUB_TOKEN with permission to write contents and pull requests.
    HTTP failures raise httpx.HTTPStatusError; unsuccessful later steps may
    leave the newly created branch in the repository.
    """
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("Set GITHUB_TOKEN before creating a pull request.")
    if not broken_html or broken_html == fixed_html:
        raise ValueError("Provide nonempty broken_html and a different fixed_html.")
    if not owner or not repo or not file_path:
        raise ValueError("owner, repo, and file_path are required.")

    repository = f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}"
    contents_path = f"{repository}/contents/{quote(file_path, safe='/')}"
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y%m%d%H%M%S%f"
    )
    branch = f"a11y-fix-{timestamp}"

    async with httpx.AsyncClient(
        base_url=BASE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
        timeout=30.0,
    ) as client:
        response = await client.get(f"{repository}/git/refs/heads/main")
        response.raise_for_status()
        commit_sha = response.json()["object"]["sha"]

        response = await client.post(
            f"{repository}/git/refs",
            json={"ref": f"refs/heads/{branch}", "sha": commit_sha},
        )
        response.raise_for_status()

        response = await client.get(contents_path, params={"ref": "main"})
        response.raise_for_status()
        file_data = response.json()
        if file_data.get("encoding") != "base64":
            raise ValueError("GitHub did not return base64-encoded file content.")
        original_content = base64.b64decode(file_data["content"]).decode("utf-8")
        if broken_html not in original_content:
            raise ValueError(f"broken_html was not found in {file_path} on main.")
        patched_content = original_content.replace(broken_html, fixed_html)

        response = await client.put(
            contents_path,
            json={
                "message": "fix: automated WCAG accessibility remediation",
                "content": encode_to_base64(patched_content),
                "sha": file_data["sha"],
                "branch": branch,
            },
        )
        response.raise_for_status()

        response = await client.post(
            f"{repository}/pulls",
            json={
                "title": "fix: automated WCAG accessibility remediation",
                "head": branch,
                "base": "main",
                "body": f"Apply automated accessibility remediation to `{file_path}`.",
            },
        )
        response.raise_for_status()
        return response.json()["html_url"]
