"""TinyFish remote browser in the crawl stage. No network: the "remote" browser is a local Chromium over CDP."""

import asyncio
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from fastapi import HTTPException
from playwright.async_api import async_playwright
from sqlmodel import Session, select

import app.db as db
from app import pipeline, tinyfish_browser
from app.config import Settings
from app.models import EventRow, IssueRow, Scan
from app.tinyfish_browser import TinyFishError, choose_engine

CHALLENGE = b'<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-running"></div></body></html>'
SPA = b'<!doctype html><html lang="en"><head><title>t</title></head><body><script>setTimeout(function(){location.replace("/")},%s)</script></body></html>'
PAGE = b'<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="x.png"></main></body></html>'


def cfg(**kw) -> Settings:
    return Settings(_env_file=None, state_secret="x" * 32, **kw)


# --- engine choice -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "settings,url,expected",
    [
        (dict(tinyfish_api_key="k"), "https://example.com", "tinyfish"),
        (dict(), "https://example.com", "local"),  # no key
        (dict(tinyfish_api_key="k"), "http://localhost:3000", "local"),  # TinyFish can't reach it
        (dict(tinyfish_api_key="k"), "http://127.0.0.1:8000/x", "local"),
        (dict(tinyfish_api_key="k", scan_engine="local"), "https://example.com", "local"),
        (dict(tinyfish_api_key="k", scan_engine="tinyfish"), "https://example.com", "tinyfish"),
    ],
)
def test_choose_engine(settings, url, expected):
    assert choose_engine(cfg(**settings), url) == expected


def test_forcing_tinyfish_fails_early_when_it_cannot_work():
    with pytest.raises(HTTPException) as e:
        choose_engine(cfg(scan_engine="tinyfish"), "https://example.com")
    assert e.value.status_code == 503
    with pytest.raises(HTTPException) as e:
        choose_engine(cfg(scan_engine="tinyfish", tinyfish_api_key="k"), "http://localhost:3000")
    assert e.value.status_code == 422


# --- Browser API calls ---------------------------------------------------------------------------


def test_create_session_sends_key_and_url():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(key=req.headers["x-api-key"], body=json.loads(req.content), method=req.method)
        return httpx.Response(201, json={"session_id": "br-1", "cdp_url": "wss://x/cdp", "base_url": "https://x"})

    out = asyncio.run(tinyfish_browser.create_session(cfg(tinyfish_api_key="secret"), "https://a.com", httpx.MockTransport(handler)))
    assert out["session_id"] == "br-1" and seen["key"] == "secret" and seen["body"]["url"] == "https://a.com"


@pytest.mark.parametrize("status,body,text", [(402, {"error": {"message": "wallet empty"}}, "wallet empty"), (404, {}, "HTTP 404"), (503, {}, "HTTP 503")])
def test_create_session_failures_are_readable(status, body, text):
    transport = httpx.MockTransport(lambda _r: httpx.Response(status, json=body))
    with pytest.raises(TinyFishError, match=text):
        asyncio.run(tinyfish_browser.create_session(cfg(tinyfish_api_key="k"), "https://a.com", transport))


def test_close_session_retries_until_it_works(monkeypatch):
    async def no_sleep(_s):
        pass

    monkeypatch.setattr(tinyfish_browser.asyncio, "sleep", no_sleep)
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append((req.method, req.url.path))
        return httpx.Response(503 if len(calls) < 3 else 204)

    assert asyncio.run(tinyfish_browser.close_session(cfg(tinyfish_api_key="k"), "br-9", httpx.MockTransport(handler))) is True
    assert calls == [("DELETE", "/br-9")] * 3


def test_close_session_gives_up_without_raising(monkeypatch):
    async def no_sleep(_s):
        pass

    monkeypatch.setattr(tinyfish_browser.asyncio, "sleep", no_sleep)
    assert asyncio.run(tinyfish_browser.close_session(cfg(tinyfish_api_key="k"), "br-9", httpx.MockTransport(lambda _r: httpx.Response(500)))) is False


# --- a whole scan through a CDP browser ----------------------------------------------------------


@pytest.fixture
def site():
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            # The fake "TinyFish" browser identifies itself, so it alone is served a bot-protection page.
            blocked = "FakeRemote" in (self.headers.get("User-Agent") or "")
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            # /spa navigates itself shortly after load, like a client-side router redirect.
            if self.path.startswith("/spa"):
                delay = self.path.split("=")[-1]
                self.wfile.write(SPA % delay.encode())
            else:
                self.wfile.write(CHALLENGE if blocked else PAGE)

        def log_message(self, *_a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/"
    srv.shutdown()


@pytest.fixture
def env(monkeypatch, tmp_path):
    state = {"cfg": cfg(tinyfish_api_key="k", database_url=f"sqlite:///{tmp_path}/s.db"), "closed": []}
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr("app.db.get_settings", lambda: state["cfg"])
    monkeypatch.setattr(pipeline, "get_settings", lambda: state["cfg"])
    db.init_db()

    async def close(_s, session_id, transport=None):
        state["closed"].append(session_id)
        return True

    monkeypatch.setattr(tinyfish_browser, "close_session", close)
    state["patch"] = monkeypatch
    return state


def new_scan(url: str, engine: str) -> str:
    with Session(db.engine()) as s:
        s.add(Scan(id="scan_t", url=url, mode="url", level="AA", scope="page", engine=engine))
        s.commit()
    return "scan_t"


def result():
    with Session(db.engine()) as s:
        scan = s.get(Scan, "scan_t")
        rules = {i.rule_id for i in s.exec(select(IssueRow)).all()}
        messages = [json.loads(e.payload)["message"] for e in s.exec(select(EventRow).order_by(EventRow.id)).all()]
        return scan, rules, messages


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def scan_with_remote_browser(env, scan_id, user_agent="Remote"):
    port = free_port()
    async with async_playwright() as pw:
        remote = await pw.chromium.launch(args=[f"--remote-debugging-port={port}", f"--user-agent={user_agent}"])

        async def create(_s, url, transport=None):
            return {"session_id": "br-1", "cdp_url": f"http://127.0.0.1:{port}"}

        env["patch"].setattr(tinyfish_browser, "create_session", create)
        try:
            await pipeline.run_scan(scan_id)
        finally:
            await remote.close()


def test_scan_runs_in_the_tinyfish_browser_and_ends_the_session(env, site):
    sid = new_scan(site, "tinyfish")
    asyncio.run(scan_with_remote_browser(env, sid))
    scan, rules, messages = result()
    assert scan.status == "done" and scan.engine == "tinyfish" and "image-alt" in rules
    assert env["closed"] == ["br-1"]
    assert any("TinyFish browser session br-1 started" in m for m in messages)
    assert any("in the TinyFish browser" in m for m in messages)
    assert any("br-1 closed" in m for m in messages)


def test_auto_falls_back_to_local_chromium_when_tinyfish_is_unavailable(env, site):
    async def broken(*_a, **_k):
        raise TinyFishError("TinyFish couldn't start a browser (HTTP 402: wallet empty).")

    env["patch"].setattr(tinyfish_browser, "create_session", broken)
    sid = new_scan(site, "tinyfish")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, messages = result()
    assert scan.status == "done" and scan.engine == "local" and "image-alt" in rules
    assert any("unavailable" in m and "wallet empty" in m for m in messages)
    assert env["closed"] == []  # no session was ever created


def test_forced_tinyfish_fails_the_scan_instead_of_falling_back(env, site):
    env["cfg"] = cfg(tinyfish_api_key="k", scan_engine="tinyfish", database_url=env["cfg"].database_url)

    async def broken(*_a, **_k):
        raise TinyFishError("TinyFish couldn't start a browser (HTTP 404).")

    env["patch"].setattr(tinyfish_browser, "create_session", broken)
    sid = new_scan(site, "tinyfish")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, _ = result()
    assert scan.status == "failed" and "HTTP 404" in scan.error and not rules


def test_session_is_ended_even_when_the_scan_crashes(env, site):
    async def crash(*_a, **_k):
        raise RuntimeError("boom")

    env["patch"].setattr(pipeline, "render", crash)

    async def go():
        port = free_port()
        async with async_playwright() as pw:
            remote = await pw.chromium.launch(args=[f"--remote-debugging-port={port}"])

            async def create(_s, url, transport=None):
                return {"session_id": "br-2", "cdp_url": f"http://127.0.0.1:{port}"}

            env["patch"].setattr(tinyfish_browser, "create_session", create)
            try:
                await pipeline.run_scan(new_scan(site, "tinyfish"))
            finally:
                await remote.close()

    asyncio.run(go())
    scan, _, _ = result()
    assert scan.status == "failed" and env["closed"] == ["br-2"]


# --- bot-protection pages ------------------------------------------------------------------------


def test_blocked_page_is_detected_and_a_normal_page_is_not(monkeypatch):
    monkeypatch.setattr(pipeline, "BLOCK_WAIT", 1)

    async def go():
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            await page.set_content(CHALLENGE.decode())
            with pytest.raises(pipeline.BlockedError, match="bot-protection"):
                await pipeline.ensure_not_blocked(page, "https://w3.org/x")
            await page.set_content(PAGE.decode())
            await pipeline.ensure_not_blocked(page, "https://w3.org/x")
            await browser.close()

    asyncio.run(go())


def test_blocked_in_tinyfish_retries_with_local_chromium_instead_of_scoring_the_challenge(env, site, monkeypatch):
    monkeypatch.setattr(pipeline, "BLOCK_WAIT", 1)
    sid = new_scan(site, "tinyfish")
    asyncio.run(scan_with_remote_browser(env, sid, user_agent="FakeRemote"))
    scan, rules, messages = result()
    assert scan.status == "done" and scan.engine == "local"
    assert "image-alt" in rules and "meta-refresh" not in rules  # the real page was scanned, not the challenge
    assert any("TinyFish browser was blocked" in m and "retrying with local" in m for m in messages)
    assert env["closed"] == ["br-1"]  # the blocked session was still ended


def test_blocked_with_forced_tinyfish_fails_the_scan(env, site, monkeypatch):
    monkeypatch.setattr(pipeline, "BLOCK_WAIT", 1)
    env["cfg"] = cfg(tinyfish_api_key="k", scan_engine="tinyfish", database_url=env["cfg"].database_url)
    sid = new_scan(site, "tinyfish")
    asyncio.run(scan_with_remote_browser(env, sid, user_agent="FakeRemote"))
    scan, rules, _ = result()
    assert scan.status == "failed" and "bot-protection" in scan.error and not rules
    assert env["closed"] == ["br-1"]


# --- saved W3C rules as reference ------------------------------------------------------------------


def test_scan_attaches_the_saved_rule_for_each_issues_success_criterion(env, site):
    from app import routes_scans
    from app.models import RuleDoc

    with Session(db.engine()) as s:
        s.add(RuleDoc(
            title="Provide Text Alternatives for Non-text Content", origin="w3c-sync",
            source_url="https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
            content="Requirement: All non-text content must have a text alternative. WCAG reference: Success Criterion 1.1.1, Non-text Content, WCAG 2.2 Level A. Implementation: ...",
        ))
        s.commit()
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    with Session(db.engine()) as s:
        issues = {i["rule_id"]: i for i in routes_scans.get_scan(sid, s)["issues"]}
    alt = issues["image-alt"]  # WCAG 1.1.1: covered by the saved rule
    assert alt["rule"]["title"] == "Provide Text Alternatives for Non-text Content"
    assert alt["rule"]["excerpt"] == "All non-text content must have a text alternative."
    assert alt["rule"]["source_url"].endswith("non-text-content.html")
    others = [i for i in issues.values() if i["wcag_sc"] != "1.1.1"]
    assert all(i["rule"] is None for i in others)
    _, _, messages = result()
    assert "using 1 saved W3C rule(s) as reference" in messages
    assert any("matched a saved W3C rule" in m for m in messages)


def test_scan_without_saved_rules_says_so_and_still_works(env, site):
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, messages = result()
    assert scan.status == "done" and "image-alt" in rules
    assert any("no saved W3C rules yet" in m for m in messages)


def test_rule_excerpt():
    from app.rule_lookup import excerpt

    assert excerpt("Requirement: Do X. WCAG reference: Success Criterion 1.1.1") == "Do X."
    assert excerpt("Plain text") == "Plain text"
    assert len(excerpt("Requirement: " + "word " * 200)) <= 300


@pytest.mark.parametrize("delay_ms", [300, 520, 600, 700, 1200])
def test_page_that_navigates_right_after_load_is_still_scanned(env, site, delay_ms):
    """Client-side redirects land at different moments relative to load; each used to fail or scan the wrong page."""
    sid = new_scan(f"{site}spa?d={delay_ms}", "local")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, _ = result()
    assert scan.status == "done", scan.error
    assert "image-alt" in rules  # the page it landed on, not an error or the page before the redirect
