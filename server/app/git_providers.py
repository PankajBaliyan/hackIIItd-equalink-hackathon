"""Register new providers here without changing the PR route."""

from collections.abc import Awaitable, Callable

from app import github
from app.config import Settings
from app.git_provider import GitProvider
from app.github_adapter import GitHubAdapter
from app.models import GithubConnection


class UnsupportedGitProvider(ValueError):
    pass


async def _github(settings: Settings, connection: GithubConnection) -> GitProvider:
    token, _ = await github.connection_token(settings, connection)
    return GitHubAdapter(token)


PROVIDERS: dict[str, Callable[[Settings, GithubConnection], Awaitable[GitProvider]]] = {
    "github": _github,
}


async def get_git_provider(name: str, settings: Settings, connection: GithubConnection) -> GitProvider:
    try:
        factory = PROVIDERS[name]
    except KeyError:
        raise UnsupportedGitProvider(f"Unsupported git provider: {name}") from None
    return await factory(settings, connection)
