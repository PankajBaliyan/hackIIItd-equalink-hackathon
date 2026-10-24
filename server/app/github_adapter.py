"""GitHub implementation of the version control strategy."""

import base64
from urllib.parse import quote

from app import github
from app.git_provider import FileChange, GitProvider, PullRequest, SourceFile


class GitHubAdapter(GitProvider):
    def __init__(self, token: str):
        self.token = token

    async def get_source_file(self, *, repo: str, path: str, ref: str) -> SourceFile:
        data = {}
        try:
            async with github._client(self.token) as client:
                data = await github._check(await client.get(
                    f"/repos/{repo}/contents/{quote(path, safe='/')}", params={"ref": ref},
                ))
            if data.get("type") != "file" or data.get("encoding") != "base64":
                raise github.GitHubError(422, "Unsupported source file.")
            content = base64.b64decode(data["content"]).decode("utf-8")
            if len(content.encode("utf-8")) > 5 * 1024 * 1024:
                raise github.GitHubError(422, "Source file is too large.")
            return SourceFile(path=path, content=content, sha=data["sha"])
        finally:
            data.clear()

    async def _commit_changes(self, client, repo: str, head: str, base: str, changes: list[FileChange]) -> None:
        """Create a new branch and one atomic tree/commit, leaving the base untouched."""
        data = {}
        tree = []
        try:
            data = await github._check(await client.get(f"/repos/{repo}/git/ref/heads/{quote(base, safe='')}"))
            base_sha = data["object"]["sha"]
            # A concurrent edit must stop shipping instead of replacing a newer source file.
            for change in changes:
                data = await github._check(await client.get(
                    f"/repos/{repo}/contents/{quote(change.path, safe='/')}", params={"ref": base_sha},
                ))
                if data.get("sha") != change.expected_sha:
                    raise github.GitHubError(409, "Source changed during analysis; retry from the latest version.")
                data.clear()
                tree.append({"path": change.path, "mode": "100644", "type": "blob", "content": change.content})
            data = await github._check(await client.get(f"/repos/{repo}/git/commits/{base_sha}"))
            base_tree = data["tree"]["sha"]
            data = await github._check(await client.post(f"/repos/{repo}/git/trees", json={"base_tree": base_tree, "tree": tree}))
            tree_sha = data["sha"]
            data = await github._check(await client.post(f"/repos/{repo}/git/commits", json={
                "message": "fix: validated accessibility improvements", "tree": tree_sha, "parents": [base_sha],
            }))
            await github._check(await client.post(f"/repos/{repo}/git/refs", json={
                "ref": f"refs/heads/{head}", "sha": data["sha"],
            }))
        finally:
            for item in tree:
                item.clear()
            tree.clear()
            data.clear()

    async def create_pull_request(
        self, *, repo: str, title: str, head: str, base: str, body: str = "",
        changes: list[FileChange] | None = None,
    ) -> PullRequest:
        payload = {"title": title, "head": head, "base": base, "body": body}
        data = {}
        response = None
        try:
            async with github._client(self.token) as client:
                if changes:
                    await self._commit_changes(client, repo, head, base, changes)
                response = await client.post(f"/repos/{repo}/pulls", json=payload)
                data = await github._check(response)
                return PullRequest(number=data["number"], url=data["html_url"])
        finally:
            # GitHub echoes PR text in its response. Keep only number and URL.
            payload.clear()
            data.clear()
            if changes:
                for change in changes:
                    change.content = ""
                changes.clear()
            del payload, data, response, body, title, head, base, repo
