"""Scan a GitHub repository's HTML and generate rule-based, axe-validated accessibility fixes."""

import base64
import html as htmllib
import re
from urllib.parse import quote

from fastapi import HTTPException

from .github import call
from .models import CandidateFix, ImportScan, IssueInput
from .validation import analyze

MAX_FILE_BYTES = 300_000
MAX_FIXES = 60
SKIP_DIRS = ("node_modules/", "dist/", "build/", ".next/", "vendor/", "coverage/", ".git/")

_TAG = r"<{name}\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>"
_ATTR = re.compile(r"([^\s=/>\"']+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>\"']+)))?")


def _start_tags(html: str, name: str) -> list[str]:
    return [m.group(0) for m in re.finditer(_TAG.format(name=name), html, re.I)]


def _key(tag: str):
    """Tag name + attributes, so an axe-serialized element matches its raw source tag."""
    head = re.match(r"<([a-zA-Z][\w-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)", tag)
    if not head:
        return None
    attrs = {}
    for m in _ATTR.finditer(head.group(2).rstrip("/")):
        value = next((g for g in m.groups()[1:] if g is not None), "")
        attrs[m.group(1).lower()] = htmllib.unescape(value)
    return head.group(1).lower(), tuple(sorted(attrs.items()))


def _attr(tag: str, name: str):
    m = re.search(rf"\s{name}\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))", tag, re.I)
    return next((g for g in m.groups() if g is not None), None) if m else None


def _add_attr(tag: str, name: str, value: str) -> str:
    end = -2 if tag.endswith("/>") else -1
    body = tag[:end].rstrip()
    return f'{body} {name}="{htmllib.escape(value, quote=True)}"{tag[end:]}'


def _humanize(text: str) -> str:
    text = re.sub(r"\.[a-z0-9]{2,5}$", "", text.rsplit("/", 1)[-1].split("?")[0], flags=re.I)
    text = re.sub(r"[-_.]+", " ", text).strip()
    return text[:1].upper() + text[1:] if text else ""


def _fix_image_alt(tag, name):
    alt = _humanize(_attr(tag, "src") or "") or "Image"
    return _add_attr(tag, "alt", alt), (
        "This image has no text alternative, so screen readers skip it or read the file name. "
        f'Add alt="{alt}". Edit it to describe what the image shows, or use alt="" if it is purely decorative.'
    ), 0.6


def _fix_lang(tag, name):
    return _add_attr(tag, "lang", "en"), (
        "The page does not declare its language, so screen readers may pronounce it with the wrong voice. "
        'Add lang="en" (change it if the page is not in English).'
    ), 0.9


def _fix_label(tag, name):
    text = _attr(tag, "placeholder") or _humanize(
        _attr(tag, "name") or _attr(tag, "id") or _attr(tag, "type") or name
    )
    return _add_attr(tag, "aria-label", text), (
        "This form control has no accessible name, so assistive technology cannot tell users what to enter. "
        f'Add aria-label="{text}". A visible <label> is better when the design allows it.'
    ), 0.6


def _fix_viewport(tag, name):
    content = _attr(tag, "content") or ""
    cleaned = re.sub(
        r",?\s*(user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?)", "", content, flags=re.I
    ).strip(", ")
    if cleaned == content:
        return None
    return tag.replace(content, cleaned, 1), (
        "The viewport meta tag blocks pinch-zoom, which low-vision users rely on. "
        "Remove user-scalable=no / maximum-scale=1 so the page can be zoomed."
    ), 0.95


SIMPLE = {
    "image-alt": ("img", _fix_image_alt),
    "html-has-lang": ("html", _fix_lang),
    "html-lang-valid": ("html", _fix_lang),
    "label": (None, _fix_label),
    "meta-viewport": ("meta", _fix_viewport),
}


def _title_fix(html: str, repo: str):
    heads = _start_tags(html, "head")
    if len(heads) != 1 or html.count(heads[0]) != 1:
        return None
    h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", html, re.I | re.S)
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", h1.group(1))).strip() if h1 else ""
    title = title or _humanize(repo.split("/")[-1]) or "Untitled page"
    head = heads[0]
    return head, f"{head}<title>{htmllib.escape(title)}</title>", (
        f"The page has no <title>, so tabs, history and screen readers cannot name it. Add <title>{title}</title>."
    ), 0.7


def _wcag(tags: list[str]) -> str:
    for tag in tags:
        m = re.fullmatch(r"wcag(\d)(\d)(\d+)", tag)
        if m:
            return ".".join(m.groups())
    return "1.3.1"


async def list_html_files(api, repo: str) -> tuple[str, list[str]]:
    info = await call(api, "GET", f"/repos/{repo}")
    branch = info["default_branch"]
    tree = await call(api, "GET", f"/repos/{repo}/git/trees/{quote(branch, safe='')}", params={"recursive": "1"})
    files = [
        e["path"] for e in tree["tree"]
        if e["type"] == "blob" and e["path"].lower().endswith((".html", ".htm"))
        and e.get("size", 0) <= MAX_FILE_BYTES
        and not any(e["path"].startswith(d) or f"/{d}" in e["path"] for d in SKIP_DIRS)
    ]
    files.sort(key=lambda p: (p.count("/"), p.lower() != "index.html", p.lower()))
    return branch, files


async def fetch_file(api, repo: str, path: str, branch: str) -> str:
    file = await call(api, "GET", f"/repos/{repo}/contents/{quote(path, safe='/')}", params={"ref": branch})
    if not isinstance(file, dict) or file.get("encoding") != "base64":
        raise HTTPException(422, f"{path} is not a supported text file.")
    try:
        return base64.b64decode(file["content"]).decode("utf-8")
    except (ValueError, UnicodeError):
        raise HTTPException(422, f"{path} is not valid UTF-8.")


def _candidate(html: str, violation: dict, repo: str):
    rule = violation["rule"]
    if rule == "document-title":
        return _title_fix(html, repo)
    if rule not in SIMPLE:
        return None
    tag_name, fixer = SIMPLE[rule]
    node = _key(violation.get("html") or "")
    if not node or (tag_name and node[0] != tag_name):
        return None
    matches = [t for t in _start_tags(html, node[0]) if _key(t) == node]
    if len(matches) != 1 or html.count(matches[0]) != 1:
        return None  # ambiguous: identical tags appear more than once in the file
    result = fixer(matches[0], node[0])
    if not result:
        return None
    patched, explanation, confidence = result
    return matches[0], patched, explanation, confidence


async def build_import(api, repo: str, path: str | None, level: str = "AA") -> ImportScan:
    branch, files = await list_html_files(api, repo)
    if not files:
        raise HTTPException(
            422, "No HTML files were found in this repository (framework apps build their HTML at deploy time)."
        )
    path = path or files[0]
    if path not in files:
        raise HTTPException(404, f"{path} is not an HTML file in {repo}.")
    html = await fetch_file(api, repo, path, branch)
    report = (await analyze([html], level))[0]

    issues: list[IssueInput] = []
    fixes: list[CandidateFix] = []
    seen = set()
    for v in report["violations"]:
        if (v["rule"], v["selector"]) in seen or len(issues) >= 100:
            continue
        seen.add((v["rule"], v["selector"]))
        issue = IssueInput(
            id=f"issue-{len(issues) + 1}", rule_id=v["rule"], wcag_sc=_wcag(v.get("tags", [])),
            impact=v.get("impact") or "moderate", selector=v["selector"],
            html=(v.get("html") or "")[:2000] or "<unknown>", context=v.get("help"), source_file=path,
        )
        candidate = _candidate(html, v, repo) if len(fixes) < MAX_FIXES else None
        if candidate:
            original, patched, explanation, confidence = candidate
            issue.html = original
            fixes.append(CandidateFix(
                id=f"fix-{len(fixes) + 1}", issue_id=issue.id, strategy="rule", original=original,
                patched=patched, explanation=explanation, confidence=confidence,
            ))
        issues.append(issue)
    return ImportScan(
        url=f"https://github.com/{repo}", repo=repo, level=level, page_html=html, issues=issues, fixes=fixes,
    )
