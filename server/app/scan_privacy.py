"""Only diagnostic metadata may leave the in-memory page analysis scope."""


def public_issue(issue: dict) -> dict:
    return {
        key: issue[key]
        for key in ("id", "scan_id", "page_url", "rule_id", "wcag_sc", "impact")
        if key in issue
    } | {"selector": "", "html": "", "context": None}


def public_event(payload: dict) -> dict:
    # Copy an allowlist: never persist a newly added DOM/fix field by accident.
    out = {key: payload[key] for key in ("stage", "type", "ts", "counters") if key in payload}
    if payload.get("issue") is not None:
        out["issue"] = public_issue(payload["issue"])
        out["message"] = "Accessibility issue detected."
    else:
        out["message"] = payload.get("message", "")
    out["retention"] = "metadata-only"
    return out
