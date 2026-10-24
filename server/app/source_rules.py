"""Static accessibility checks on HTML/JSX/Vue/Svelte source, with file and line numbers.

Deterministic and conservative: a check only fires when the markup alone proves the problem (a spread such as
`{...props}` could supply any attribute, so those tags are skipped). Rule ids follow axe-core where one exists,
so results sit next to rendered-page scans and match the saved W3C rules by success criterion.
"""

import re
from dataclasses import dataclass

EXTENSIONS = (".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro")
SKIP_DIRS = {"node_modules", "dist", "build", ".next", ".nuxt", ".svelte-kit", "out", "coverage", "vendor", ".git", "__tests__", "__mocks__"}
SKIP_NAME = re.compile(r"\.(test|spec|stories|min)\.|\.d\.ts$")

NON_INTERACTIVE = {"div", "span", "li", "p", "td", "tr", "section", "article", "main", "header", "footer", "img", "svg", "ul", "label"}
UNLABELLED_TYPES = {"hidden", "submit", "button", "reset", "image"}
INTERACTIVE_ROLES = {"button", "link", "checkbox", "menuitem", "tab", "switch", "option", "radio", "combobox", "textbox"}
CHECKED = {"img", "input", "select", "textarea", "button", "a", "iframe", "frame", "video", "html", "meta", "label", "Label"} | NON_INTERACTIVE

TAG_START = re.compile(r"<([A-Za-z][\w.:-]*)")
ATTR = re.compile(r"""\s*(?:\{\s*\.\.\.[^}]*\}|([^\s=>/"'{}]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{(?:[^{}]|\{[^{}]*\})*\})|([^\s"'>]+)))?)""")
COMMENT = re.compile(r"<!--.*?-->|\{/\*.*?\*/\}", re.S)
IMG_WITH_ALT = re.compile(r"""<img\b[^>]*\balt\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>""", re.I)
TAGS = re.compile(r"<[^>]*>")


@dataclass
class Finding:
    rule_id: str
    wcag_sc: str
    impact: str
    line: int
    snippet: str
    message: str


@dataclass
class Tag:
    name: str
    attrs: dict[str, str | bool]
    spread: bool
    start: int
    end: int  # index just past '>'
    self_closing: bool


def is_source_file(path: str) -> bool:
    parts = path.split("/")
    return (
        path.lower().endswith(EXTENSIONS)
        and not any(p in SKIP_DIRS for p in parts[:-1])
        and not SKIP_NAME.search(parts[-1])
    )


def _norm(name: str) -> str:
    n = name.strip()
    for prefix in ("v-bind:", ":"):
        if n.startswith(prefix):
            n = n[len(prefix):]
    if n.startswith(("@", "v-on:", "on:")):
        n = "on" + re.sub(r"^(@|v-on:|on:)", "", n).split(".")[0]
    return {"htmlfor": "for", "classname": "class"}.get(n.lower(), n.lower())


def _parse_attrs(text: str) -> tuple[dict[str, str | bool], bool]:
    attrs: dict[str, str | bool] = {}
    spread = False
    pos = 0
    while pos < len(text):
        m = ATTR.match(text, pos)
        if not m or m.end() == pos:
            pos += 1
            continue
        pos = m.end()
        if m.group(1) is None:
            spread = True
            continue
        value = next((g for g in m.groups()[1:] if g is not None), True)
        if isinstance(value, str) and value.startswith("{") and value.endswith("}"):
            value = value[1:-1].strip()
            value = value[1:-1] if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'`" else "{" + value + "}"
        attrs[_norm(m.group(1))] = value
    return attrs, spread


def iter_tags(text: str):
    """Opening tags of the elements we check, honouring quotes and `{...}` expressions inside attributes."""
    n = len(text)
    i = 0
    while True:
        m = TAG_START.search(text, i)
        if not m:
            return
        i = m.end()
        if m.group(1) not in CHECKED:
            continue
        j, depth, quote = m.end(), 0, None
        while j < n:
            ch = text[j]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            elif ch == ">" and depth <= 0:
                break
            j += 1
        else:
            continue
        attrs, spread = _parse_attrs(text[m.end():j].rstrip("/"))
        yield Tag(m.group(1), attrs, spread, m.start(), j + 1, text[j - 1] == "/")


def _label_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in re.finditer(r"<(?:label|Label)\b.*?</(?:label|Label)>", text, re.S)]


def _label_targets(tags: list[Tag]) -> set[str]:
    return {str(t.attrs["for"]) for t in tags if t.name in ("label", "Label") and isinstance(t.attrs.get("for"), str)}


def _inner(text: str, tag: Tag, closer: str) -> str | None:
    if tag.self_closing:
        return None
    k = text.find(closer, tag.end)
    return text[tag.end:k] if k != -1 else None


def _has_text(inner: str) -> bool:
    inner = COMMENT.sub("", inner)
    if "{" in inner:  # an expression: assume it renders a label
        return True
    inner = IMG_WITH_ALT.sub(lambda m: m.group(1) or m.group(2), inner)
    if re.search(r"aria-label(?:ledby)?\s*=", inner):
        return True
    return bool(re.sub(r"&\w+;|\s+", "", TAGS.sub("", inner)))


def _named(t: Tag) -> bool:
    return any(t.attrs.get(a) not in (None, "") for a in ("aria-label", "aria-labelledby", "title"))


def _num(v: str | bool | None) -> int | None:
    m = re.fullmatch(r"\{?\s*(-?\d+)\s*\}?", v) if isinstance(v, str) else None
    return int(m.group(1)) if m else None


def analyze(text: str) -> list[Finding]:
    tags = list(iter_tags(text))
    spans = _label_spans(text)
    targets = _label_targets(tags)
    out: list[Finding] = []

    def add(t: Tag, rule: str, sc: str, impact: str, message: str) -> None:
        line = text.count("\n", 0, t.start) + 1
        out.append(Finding(rule, sc, impact, line, " ".join(text[t.start:t.end].split())[:300], message))

    for t in tags:
        a, name = t.attrs, t.name
        hidden = str(a.get("aria-hidden", "")).lower() == "true" or a.get("role") in ("presentation", "none")

        if name == "img" and "alt" not in a and not t.spread and not hidden:
            add(t, "image-alt", "1.1.1", "critical", "Image has no alt attribute. Describe it, or use alt=\"\" if it is decorative.")

        elif name in ("input", "select", "textarea") and not t.spread:
            kind = str(a.get("type", "text")).lower()
            wrapped = any(s <= t.start < e for s, e in spans)
            if (
                kind not in UNLABELLED_TYPES and not _named(t) and not wrapped and not hidden
                and not (isinstance(a.get("id"), str) and a["id"] in targets)
            ):
                add(t, "label", "3.3.2", "critical", f"<{name}> has no label. Add a <label for>, wrap it in a <label>, or set aria-label.")

        elif name == "button" and not t.spread and not _named(t) and not hidden:
            inner = _inner(text, t, "</button>")
            if inner is not None and not _has_text(inner):
                add(t, "button-name", "4.1.2", "critical", "Button has no text or accessible name. Add visible text or aria-label.")

        elif name == "a" and "href" in a and not t.spread and not _named(t) and not hidden:
            inner = _inner(text, t, "</a>")
            if inner is not None and not _has_text(inner):
                add(t, "link-name", "2.4.4", "serious", "Link has no text or accessible name. Add visible text or aria-label.")

        elif name in NON_INTERACTIVE and "onclick" in a:
            keyboard = any(k in a for k in ("onkeydown", "onkeyup", "onkeypress"))
            focusable = "tabindex" in a
            if a.get("role") not in INTERACTIVE_ROLES or not (keyboard and focusable):
                add(t, "click-events-have-key-events", "2.1.1", "serious",
                    f"<{name}> has a click handler but is not keyboard accessible. Use a <button>, or add a role, tabindex and key handler.")

        elif name == "html" and "lang" not in a and not t.spread:
            add(t, "html-has-lang", "3.1.1", "serious", "<html> has no lang attribute, so screen readers can't pick the right voice.")

        elif name in ("iframe", "frame") and not _named(t) and not t.spread and not hidden:
            add(t, "frame-title", "4.1.2", "serious", "Frame has no title. Add a title that describes its content.")

        elif name == "video":
            inner = _inner(text, t, "</video>")
            if inner is not None and "<track" not in inner and "muted" not in a:
                add(t, "video-caption", "1.2.2", "critical", "Video has no <track> captions for its audio.")

        elif name == "meta" and str(a.get("name", "")).lower() == "viewport":
            content = str(a.get("content", "")).replace(" ", "")
            if re.search(r"user-scalable=(no|0)|maximum-scale=1(\.0)?(?![\d.])", content):
                add(t, "meta-viewport", "1.4.4", "critical", "The viewport blocks pinch-zoom. Remove user-scalable=no and maximum-scale=1.")

        if (n := _num(a.get("tabindex"))) is not None and n > 0:
            add(t, "tabindex", "2.4.3", "serious", f"tabindex={n} overrides the natural tab order. Use 0 or -1 and fix the DOM order.")

    return out
