import asyncio
import json
import secrets
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app import pipeline, tinyfish_browser
from app.config import Settings, get_settings
from app.db import engine, get_session
from app.models import EventRow, FixRow, IssueRow, RuleDoc, Scan
from app.routes_sites import normalize_url, REPO_RE

router = APIRouter(prefix="/scans", tags=["scans"])
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
TERMINAL = {"done", "failed"}


class ScanIn(BaseModel):
    url: str | None = None  # a site scan needs it; a repo scan takes the repo instead
    repo: str | None = None
    target: Literal["site", "repo"] = "site"  # "repo": scan the repo's source code instead of a rendered page
    level: Literal["A", "AA", "AAA"] = "AA"
    scope: Literal["page", "site"] = "page"
    auto_ship: bool = False


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=None).isoformat() + "Z"  # stored as UTC


def scan_out(s: Scan) -> dict:
    out = {
        "id": s.id, "url": s.url, "mode": s.mode, "level": s.level, "scope": s.scope, "engine": s.engine,
        "status": s.status, "created_at": _iso(s.created_at),
    }
    if s.score_before is not None:
        out["score_before"] = s.score_before
    if s.score_after is not None:
        out["score_after"] = s.score_after
    if s.error:
        out["error"] = s.error
    return out


@router.post("", status_code=201)
async def create_scan(body: ScanIn, db: SessionDep, settings: SettingsDep):
    repo = (body.repo or "").strip() or None
    if repo and not REPO_RE.match(repo):
        raise HTTPException(422, "Repository must look like owner/repo.")
    if body.target == "repo":
        if not repo:
            raise HTTPException(422, "Enter the repository to scan, like owner/repo.")
        url, mode, engine = f"https://github.com/{repo}", "source", "source"
    else:
        if not body.url:
            raise HTTPException(422, "Enter a website URL.")
        url = normalize_url(body.url)
        pipeline.check_target(settings, url)
        mode, engine = "repo" if repo else "url", tinyfish_browser.choose_engine(settings, url)
    scan = Scan(
        id=f"scan_{secrets.token_hex(4)}", url=url, mode=mode,
        level=body.level, scope=body.scope, repo=repo, engine=engine,
    )
    db.add(scan)
    db.commit()
    pipeline.emit(db, scan.id, "queued", "scan queued")
    pipeline.start(scan.id)
    return scan_out(scan)


@router.get("")
def list_scans(db: SessionDep):
    return [scan_out(s) for s in db.exec(select(Scan).order_by(Scan.created_at.desc())).all()]  # type: ignore[attr-defined]


@router.get("/{scan_id}")
def get_scan(scan_id: str, db: SessionDep):
    scan = db.get(Scan, scan_id)
    if not scan:
        raise HTTPException(404, "Scan not found.")
    issues = db.exec(select(IssueRow).where(IssueRow.scan_id == scan_id)).all()
    ids = {i.rule_doc_id for i in issues if i.rule_doc_id}
    docs = {d.id: d for d in db.exec(select(RuleDoc).where(RuleDoc.id.in_(ids))).all()} if ids else {}  # type: ignore[attr-defined]
    fixes = db.exec(select(FixRow).where(FixRow.scan_id == scan_id)).all()
    return {
        "scan": scan_out(scan), "issues": [pipeline.issue_dict(i, docs.get(i.rule_doc_id)) for i in issues],
        "fixes": [pipeline.fix_dict(f) for f in fixes],
    }


@router.get("/{scan_id}/log")
def get_log(scan_id: str, db: SessionDep):
    """Every event of the scan so far as plain JSON, for opening a scan that already finished."""
    if not db.get(Scan, scan_id):
        raise HTTPException(404, "Scan not found.")
    rows = db.exec(select(EventRow).where(EventRow.scan_id == scan_id).order_by(EventRow.id)).all()  # type: ignore[arg-type]
    return [json.loads(r.payload) for r in rows]


@router.post("/{scan_id}/ship")
def ship(scan_id: str):
    raise HTTPException(501, "Opening pull requests isn't implemented yet: no automatic fixes exist to ship.")


@router.get("/{scan_id}/events")
async def events(
    scan_id: str, request: Request, last_event_id: Annotated[str | None, Header()] = None, after: int = 0
):
    """Server-Sent Events: tails the scan's event log until a terminal stage.

    Resumes after the Last-Event-ID header (the browser's own reconnect) or the `after` query parameter (a client
    that opens a fresh EventSource, which sends no header). The later of the two wins.
    """
    with Session(engine()) as db:
        if not db.get(Scan, scan_id):
            raise HTTPException(404, "Scan not found.")
    cursor = max(int(last_event_id) if last_event_id and last_event_id.isdigit() else 0, after)

    async def stream() -> AsyncIterator[str]:
        nonlocal cursor
        while not await request.is_disconnected():
            with Session(engine()) as db:
                rows = db.exec(
                    select(EventRow).where(EventRow.scan_id == scan_id, EventRow.id > cursor).order_by(EventRow.id)  # type: ignore[arg-type]
                ).all()
            for r in rows:
                cursor = r.id  # type: ignore[assignment]
                yield f"id: {r.id}\ndata: {r.payload}\n\n"
                if json.loads(r.payload)["stage"] in TERMINAL:
                    return
            await asyncio.sleep(0.4)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
