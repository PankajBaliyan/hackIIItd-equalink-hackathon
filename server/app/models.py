from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


class GithubConnection(SQLModel, table=True):
    """The single connected GitHub account (no user auth yet, so one row with id=1)."""

    id: int = Field(default=1, primary_key=True)
    mode: str  # "pat" | "app" | "oauth"
    account: str
    installation_id: int | None = None  # GitHub App only
    access_token: str | None = None  # OAuth/PAT token; stored server-side, never sent to the browser
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


class RuleDoc(SQLModel, table=True):
    """A reference document (e.g. a W3C/WCAG rule page). Added by hand or by an agent via the API."""

    __tablename__ = "ruledoc"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    source_url: str | None = Field(default=None, index=True)  # where the content came from, if anywhere
    content: str
    origin: str = "manual"  # "manual" | "w3c-sync"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RuleSync(SQLModel, table=True):
    """One run of the W3C rules sync. The newest finished run decides when the next one is due."""

    __tablename__ = "rulesync"

    id: int | None = Field(default=None, primary_key=True)
    trigger: str  # "schedule" | "manual"
    status: str = "running"  # running | done | failed
    received: int = 0  # rules the agent returned
    added: int = 0
    skipped: int = 0  # duplicates of stored docs, or malformed
    error: str | None = None
    tinyfish_run_id: str | None = None
    started_at: datetime
    finished_at: datetime | None = None


class Scan(SQLModel, table=True):
    id: str = Field(primary_key=True)
    url: str
    mode: str  # "url" | "repo"
    level: str  # A | AA | AAA
    scope: str  # page | site
    repo: str | None = None
    status: str = "queued"
    score_before: int | None = None
    score_after: int | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IssueRow(SQLModel, table=True):
    __tablename__ = "issue"

    id: str = Field(primary_key=True)
    scan_id: str = Field(index=True)
    page_url: str
    rule_id: str
    wcag_sc: str
    impact: str
    selector: str
    html: str
    context: str | None = None


class EventRow(SQLModel, table=True):
    """Append-only progress log; the SSE endpoint tails it, so it survives reconnects."""

    id: int | None = Field(default=None, primary_key=True)
    scan_id: str = Field(index=True)
    payload: str  # JSON of the dashboard's ScanEvent
