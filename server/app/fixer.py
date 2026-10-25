"""Proposed fixes and the rules-engine check that decides whether each one may be trusted.

The model only proposes. A fix counts as validated when re-running the rules on the patched result shows the
original violation gone and nothing new: axe-core on the live DOM for a rendered page, the static source rules
on the patched text for repo code. This module has no database or event code; the callers store and report.
"""

import re
from collections import Counter
from dataclasses import dataclass

from playwright.async_api import Page

from app import source_llm
from app.config import Settings
from app.models import IssueRow
from app.source_rules import analyze

UNSAFE = re.compile(r"<\s*script|javascript:", re.I)
MAX_PATCH_CHARS = 6000
MAX_RANGE_LINES = 25
FILE_CHARS = 60_000
SKIP_SELECTORS = {"html", "body", "head"}  # whole-document nodes can't be swapped out for a snippet


def _schema(item: dict) -> dict:
    return {
        "type": "object",
        "properties": {"fixes": {"type": "array", "items": {
            "type": "object", "properties": item, "required": list(item), "additionalProperties": False}}},
        "required": ["fixes"], "additionalProperties": False,
    }


SITE_SCHEMA = _schema({"issue_id": {"type": "string"}, "patched_html": {"type": "string"}, "explanation": {"type": "string"}, "confidence": {"type": "number"}})
SOURCE_SCHEMA = _schema({
    "issue_id": {"type": "string"}, "start_line": {"type": "integer"}, "end_line": {"type": "integer"},
    "replacement": {"type": "string"}, "explanation": {"type": "string"}, "confidence": {"type": "number"},
})

COMMON = """Rules for every fix:
- Change as little as possible. Keep existing classes, ids, attributes and handlers that are not part of the problem.
- Do not invent facts. Write text (alt text, labels, link names) only from what the markup, its context or its file names say. If no honest fix exists, return an empty replacement and say why in the explanation.
- Never add scripts, inline event handlers that did not exist, or javascript: URLs.
- explanation is one or two sentences: what was wrong and what you changed. confidence is 0 to 1: how sure you are the fix is correct and complete.
- Return exactly one entry per issue_id you were given.

When a saved W3C rule below covers the criterion, follow its requirement.

Saved W3C rules (reference):
"""

SITE_SYSTEM = """You fix web accessibility violations (WCAG 2.2) found by axe-core. Each issue gives the failing element's HTML.
For each issue return patched_html: the corrected markup that replaces that element. It may be several sibling elements
(for example a <label> followed by the <input>). Return only the markup, no code fences.

""" + COMMON

SOURCE_SYSTEM = """You fix web accessibility problems in front-end source code (HTML, JSX, TSX, Vue, Svelte, Astro).
You get one file with numbered lines ("  12| code") and the problems found in it. For each issue return start_line and end_line
(1-based, inclusive, the smallest range that contains the problem) and replacement: the corrected text for exactly those lines,
using the file's own indentation and syntax, without the line numbers.

""" + COMMON


@dataclass
class Proposal:
    issue_id: str
    patched: str
    explanation: str
    confidence: float
    start_line: int | None = None
    end_line: int | None = None


@dataclass
class Verdict:
    validated: bool
    before: int = 0
    after: int = 0
    reason: str | None = None


def _clamp(v: object) -> float:
    try:
        return max(0.0, min(1.0, float(v)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def eligible_site_issues(issues: list[IssueRow], limit: int) -> list[IssueRow]:
    """Axe issues only (the rules engine can re-check those), worst first, capped."""
    weight = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
    pool = [i for i in issues if i.detector == "axe" and i.selector.strip().lower() not in SKIP_SELECTORS]
    return sorted(pool, key=lambda i: weight.get(i.impact, 4))[:limit]


def eligible_source_issues(issues: list[IssueRow], limit: int) -> list[IssueRow]:
    """Static-rule findings only (the same rules can re-check the patched file), worst first, capped."""
    weight = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
    pool = [i for i in issues if i.detector == "static" and i.source_file and i.source_line]
    return sorted(pool, key=lambda i: weight.get(i.impact, 4))[:limit]


def _site_prompt(issues: list[IssueRow]) -> str:
    return "Fix these issues.\n\n" + "\n\n".join(
        f"issue_id: {i.id}\nrule: {i.rule_id} (WCAG {i.wcag_sc}, {i.impact})\nproblem: {i.context or ''}\npage: {i.page_url}\nelement:\n{i.html}"
        for i in issues
    )


async def propose_site(s: Settings, client, rules_text: str, issues: list[IssueRow], note) -> list[Proposal]:
    raw = await source_llm.ask_json(
        s, client, SITE_SYSTEM + (rules_text or "(none saved)"), _site_prompt(issues), "fixes", note, SITE_SCHEMA, "fixes",
    )
    items = raw.get("fixes") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    known = {i.id for i in issues}
    out: dict[str, Proposal] = {}
    for it in items:
        try:
            iid, patched, why = str(it["issue_id"]), str(it["patched_html"]).strip(), str(it["explanation"]).strip()
            conf = _clamp(it["confidence"])
        except (KeyError, TypeError):
            continue
        if iid in known and iid not in out and patched and why and len(patched) <= MAX_PATCH_CHARS and not UNSAFE.search(patched):
            out[iid] = Proposal(iid, patched, why, conf)
    return list(out.values())


# Runs in the page: swap the element for the patch inside a marked parent, count axe violations by rule before and
# after, then put the original markup back. Counting the parent (not the whole page) keeps the comparison local.
VERIFY_JS = """async ({selector, patched, tags}) => {
  let el;
  try { el = document.querySelector(selector); } catch (e) { return {error: 'invalid selector'}; }
  if (!el || !el.parentElement) return {error: 'element not found'};
  const scope = el.parentElement;
  const ctx = {include: [['[data-eqlk-scope]']]};
  const opts = {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations']};
  const tally = vs => Object.fromEntries(vs.map(v => [v.id, v.nodes.length]));
  const saved = scope.innerHTML;
  scope.setAttribute('data-eqlk-scope', '');
  try {
    const before = tally((await axe.run(ctx, opts)).violations);
    const tpl = document.createElement('template');
    tpl.innerHTML = patched;
    el.replaceWith(tpl.content);
    const after = tally((await axe.run(ctx, opts)).violations);
    return {before, after};
  } finally {
    scope.innerHTML = saved;
    scope.removeAttribute('data-eqlk-scope');
  }
}"""


def judge(rule_id: str, before: dict[str, int], after: dict[str, int]) -> Verdict:
    b, a = sum(before.values()), sum(after.values())
    if after.get(rule_id, 0) >= before.get(rule_id, 0):
        return Verdict(False, b, a, f"axe-core still reports {rule_id} after the change")
    worse = sorted(r for r, n in after.items() if n > before.get(r, 0))
    if worse:
        return Verdict(False, b, a, f"the change introduces new violations: {', '.join(worse)}")
    return Verdict(True, b, a)


async def verify_site(page: Page, issue: IssueRow, patched: str, tags: list[str], axe_js: str) -> Verdict:
    await page.evaluate(axe_js)
    res = await page.evaluate(VERIFY_JS, {"selector": issue.selector, "patched": patched, "tags": tags})
    if "error" in res:
        return Verdict(False, 0, 0, f"couldn't re-check it in the browser ({res['error']})")
    return judge(issue.rule_id, res["before"], res["after"])


def _numbered(text: str) -> str:
    return "\n".join(f"{n:>4}| {line}" for n, line in enumerate(text.split("\n"), 1))


async def propose_source(s: Settings, client, rules_text: str, path: str, text: str, issues: list[IssueRow], note) -> list[Proposal]:
    user = f"=== {path} ===\n{_numbered(text)[:FILE_CHARS]}\n\nIssues to fix:\n" + "\n".join(
        f"- issue_id: {i.id} | line {i.source_line} | {i.rule_id} (WCAG {i.wcag_sc}) | {i.context or ''}" for i in issues
    )
    raw = await source_llm.ask_json(s, client, SOURCE_SYSTEM + (rules_text or "(none saved)"), user, f"fixes for {path}", note, SOURCE_SCHEMA, "fixes")
    items = raw.get("fixes") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    known = {i.id for i in issues}
    out: dict[str, Proposal] = {}
    for it in items:
        try:
            iid, why = str(it["issue_id"]), str(it["explanation"]).strip()
            repl = str(it["replacement"]).strip("\n")
            start, end, conf = int(it["start_line"]), int(it["end_line"]), _clamp(it["confidence"])
        except (KeyError, TypeError, ValueError):
            continue
        if iid in known and iid not in out and repl.strip() and why and len(repl) <= MAX_PATCH_CHARS and not UNSAFE.search(repl):
            out[iid] = Proposal(iid, repl, why, conf, start, end)
    return list(out.values())


def verify_source(text: str, issue: IssueRow, p: Proposal) -> tuple[str, Verdict]:
    """(the original lines the patch replaces, the verdict from re-running the static rules on the patched file)."""
    lines = text.split("\n")
    start, end = p.start_line or 0, p.end_line or 0
    if not (1 <= start <= end <= len(lines)) or end - start + 1 > MAX_RANGE_LINES:
        return "", Verdict(False, 0, 0, "the proposed line range is not valid for this file")
    original = "\n".join(lines[start - 1 : end])
    if not (start <= (issue.source_line or 0) <= end):
        return original, Verdict(False, 0, 0, "the proposed change does not cover the line with the problem")
    patched_text = "\n".join(lines[: start - 1] + p.patched.split("\n") + lines[end:])
    before = Counter(f.rule_id for f in analyze(text))
    after = Counter(f.rule_id for f in analyze(patched_text))
    return original, judge(issue.rule_id, dict(before), dict(after))
