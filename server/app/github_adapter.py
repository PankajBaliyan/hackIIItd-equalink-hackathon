"""GitHub implementation of the version control strategy."""

from app import github
from app.git_provider import GitProvider, PullRequest


class GitHubAdapter(GitProvider):
    def __init__(self, token: str):
        self.token = token

    async def create_pull_request(
        self, *, repo: str, title: str, head: str, base: str, body: str = ""
    ) -> PullRequest:
        payload = {"title": title, "head": head, "base": base, "body": body}
        data = {}
        response = None
        try:
            async with github._client(self.token) as client:
                response = await client.post(f"/repos/{repo}/pulls", json=payload)
                data = await github._check(response)
                return PullRequest(number=data["number"], url=data["html_url"])
        finally:
            # GitHub echoes PR text in its response. Keep only number and URL.
            payload.clear()
            data.clear()
            del payload, data, response, body, title, head, base, repo
