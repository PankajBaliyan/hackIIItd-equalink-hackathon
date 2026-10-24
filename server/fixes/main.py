"""Local FastAPI service for importing, validating, reviewing and shipping fixes."""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import github, repo_scan
from .models import (
    Fix, GithubStatus, ImportScan, Issue, PullRequest, RepoSetting, ReviewFix,
    RepoFiles, RepoScanInput, Scan, ScanDetail, ShipInput, Summary,
)
from .store import open_store
from .validation import validate_candidates, validate_combination


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")


def create_app(db_path=None):
    app = FastAPI(title="EquaLink Fixes API", version="1.0.0", description=(
        "Import HTML and candidate fixes; validate with axe-core, review, and ship a GitHub PR. "
        "Validation covers static HTML snapshots. It does not prove keyboard behavior or full WCAG compliance."
    ))
    store_target = str(
        db_path
        or os.getenv("FIXES_DATABASE_URL")
        or os.getenv("DATABASE_URL")
        or ROOT.parent / "data" / "equalink-fixes.db"
    )
    store = open_store(store_target)
    app.state.store = store
    allowed_origins = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174").split(",") if v.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def local_api_boundary(request: Request, call_next):
        if request.method in {"POST", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin and origin not in allowed_origins:
                return JSONResponse(status_code=403, content={"detail": "This browser origin is not allowed."})
            # Bound JSON payloads before parsing, including chunked requests.
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 2_000_000:
                    return JSONResponse(status_code=413, content={"detail": "Request exceeds the 2 MB limit."})
            request._body = bytes(body)
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        # Pydantic error inputs can contain entire HTML documents; omit them.
        errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in error.errors()]
        return JSONResponse(status_code=422, content={"detail": "Invalid request data.", "errors": errors})

    @app.exception_handler(httpx.HTTPStatusError)
    async def github_http_error(request, error):
        status = error.response.status_code
        message = {
            401: "GitHub rejected GITHUB_TOKEN. Check the configured token.",
            403: "GitHub denied the request. Check token permissions and API rate limits.",
            404: "GitHub repository, main branch, or source file was not found or is inaccessible.",
            409: "GitHub reported a conflict. Refresh and retry the original selection.",
            422: "GitHub could not create the branch or pull request. Check the repository and retry the original selection.",
        }.get(status, "GitHub could not complete the request. Try again later.")
        return JSONResponse(status_code=status if status in (403, 404, 409, 422) else 502, content={"detail": message})

    @app.exception_handler(httpx.RequestError)
    async def github_network_error(request, error):
        return JSONResponse(status_code=502, content={"detail": "GitHub is unreachable. Retry the same selection; any existing PR will be recovered."})

    async def import_detail(payload, scan_id=None, is_demo=False):
        fixes = await validate_candidates(payload)
        scan_id = scan_id or f"scan_{uuid4().hex}"
        issues = [Issue(**i.model_dump(), scan_id=scan_id, page_url=str(payload.url)) for i in payload.issues]
        detail = ScanDetail(
            scan=Scan(id=scan_id, url=str(payload.url), repo=payload.repo,
                      mode="repo" if payload.repo else "url", level=payload.level,
                      created_at=datetime.now(timezone.utc).isoformat(), is_demo=is_demo),
            issues=issues, fixes=fixes, screenshot=payload.screenshot,
            summary=Summary(accepted=sum(f.validated for f in fixes),
                            rejected=sum(not f.validated for f in fixes),
                            review=len(issues) - len(fixes), included=sum(f.included for f in fixes)),
        )
        store.insert(detail.model_dump(), payload.page_html, replace_demo=is_demo)
        return detail

    demo_lock = asyncio.Lock()

    async def ensure_demo():
        async with demo_lock:
            try:
                store.get("demo")
                if store.setting("demo_version") == 2:
                    return
            except HTTPException as error:
                if error.status_code != 404:
                    raise
            payload = ImportScan.model_validate_json((ROOT / "demo_scan.json").read_text(encoding="utf-8"))
            await import_detail(payload, "demo", True)
            store.set_setting("demo_version", 2)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "equalink-fixes"}

    @app.post("/scans/import", response_model=ScanDetail, status_code=201)
    async def import_scan(payload: ImportScan):
        return await import_detail(payload)

    @app.get("/repo-files", response_model=RepoFiles)
    async def repo_files(repo: str = Query(pattern=r"^[\w.-]+/[\w.-]+$")):
        token = await shipping_token(repo)
        async with github.client(token) as api:
            branch, files = await repo_scan.list_html_files(api, repo)
        return RepoFiles(repo=repo, branch=branch, files=files)

    @app.post("/scans/repo", response_model=ScanDetail, status_code=201)
    async def scan_repo(payload: RepoScanInput):
        """Read an HTML file from an enabled repository, find issues and build validated fixes."""
        token = await shipping_token(payload.repo)
        async with github.client(token) as api:
            candidate = await repo_scan.build_import(api, payload.repo, payload.path, payload.level)
        return await import_detail(candidate)

    @app.post("/scans", status_code=501)
    async def create_scan():
        raise HTTPException(501, "URL crawling and fix generation are not configured. Import an HTML snapshot and candidate fixes from the Fixes page.")

    @app.get("/scans", response_model=list[Scan])
    async def list_scans():
        await ensure_demo()
        return store.list()

    @app.get("/scans/{scan_id}", response_model=ScanDetail)
    async def get_scan(scan_id: str):
        if scan_id == "demo":
            await ensure_demo()
        return store.get(scan_id)[0]

    @app.get("/scans/{scan_id}/fixes", response_model=list[Fix])
    async def list_fixes(scan_id: str, status: str = Query("all", pattern="^(all|validated|rejected|included)$")):
        detail = await get_scan(scan_id)
        return [f for f in detail["fixes"] if status == "all" or
                (status == "validated" and f["validated"]) or
                (status == "rejected" and not f["validated"]) or
                (status == "included" and f["included"])]

    @app.patch("/scans/{scan_id}/fixes/{fix_id}", response_model=ScanDetail)
    async def review_fix(scan_id: str, fix_id: str, payload: ReviewFix):
        return store.review(scan_id, fix_id, payload.included)

    @app.get("/scans/{scan_id}/events")
    async def events(scan_id: str):
        await get_scan(scan_id)
        async def stream():
            event = {"stage": "done", "type": "info", "message": "HTML snapshot and fix validation complete.", "ts": datetime.now(timezone.utc).isoformat()}
            yield f"data: {json.dumps(event)}\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.get("/pull-requests", response_model=list[PullRequest])
    async def pull_requests():
        return [detail["pr"] for scan in store.list() if (detail := store.get(scan["id"])[0]).get("pr")]

    def configured_repos():
        return [repo.strip() for repo in os.getenv("GITHUB_REPOSITORIES", "").split(",") if repo.strip()]

    def repo_enabled(repo):
        return repo in configured_repos() and store.setting("github_connected", True) and store.setting(f"repo:{repo}", True)

    async def shipping_token(repo):
        """Use the unified GitHub connection, with the old PAT allowlist as a standalone fallback."""
        try:
            from app.config import get_settings
            from app.db import engine
            from app.github import GitHubError
            from app.models import GithubConnection, RepoSetting as ConnectedRepo
            from app.routes_github import _token
            from sqlmodel import Session
        except ImportError:
            get_settings = None

        if get_settings is not None:
            with Session(engine()) as db:
                connection = db.get(GithubConnection, 1)
                enabled = db.get(ConnectedRepo, repo)
                if connection is not None:
                    if enabled is None or not enabled.enabled:
                        raise HTTPException(403, "Enable this repository in the GitHub integration before shipping.")
                    try:
                        token, _ = await _token(get_settings(), connection)
                    except GitHubError as error:
                        raise HTTPException(502, error.message) from error
                    return token

        if not os.getenv("GITHUB_TOKEN"):
            raise HTTPException(503, "Connect GitHub or set GITHUB_TOKEN before opening a PR.")
        if not repo_enabled(repo):
            raise HTTPException(403, "Enable this repository in GitHub or add it to GITHUB_REPOSITORIES before shipping.")
        return os.environ["GITHUB_TOKEN"]

    @app.get("/integrations/github", response_model=GithubStatus)
    async def github_status():
        if not os.getenv("GITHUB_TOKEN") or not store.setting("github_connected", True):
            return GithubStatus(connected=False)
        async with github.client() as api:
            user = await github.call(api, "GET", "/user")
        return GithubStatus(connected=True, account=user["login"], repos=[{"full_name": repo, "enabled": repo_enabled(repo)} for repo in configured_repos()])

    @app.post("/integrations/github/connect", response_model=GithubStatus)
    async def connect_github():
        if not os.getenv("GITHUB_TOKEN"):
            raise HTTPException(503, "Set GITHUB_TOKEN and GITHUB_REPOSITORIES in server/.env, then restart the backend.")
        async with github.client() as api:
            await github.call(api, "GET", "/user")
        store.set_setting("github_connected", True)
        return await github_status()

    @app.delete("/integrations/github", response_model=GithubStatus)
    async def disconnect_github():
        store.set_setting("github_connected", False)
        return GithubStatus(connected=False)

    @app.patch("/integrations/github/repos", response_model=GithubStatus)
    async def update_repo(payload: RepoSetting):
        if payload.full_name not in configured_repos():
            raise HTTPException(404, "Repository is not in the backend's GITHUB_REPOSITORIES allowlist.")
        store.set_setting(f"repo:{payload.full_name}", payload.enabled)
        return await github_status()

    @app.post("/scans/{scan_id}/ship", response_model=PullRequest)
    async def ship(scan_id: str, payload: ShipInput):
        detail, html = store.get(scan_id)
        requested = payload.fix_ids
        if detail.get("pr"):
            if requested is not None and set(requested) != set(detail["pr"]["fixes"]):
                raise HTTPException(409, "This scan already has a PR with a different fix selection.")
            return detail["pr"]
        scan = detail["scan"]
        repo = scan.get("repo")
        if scan["is_demo"] or not repo:
            raise HTTPException(422, "Import a real scan with an owner/repo before opening a PR. Demo data cannot be shipped.")
        token = await shipping_token(repo)
        fix_map = {fix["id"]: fix for fix in detail["fixes"]}
        ids = requested if requested is not None else [f["id"] for f in detail["fixes"] if f["included"]]
        if not ids or len(ids) != len(set(ids)) or any(i not in fix_map for i in ids):
            raise HTTPException(422, "Select one or more distinct fixes belonging to this scan.")
        fixes = [fix_map[i] for i in sorted(ids)]
        if any(not f["validated"] or not f["included"] for f in fixes):
            raise HTTPException(422, "Only validated, included fixes can be shipped.")
        issue_map = {issue["id"]: issue for issue in detail["issues"]}
        changes = {}
        for fix in fixes:
            source = issue_map[fix["issue_id"]].get("source_file")
            if not source:
                raise HTTPException(422, "Every selected fix needs a source_file repository mapping.")
            changes.setdefault(source, []).append(fix)
        branch = f"a11y-fix-{scan_id}"
        store.reserve(scan_id, {"branch": branch, "fix_ids": sorted(ids)})
        github_started = False
        try:
            await validate_combination(html, fixes, scan["level"])
            body = "## Accessibility fixes\n\n" + "\n".join(
                f"- {issue_map[f['issue_id']]['rule_id']} (WCAG {issue_map[f['issue_id']]['wcag_sc']}) in `{issue_map[f['issue_id']]['source_file']}`"
                for f in fixes
            ) + "\n\nValidated with axe-core on a static HTML snapshot. Manual review of behavior and visual context is still required."
            github_started = True
            remote = await github.open_pull_request(repo, branch, changes, body, token=token)
            pr = PullRequest(scan_id=scan_id, repo=repo, branch=remote["head"]["ref"], number=remote["number"], url=remote["html_url"], fixes=sorted(ids))
            store.finish(scan_id, pr.model_dump())
            return pr
        except BaseException:
            store.finish(scan_id, clear_shipment=not github_started)
            raise

    # The unified server's live-scan router delegates here when an ID belongs
    # to an imported Fixes scan. Keeping these callables explicit avoids two
    # overlapping FastAPI routes silently hiding one another.
    app.state.list_scans = list_scans
    app.state.get_scan = get_scan
    app.state.events = events
    app.state.ship = ship
    app.state.scan_repo = scan_repo

    return app


app = create_app()
