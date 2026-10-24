import asyncio

from fixes import repo_scan
from fixes.validation import validate_candidates

BROKEN = (
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head>'
    '<body><main><h1>Shop</h1><img src="img/red-car.png"><input type="text" name="email">'
    '<a href="#"></a></main></body></html>'
)


def test_repo_scan_generates_validated_fixes(monkeypatch):
    async def files(api, repo):
        return "main", ["index.html"]

    async def fetch(api, repo, path, branch):
        return BROKEN

    monkeypatch.setattr(repo_scan, "list_html_files", files)
    monkeypatch.setattr(repo_scan, "fetch_file", fetch)

    async def run():
        payload = await repo_scan.build_import(None, "me/shop", None)
        return payload, await validate_candidates(payload)

    payload, fixes = asyncio.run(run())
    rules = {i.rule_id: i for i in payload.issues}
    assert {"image-alt", "html-has-lang", "document-title", "label", "meta-viewport", "link-name"} <= set(rules)
    by_issue = {f.issue_id: f for f in fixes}
    assert rules["link-name"].id not in by_issue  # no safe automatic fix: stays for manual review
    for rule in ("image-alt", "html-has-lang", "document-title", "label", "meta-viewport"):
        fix = by_issue[rules[rule].id]
        assert fix.validated, (rule, fix.rejected_reason)
    assert 'alt="Red car"' in by_issue[rules["image-alt"].id].patched


def test_github_url_scan_uses_repo_scan_not_a_crawl(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    import app.db as db
    from app.config import Settings, get_settings
    from app.main import app
    from fixes import repo_scan as rs

    cfg = Settings(_env_file=None, state_secret="x" * 32, database_url=f"sqlite:///{tmp_path}/s.db")
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: cfg)
    app.dependency_overrides[get_settings] = lambda: cfg
    seen = {}

    async def fake(self_or_payload=None, *a, **k):  # replaces the Fixes app's scan_repo
        raise AssertionError("unused")

    from app import routes_scans

    class Detail:
        scan = type("S", (), {"model_dump": lambda self: {"id": "scan_x", "status": "done", "mode": "repo"}})()

    class State:
        async def scan_repo(self, payload):
            seen["repo"] = payload.repo
            return Detail()

    monkeypatch.setattr(routes_scans, "fixes_service", lambda: type("A", (), {"state": State()})())
    with TestClient(app) as c:
        r = c.post("/scans", json={"url": "https://github.com/octocat/hello-world/tree/main"})
    app.dependency_overrides.clear()
    assert r.status_code == 201 and r.json()["id"] == "scan_x" and seen["repo"] == "octocat/hello-world"
