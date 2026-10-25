"""Scan pipeline: render pages in headless Chromium, run axe-core, store issues, score the result.

Pages are rendered in a TinyFish remote browser when one is available (see `open_page`), otherwise in
local Chromium. Automatic fixing (LLM + re-validation) is a separate stage that plugs in between
'diagnosing' and 'done'; for now a scan ends with diagnosed issues awaiting human review.
"""

import asyncio
import json
import re
import secrets
import socket
import ipaddress
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlsplit

import axe_playwright_python
from fastapi import HTTPException
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Browser, Page, Playwright, async_playwright
from sqlmodel import Session, select

from app import fixer, page_llm, rule_lookup, source_llm, tinyfish_browser
from app.config import Settings, get_settings
from app.db import engine
from app.models import EventRow, FixRow, IssueRow, RuleDoc, Scan

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


def issue_dict(i: IssueRow, doc: RuleDoc | None = None) -> dict:
    return {
        "id": i.id, "scan_id": i.scan_id, "page_url": i.page_url, "rule_id": i.rule_id, "wcag_sc": i.wcag_sc,
        "impact": i.impact, "selector": i.selector, "html": i.html, "context": i.context,
        "rule": rule_lookup.rule_ref(doc), "detector": i.detector, "source_file": i.source_file, "source_line": i.source_line,
    }


@asynccontextmanager
async def open_page(pw: Playwright, db: Session, scan: Scan, s: Settings) -> AsyncIterator[Page]:
    """A page to scan with: TinyFish's remote browser over CDP, or local Chromium.

    With SCAN_ENGINE=auto a TinyFish failure falls back to local Chromium (and says so in the log); with
    SCAN_ENGINE=tinyfish it fails the scan. The TinyFish session is always ended, since it bills while open.
    """
    browser: Browser | None = None
    session_id: str | None = None
    try:
        if scan.engine == "tinyfish":
            try:
                session = await tinyfish_browser.create_session(s, scan.url)
                session_id = session["session_id"]
                emit(db, scan.id, "crawling", f"TinyFish browser session {session_id} started")
                browser = await pw.chromium.connect_over_cdp(session["cdp_url"])
                ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
                page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            except Exception as e:
                if browser:
                    await browser.close()
                    browser = None
                if session_id:
                    await tinyfish_browser.close_session(s, session_id)
                    session_id = None
                if s.scan_engine == "tinyfish":
                    raise
                reason = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
                emit(db, scan.id, "crawling", f"TinyFish browser unavailable ({reason}); using local Chromium")
                scan.engine = "local"
                db.add(scan)
                db.commit()
        if browser is None:
            browser = await pw.chromium.launch()
            page = await (await browser.new_context()).new_page()
        yield page
    finally:
        if browser:
            try:
                await browser.close()  # over CDP this only disconnects
            except Exception:
                pass
        if session_id:
            await tinyfish_browser.close_session(s, session_id)
            emit(db, scan.id, "crawling", f"TinyFish browser session {session_id} closed")


class BlockedError(Exception):
    """The site served a bot-protection page instead of its content; axe would score the wrong page."""


BLOCK_TITLES = ("just a moment", "attention required", "access denied", "verify you are human", "are you a robot", "checking your browser")
BLOCK_SELECTORS = "#challenge-running, #cf-challenge-running, #challenge-form, .cf-turnstile"
BLOCK_WAIT = 6  # seconds a challenge gets to clear itself


NAVIGATING = ("Execution context was destroyed", "axe is not defined", "navigating", "Target page, context or browser has been closed")
SETTLE_STEP = 0.8  # seconds the URL must stay put before the page counts as settled
SETTLE_MAX = 6  # seconds to wait for client-side redirects (SPA routers) to finish


def _mid_navigation(e: Exception) -> bool:
    return isinstance(e, PlaywrightError) and any(m in str(e) for m in NAVIGATING)


async def settle(page: Page) -> None:
    """Wait out client-side redirects: many sites navigate again right after the load event."""
    waited = 0.0
    while waited < SETTLE_MAX:
        url = page.url
        await asyncio.sleep(SETTLE_STEP)
        waited += SETTLE_STEP
        try:
            if page.url == url and await page.evaluate("document.readyState") == "complete":
                return
        except PlaywrightError as e:
            if not _mid_navigation(e):
                raise


async def is_blocked(page: Page) -> bool:
    for attempt in range(3):
        try:
            title = (await page.title()).lower()
            return any(t in title for t in BLOCK_TITLES) or await page.query_selector(BLOCK_SELECTORS) is not None
        except PlaywrightError as e:
            if attempt == 2 or not _mid_navigation(e):
                raise
            await settle(page)
    return False


async def run_axe(page: Page, level: str) -> dict:
    """Inject and run axe, retrying if the page navigates between the two (the new page needs axe again)."""
    for attempt in range(3):
        try:
            await page.evaluate(AXE_JS)
            return await page.evaluate(
                "tags => axe.run(document, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations']})",
                TAGS[level],
            )
        except PlaywrightError as e:
            if attempt == 2 or not _mid_navigation(e):
                raise
            await settle(page)
    raise AssertionError("unreachable")


async def ensure_not_blocked(page: Page, url: str) -> None:
    for _ in range(BLOCK_WAIT):
        if not await is_blocked(page):
            return
        await asyncio.sleep(1)
    if await is_blocked(page):
        title = (await page.title()).strip()[:60]
        raise BlockedError(f"{urlsplit(url).netloc} showed a bot-protection page ({title!r}) instead of its content")


async def render(page: Page, url: str) -> None:
    await page.goto(url, wait_until="load", timeout=30_000)
    try:
        await page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass  # chatty pages never go idle; the load event is enough
    await settle(page)
    await ensure_not_blocked(page, url)


def url_key(u: str) -> tuple[str, str, str]:
    """Identity of a page for the crawl: /about and /about/ are the same page."""
    p = urlsplit(u)
    return p.netloc.lower(), p.path.rstrip("/") or "/", p.query


async def same_origin_links(page: Page, origins: set[str]) -> list[str]:
    """Every distinct page link on the rendered page that stays on the site (fragments dropped, files skipped)."""
    hrefs = await page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    out: list[str] = []
    for h in hrefs:
        u = urldefrag(urljoin(page.url, h or ""))[0]
        p = urlsplit(u)
        if p.scheme in ("http", "https") and p.netloc.lower() in origins and not SKIP_EXT.search(p.path) and u not in out:
            out.append(u)
    return out


async def crawl(
    db: Session, scan: Scan, s: Settings, counts: dict[str, int], seen: set[tuple[str, str, str]], rules: dict[str, RuleDoc]
) -> None:
    """Render the page(s) in the scan's engine and store the axe violations. `counts` and `seen` survive a retry."""
    scan_id = scan.id
    client = source_llm.make_client(s) if s.openai_api_key else None
    rules_text = rule_lookup.prompt_context(db) if client else ""
    async with async_playwright() as pw, open_page(pw, db, scan, s) as page:
        emit(db, scan_id, "crawling", f"rendering {scan.url} in the {'TinyFish' if scan.engine == 'tinyfish' else 'local'} browser")
        await render(page, scan.url)
        origins = {urlsplit(scan.url).netloc.lower(), urlsplit(page.url).netloc.lower()}
        queue, queued, overflow, visited = [scan.url], {url_key(scan.url)}, set(), []

        set_status(db, scan, "diagnosing")
        n = 0
        while n < len(queue):
            url = queue[n]
            if n:
                emit(db, scan_id, "diagnosing", f"rendering {url}")
                try:
                    await render(page, url)
                except Exception as e:  # one broken page must not sink the whole crawl
                    reason = str(e).splitlines()[0][:120] if str(e) else type(e).__name__
                    emit(db, scan_id, "diagnosing", f"couldn't scan {url} ({reason}); skipped")
                    queue.pop(n)
                    try:  # a failed navigation leaves Chromium on its error page, which interrupts the next one: use a fresh tab
                        broken, page = page, await page.context.new_page()
                        await broken.close()
                    except Exception:
                        pass
                    continue
            if scan.scope == "site":
                added = 0
                for link in await same_origin_links(page, origins):
                    key = url_key(link)
                    if key in queued or key in overflow:
                        continue
                    if len(queued) < s.max_site_pages:
                        queued.add(key)
                        queue.append(link)
                        added += 1
                    else:
                        overflow.add(key)
                if added:
                    emit(db, scan_id, "diagnosing", f"found {added} new page(s) on {urlsplit(url).path or '/'}: {len(queued)} to scan (limit {s.max_site_pages})")
            n += 1
            visited.append(url)
            emit(db, scan_id, "diagnosing", f"axe-core: WCAG {scan.level} on {urlsplit(url).path or '/'}")
            result = await run_axe(page, scan.level)
            axe_found: list[tuple[str, str]] = []
            for v in result["violations"]:
                impact = v.get("impact") or "minor"
                for node in v["nodes"][:MAX_NODES_PER_RULE]:
                    selector = " ".join(node["target"][0]) if isinstance(node["target"][0], list) else node["target"][0]
                    key = (v["id"], selector, url)
                    if key in seen:
                        continue
                    seen.add(key)
                    axe_found.append((v["id"], selector))
                    row = IssueRow(
                        id=f"iss_{secrets.token_hex(4)}", scan_id=scan_id, page_url=url, rule_id=v["id"],
                        wcag_sc=sc_from_tags(v.get("tags", [])), impact=impact, selector=selector,
                        html=node.get("html", "")[:2000],
                        context=context_for(v, node),
                        rule_doc_id=doc.id if (doc := rules.get(sc_from_tags(v.get("tags", [])))) else None,
                    )
                    db.add(row)
                    db.commit()
                    counts[impact] += 1
                    emit(
                        db, scan_id, "diagnosing",
                        f"{v['id']} (WCAG {row.wcag_sc}) {selector}",
                        "issue", counters=dict(counts), issue=issue_dict(row, doc),
                    )
            if client:
                await llm_review(db, scan, s, counts, seen, rules, rules_text, page, url, axe_found, client)
            elif n == 1:
                emit(db, scan_id, "diagnosing", "OpenAI review skipped: set OPENAI_API_KEY to add it (axe-core results only)")
        if overflow:
            emit(db, scan_id, "diagnosing", f"page limit reached: {len(overflow)} more page(s) were found but not scanned (raise MAX_SITE_PAGES)")
        if client:
            await fix_site(db, scan, s, rules_text, page, visited, client)


def fix_dict(f: FixRow) -> dict:
    out = {
        "id": f.id, "issue_id": f.issue_id, "strategy": f.strategy, "original": f.original, "patched": f.patched,
        "explanation": f.explanation, "confidence": f.confidence, "validated": f.validated,
        "violations_before": f.violations_before, "violations_after": f.violations_after,
    }
    if f.rejected_reason:
        out["rejected_reason"] = f.rejected_reason
    return out


def announce_proposal(db: Session, scan_id: str, issue: IssueRow, p: "fixer.Proposal") -> None:
    emit(db, scan_id, "fixing", f"proposed fix for {issue.rule_id} {issue.selector[:60]} (llm, confidence {round(p.confidence * 100)}%)", "fix")


def save_fix(db: Session, scan_id: str, issue: IssueRow, p: "fixer.Proposal", original: str, v: "fixer.Verdict") -> None:
    """Store a proposal with the rules engine's verdict and report it."""
    db.add(FixRow(
        id=f"fix_{secrets.token_hex(4)}", scan_id=scan_id, issue_id=issue.id, strategy="llm", original=original,
        patched=p.patched, explanation=p.explanation, confidence=p.confidence, validated=v.validated,
        violations_before=v.before, violations_after=v.after, rejected_reason=None if v.validated else v.reason,
        start_line=p.start_line, end_line=p.end_line,
    ))
    db.commit()
    if v.validated:
        emit(db, scan_id, "verifying", f"validated {issue.rule_id}: violations {v.before} -> {v.after}", "validated")
    else:
        emit(db, scan_id, "verifying", f"rejected {issue.rule_id}: {v.reason}", "rejected")


def fix_score(db: Session, scan: Scan, counts: dict[str, int]) -> int:
    """The score the scan would have if every validated fix were applied."""
    fixed = {k: 0 for k in counts}
    for f in db.exec(select(FixRow).where(FixRow.scan_id == scan.id, FixRow.validated == True)).all():  # noqa: E712
        issue = db.get(IssueRow, f.issue_id)
        if issue and issue.impact in fixed:
            fixed[issue.impact] += 1
    return score({k: max(0, counts[k] - fixed[k]) for k in counts})


async def fix_site(
    db: Session, scan: Scan, s: Settings, rules_text: str, page: Page, urls: list[str], client
) -> None:
    """Propose a fix for each axe issue, then check every proposal in the live page. Never fails the scan."""
    try:
        issues = fixer.eligible_site_issues(
            list(db.exec(select(IssueRow).where(IssueRow.scan_id == scan.id)).all()), s.fix_max
        )
        if not issues:
            return
        note = lambda m: emit(db, scan.id, "fixing", m)  # noqa: E731
        set_status(db, scan, "fixing")
        emit(db, scan.id, "fixing", f"OpenAI is proposing fixes for {len(issues)} issue(s)")
        by_id = {i.id: i for i in issues}
        proposals: list[fixer.Proposal] = []
        for k in range(0, len(issues), s.fix_batch):
            for p in await fixer.propose_site(s, client, rules_text, issues[k : k + s.fix_batch], note):
                announce_proposal(db, scan.id, by_id[p.issue_id], p)
                proposals.append(p)
        if len(proposals) < len(issues):
            emit(db, scan.id, "fixing", f"{len(issues) - len(proposals)} issue(s) got no fix and are left for human review")
        set_status(db, scan, "verifying")
        emit(db, scan.id, "verifying", "re-running axe-core on every proposed fix")
        current = urls[-1]  # the page left open by the diagnosing loop
        for url in urls:
            mine = [p for p in proposals if by_id[p.issue_id].page_url == url]
            if not mine:
                continue
            try:
                if url != current:
                    await render(page, url)
                    current = url
            except Exception as e:
                emit(db, scan.id, "verifying", f"couldn't reopen {url} to check its fixes ({type(e).__name__}); left for review")
                continue
            for p in mine:
                issue = by_id[p.issue_id]
                try:
                    v = await fixer.verify_site(page, issue, p.patched, TAGS[scan.level], AXE_JS)
                except Exception as e:
                    v = fixer.Verdict(False, 0, 0, f"couldn't check it in the browser ({type(e).__name__})")
                save_fix(db, scan.id, issue, p, issue.html, v)
    except Exception as e:
        emit(db, scan.id, "verifying", f"fix stage stopped ({type(e).__name__}); remaining issues are left for human review")


async def llm_review(
    db: Session, scan: Scan, s: Settings, counts: dict[str, int], seen: set[tuple[str, str, str]],
    rules: dict[str, RuleDoc], rules_text: str, page: Page, url: str, axe_found: list[tuple[str, str]], client,
) -> None:
    """Add the model's findings for one rendered page. Never fails the scan: axe-core's results stand on their own."""
    emit(db, scan.id, "diagnosing", f"OpenAI is reviewing {urlsplit(url).path or '/'} for what axe-core can't see")
    try:
        issues = await page_llm.review(s, rules_text, page, url, axe_found, client, on_note=lambda m: emit(db, scan.id, "diagnosing", m))
    except Exception as e:
        emit(db, scan.id, "diagnosing", f"OpenAI review skipped ({type(e).__name__})")
        return
    for i in issues:
        key = (i.rule_id, i.selector, url)
        if key in seen:
            continue
        seen.add(key)
        doc = rules.get(i.wcag_sc)
        row = IssueRow(
            id=f"iss_{secrets.token_hex(4)}", scan_id=scan.id, page_url=url, rule_id=i.rule_id, wcag_sc=i.wcag_sc,
            impact=i.impact, selector=i.selector, html=i.html, context=i.problem, detector="llm",
            rule_doc_id=doc.id if doc else None,
        )
        db.add(row)
        db.commit()
        counts[i.impact] += 1
        emit(
            db, scan.id, "diagnosing", f"{i.rule_id} (WCAG {i.wcag_sc}) {i.selector}",
            "issue", counters=dict(counts), issue=issue_dict(row, doc),
        )


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
            rules, saved = rule_lookup.load_index(db)
            emit(
                db, scan_id, "crawling",
                f"using {saved} saved W3C rule(s) as reference" if saved
                else "no saved W3C rules yet; add some under Docs > Reference documents",
            )
            if scan.mode == "source":
                from app import source_scan  # imports pipeline, so it can't be imported at the top

                await source_scan.scan_repo(db, scan, s, counts, seen, rules)
            else:
                for attempt in (0, 1):
                    try:
                        await crawl(db, scan, s, counts, seen, rules)
                        break
                    except BlockedError as e:
                        if attempt or scan.engine != "tinyfish" or s.scan_engine != "auto":
                            raise
                        emit(db, scan_id, "crawling", f"TinyFish browser was blocked ({e}); retrying with local Chromium")
                        scan.engine = "local"
                        db.add(scan)
                        db.commit()

            total = sum(counts.values())
            matched = len(db.exec(select(IssueRow).where(IssueRow.scan_id == scan_id, IssueRow.rule_doc_id != None)).all())  # noqa: E711
            if saved:
                emit(db, scan_id, "diagnosing", f"{matched} of {total} issue(s) matched a saved W3C rule")
            scan.score_before = score(counts)
            fixes = db.exec(select(FixRow).where(FixRow.scan_id == scan_id)).all()
            if s.openai_api_key:
                scan.score_after = fix_score(db, scan, counts)
                good = sum(1 for f in fixes if f.validated)
                emit(
                    db, scan_id, "verifying",
                    f"score {scan.score_before} -> {scan.score_after} with {good} validated fix(es) of {total} issue(s); "
                    f"{len(fixes) - good} rejected, the rest need human review",
                )
            else:
                emit(
                    db, scan_id, "diagnosing",
                    f"score {scan.score_before}. {total} issue(s) found; set OPENAI_API_KEY to get proposed fixes, so they are left for human review",
                )
            set_status(db, scan, "done")
            emit(db, scan_id, "done", f"scan complete: {total} issue(s)", counters=dict(counts))
        except Exception as e:  # any failure should surface in the UI, not vanish in a task
            msg = str(e).splitlines()[0][:300] if str(e) else type(e).__name__
            scan.error = msg
            set_status(db, scan, "failed")
            emit(db, scan_id, "failed", f"scan failed: {msg}")


def start(scan_id: str) -> None:
    task = asyncio.create_task(run_scan(scan_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
