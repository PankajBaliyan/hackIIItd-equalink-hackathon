"""Pulls the latest W3C accessibility rules from a TinyFish agent into the reference docs.

Runs monthly (see `scheduler`) or on demand. A rule is only stored when no existing doc covers the
same WCAG success criterion or has the same title, so repeated runs never create duplicates.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlmodel import Session, select

from app.config import Settings, get_settings
from app.db import engine
from app.models import RuleDoc, RuleSync

log = logging.getLogger("equalink.rule_sync")

RUN_URL = "https://agent.tinyfish.ai/v1/automation/run-sse"
PROMPT = (Path(__file__).parent / "prompts" / "w3c_rules.md").read_text()
MAX_HINTS = 400  # stored rules listed to the agent so it can skip them
RETRY_AFTER = timedelta(days=1)  # after a failed run
CHECK_EVERY = 3600  # seconds between "is a sync due?" checks

_running = asyncio.Lock()
SC_RE = re.compile(r"(?:Success Criterion|\bSC)\s*(\d\.\d{1,2}\.\d{1,2})", re.I)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite hands datetimes back naive; they were stored as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class SyncError(Exception):
    pass


def _norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def keys_for(title: str, content: str) -> set[str]:
    """Identity of a rule: its WCAG success criterion (titles get reworded between runs) and its title."""
    keys = {f"t:{_norm_title(title)}"}
    if m := SC_RE.search(content) or SC_RE.search(title):
        keys.add(f"sc:{m.group(1)}")
    return keys


def _extract_list(result: object) -> list:
    """The agent should return a JSON array, but it may arrive wrapped ({"result": [...]}) or as a string."""
    if isinstance(result, str):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", result.strip())
        try:
            result = json.loads(text)
        except json.JSONDecodeError as e:
            raise SyncError("The agent's answer was not valid JSON.") from e
    if isinstance(result, dict):
        lists = [v for v in result.values() if isinstance(v, list)]
        if len(lists) != 1:
            raise SyncError("The agent's answer had no list of rules.")
        result = lists[0]
    if not isinstance(result, list):
        raise SyncError("The agent's answer was not a list of rules.")
    return result


def split_urls(raw: object) -> tuple[list[str], list[str]]:
    """(valid, invalid) http(s) URLs from a comma/space separated string. Fragments are kept: W3C anchors matter."""
    good: list[str] = []
    bad: list[str] = []
    for part in re.split(r"[,\s]+", raw if isinstance(raw, str) else ""):
        if not part:
            continue
        url = part if "://" in part else f"https://{part}"
        host = urlsplit(url).hostname or ""
        if urlsplit(url).scheme not in ("http", "https") or "." not in host:
            bad.append(part)
        elif url not in good:
            good.append(url)
    return good, bad


def parse_rules(result: object) -> tuple[list[dict], int]:
    """Valid rules plus the number of malformed entries that were dropped."""
    rules, bad = [], 0
    for item in _extract_list(result):
        title = item.get("title") if isinstance(item, dict) else None
        content = item.get("content") if isinstance(item, dict) else None
        if not (isinstance(title, str) and title.strip() and isinstance(content, str) and content.strip()):
            bad += 1
            continue
        src = item.get("sourceurl") or item.get("source_url")
        rules.append({"title": title.strip()[:200], "content": content.strip(), "source_url": ", ".join(split_urls(src)[0]) or None})
    return rules, bad


def merge(db: Session, rules: list[dict]) -> tuple[int, int]:
    """Store the rules nobody has yet. Returns (added, skipped)."""
    seen: set[str] = set()
    for d in db.exec(select(RuleDoc)).all():
        seen |= keys_for(d.title, d.content)
    added = 0
    for r in rules:
        keys = keys_for(r["title"], r["content"])
        if keys & seen:
            continue
        seen |= keys
        db.add(RuleDoc(origin="w3c-sync", **r))
        added += 1
    db.commit()
    return added, len(rules) - added


def build_goal(db: Session) -> str:
    docs = db.exec(select(RuleDoc).order_by(RuleDoc.id)).all()  # type: ignore[arg-type]
    if not docs:
        return PROMPT
    lines = []
    for d in docs[-MAX_HINTS:]:
        sc = next((k[3:] for k in sorted(keys_for(d.title, d.content)) if k.startswith("sc:")), None)
        lines.append(f"- {f'SC {sc}: ' if sc else ''}{d.title}")
    return (
        f"{PROMPT}\n\n### 10. Already Stored (Do Not Return Again)\n"
        "The knowledge base already contains the rules below. Return only NEW rules that are not in this list "
        "(a different success criterion or a different requirement). If there is nothing new that you can "
        "verify, return an empty JSON array: []\n" + "\n".join(lines)
    )


async def fetch_rules(settings: Settings, goal: str, on_run_id=None, transport: httpx.AsyncBaseTransport | None = None) -> object:
    """Runs the TinyFish agent and returns the `result` of its COMPLETE event."""
    headers = {"X-API-Key": settings.tinyfish_api_key, "Content-Type": "application/json"}
    body = {"url": settings.w3c_sync_url, "goal": goal}
    timeout = httpx.Timeout(connect=30, read=180, write=60, pool=30)  # the stream sends heartbeats
    async with asyncio.timeout(settings.w3c_sync_timeout_seconds):
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            async with client.stream("POST", RUN_URL, headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    raise SyncError(f"TinyFish returned HTTP {resp.status_code}.")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "STARTED" and on_run_id:
                        on_run_id(event.get("run_id"))
                    if event.get("type") != "COMPLETE":
                        continue
                    if event.get("status") != "COMPLETED" or event.get("result") is None:
                        err = event.get("error") or {}
                        msg = err.get("message") if isinstance(err, dict) else None
                        raise SyncError(msg or "The TinyFish run did not complete.")
                    return event["result"]
    raise SyncError("The TinyFish stream ended without a result.")


def latest(db: Session) -> RuleSync | None:
    return db.exec(select(RuleSync).order_by(RuleSync.id.desc())).first()  # type: ignore[attr-defined]


def start(db: Session, trigger: str) -> RuleSync:
    run = RuleSync(trigger=trigger, started_at=_now())
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


async def execute(run_id: int, settings: Settings | None = None) -> None:
    """Runs the sync for an already created RuleSync row and records the outcome on it."""
    settings = settings or get_settings()
    error: str | None = None
    received = added = skipped = 0
    try:
        async with _running:
            with Session(engine()) as db:
                goal = build_goal(db)

            def note(tf_id: str | None) -> None:
                with Session(engine()) as s:
                    if (r := s.get(RuleSync, run_id)) and tf_id:
                        r.tinyfish_run_id = tf_id
                        s.add(r)
                        s.commit()

            result = await fetch_rules(settings, goal, note)
            rules, bad = parse_rules(result)
            with Session(engine()) as db:
                added, skipped = merge(db, rules)
            received, skipped = len(rules) + bad, skipped + bad
    except TimeoutError:
        error = "The TinyFish run took too long."
    except SyncError as e:
        error = str(e)
    except httpx.HTTPError as e:
        error = f"Couldn't reach TinyFish ({type(e).__name__})."
    except Exception:  # never let the background task die silently
        log.exception("W3C rules sync failed")
        error = "Unexpected error. See the server log."
    with Session(engine()) as db:
        run = db.get(RuleSync, run_id)
        if run:
            run.status, run.error = ("failed", error) if error else ("done", None)
            run.received, run.added, run.skipped, run.finished_at = received, added, skipped, _now()
            db.add(run)
            db.commit()
    log.info("W3C rules sync %s: +%d, %d skipped%s", "failed" if error else "done", added, skipped, f" ({error})" if error else "")


def next_due(db: Session, settings: Settings) -> datetime | None:
    """When the next scheduled sync runs. None while one is running, and until a first sync has succeeded:
    the first (billed) run is always started by a person, never by a server boot or reload."""
    last = latest(db)
    if last and last.status == "running":
        return None
    done = db.exec(select(RuleSync).where(RuleSync.status == "done").order_by(RuleSync.id.desc())).first()  # type: ignore[attr-defined]
    if not done or not done.finished_at:
        return None
    due = _aware(done.finished_at) + timedelta(days=settings.w3c_sync_interval_days)
    if last and last.status == "failed" and last.finished_at:
        due = max(due, _aware(last.finished_at) + RETRY_AFTER)
    return due


def fail_orphaned_syncs() -> None:
    """A sync still running when the server stopped will never finish."""
    with Session(engine()) as db:
        for run in db.exec(select(RuleSync).where(RuleSync.status == "running")).all():
            run.status, run.error, run.finished_at = "failed", "Server restarted during the sync.", _now()
            db.add(run)
        db.commit()


async def scheduler() -> None:
    while True:
        try:
            settings = get_settings()
            if settings.w3c_sync_schedule and settings.tinyfish_api_key:
                with Session(engine()) as db:
                    due = next_due(db, settings)
                    run = start(db, "schedule") if due and due <= _now() else None
                if run:
                    await execute(run.id, settings)  # type: ignore[arg-type]
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("W3C rules scheduler tick failed")
        await asyncio.sleep(CHECK_EVERY)
