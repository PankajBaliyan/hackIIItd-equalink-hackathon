"""Settings that can be changed in the dashboard.

They are stored in the database and override the environment defaults (server/.env) for every scan that starts
afterwards. Secrets and anything that changes how the server is deployed (API keys, ports, private-address
blocking) stay environment-only and are only reported, never editable.
"""

import json
import re
from collections.abc import Callable

from sqlmodel import Session, select

from app.config import Settings
from app.db import engine
from app.models import AppSetting

SEVERITIES = ("minor", "moderate", "serious", "critical")  # least to most severe
RULE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")


def _choice(*options: str) -> Callable[[object], str]:
    def check(v: object) -> str:
        if v not in options:
            raise ValueError(f"must be one of {', '.join(options)}")
        return str(v)

    return check


def _int(lo: int, hi: int) -> Callable[[object], int]:
    def check(v: object) -> int:
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise ValueError(f"must be a whole number from {lo} to {hi}")
        return v

    return check


def _bool(v: object) -> bool:
    if not isinstance(v, bool):
        raise ValueError("must be true or false")
    return v


def _model(v: object) -> str:
    if not isinstance(v, str) or not re.fullmatch(r"[\w.:/-]{1,80}", v.strip()):
        raise ValueError("must be a model name such as gpt-4.1")
    return v.strip()


def _rules(v: object) -> str:
    """A list of rule ids (or a comma separated string) -> the stored comma separated string."""
    items = v.split(",") if isinstance(v, str) else v
    if not isinstance(items, list) or not all(isinstance(i, str) for i in items):
        raise ValueError("must be a list of rule ids")
    rules = sorted({i.strip().lower() for i in items if i.strip()})
    bad = [r for r in rules if not RULE_RE.match(r)]
    if bad:
        raise ValueError(f"not a rule id: {', '.join(bad[:3])} (use names like image-alt)")
    if len(rules) > 200:
        raise ValueError("at most 200 rules")
    return ",".join(rules)


EDITABLE: dict[str, Callable[[object], object]] = {
    "default_level": _choice("A", "AA", "AAA"),
    "default_scope": _choice("page", "site"),
    "max_site_pages": _int(1, 100),
    "fix_max": _int(0, 100),
    "openai_model": _model,
    "min_severity": _choice(*SEVERITIES),
    "disabled_rules": _rules,
    "ai_review": _bool,
    "ai_fixes": _bool,
}


def overrides(db: Session) -> dict[str, object]:
    """The saved values, skipping any that no longer validate."""
    out: dict[str, object] = {}
    for row in db.exec(select(AppSetting)).all():
        check = EDITABLE.get(row.key)
        if not check:
            continue
        try:
            out[row.key] = check(json.loads(row.value))
        except (ValueError, json.JSONDecodeError):
            continue
    return out


def effective(base: Settings, db: Session | None = None) -> Settings:
    """The environment settings with the dashboard's changes applied."""
    if db is None:
        with Session(engine()) as own:
            return base.model_copy(update=overrides(own))
    return base.model_copy(update=overrides(db))


def disabled_set(s: Settings) -> set[str]:
    return {r for r in s.disabled_rules.split(",") if r}


def keep(s: Settings, rule_id: str, impact: str) -> bool:
    """Whether an issue is recorded under the minimum severity and disabled rules."""
    if rule_id in disabled_set(s):
        return False
    return SEVERITIES.index(impact if impact in SEVERITIES else "minor") >= SEVERITIES.index(s.min_severity)


def values(s: Settings) -> dict[str, object]:
    out: dict[str, object] = {k: getattr(s, k) for k in EDITABLE}
    out["disabled_rules"] = sorted(disabled_set(s))
    return out


def server_info(base: Settings, eff: Settings) -> dict:
    """What the server was started with. Never contains a secret, only whether one is set."""
    return {
        "openai": {"configured": bool(base.openai_api_key), "model": eff.openai_model},
        "tinyfish": {"configured": bool(base.tinyfish_api_key)},
        "github": {"mode": base.github_mode},
        "scan_engine": base.scan_engine,
        "allow_private_targets": base.allow_private_targets,
        "screenshot_max_height": base.screenshot_max_height,
        "fix_batch": base.fix_batch,
        "source_max_files": base.source_max_files,
        "source_llm_max_files": base.source_llm_max_files,
        "w3c_sync": {"schedule": base.w3c_sync_schedule, "interval_days": base.w3c_sync_interval_days},
    }


def describe(base: Settings, db: Session) -> dict:
    saved = overrides(db)
    return {
        "values": values(effective(base, db)),
        "defaults": values(base),
        "changed": sorted(saved),
        "server": server_info(base, effective(base, db)),
    }
