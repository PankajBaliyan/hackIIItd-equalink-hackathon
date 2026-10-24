#!/usr/bin/env python3
"""Fetch an intranet page locally and submit HTML to an EquaLink cloud worker.

Cloud contract: POST {"html": "..."} -> {"pr_url": "https://..."}.
The endpoint may also return the GitProvider result shape {"number": ..., "url": ...}.
Uses only Python's standard library; page content is never written to a file.
"""

import argparse
import json
import os
import sys
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

MAX_HTML_BYTES = 5 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024


class RunnerError(Exception):
    pass


def http_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise argparse.ArgumentTypeError("Use an absolute HTTP(S) URL without embedded credentials.")
    return value


class EssentialHTML(HTMLParser):
    """Drop executable scripts and comments while preserving markup used by accessibility checks."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.in_script = False

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.in_script = True
        elif not self.in_script:
            self.parts.append(self.get_starttag_text())

    def handle_startendtag(self, tag, attrs):
        if tag != "script" and not self.in_script:
            self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_script = False
        elif not self.in_script:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.in_script:
            self.parts.append(data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")

    def handle_decl(self, decl):
        if not self.in_script:
            self.parts.append(f"<!{decl}>")


def strip_scripts(html: str) -> str:
    parser = EssentialHTML()
    try:
        parser.feed(html)
        parser.close()
        return "".join(parser.parts)
    finally:
        parser.parts.clear()
        parser.reset()
        del parser, html


def read_limited(response, limit: int) -> bytes:
    data = response.read(limit + 1)
    if len(data) > limit:
        raise RunnerError("HTTP response exceeds the permitted size.")
    return data


def fetch_html(url: str, timeout: float) -> str:
    request = Request(url, headers={"Accept": "text/html, application/xhtml+xml", "User-Agent": "EquaLink-LocalRunner/1.0"})
    with urlopen(request, timeout=timeout) as response:
        if response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
            raise RunnerError("The intranet server did not return HTML.")
        raw = read_limited(response, MAX_HTML_BYTES)
        try:
            return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
        finally:
            del raw


class NoCloudRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward page content or authorization to another endpoint.
        raise RunnerError("Cloud endpoint redirected; supply its final URL explicitly.")


def submit_html(endpoint: str, html: str, timeout: float, token: str | None = None) -> str:
    payload = json.dumps({"html": html}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(endpoint, data=payload, headers=headers, method="POST")
    result = {}
    try:
        with build_opener(NoCloudRedirects()).open(request, timeout=timeout) as response:
            raw = read_limited(response, MAX_RESPONSE_BYTES)
            try:
                result = json.loads(raw)
            except (ValueError, UnicodeError):
                raise RunnerError("Cloud endpoint returned invalid JSON.") from None
            finally:
                del raw
        if not isinstance(result, dict):
            raise RunnerError("Cloud endpoint must return a JSON object containing pr_url.")
        link = result.get("pr_url") or result.get("url")
        try:
            if not isinstance(link, str) or any(ord(c) < 32 or ord(c) == 127 for c in link):
                raise ValueError
            return http_url(link)
        except (ValueError, argparse.ArgumentTypeError):
            raise RunnerError("Cloud endpoint did not return a valid PR URL.") from None
    finally:
        if isinstance(result, dict):
            result.clear()
        request.data = None
        headers.clear()
        del payload, html, request, result, token


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", type=http_url, help="Local intranet page to fetch")
    parser.add_argument("--endpoint", type=http_url, default=os.environ.get("EQUALINK_CLOUD_ENDPOINT"),
                        help="Cloud HTML-to-PR endpoint (or EQUALINK_CLOUD_ENDPOINT)")
    parser.add_argument("--timeout", type=float, default=60, help="HTTP timeout in seconds (default: 60)")
    parser.add_argument("--token-env", default="EQUALINK_CLOUD_TOKEN", help="Environment variable holding the cloud bearer token")
    args = parser.parse_args(argv)
    if not args.endpoint:
        parser.error("Provide --endpoint or set EQUALINK_CLOUD_ENDPOINT.")
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero.")
    html = cleaned = None
    try:
        html = fetch_html(args.url, args.timeout)
        cleaned = strip_scripts(html)
        del html
        if not cleaned.strip():
            raise RunnerError("No HTML remained after removing scripts.")
        print(submit_html(args.endpoint, cleaned, args.timeout, os.environ.get(args.token_env)))
        return 0
    except HTTPError as exc:
        print(f"HTTP request failed (status {exc.code}).", file=sys.stderr)
        return 1
    except (RunnerError, URLError, OSError, ValueError) as exc:
        # Network exception bodies/URLs may contain private source data or credentials.
        message = str(exc) if isinstance(exc, RunnerError) else "HTTP request failed; check connectivity and endpoint configuration."
        print(message, file=sys.stderr)
        return 1
    finally:
        html = cleaned = None
        # Python reference release is not secure memory erasure.
        del html, cleaned


if __name__ == "__main__":
    raise SystemExit(main())
