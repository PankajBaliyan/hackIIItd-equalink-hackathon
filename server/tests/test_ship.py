import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

import app.db as db
from app import github, pipeline
from app.config import Settings, get_settings
from app.main import app
from app.models import FixRow, GithubConnection, IssueRow, RepoSetting, Scan
from app.shipping import plan

SOURCE = '<div>\n  <img src="a.png">\n  <p>hi</p>\n</div>\n'


@pytest.fixture
def client(monkeypatch, tmp_path):
    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    monkeypatch.setattr("app.main.get_settings", lambda: cfg)
    monkeypatch.setattr(pipeline, "get_settings", lambda: cfg)
    app.dependency_overrides[get_settings] = lambda: cfg
    with TestClient(app) as c:
        with Session(db.engine()) as s:
            s.add(Scan(id="scan_1", url="https://github.com/me/site", mode="source", level="AA", scope="page",
                       repo="me/site", engine="source", status="done", score_before=60, score_after=90))
            s.add(IssueRow(id="i1", scan_id="scan_1", page_url="x", rule_id="image-alt", wcag_sc="1.1.1", impact="critical",
                           selector="img", html="<img>", detector="static", source_file="index.html", source_line=2))
            s.add(FixRow(id="f1", scan_id="scan_1", issue_id="i1", original='  <img src="a.png">',
                         patched='  <img src="a.png" alt="A logo">', explanation="Added alt text.", confidence=0.9,
                         validated=True, start_line=2, end_line=2))
            s.add(GithubConnection(id=1, mode="oauth", account="me", access_token="t"))
            s.commit()
        yield c
    app.dependency_overrides.clear()


def stub_github(monkeypatch, calls):
    async def token(*a, **k):
        return "tok"

    async def head(t, repo):
        return "main", "sha1"

    async def file_at(t, repo, path, ref):
        return SOURCE, "blob1"

    async def branch(t, repo, name, sha):
        calls.append(("branch", name))

    async def commit(t, repo, br, path, text, blob, msg):
        calls.append(("commit", path, text))

    async def pull(t, repo, base, head, title, body, draft):
        calls.append(("pull", title, body))
        return {"number": 7, "url": "https://github.com/me/site/pull/7"}

    monkeypatch.setattr("app.routes_github._repo_token", token)
    monkeypatch.setattr(github, "branch_head", head)
    monkeypatch.setattr(github, "file_at", file_at)
    monkeypatch.setattr(github, "create_branch", branch)
    monkeypatch.setattr(github, "commit_file", commit)
    monkeypatch.setattr(github, "create_pull", pull)


def test_ship_opens_pr_and_scan_remembers_it(client, monkeypatch):
    calls = []
    stub_github(monkeypatch, calls)
    r = client.post("/scans/scan_1/ship", json={})
    assert r.status_code == 200, r.text
    pr = r.json()
    assert pr["number"] == 7 and pr["repo"] == "me/site" and pr["fixes"] == ["f1"]
    commit = next(c for c in calls if c[0] == "commit")
    assert 'alt="A logo"' in commit[2] and "<p>hi</p>" in commit[2]
    assert "60 -> 90" in next(c for c in calls if c[0] == "pull")[2]
    assert client.get("/scans/scan_1").json()["pr"]["url"].endswith("/pull/7")
    assert client.post("/scans/scan_1/ship", json={}).json()["number"] == 7
    assert [c[0] for c in calls].count("pull") == 1  # second call returns the stored PR


def test_review_excludes_a_fix_from_the_pr(client, monkeypatch):
    stub_github(monkeypatch, [])
    d = client.patch("/scans/scan_1/fixes/f1", json={"included": False})
    assert d.status_code == 200 and d.json()["fixes"][0]["included"] is False
    assert client.post("/scans/scan_1/ship", json={}).status_code == 422


def test_ship_refuses_when_repo_changed(client, monkeypatch):
    stub_github(monkeypatch, [])

    async def moved(t, repo, path, ref):
        return SOURCE.replace("a.png", "b.png"), "blob2"

    monkeypatch.setattr(github, "file_at", moved)
    r = client.post("/scans/scan_1/ship", json={})
    assert r.status_code == 409 and "rescan" in r.json()["detail"]


def test_ship_requires_the_repo_to_be_enabled(client):
    r = client.post("/scans/scan_1/ship", json={})
    assert r.status_code == 403


def test_plan_skips_overlapping_fixes():
    a = FixRow(id="a", scan_id="s", issue_id="i", original='  <img src="a.png">', patched='  <img src="a.png" alt="x">',
               explanation="e", confidence=1, validated=True, start_line=2, end_line=2)
    b = FixRow(id="b", scan_id="s", issue_id="i", original='  <img src="a.png">', patched='  <img src="a.png" alt="y">',
               explanation="e", confidence=1, validated=True, start_line=2, end_line=2)
    issue = IssueRow(id="i", scan_id="s", page_url="x", rule_id="image-alt", wcag_sc="1.1.1", impact="critical",
                     selector="img", html="", source_file="f.html", source_line=2)
    out = plan({"f.html": SOURCE}, [a, b], {"i": issue})
    assert len(out.edits) == 1 and len(out.edits[0].applied) == 1 and len(out.skipped) == 1
