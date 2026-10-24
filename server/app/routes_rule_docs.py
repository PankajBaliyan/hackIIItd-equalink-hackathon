from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import rule_sync
from app.config import Settings, get_settings
from app.db import get_session
from app.models import RuleDoc

# Not "/docs": FastAPI serves Swagger UI there.
router = APIRouter(prefix="/rule-docs", tags=["rule-docs"])
SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


class RuleDocOut(BaseModel):
    id: int
    title: str
    source_url: str | None  # one URL, or several separated by ", "
    content: str
    origin: str
    created_at: str


class SyncOut(BaseModel):
    configured: bool  # a TinyFish API key is set
    scheduled: bool
    status: str | None  # running | done | failed; None before the first run
    trigger: str | None
    received: int
    added: int
    skipped: int
    error: str | None
    started_at: str | None
    finished_at: str | None
    next_run_at: str | None


class RuleDocIn(BaseModel):
    title: str = Field(max_length=200)
    content: str = Field(max_length=200_000)
    source_url: str | None = None


def _iso(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=None).isoformat() + "Z" if dt else None  # stored as UTC


def _out(d: RuleDoc) -> RuleDocOut:
    return RuleDocOut(id=d.id, title=d.title, source_url=d.source_url, content=d.content, origin=d.origin, created_at=_iso(d.created_at))  # type: ignore[arg-type]


def _build(body: RuleDocIn) -> RuleDoc:
    title, content = body.title.strip(), body.content.strip()
    if not title:
        raise HTTPException(422, "Give the document a title.")
    if not content:
        raise HTTPException(422, "The document is empty.")
    sources, invalid = rule_sync.split_urls(body.source_url)
    if invalid:
        raise HTTPException(422, f"Not a valid web address: {invalid[0]}")
    return RuleDoc(title=title, content=content, source_url=", ".join(sources) or None)


@router.get("", response_model=list[RuleDocOut])
def list_docs(db: SessionDep):
    return [_out(d) for d in db.exec(select(RuleDoc).order_by(RuleDoc.created_at.desc(), RuleDoc.id.desc())).all()]  # type: ignore[attr-defined]


@router.post("", response_model=list[RuleDocOut], status_code=201)
def add_docs(body: RuleDocIn | list[RuleDocIn], db: SessionDep):
    """Accepts one document or a list, so an agent can push a whole batch in one call. All or nothing."""
    items = body if isinstance(body, list) else [body]
    if not items:
        raise HTTPException(422, "Send at least one document.")
    docs = [_build(i) for i in items]
    db.add_all(docs)
    db.commit()
    for d in docs:
        db.refresh(d)
    return [_out(d) for d in docs]


@router.delete("/{doc_id}", status_code=204)
def delete_doc(doc_id: int, db: SessionDep):
    doc = db.get(RuleDoc, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found.")
    db.delete(doc)
    db.commit()


def _sync_out(db: Session, settings: Settings) -> SyncOut:
    last = rule_sync.latest(db)
    due = rule_sync.next_due(db, settings) if settings.w3c_sync_schedule and settings.tinyfish_api_key else None
    return SyncOut(
        configured=bool(settings.tinyfish_api_key), scheduled=settings.w3c_sync_schedule,
        status=last.status if last else None, trigger=last.trigger if last else None,
        received=last.received if last else 0, added=last.added if last else 0, skipped=last.skipped if last else 0,
        error=last.error if last else None, started_at=_iso(last.started_at) if last else None,
        finished_at=_iso(last.finished_at) if last else None, next_run_at=_iso(max(due, rule_sync._now())) if due else None,
    )


@router.get("/sync", response_model=SyncOut)
def sync_status(db: SessionDep, settings: SettingsDep):
    return _sync_out(db, settings)


@router.post("/sync", response_model=SyncOut, status_code=202)
def sync_now(db: SessionDep, settings: SettingsDep, tasks: BackgroundTasks):
    """Starts the W3C rules sync in the background. Poll GET /rule-docs/sync for the outcome."""
    if not settings.tinyfish_api_key:
        raise HTTPException(503, "Set TINYFISH_API_KEY on the server to sync W3C rules.")
    last = rule_sync.latest(db)
    if last and last.status == "running":
        raise HTTPException(409, "A sync is already running.")
    run = rule_sync.start(db, "manual")
    tasks.add_task(rule_sync.execute, run.id, settings)
    return _sync_out(db, settings)
