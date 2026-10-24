"""Scan pipeline: render pages in headless Chromium, run axe-core, store issues, score the result.

Automatic fixing (LLM + re-validation) and TinyFish crawling are separate stages that plug in
between 'crawling' and 'done'; for now a scan ends with diagnosed issues awaiting human review.
"""

import asyncio
import json
import re
import secrets
import socket
import ipaddress
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlsplit

import axe_playwright_python
from fastapi import HTTPException
from playwright.async_api import Page, async_playwright
from sqlmodel import Session

from app.config import Settings, get_settings
from app.db import engine
from app.models import EventRow, IssueRow, Scan

AXE_JS = (Path(axe_playwright_python.__file__).parent / "axe.min.js").read_text()
TAGS = {
    "A": ["wcag2a", "wcag21a"],
    "AA": ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag22aa"],
    "AAA": ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag22aa", "wcag2aaa"],
}
WEIGHT = {"critical": 10, "serious": 5, "moderate": 2, "minor": 1}
MAX_NODES_PER_RULE = 10  # per page: keeps one noisy rule from drowning the report
SKIP_EXT = re.compile(r"\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mp3|css|js|ico|xml)$", re.I)
_tasks: set[asyncio.Task] = set()  # keep references so background scans aren't garbage collected


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def check_target(s: Settings, url: str) -> None:
    """Refuse private/loopback targets unless explicitly allowed (SSRF guard for deployments)."""
    if s.allow_private_targets:
        return
    host = urlsplit(url).hostname or ""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(422, f"Couldn't resolve {host}.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(422, "Scanning private or local addresses is disabled on this server.")


def score(counts: dict[str, int]) -> int:
    """100 minus weighted issue count, clamped to 0-100 (plan section 4.6)."""
    return max(0, min(100, round(100 - sum(WEIGHT[k] * v for k, v in counts.items()) / 2)))


def emit(
    db: Session, scan_id: str, stage: str, message: str, type_: str = "info", counters=None, issue=None
) -> None:
    payload = {"stage": stage, "message": message, "type": type_, "ts": now_iso()}
    if counters is not None:
        payload["counters"] = counters
    if issue is not None:
        payload["issue"] = issue
    db.add(EventRow(scan_id=scan_id, payload=json.dumps(payload)))
    db.commit()


def set_status(db: Session, scan: Scan, status: str) -> None:
    scan.status = status
    db.add(scan)
    db.commit()


def sc_from_tags(tags: list[str]) -> str:
    for t in tags:
        m = re.fullmatch(r"wcag(\d)(\d)(\d+)", t)
        if m:
            return ".".join(m.groups())
    return "n/a"


def context_for(violation: dict, node: dict) -> str:
    """axe's rule help text plus the first concrete failure hint for this node."""
    lines = (node.get("failureSummary") or "").splitlines()
    hint = lines[1].strip() if len(lines) > 1 else ""
    return f"{violation.get('help', '')}. {hint}".strip()


def issue_dict(i: IssueRow) -> dict:
    return {
        "id": i.id, "scan_id": i.scan_id, "page_url": i.page_url, "rule_id": i.rule_id, "wcag_sc": i.wcag_sc,
        "impact": i.impact, "selector": i.selector, "html": i.html, "context": i.context,
    }


async def render(page: Page, url: str) -> None:
    # "domcontentloaded" returns as soon as the HTML is parsed; heavy pages never fire "load" in time.
    await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    try:
        await page.wait_for_load_state("load", timeout=10_000)
        await page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass  # chatty pages never go idle; the load event is enough


async def same_origin_links(page: Page, base: str, limit: int) -> list[str]:
    hrefs = await page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    origin = urlsplit(base)
    out: list[str] = []
    for h in hrefs:
        u = urldefrag(urljoin(base, h or ""))[0]
        p = urlsplit(u)
        if p.scheme in ("http", "https") and p.netloc == origin.netloc and not SKIP_EXT.search(p.path):
            if u != base and u not in out:
                out.append(u)
        if len(out) >= limit:
            break
    return out


async def run_scan(scan_id: str) -> None:
    s = get_settings()
    with Session(engine()) as db:
        scan = db.get(Scan, scan_id)
        if not scan:
            return
        counts = {"critical": 0, "serious": 0, "moderate": 0, "minor": 0}
        seen: set[tuple[str, str, str]] = set()
        try:
            set_status(db, scan, "crawling")
            async with async_playwright() as pw:
                browser = await pw.chromium.launch()
                try:
                    page = await (await browser.new_context()).new_page()
                    emit(db, scan_id, "crawling", f"rendering {scan.url}")
                    await render(page, scan.url)
                    urls = [scan.url]
                    if scan.scope == "site":
                        urls += await same_origin_links(page, scan.url, s.max_site_pages - 1)
                        emit(db, scan_id, "crawling", f"found {len(urls)} page(s) to scan")

                    set_status(db, scan, "diagnosing")
                    for n, url in enumerate(urls):
                        if n:
                            emit(db, scan_id, "diagnosing", f"rendering {url}")
                            await render(page, url)
                        emit(db, scan_id, "diagnosing", f"axe-core: WCAG {scan.level} on {urlsplit(url).path or '/'}")
                        await page.evaluate(AXE_JS)
                        result = await page.evaluate(
                            "tags => axe.run(document, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations']})",
                            TAGS[scan.level],
                        )
                        for v in result["violations"]:
                            impact = v.get("impact") or "minor"
                            for node in v["nodes"][:MAX_NODES_PER_RULE]:
                                selector = " ".join(node["target"][0]) if isinstance(node["target"][0], list) else node["target"][0]
                                key = (v["id"], selector, url)
                                if key in seen:
                                    continue
                                seen.add(key)
                                row = IssueRow(
                                    id=f"iss_{secrets.token_hex(4)}", scan_id=scan_id, page_url=url, rule_id=v["id"],
                                    wcag_sc=sc_from_tags(v.get("tags", [])), impact=impact, selector=selector,
                                    html=node.get("html", "")[:2000],
                                    context=context_for(v, node),
                                )
                                db.add(row)
                                db.commit()
                                counts[impact] += 1
                                emit(
                                    db, scan_id, "diagnosing",
                                    f"{v['id']} (WCAG {row.wcag_sc}) {selector}",
                                    "issue", counters=dict(counts), issue=issue_dict(row),
                                )
                finally:
                    await browser.close()

            total = sum(counts.values())
            scan.score_before = score(counts)
            emit(
                db, scan_id, "diagnosing",
                f"score {scan.score_before}. {total} issue(s) found; automatic fixes need the LLM stage, so they are left for human review",
            )
            set_status(db, scan, "done")
            emit(db, scan_id, "done", f"scan complete: {total} issue(s)", counters=dict(counts))
        except Exception as e:  # any failure should surface in the UI, not vanish in a task
            msg = str(e).splitlines()[0][:300] if str(e) else type(e).__name__
            scan.error = msg
            set_status(db, scan, "failed")
            emit(db, scan_id, "failed", f"scan failed: {msg}")


def _run_in_thread(scan_id: str) -> None:
    # Playwright launches Chromium as a subprocess, which needs a Proactor loop on Windows. uvicorn's
    # reload mode runs the server on a Selector loop (NotImplementedError), so give each scan its own loop.
    asyncio.run(run_scan(scan_id))


def start(scan_id: str) -> None:
    task = asyncio.create_task(asyncio.to_thread(_run_in_thread, scan_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
