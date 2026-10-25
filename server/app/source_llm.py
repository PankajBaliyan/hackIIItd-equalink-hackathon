"""OpenAI review of source files for accessibility problems the static rules cannot see.

Optional: it runs only when OPENAI_API_KEY is set, and a failure never fails the scan. The saved W3C rules
go into the system prompt as reference, and every reported issue is validated against the files that were sent
(real file, line inside the file, a well-formed WCAG number) before it is stored.
"""

import json
import re
from dataclasses import dataclass

import openai

from app.config import Settings
from app.source_rules import Finding

BATCH_CHARS = 80_000
SC_RE = re.compile(r"^\d\.\d{1,2}\.\d{1,2}$")
IMPACTS = ("critical", "serious", "moderate", "minor")

SYSTEM = """You review front-end source code for web accessibility problems against WCAG 2.2.

How to report:
- Report only problems you can see in the code shown. Give the file path and the 1-based line number (the number before the "|").
- Do not repeat anything in a file's "Already reported" list, and skip what simple static rules already cover: missing alt, unlabeled form fields, empty buttons or links, click handlers on non-interactive elements, missing lang.
- Look for what static rules cannot see: heading order and document structure, missing landmarks, focus management in dialogs and menus, ARIA misuse (invalid roles or attributes, aria-hidden on focusable content), form errors that are not identified in text (3.3.1), status messages that are not announced (4.1.3), keyboard traps, meaning conveyed by color alone, hard-coded color pairs that fail contrast (work out the ratio), touch targets smaller than 24 CSS px, autoplaying or flashing content.
- Be precise. If you are not sure it is a real problem, leave it out. An empty list is a good answer.
- rule_id is a short kebab-case name for the problem. wcag_sc is the success criterion number, for example 2.4.7. problem is one sentence saying what is wrong and how to fix it.

When a saved W3C rule below covers the criterion, use its wording and requirement.

Saved W3C rules (reference):
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "file": {"type": "string"},
                    "line": {"type": "integer"},
                    "rule_id": {"type": "string"},
                    "wcag_sc": {"type": "string"},
                    "impact": {"type": "string", "enum": list(IMPACTS)},
                    "problem": {"type": "string"},
                },
                "required": ["file", "line", "rule_id", "wcag_sc", "impact", "problem"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["issues"],
    "additionalProperties": False,
}


@dataclass
class LlmIssue:
    file: str
    line: int
    rule_id: str
    wcag_sc: str
    impact: str
    problem: str


def make_client(s: Settings) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(api_key=s.openai_api_key)


def numbered(text: str) -> str:
    return "\n".join(f"{i:>4}| {line}" for i, line in enumerate(text.split("\n"), 1))


def batches(files: dict[str, str]) -> list[list[str]]:
    out: list[list[str]] = [[]]
    size = 0
    for path, text in files.items():
        if out[-1] and size + len(text) > BATCH_CHARS:
            out.append([])
            size = 0
        out[-1].append(path)
        size += len(text)
    return [b for b in out if b]


def prompt(paths: list[str], files: dict[str, str], static: dict[str, list[Finding]]) -> str:
    parts = []
    for p in paths:
        known = "\n".join(f"  line {f.line}: {f.rule_id}" for f in static.get(p, []))
        parts.append(f"=== {p} ===\n" + (f"Already reported:\n{known}\n" if known else "") + numbered(files[p]))
    return "Review these files.\n\n" + "\n\n".join(parts)


def validate(raw: object, files: dict[str, str]) -> tuple[list[LlmIssue], int]:
    """Keep only issues that point at a real line of a file we sent. Returns (issues, dropped)."""
    items = raw.get("issues") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return [], 0
    ok, dropped, seen = [], 0, set()
    for i in items:
        try:
            issue = LlmIssue(str(i["file"]), int(i["line"]), str(i["rule_id"]).strip(), str(i["wcag_sc"]).strip(), str(i["impact"]), str(i["problem"]).strip())
        except (KeyError, TypeError, ValueError):
            dropped += 1
            continue
        if issue.file not in files:  # a path we never sent
            dropped += 1
            continue
        lines = files[issue.file].count("\n") + 1
        key = (issue.file, issue.line, issue.wcag_sc)
        if not (1 <= issue.line <= lines and SC_RE.match(issue.wcag_sc) and issue.impact in IMPACTS and issue.rule_id and issue.problem) or key in seen:
            dropped += 1
            continue
        seen.add(key)
        ok.append(issue)
    return ok, dropped


async def ask_json(s: Settings, client, system: str, user: str, label: str, note, schema: dict | None = None, name: str = "accessibility_issues") -> object | None:
    """One structured-output call. Returns the parsed JSON, or None (with a note) if it failed, was declined or was malformed."""
    try:
        resp = await client.chat.completions.create(
            model=s.openai_model,
            max_completion_tokens=16000,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema or SCHEMA}},
        )
    except openai.OpenAIError as e:
        note(f"OpenAI review of {label} failed ({type(e).__name__}); skipped")
        return None
    choice = resp.choices[0]
    if choice.message.refusal:
        note(f"OpenAI declined to review {label}; skipped")
        return None
    try:
        return json.loads(choice.message.content or "")
    except json.JSONDecodeError:
        note(f"The answer for {label} was not valid JSON (finish reason: {choice.finish_reason}); skipped")
        return None


async def review(
    s: Settings, rules_text: str, files: dict[str, str], static: dict[str, list[Finding]], client=None, on_note=None
) -> list[LlmIssue]:
    """Ask the model about each batch of files. Batches that fail or are declined are skipped with a note."""
    client = client or make_client(s)
    note = on_note or (lambda _m: None)
    found: list[LlmIssue] = []
    for n, paths in enumerate(batches(files), 1):
        raw = await ask_json(s, client, SYSTEM + (rules_text or "(none saved)"), prompt(paths, files, static), f"batch {n}", note)
        if raw is None:
            continue
        issues, dropped = validate(raw, {p: files[p] for p in paths})
        if dropped:
            note(f"dropped {dropped} OpenAI finding(s) that pointed at unknown files or lines")
        found += issues
    return found
