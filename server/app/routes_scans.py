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

from app import pipeline
from app.config import Settings, get_settings
from app.db import engine, get_session
from app.models import EventRow, IssueRow, Scan
from app.routes_sites import normalize_url, REPO_RE

router = APIRouter(prefix="/scans", tags=["scans"])
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
TERMINAL = {"done", "failed"}


class ScanIn(BaseModel):
    url: str
    repo: str | None = None
    level: Literal["A", "AA", "AAA"] = "AA"
    scope: Literal["page", "site"] = "page"
    auto_ship: bool = False


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=None).isoformat() + "Z"  # stored as UTC


def scan_out(s: Scan) -> dict:
    out = {
        "id": s.id, "url": s.url, "mode": s.mode, "level": s.level, "scope": s.scope,
        "status": s.status, "created_at": _iso(s.created_at),
    }
    if s.score_before is not None:
        out["score_before"] = s.score_before
    if s.score_after is not None:
        out["score_after"] = s.score_after
    return out


@router.post("", status_code=201)
async def create_scan(body: ScanIn, db: SessionDep, settings: SettingsDep):
    url = normalize_url(body.url)
    pipeline.check_target(settings, url)
    repo = (body.repo or "").strip() or None
    if repo and not REPO_RE.match(repo):
        raise HTTPException(422, "Repository must look like owner/repo.")
    scan = Scan(
        id=f"scan_{secrets.token_hex(4)}", url=url, mode="repo" if repo else "url",
        level=body.level, scope=body.scope, repo=repo,
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
    return {"scan": scan_out(scan), "issues": [pipeline.issue_dict(i) for i in issues], "fixes": []}


@router.post("/{scan_id}/ship")
def ship(scan_id: str):
    raise HTTPException(501, "Opening pull requests isn't implemented yet: no automatic fixes exist to ship.")


@router.get("/{scan_id}/events")
async def events(
    scan_id: str, request: Request, last_event_id: Annotated[str | None, Header()] = None
):
    """Server-Sent Events: tails the scan's event log until a terminal stage."""
    with Session(engine()) as db:
        if not db.get(Scan, scan_id):
            raise HTTPException(404, "Scan not found.")
    cursor = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0

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
