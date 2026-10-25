"""TinyFish remote browser sessions (Browser API): a stealth Chrome we drive over CDP with Playwright.

The crawl stage uses it so pages are rendered from TinyFish's network instead of this machine. TinyFish
cannot reach localhost or private addresses, so those targets are always scanned with local Chromium.
"""

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from app.config import Settings

log = logging.getLogger("equalink.tinyfish")

BROWSER_API = "https://api.browser.tinyfish.ai"
INACTIVITY_TIMEOUT = 120  # seconds; a session that is leaked ends itself (it bills until then)


class TinyFishError(Exception):
    pass


def is_private_target(url: str) -> bool:
    host = urlsplit(url).hostname or ""
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test")):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False  # unknown to us: let TinyFish report it
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return True
    return False


def choose_engine(s: Settings, url: str) -> str:
    """'tinyfish' or 'local' for a new scan. Raises 422/503 when the configured engine cannot work."""
    if s.scan_engine == "local":
        return "local"
    if s.scan_engine == "tinyfish":
        if not s.tinyfish_api_key:
            raise HTTPException(503, "SCAN_ENGINE=tinyfish needs TINYFISH_API_KEY on the server.")
        if is_private_target(url):
            raise HTTPException(422, "TinyFish can't reach local or private addresses. Use SCAN_ENGINE=auto or local.")
        return "tinyfish"
    return "tinyfish" if s.tinyfish_api_key and not is_private_target(url) else "local"


def _headers(s: Settings) -> dict:
    return {"X-API-Key": s.tinyfish_api_key, "Content-Type": "application/json"}


def _reason(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error") or {}
        text = err.get("message") or err.get("code")
    except Exception:
        text = None
    return f"HTTP {resp.status_code}" + (f": {text}" if text else "")


async def create_session(s: Settings, url: str, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Starts a session that opens `url`. Returns {session_id, cdp_url, base_url}."""
    body = {"url": url, "timeout_seconds": INACTIVITY_TIMEOUT}
    try:
        async with httpx.AsyncClient(timeout=90, transport=transport) as client:  # creation takes 10-30 s
            resp = await client.post(BROWSER_API, headers=_headers(s), json=body)
    except httpx.HTTPError as e:
        raise TinyFishError(f"Couldn't reach TinyFish ({type(e).__name__}).") from e
    if resp.status_code != 201:
        raise TinyFishError(f"TinyFish couldn't start a browser ({_reason(resp)}).")
    data = resp.json()
    if not data.get("session_id") or not data.get("cdp_url"):
        raise TinyFishError("TinyFish returned no browser session.")
    return data


async def close_session(s: Settings, session_id: str, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Ends the session so it stops billing. Never raises; retries, since a missed DELETE costs money."""
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=30, transport=transport) as client:
                resp = await client.delete(f"{BROWSER_API}/{session_id}", headers=_headers(s))
            if resp.status_code in (204, 404):
                return True
            log.warning("closing TinyFish session %s: %s", session_id, _reason(resp))
        except httpx.HTTPError as e:
            log.warning("closing TinyFish session %s: %s", session_id, type(e).__name__)
        await asyncio.sleep(1 + attempt)
    log.error("TinyFish session %s was not closed; it ends after %ss of inactivity", session_id, INACTIVITY_TIMEOUT)
    return False
