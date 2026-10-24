from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class GithubConnection(SQLModel, table=True):
    """The single connected GitHub account (no user auth yet, so one row with id=1)."""

    id: int = Field(default=1, primary_key=True)
    mode: str  # "pat" | "app" | "oauth"
    account: str
    installation_id: int | None = None  # GitHub App only
    access_token: str | None = None  # OAuth only (user token; stored server-side, never sent to the browser)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RepoSetting(SQLModel, table=True):
    """Whether EquaLink may open PRs on a repo. Repos without a row are disabled."""

    full_name: str = Field(primary_key=True)
    enabled: bool = False


class Site(SQLModel, table=True):
    """A website the user wants EquaLink to track, optionally tied to a GitHub repo."""

    id: int | None = Field(default=None, primary_key=True)
    url: str = Field(unique=True, index=True)
    host: str
    repo: str | None = None  # owner/repo that holds this site's source
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
