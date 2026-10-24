import pytest
from fastapi.testclient import TestClient

import app.db as db
from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    # The scheduler reads settings too; without this it would use server/.env and start a real TinyFish run.
    monkeypatch.setattr("app.rule_sync.get_settings", lambda: cfg)

    async def no_network(*_a, **_k):
        raise AssertionError("tests must not call TinyFish")

    monkeypatch.setattr("app.rule_sync.fetch_rules", no_network)
    app.dependency_overrides[get_settings] = lambda: cfg
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_starts_empty(client):
    assert client.get("/rule-docs").json() == []


def test_add_single_and_batch(client):
    one = client.post("/rule-docs", json={"title": " WCAG 1.1.1 ", "content": "Text alternatives", "source_url": "w3.org/WAI"})
    assert one.status_code == 201
    assert one.json()[0]["title"] == "WCAG 1.1.1" and one.json()[0]["source_url"] == "https://w3.org/WAI"
    batch = client.post("/rule-docs", json=[{"title": "a", "content": "x"}, {"title": "b", "content": "y"}])
    assert [d["title"] for d in batch.json()] == ["a", "b"]
    assert len(client.get("/rule-docs").json()) == 3


def test_batch_is_all_or_nothing(client):
    r = client.post("/rule-docs", json=[{"title": "ok", "content": "x"}, {"title": "", "content": "y"}])
    assert r.status_code == 422
    assert client.get("/rule-docs").json() == []


def test_delete(client):
    doc_id = client.post("/rule-docs", json={"title": "t", "content": "c"}).json()[0]["id"]
    assert client.delete(f"/rule-docs/{doc_id}").status_code == 204
    assert client.delete(f"/rule-docs/{doc_id}").status_code == 404


# --- W3C rules sync -----------------------------------------------------------------------------

from datetime import timedelta  # noqa: E402

from sqlmodel import Session  # noqa: E402

from app import rule_sync  # noqa: E402
from app.models import RuleSync  # noqa: E402

ALT = {
    "title": "Provide Text Alternatives for Non-text Content",
    "content": "Requirement: ... WCAG reference: Success Criterion 1.1.1, Non-text Content, WCAG 2.2 Level A.",
    "sourceurl": "https://w3c.github.io/wcag/understanding/non-text-content.html, https://www.w3.org/WAI/WCAG22/quickref/#non-text-content",
}
CONTRAST = {
    "title": "Ensure Sufficient Text Color Contrast",
    "content": "Requirement: ... WCAG reference: Success Criterion 1.4.3, Contrast (Minimum), WCAG 2.2 Level AA.",
    "sourceurl": "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
}


@pytest.fixture
def synced(client, monkeypatch):
    """A client with a TinyFish key whose agent returns whatever `agent['result']` holds."""
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=db.get_settings().database_url, tinyfish_api_key="k", w3c_sync_schedule=False)
    agent = {"result": {"result": [ALT, CONTRAST]}, "goals": []}

    async def fake_fetch(settings, goal, on_run_id=None):
        agent["goals"].append(goal)
        return agent["result"]

    monkeypatch.setattr(rule_sync, "fetch_rules", fake_fetch)
    app.dependency_overrides[get_settings] = lambda: cfg
    monkeypatch.setattr(rule_sync, "get_settings", lambda: cfg)
    client.agent = agent
    return client


def test_sync_requires_api_key(client):
    assert client.post("/rule-docs/sync").status_code == 503
    assert client.get("/rule-docs/sync").json()["configured"] is False


def test_sync_adds_rules_and_keeps_all_source_urls(synced):
    r = synced.post("/rule-docs/sync")
    assert r.status_code == 202
    status = synced.get("/rule-docs/sync").json()
    assert (status["status"], status["received"], status["added"], status["skipped"]) == ("done", 2, 2, 0)
    docs = {d["title"]: d for d in synced.get("/rule-docs").json()}
    assert docs[ALT["title"]]["origin"] == "w3c-sync"
    assert docs[ALT["title"]]["source_url"] == ALT["sourceurl"]


def test_sync_twice_adds_nothing_new(synced):
    synced.post("/rule-docs/sync")
    synced.post("/rule-docs/sync")
    status = synced.get("/rule-docs/sync").json()
    assert (status["added"], status["skipped"]) == (0, 2)
    assert len(synced.get("/rule-docs").json()) == 2


def test_reworded_title_with_same_criterion_is_a_duplicate(synced):
    synced.post("/rule-docs/sync")
    synced.agent["result"] = [{**ALT, "title": "Text Alternatives for Informative Images"}, {**CONTRAST, "content": "No SC here", "title": "A brand new rule"}]
    synced.post("/rule-docs/sync")
    titles = {d["title"] for d in synced.get("/rule-docs").json()}
    assert "Text Alternatives for Informative Images" not in titles and "A brand new rule" in titles


def test_manual_doc_blocks_a_synced_duplicate_and_batch_duplicates_collapse(synced):
    synced.post("/rule-docs", json={"title": "Contrast notes", "content": "See Success Criterion 1.4.3 for details."})
    synced.agent["result"] = [ALT, ALT, CONTRAST]
    synced.post("/rule-docs/sync")
    assert sorted(d["title"] for d in synced.get("/rule-docs").json()) == sorted([ALT["title"], "Contrast notes"])


def test_goal_lists_stored_rules_so_the_agent_skips_them(synced):
    synced.post("/rule-docs/sync")
    synced.post("/rule-docs/sync")
    first, second = synced.agent["goals"]
    assert "Already Stored" not in first
    assert "SC 1.1.1: Provide Text Alternatives for Non-text Content" in second and "SC 1.4.3" in second


def test_empty_result_is_a_successful_sync(synced):
    synced.agent["result"] = []
    synced.post("/rule-docs/sync")
    assert synced.get("/rule-docs/sync").json()["status"] == "done"


@pytest.mark.parametrize("result", ["not json", {"a": 1}, 7])
def test_unusable_answer_fails_the_run_without_adding(synced, result):
    synced.agent["result"] = result
    synced.post("/rule-docs/sync")
    status = synced.get("/rule-docs/sync").json()
    assert status["status"] == "failed" and status["error"]
    assert synced.get("/rule-docs").json() == []


def test_answer_may_be_fenced_json_string_and_malformed_items_are_skipped(synced):
    import json

    synced.agent["result"] = "```json\n" + json.dumps([ALT, {"title": "", "content": "x"}, "junk"]) + "\n```"
    synced.post("/rule-docs/sync")
    status = synced.get("/rule-docs/sync").json()
    assert (status["added"], status["skipped"]) == (1, 2)


def test_second_sync_is_refused_while_one_is_running(synced):
    with Session(db.engine()) as s:
        rule_sync.start(s, "manual")
    assert synced.post("/rule-docs/sync").status_code == 409


def test_schedule_runs_monthly_and_waits_a_day_after_a_failure(synced):
    cfg = rule_sync.get_settings()
    with Session(db.engine()) as s:
        assert rule_sync.next_due(s, cfg) is None  # never synced: a person starts the first run
        ok = rule_sync.start(s, "manual")
        ok.status, ok.finished_at = "done", rule_sync._now() - timedelta(days=10)
        s.add(ok), s.commit()
        assert rule_sync.next_due(s, cfg) > rule_sync._now() + timedelta(days=19)
        ok.finished_at = rule_sync._now() - timedelta(days=31)
        s.add(ok), s.commit()
        assert rule_sync.next_due(s, cfg) <= rule_sync._now()  # a month has passed
        bad = rule_sync.start(s, "schedule")
        bad.status, bad.finished_at = "failed", rule_sync._now()
        s.add(bad), s.commit()
        assert rule_sync.next_due(s, cfg) > rule_sync._now() + timedelta(hours=23)  # retry tomorrow


def test_orphaned_running_sync_is_failed_on_startup(client):
    with Session(db.engine()) as s:
        rule_sync.start(s, "manual")
    rule_sync.fail_orphaned_syncs()
    assert client.get("/rule-docs/sync").json()["status"] == "failed"


# --- TinyFish stream parsing (no network: httpx MockTransport) -------------------------------------

import json  # noqa: E402

import httpx  # noqa: E402


def _stream(*events, status=200):
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events).encode()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"], seen["body"] = request.headers.get("x-api-key"), json.loads(request.content)
        return httpx.Response(status, content=body, headers={"content-type": "text/event-stream"})

    return httpx.MockTransport(handler), seen


def _cfg():
    return Settings(_env_file=None, tinyfish_api_key="secret-key")


def test_fetch_returns_result_of_complete_event_and_reports_run_id():
    import asyncio

    transport, seen = _stream(
        {"type": "STARTED", "run_id": "run_1"},
        {"type": "PROGRESS", "purpose": "Reading"},
        {"type": "HEARTBEAT"},
        {"type": "COMPLETE", "run_id": "run_1", "status": "COMPLETED", "result": {"result": [ALT]}},
    )
    ids = []
    out = asyncio.run(rule_sync.fetch_rules(_cfg(), "the goal", ids.append, transport))
    assert out == {"result": [ALT]} and ids == ["run_1"]
    assert seen["key"] == "secret-key" and seen["body"] == {"url": "https://www.w3.org/TR/", "goal": "the goal"}


@pytest.mark.parametrize(
    "events,status,message",
    [
        ([{"type": "COMPLETE", "status": "FAILED", "error": {"message": "Site blocked"}}], 200, "Site blocked"),
        ([{"type": "PROGRESS", "purpose": "x"}], 200, "without a result"),
        ([], 401, "HTTP 401"),
    ],
)
def test_fetch_failures_become_sync_errors(events, status, message):
    import asyncio

    transport, _ = _stream(*events, status=status)
    with pytest.raises(rule_sync.SyncError, match=message):
        asyncio.run(rule_sync.fetch_rules(_cfg(), "g", None, transport))


def test_manual_source_url_must_be_a_web_address(client):
    assert client.post("/rule-docs", json={"title": "t", "content": "c", "source_url": "not a url, ftp://x.y"}).status_code == 422
    ok = client.post("/rule-docs", json={"title": "t", "content": "c", "source_url": "https://a.org/x#frag, b.org"})
    assert ok.json()[0]["source_url"] == "https://a.org/x#frag, https://b.org"
