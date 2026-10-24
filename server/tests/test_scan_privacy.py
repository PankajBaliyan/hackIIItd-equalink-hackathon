import json
from types import SimpleNamespace

import pytest
from sqlmodel import Session, select

import app.db as database
from app import pipeline
from app.config import Settings
from app.models import EventRow, IssueRow, Scan
from app.routes_pull_requests import PullRequestIn, create_pull_request
from app.git_provider import PullRequest

SECRET = "PRIVATE-DOM-CONTENT"


@pytest.fixture
def db(monkeypatch, tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path}/privacy.db")
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "get_settings", lambda: settings)
    database.init_db()
    with Session(database.engine()) as session:
        yield session


def raw_result():
    return {"violations": [{
        "id": "image-alt", "tags": ["wcag111"], "impact": "serious",
        "nodes": [{"html": f"<img alt='{SECRET}'>", "target": [f"#{SECRET}"],
                   "failureSummary": SECRET}],
    }]}


@pytest.mark.parametrize("malformed", [False, True])
async def test_analysis_releases_raw_results_on_success_and_failure(malformed):
    raw = raw_result()
    if malformed:
        del raw["violations"][0]["id"]

    async def evaluate(*args):
        return raw

    scan = Scan(id="s", url="https://example.com", mode="url", level="AA", scope="page")
    page = SimpleNamespace(evaluate=evaluate)
    if malformed:
        with pytest.raises(KeyError):
            await pipeline.analyze_page(page, scan, scan.url)
    else:
        issues = await pipeline.analyze_page(page, scan, scan.url)
        assert len(issues) == 1
        assert issues[0].rule_id == "image-alt" and issues[0].impact == "serious"
        assert SECRET not in issues[0].model_dump_json()
        assert issues[0].html == "" and issues[0].selector == "" and issues[0].context is None
    assert raw == {}


def test_events_and_issue_responses_strip_dom_and_fixes(db):
    row = IssueRow(id="i", scan_id="s", page_url="https://example.com", rule_id="image-alt",
                   wcag_sc="1.1.1", impact="serious", selector=SECRET, html=SECRET, context=SECRET)
    issue = row.model_dump() | {"fix": SECRET}
    pipeline.emit(db, "s", "diagnosing", SECRET, "issue", issue=issue)
    event = db.exec(select(EventRow)).one()
    assert SECRET not in event.payload
    assert SECRET not in json.dumps(pipeline.issue_dict(row))


def test_startup_scrubs_legacy_persistence(db):
    db.add(IssueRow(id="legacy", scan_id="s", page_url="https://example.com", rule_id="image-alt",
                   wcag_sc="1.1.1", impact="serious", selector=SECRET, html=SECRET, context=SECRET))
    db.add(EventRow(scan_id="s", payload=json.dumps({"stage": "diagnosing", "message": SECRET,
                                                   "fix": SECRET, "issue": {"html": SECRET}})))
    db.add(Scan(id="s", url="https://example.com", mode="url", level="AA", scope="page", error=SECRET))
    db.commit()
    database.purge_legacy_scan_content()
    db.expire_all()
    assert SECRET not in db.exec(select(IssueRow)).one().model_dump_json()
    assert SECRET not in db.exec(select(EventRow)).one().payload
    assert SECRET not in db.get(Scan, "s").error


@pytest.mark.parametrize("fails", [False, True])
async def test_pr_input_released_after_provider_call(monkeypatch, fails):
    from app import git_providers

    class Provider:
        async def create_pull_request(self, **kwargs):
            assert kwargs["body"] == SECRET
            if fails:
                raise RuntimeError("provider failed")
            return PullRequest(number=1, url="https://example.com/pr/1")

    async def factory(*args):
        return Provider()

    monkeypatch.setattr(git_providers, "get_git_provider", factory)
    db = SimpleNamespace(get=lambda *args: SimpleNamespace(enabled=True))
    body = PullRequestIn(repo="owner/repo", title=SECRET, head="fix", base="main", body=SECRET)
    if fails:
        with pytest.raises(RuntimeError):
            await create_pull_request(body, db, Settings(_env_file=None))
    else:
        assert (await create_pull_request(body, db, Settings(_env_file=None))).number == 1
    assert body.body == "" and body.title == "" and body.head == "" and body.base == ""
