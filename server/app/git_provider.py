"""Provider-neutral contract for version control strategies."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class PullRequest:
    number: int
    url: str


@dataclass
class SourceFile:
    path: str
    content: str = field(repr=False)
    sha: str


@dataclass
class FileChange:
    path: str
    content: str = field(repr=False)
    expected_sha: str


class GitProvider(ABC):
    async def get_source_file(self, *, repo: str, path: str, ref: str) -> SourceFile:
        raise NotImplementedError("This provider does not support source retrieval.")

    @abstractmethod
    async def create_pull_request(
        self, *, repo: str, title: str, head: str, base: str, body: str = "",
        changes: list[FileChange] | None = None,
    ) -> PullRequest:
        """Open a pull request, optionally preparing source changes on a new head branch."""
        raise NotImplementedError


