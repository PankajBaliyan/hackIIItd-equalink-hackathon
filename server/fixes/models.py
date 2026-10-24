"""Validated API contracts for the fixes workflow."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IssueInput(Model):
    id: str = Field(min_length=1, max_length=100)
    rule_id: str = Field(min_length=1, max_length=100)
    wcag_sc: str = Field(pattern=r"^[1-4]\.\d+\.\d+$")
    impact: Literal["critical", "serious", "moderate", "minor"]
    selector: str = Field(min_length=1, max_length=1000)
    html: str = Field(min_length=1, max_length=100_000)
    context: str | None = None
    source_file: str | None = None
    source_line: int | None = Field(default=None, ge=1)
    source_excerpt: str | None = Field(default=None, max_length=20_000)

    @field_validator("source_file")
    @classmethod
    def relative_source(cls, value):
        if value is not None and (
            not value or value.startswith("/") or "\\" in value
            or any(part in ("", ".", "..") for part in value.split("/"))
        ):
            raise ValueError("source_file must be a relative repository path")
        return value


class CandidateFix(Model):
    id: str = Field(min_length=1, max_length=100)
    issue_id: str = Field(min_length=1, max_length=100)
    strategy: Literal["rule", "llm"] = "rule"
    original: str = Field(min_length=1, max_length=100_000)
    patched: str = Field(min_length=1, max_length=100_000)
    explanation: str = Field(min_length=1, max_length=5000)
    confidence: float = Field(default=0, ge=0, le=1)


class ImportScan(Model):
    url: HttpUrl
    repo: str | None = Field(default=None, pattern=r"^[\w.-]+/[\w.-]+$")
    level: Literal["A", "AA", "AAA"] = "AA"
    page_html: str = Field(min_length=1, max_length=1_000_000)
    issues: list[IssueInput] = Field(max_length=100)
    fixes: list[CandidateFix] = Field(max_length=100)
    screenshot: str | None = Field(default=None, max_length=2_000_000)

    @model_validator(mode="after")
    def coherent_candidates(self):
        ids = [issue.id for issue in self.issues]
        fix_ids = [fix.id for fix in self.fixes]
        references = [fix.issue_id for fix in self.fixes]
        if len(ids) != len(set(ids)) or len(fix_ids) != len(set(fix_ids)):
            raise ValueError("Issue IDs and fix IDs must be unique within the scan")
        if len(references) != len(set(references)) or not set(references).issubset(ids):
            raise ValueError("Each candidate must reference one distinct existing issue")
        return self


class Scan(Model):
    id: str
    url: str
    repo: str | None = None
    mode: Literal["url", "repo"]
    level: Literal["A", "AA", "AAA"]
    scope: Literal["page"] = "page"
    status: Literal["done"] = "done"
    created_at: str
    is_demo: bool = False
    validation_engine: Literal["axe-core"] = "axe-core"


class Issue(IssueInput):
    scan_id: str
    page_url: str


class Fix(CandidateFix):
    validated: bool
    included: bool
    violations_before: int
    violations_after: int
    rejected_reason: str | None = None


class PullRequest(Model):
    scan_id: str
    repo: str
    branch: str
    number: int
    url: str
    fixes: list[str]


class Summary(Model):
    accepted: int
    rejected: int
    review: int
    included: int


class ScanDetail(Model):
    scan: Scan
    issues: list[Issue]
    fixes: list[Fix]
    summary: Summary
    pr: PullRequest | None = None
    screenshot: str | None = Field(default=None, max_length=2_000_000)


class ReviewFix(Model):
    included: bool


class ShipInput(Model):
    fix_ids: list[str] | None = Field(default=None, max_length=100)


class GithubRepo(Model):
    full_name: str
    enabled: bool


class GithubStatus(Model):
    connected: bool
    account: str | None = None
    repos: list[GithubRepo] = []


class RepoSetting(Model):
    full_name: str = Field(pattern=r"^[\w.-]+/[\w.-]+$")
    enabled: bool


class RepoScanInput(Model):
    repo: str = Field(pattern=r"^[\w.-]+/[\w.-]+$")
    path: str | None = Field(default=None, max_length=500)
    level: Literal["A", "AA", "AAA"] = "AA"


class RepoFiles(Model):
    repo: str
    branch: str
    files: list[str]
