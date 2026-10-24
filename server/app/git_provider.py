"""Provider-neutral contract for version control strategies."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class PullRequest:
    number: int
    url: str


class GitProvider(ABC):
    @abstractmethod
    async def create_pull_request(
        self, *, repo: str, title: str, head: str, base: str, body: str = ""
    ) -> PullRequest:
        """Open a pull request between existing branches."""
        raise NotImplementedError


