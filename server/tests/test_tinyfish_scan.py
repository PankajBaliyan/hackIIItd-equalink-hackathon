"""TinyFish remote browser in the crawl stage. No network: the "remote" browser is a local Chromium over CDP."""

import asyncio
import json
import re
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


# --- OpenAI review of the rendered page ---------------------------------------------------------------


class FakeOpenAI:
    def __init__(self, issues=None, error=None, fixes=None):
        """`fixes`: patched_html by axe rule id, answered for the fix stage (the review call gets `issues`)."""
        from types import SimpleNamespace

        self.calls, self.issues, self.error, self.fixes = [], issues or [], error, fixes or {}
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    async def create(self, **kw):
        from types import SimpleNamespace

        self.calls.append(kw)
        if self.error:
            raise self.error
        if kw["response_format"]["json_schema"]["name"] == "fixes":
            ids = {rule: iid for iid, rule in re.findall(r"issue_id: (iss_\w+)\nrule: ([\w-]+)", kw["messages"][1]["content"])}
            fx = [{"issue_id": ids[r], "patched_html": html, "explanation": "Fixed.", "confidence": 0.8} for r, html in self.fixes.items() if r in ids]
            msg = SimpleNamespace(content=json.dumps({"fixes": fx}), refusal=None)
        else:
            msg = SimpleNamespace(content=json.dumps({"issues": self.issues}), refusal=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")])


def with_openai(env, fake):
    from app import source_llm

    env["cfg"] = env["cfg"].model_copy(update={"openai_api_key": "k"})
    env["patch"].setattr(source_llm, "make_client", lambda _s: fake)


def llm_issue(selector, **kw):
    return {"file": selector, "line": 1, "rule_id": "vague-link-text", "wcag_sc": "2.4.4", "impact": "moderate", "problem": "Say where the link goes.", **kw}


def test_page_review_adds_issues_with_real_selectors_and_drops_the_rest(env, site):
    fake = FakeOpenAI([llm_issue("main"), llm_issue("#nope"), llm_issue("main[", rule_id="bad-selector"), llm_issue("html", wcag_sc="two")])
    with_openai(env, fake)
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    with Session(db.engine()) as s:
        issues = s.exec(select(IssueRow)).all()
    llm = [i for i in issues if i.detector == "llm"]
    assert [(i.rule_id, i.selector, i.wcag_sc) for i in llm] == [("vague-link-text", "main", "2.4.4")]
    assert llm[0].context == "Say where the link goes." and llm[0].html.startswith("<main")
    assert any(i.detector == "axe" for i in issues)  # axe results are still there
    _, _, messages = result()
    assert any("dropped 3 OpenAI finding(s)" in m for m in messages)
    assert "Already reported by axe-core:" in fake.calls[0]["messages"][1]["content"]


def test_page_review_failure_keeps_the_axe_results(env, site):
    import httpx
    import openai

    with_openai(env, FakeOpenAI(error=openai.APIConnectionError(request=httpx.Request("POST", "https://x"))))
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, messages = result()
    assert scan.status == "done" and "image-alt" in rules
    assert any("OpenAI review of" in m and "failed" in m for m in messages)


def test_page_review_without_a_key_is_axe_only(env, site):
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, messages = result()
    assert scan.status == "done" and "image-alt" in rules
    assert any("set OPENAI_API_KEY" in m for m in messages)


# --- fixes checked in the live page ---------------------------------------------------------------------


def fixes_of(sid="scan_t"):
    from app import routes_scans

    with Session(db.engine()) as s:
        d = routes_scans.get_scan(sid, s)
    return {next(i for i in d["issues"] if i["id"] == f["issue_id"])["rule_id"]: f for f in d["fixes"]}, d


def test_good_fix_is_validated_in_the_live_page_and_the_page_is_left_untouched(env, site):
    with_openai(env, FakeOpenAI(fixes={"image-alt": '<img src="x.png" alt="A red square">'}))
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    fixes, detail = fixes_of()
    fix = fixes["image-alt"]
    assert fix["validated"] is True and fix["violations_after"] < fix["violations_before"]
    assert fix["original"] == '<img src="x.png">' and 'alt="A red square"' in fix["patched"]
    assert detail["scan"]["score_after"] > detail["scan"]["score_before"]
    _, _, messages = result()
    assert any(m.startswith("validated image-alt") for m in messages)


@pytest.mark.parametrize(
    "patched,reason",
    [
        ('<img src="x.png">', "still reports image-alt"),
        ('<img src="x.png" alt="ok"><button></button>', "introduces new violations: button-name"),
    ],
)
def test_bad_fix_is_rejected_by_axe(env, site, patched, reason):
    with_openai(env, FakeOpenAI(fixes={"image-alt": patched}))
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    fix = fixes_of()[0]["image-alt"]
    assert fix["validated"] is False and reason in fix["rejected_reason"]
    scan, _, _ = result()
    assert scan.score_after == scan.score_before


def test_fix_stage_failure_keeps_the_scan_and_axe_results(env, site):
    import httpx
    import openai

    with_openai(env, FakeOpenAI(error=openai.APIConnectionError(request=httpx.Request("POST", "https://x"))))
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    scan, rules, messages = result()
    assert scan.status == "done" and "image-alt" in rules
    assert fixes_of()[0] == {}
    assert any("left for human review" in m for m in messages)


def test_llm_found_page_issues_get_no_fix(env, site):
    with_openai(env, FakeOpenAI([llm_issue("main")], fixes={"vague-link-text": "<main></main>"}))
    sid = new_scan(site, "local")
    asyncio.run(pipeline.run_scan(sid))
    fixes, detail = fixes_of()
    assert "vague-link-text" not in fixes
    assert any(i["detector"] == "llm" for i in detail["issues"])


# --- full-site crawl -------------------------------------------------------------------------------------

SITE = {
    "/": '<a href="/a">A</a> <a href="/b/">B</a> <a href="https://elsewhere.example/x">out</a> <a href="/doc.pdf">pdf</a> <a href="/boom">boom</a> <a href="/#top">top</a>',
    "/a": '<a href="/c">C</a> <a href="/">home</a> <a href="/b">B again</a>',
    "/b": "<p>b</p>",
    "/c": "<p>c</p>",
}


@pytest.fixture
def multi_site():
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/boom":
                self.connection.close()  # no response at all: the navigation fails
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            body = SITE.get(self.path.rstrip("/") or "/", "<p>x</p>")
            self.wfile.write(f'<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="x.png">{body}</main></body></html>'.encode())

        def log_message(self, *_a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/"
    srv.shutdown()


def site_scan(sid="scan_t", url="http://x/"):
    with Session(db.engine()) as s:
        s.add(Scan(id=sid, url=url, mode="url", level="AA", scope="site", engine="local"))
        s.commit()
    return sid


def scanned_paths():
    from urllib.parse import urlsplit

    with Session(db.engine()) as s:
        return sorted({urlsplit(i.page_url).path for i in s.exec(select(IssueRow)).all()})


def test_site_scan_follows_links_on_every_page_and_skips_external_files_and_failures(env, multi_site):
    asyncio.run(pipeline.run_scan(site_scan(url=multi_site)))
    scan, _, messages = result()
    assert scan.status == "done"
    assert scanned_paths() == ["/", "/a", "/b/", "/c"]  # /c is only linked from /a; /b/ and /b are one page
    assert any("/boom" in m and "skipped" in m for m in messages)
    assert not any("page limit reached" in m for m in messages)


def test_site_scan_stops_at_the_page_limit_and_says_so(env, multi_site):
    env["cfg"] = env["cfg"].model_copy(update={"max_site_pages": 2})
    asyncio.run(pipeline.run_scan(site_scan(url=multi_site)))
    scan, _, messages = result()
    assert scan.status == "done" and len(scanned_paths()) == 2
    assert any("page limit reached" in m and "raise MAX_SITE_PAGES" in m for m in messages)


def test_single_page_scope_does_not_crawl(env, multi_site):
    sid = new_scan(multi_site, "local")
    asyncio.run(pipeline.run_scan(sid))
    assert scanned_paths() == ["/"]
