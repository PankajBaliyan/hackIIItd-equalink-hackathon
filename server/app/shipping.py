"""Turn a repo scan's validated fixes into edited files, ready to commit to a branch.

Pure text work, no network or database: the route fetches the files and stores the result. Each fix replaces a range
of lines (found when the repository was scanned), so before applying one we check the file still holds those lines.
"""

from collections import Counter
from dataclasses import dataclass, field

from app.models import FixRow, IssueRow
from app.source_rules import analyze


@dataclass
class FileEdit:
    path: str
    text: str  # the patched file
    applied: list[FixRow] = field(default_factory=list)


@dataclass
class Plan:
    edits: list[FileEdit] = field(default_factory=list)
    skipped: list[tuple[FixRow, str]] = field(default_factory=list)  # (fix, why it was left out)


def _norm(s: str) -> str:
    return "\n".join(line.rstrip("\r") for line in s.split("\n")).strip()


def apply_fixes(path: str, text: str, fixes: list[FixRow]) -> tuple[FileEdit, list[tuple[FixRow, str]]]:
    """Apply the fixes of one file from the bottom up so earlier line numbers stay valid."""
    crlf = "\r\n" in text
    lines = text.split("\n")
    skipped: list[tuple[FixRow, str]] = []
    applied: list[FixRow] = []
    taken: list[tuple[int, int]] = []
    for f in sorted(fixes, key=lambda f: (f.start_line or 0, f.end_line or 0), reverse=True):
        start, end = f.start_line or 0, f.end_line or 0
        if not (1 <= start <= end <= len(lines)):
            skipped.append((f, "its lines are no longer in the file"))
        elif any(start <= b and a <= end for a, b in taken):
            skipped.append((f, "it overlaps another fix in the same lines"))
        elif _norm("\n".join(lines[start - 1 : end])) != _norm(f.original):
            skipped.append((f, "the file changed since the scan (rescan to refresh the fixes)"))
        else:
            repl = f.patched.split("\n")
            if crlf:
                repl = [r + "\r" for r in repl]
            lines[start - 1 : end] = repl
            taken.append((start, end))
            applied.append(f)
    return FileEdit(path, "\n".join(lines), applied), skipped


def plan(files: dict[str, str], fixes: list[FixRow], issues: dict[str, IssueRow]) -> Plan:
    """Group fixes by file, apply them, and drop a file's edits if together they add a violation the file didn't have."""
    by_file: dict[str, list[FixRow]] = {}
    out = Plan()
    for f in fixes:
        issue = issues.get(f.issue_id)
        if not issue or not issue.source_file or f.start_line is None or f.end_line is None:
            out.skipped.append((f, "it has no source file and line to change"))
        else:
            by_file.setdefault(issue.source_file, []).append(f)
    for path, group in sorted(by_file.items()):
        if path not in files:
            out.skipped += [(f, "the file is missing from the repository") for f in group]
            continue
        edit, skipped = apply_fixes(path, files[path], group)
        out.skipped += skipped
        if not edit.applied:
            continue
        before, after = Counter(x.rule_id for x in analyze(files[path])), Counter(x.rule_id for x in analyze(edit.text))
        worse = sorted(r for r, n in after.items() if n > before.get(r, 0))
        if worse:
            out.skipped += [(f, f"together the fixes in this file add new violations ({', '.join(worse)})") for f in edit.applied]
            continue
        out.edits.append(edit)
    return out
