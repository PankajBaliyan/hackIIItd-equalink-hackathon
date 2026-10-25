"""Saved W3C rule documents as reference for scan results.

The rules (Docs > Reference documents) are matched to issues by WCAG success criterion, the same identity
the sync uses to avoid duplicates, so an axe violation tagged 1.4.3 carries the saved 1.4.3 rule.
"""

import re

from sqlmodel import Session, select

from app.models import RuleDoc
from app.rule_sync import keys_for

EXCERPT_MAX = 300


def load_index(db: Session) -> tuple[dict[str, RuleDoc], int]:
    """(success criterion -> rule doc, number of saved docs). The oldest doc wins when several cover a criterion."""
    index: dict[str, RuleDoc] = {}
    docs = db.exec(select(RuleDoc).order_by(RuleDoc.id)).all()  # type: ignore[arg-type]
    for d in docs:
        for key in keys_for(d.title, d.content):
            if key.startswith("sc:"):
                index.setdefault(key[3:], d)
    return index, len(docs)


def excerpt(content: str) -> str:
    """The requirement sentence(s): text after 'Requirement:' up to the 'WCAG reference:' marker."""
    text = re.sub(r"^\s*Requirement:\s*", "", content)
    text = re.split(r"\s+WCAG reference:", text, maxsplit=1)[0].strip()
    return text if len(text) <= EXCERPT_MAX else text[: EXCERPT_MAX - 1].rstrip() + "…"


def rule_ref(doc: RuleDoc | None) -> dict | None:
    if doc is None:
        return None
    return {"id": doc.id, "title": doc.title, "source_url": doc.source_url, "excerpt": excerpt(doc.content)}


def prompt_context(db: Session, limit: int = 80) -> str:
    """The saved rules as compact reference lines for an LLM prompt: 'SC 1.4.3: Title: requirement'."""
    lines = []
    for d in db.exec(select(RuleDoc).order_by(RuleDoc.id)).all()[:limit]:  # type: ignore[arg-type]
        sc = next((k[3:] for k in sorted(keys_for(d.title, d.content)) if k.startswith("sc:")), None)
        lines.append(f"- {f'SC {sc}: ' if sc else ''}{d.title}: {excerpt(d.content)[:260]}")
    return "\n".join(lines)
