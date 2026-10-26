"""Open one pull request from a scan's validated fixes. Used by the Fixes page and by "Auto-open PR when done"."""

import json
import secrets

from fastapi import HTTPException
from sqlmodel import Session, select

from app import github, shipping
from app.config import Settings
from app.models import FixRow, IssueRow, PullRow, Scan


async def open_pull(db: Session, settings: Settings, scan: Scan, fix_ids: list[str] | None = None) -> PullRow:
    """Commit the chosen fixes to a new branch and open the PR (never merged). Raises HTTPException when it can't."""
    scan_id = scan.id
    if existing := db.get(PullRow, scan_id):
        return existing
    if scan.status not in ("done", "shipping"):
        raise HTTPException(409, "Wait for the scan to finish before opening a pull request.")
    if not scan.repo:
        raise HTTPException(422, "This scan has no GitHub repository. Scan a repository to open a pull request.")

    fixes = db.exec(select(FixRow).where(FixRow.scan_id == scan_id)).all()
    issues = {i.id: i for i in db.exec(select(IssueRow).where(IssueRow.scan_id == scan_id)).all()}
    if fix_ids is not None:
        by_id = {f.id: f for f in fixes}
        if len(set(fix_ids)) != len(fix_ids) or any(i not in by_id for i in fix_ids):
            raise HTTPException(422, "Select distinct fixes that belong to this scan.")
        chosen = [by_id[i] for i in fix_ids]
    else:
        chosen = [f for f in fixes if f.validated and f.included]
    if not chosen or any(not f.validated for f in chosen):
        raise HTTPException(422, "Select at least one validated fix.")
    if not any(issues.get(f.issue_id) and issues[f.issue_id].source_file for f in chosen):
        raise HTTPException(
            422, "These fixes patch a rendered page, not source files, so there is nothing to commit. Scan the repository itself to open a pull request.",
        )

    from app.routes_github import _repo_token

    token = await _repo_token(settings, db, scan.repo)
    branch = None
    try:
        base, base_sha = await github.branch_head(token, scan.repo)
        paths = sorted({issues[f.issue_id].source_file for f in chosen if f.issue_id in issues and issues[f.issue_id].source_file})
        files, blobs = {}, {}
        for path in paths:
            files[path], blobs[path] = await github.file_at(token, scan.repo, path, base_sha)
        result = shipping.plan(files, chosen, issues)
        if not result.edits:
            why = "; ".join(sorted({reason for _, reason in result.skipped})) or "nothing to change"
            raise HTTPException(409, f"None of the fixes could be applied: {why}.")
        applied = [f for e in result.edits for f in e.applied]
        branch = f"equalink/a11y-fixes-{scan_id}-{secrets.token_hex(2)}"
        await github.create_branch(token, scan.repo, branch, base_sha)
        for edit in result.edits:
            await github.commit_file(
                token, scan.repo, branch, edit.path, edit.text, blobs[edit.path],
                f"fix(a11y): {len(edit.applied)} accessibility fix{'es' if len(edit.applied) != 1 else ''} in {edit.path}",
            )
        pull = await github.create_pull(
            token, scan.repo, base, branch,
            f"Fix {len(applied)} accessibility issue{'s' if len(applied) != 1 else ''} (EquaLink)",
            shipping_body(scan, applied, issues, result.skipped), False,
        )
    except github.GitHubError as e:
        if branch:
            await github.delete_branch(token, scan.repo, branch)
        raise HTTPException(502 if e.status >= 500 or e.status == 401 else (409 if e.status == 422 else e.status), e.message)
    except HTTPException:
        if branch:
            await github.delete_branch(token, scan.repo, branch)
        raise
    row = PullRow(scan_id=scan_id, repo=scan.repo, branch=branch, number=pull["number"], url=pull["url"], fix_ids=json.dumps([f.id for f in applied]))
    db.add(row)
    db.commit()
    return row


def shipping_body(scan: Scan, applied: list[FixRow], issues: dict[str, IssueRow], skipped: list[tuple[FixRow, str]]) -> str:
    score = f"Accessibility score: {scan.score_before} -> {scan.score_after}\n\n" if scan.score_before is not None and scan.score_after is not None else ""
    lines = [f"## Accessibility fixes (WCAG {scan.level})", "", score + f"EquaLink scanned `{scan.repo}` and proposes {len(applied)} fix{'es' if len(applied) != 1 else ''}. Each one was re-checked with the same rules after the change.", "", "| Rule | WCAG | Location | What changed |", "| --- | --- | --- | --- |"]
    for f in applied:
        i = issues[f.issue_id]
        lines.append(f"| `{i.rule_id}` | {i.wcag_sc} | `{i.source_file}:{f.start_line}` | {f.explanation.replace('|', '/')} |")
    if skipped:
        lines += ["", "Left out:"] + [f"- `{issues[f.issue_id].rule_id}`: {why}" for f, why in skipped if f.issue_id in issues]
    lines += ["", "Automated checks cover only part of WCAG. Please review the diff and test keyboard and screen-reader behaviour before merging.", "", "_Opened by EquaLink. It never merges for you._"]
    return "\n".join(lines)
