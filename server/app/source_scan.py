"""Scan a GitHub repo's source code (no browser): static rules, then an optional Claude review.

Issues carry the file and line they were found on, which a later fix and pull request step needs.
"""

import asyncio
import secrets

from fastapi import HTTPException
from sqlmodel import Session

from app import github, pipeline, rule_lookup, source_llm
from app.config import Settings
from app.models import GithubConnection, IssueRow, RuleDoc, Scan
from app.source_rules import Finding, analyze, is_source_file

FETCH_CONCURRENCY = 8
PRIORITY_DIRS = {"src", "app", "pages", "components", "lib", "public", "templates"}

_transport = None  # tests inject an httpx transport that stands in for api.github.com


class SourceError(Exception):
    pass


async def _token(db: Session, s: Settings) -> str | None:
    """The connected account's token, else GITHUB_TOKEN, else None (public repos still work)."""
    from app import routes_github

    conn = db.get(GithubConnection, 1)
    if conn:
        try:
            return (await routes_github._token(s, conn))[0]
        except HTTPException:
            pass
    return s.github_token or None


def pick_files(blobs: list[dict], s: Settings) -> tuple[list[str], int]:
    """Paths worth checking, most likely app code first, capped. Returns (paths, number skipped by the cap)."""
    wanted = [b["path"] for b in blobs if is_source_file(b["path"]) and b["size"] <= s.source_max_file_bytes]
    wanted.sort(key=lambda p: (0 if PRIORITY_DIRS & set(p.split("/")[:-1]) else 1, p))
    return wanted[: s.source_max_files], max(0, len(wanted) - s.source_max_files)


def _friendly(e: github.GitHubError, repo: str) -> str:
    if e.status in (401, 403, 404):
        return f"Couldn't read {repo} ({e.message}). If it is private, connect GitHub on the Integrations page."
    return e.message


def _record(
    db: Session, scan: Scan, counts: dict[str, int], seen: set, rules: dict[str, RuleDoc], *, branch: str, path: str,
    line: int, rule_id: str, sc: str, impact: str, snippet: str, message: str, detector: str,
) -> None:
    key = (rule_id, path, line)
    if key in seen:
        return
    seen.add(key)
    doc = rules.get(sc)
    row = IssueRow(
        id=f"iss_{secrets.token_hex(4)}", scan_id=scan.id, page_url=f"https://github.com/{scan.repo}/blob/{branch}/{path}#L{line}",
        rule_id=rule_id, wcag_sc=sc, impact=impact, selector=snippet or f"{path}:{line}", html=snippet, context=message,
        rule_doc_id=doc.id if doc else None, detector=detector, source_file=path, source_line=line,
    )
    db.add(row)
    db.commit()
    counts[impact] += 1
    pipeline.emit(
        db, scan.id, "diagnosing", f"{rule_id} (WCAG {sc}) {path}:{line}", "issue",
        counters=dict(counts), issue=pipeline.issue_dict(row, doc),
    )


async def scan_repo(db: Session, scan: Scan, s: Settings, counts: dict[str, int], seen: set, rules: dict[str, RuleDoc]) -> None:
    repo = scan.repo or ""
    token = await _token(db, s)
    async with github.client(token, _transport) as c:
        try:
            branch = await github.default_branch(c, repo)
            pipeline.emit(db, scan.id, "crawling", f"reading {repo}@{branch}")
            blobs, truncated = await github.repo_blobs(c, repo, branch)
            paths, skipped = pick_files(blobs, s)
            if not paths:
                raise SourceError(f"No HTML, JSX, TSX, Vue, Svelte or Astro files found in {repo}.")
            note = f"; {skipped} more skipped (limit {s.source_max_files})" if skipped else ""
            pipeline.emit(db, scan.id, "crawling", f"found {len(paths)} source file(s) to check{note}")
            if truncated:
                pipeline.emit(db, scan.id, "crawling", "GitHub truncated the file listing of this very large repo; some files are not scanned")
            gate = asyncio.Semaphore(FETCH_CONCURRENCY)

            async def get(path: str) -> tuple[str, str]:
                async with gate:
                    return path, await github.file_text(c, repo, path, branch)

            files = dict(await asyncio.gather(*(get(p) for p in paths)))
        except github.GitHubError as e:
            raise SourceError(_friendly(e, repo)) from e

    pipeline.set_status(db, scan, "diagnosing")
    static: dict[str, list[Finding]] = {}
    for path in paths:
        static[path] = analyze(files[path])
        for f in static[path]:
            _record(db, scan, counts, seen, rules, branch=branch, path=path, line=f.line, rule_id=f.rule_id, sc=f.wcag_sc,
                    impact=f.impact, snippet=f.snippet, message=f.message, detector="static")
    pipeline.emit(db, scan.id, "diagnosing", f"static checks done on {len(paths)} file(s): {sum(counts.values())} issue(s)")

    if not s.anthropic_api_key:
        pipeline.emit(db, scan.id, "diagnosing", "Claude review skipped: set ANTHROPIC_API_KEY to add it")
        return
    review_files = {p: files[p] for p in paths[: s.source_llm_max_files]}
    pipeline.emit(db, scan.id, "diagnosing", f"Claude is reviewing {len(review_files)} file(s) against the saved W3C rules")
    try:
        issues = await source_llm.review(
            s, rule_lookup.prompt_context(db), review_files, static, source_llm.make_client(s),
            on_note=lambda m: pipeline.emit(db, scan.id, "diagnosing", m),
        )
    except Exception as e:  # the review is an extra: never fail the scan over it
        pipeline.emit(db, scan.id, "diagnosing", f"Claude review skipped ({type(e).__name__})")
        return
    for i in issues:
        lines = files[i.file].split("\n")
        _record(db, scan, counts, seen, rules, branch=branch, path=i.file, line=i.line, rule_id=i.rule_id, sc=i.wcag_sc,
                impact=i.impact, snippet=lines[i.line - 1].strip()[:300], message=i.problem, detector="claude")
