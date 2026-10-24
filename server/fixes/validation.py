"""Axe validation of submitted HTML snapshots, without executing page scripts."""

import asyncio
import json
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException

from .models import Fix, ImportScan


RUNNER = Path(__file__).with_name("axe_runner.mjs")
VALIDATION_SLOTS = asyncio.Semaphore(1)


async def analyze(pages: list[str | dict], level="AA", targets=None):
    node = shutil.which("node")
    if not node:
        raise HTTPException(503, "Node.js is required for axe validation.")
    async with VALIDATION_SLOTS:
        try:
            # Uvicorn's Windows reload worker may use a SelectorEventLoop,
            # which cannot create asyncio subprocesses. A worker thread works
            # with both Windows event loop policies.
            process = await asyncio.to_thread(
                subprocess.run, [node, str(RUNNER)],
                input=json.dumps({"pages": pages, "level": level, "targets": targets or []}).encode(),
                capture_output=True, timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(503, "HTML validation timed out. Submit fewer candidates.")
    if process.returncode:
        # Do not forward source HTML or internal process paths to the browser.
        raise HTTPException(503, "Axe validation is unavailable. Run npm ci and npx playwright install chromium in client/; see server/fixes/README.md.")
    return json.loads(process.stdout)


def fingerprint(report):
    return {(v["rule"], v["selector"]) for v in report["violations"]}


def has_issue(report, issue):
    return any(v["rule"] == issue.rule_id and (
        v["selector"] == issue.selector or issue.selector in v.get("issue_selectors", [])
    ) for v in report["violations"])


async def validate_candidates(payload: ImportScan):
    issues = {issue.id: issue for issue in payload.issues}
    pages = [payload.page_html]
    patches = {}
    for fix in payload.fixes:
        if payload.page_html.count(fix.original) == 1 and fix.original != fix.patched:
            patches[fix.id] = len(pages)
            pages.append(payload.page_html.replace(fix.original, fix.patched, 1))
    reports = await analyze(pages, payload.level, [issue.selector for issue in payload.issues])
    baseline = reports[0]
    before = fingerprint(baseline)
    validated = []
    for fix in payload.fixes:
        issue = issues[fix.issue_id]
        report = reports[patches[fix.id]] if fix.id in patches else baseline
        after = fingerprint(report)
        reason = None
        if fix.id not in patches:
            reason = "The original snippet must occur exactly once in page_html and the patch must change it."
        elif payload.page_html.count(issue.html) != 1 or issue.html != fix.original:
            reason = "The issue HTML must match the original fix snippet exactly once."
        elif not has_issue(baseline, issue):
            reason = "Axe did not reproduce this rule at this selector. Manual review is required."
        elif baseline["matches"][payload.issues.index(issue)] != 1:
            reason = "The selector must identify exactly one element in the HTML snapshot."
        elif has_issue(report, issue):
            reason = "The proposed fix does not remove the reported violation."
        elif any(v["rule"] == issue.rule_id for v in report["incomplete"]):
            reason = "Axe could not fully evaluate the target rule after patching. Manual review is required."
        elif after - before:
            reason = "The proposed fix introduces a new axe violation."
        elif len(after) >= len(before):
            reason = "The proposed fix does not reduce the total violation count."
        validated.append(Fix(
            **fix.model_dump(), validated=reason is None, included=reason is None,
            violations_before=len(before), violations_after=len(after), rejected_reason=reason,
        ))
    return validated


async def validate_combination(html, fixes, level):
    patched = html
    for fix in fixes:
        if patched.count(fix["original"]) != 1:
            raise HTTPException(409, "Selected fixes overlap or no longer match the stored HTML.")
        patched = patched.replace(fix["original"], fix["patched"], 1)
    before, after = await analyze([html, patched], level)
    if fingerprint(after) - fingerprint(before) or len(fingerprint(after)) >= len(fingerprint(before)):
        raise HTTPException(422, "The combined patch failed axe validation. Review a smaller selection.")
