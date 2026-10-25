"""OpenAI review of a rendered page for accessibility problems axe-core cannot see.

Optional, like the repo review: it runs only when OPENAI_API_KEY is set and a failure never fails the scan.
The model gets the page's markup (scripts and styles removed) and the problems axe already found. Each issue it
reports must name a CSS selector that matches an element on the live page, which is checked in the browser
before the issue is stored.
"""

import re
from dataclasses import dataclass

from playwright.async_api import Page

from app import source_llm
from app.config import Settings

HTML_CHARS = 60_000
SC_RE = source_llm.SC_RE
IMPACTS = source_llm.IMPACTS

SYSTEM = """You review a rendered web page's HTML for accessibility problems against WCAG 2.2.

How to report:
- Report only problems you can see in the markup shown. Give a CSS selector that matches the element (prefer an id or a short, specific path).
- Do not repeat anything in the "Already reported by axe-core" list, and skip what axe-core covers well: missing alt, unlabeled form fields, empty buttons or links, color contrast of computed styles, duplicate ids, missing lang.
- Look for what automated rules cannot judge: alt text that is present but meaningless (file names, "image"), link or button text that is vague ("click here", "read more") or does not say where it goes, heading order and headings that do not describe their section, missing landmarks or a missing skip link, inputs whose visible text and accessible name disagree, ARIA misuse (invalid roles, aria-hidden on focusable content), errors or status messages not exposed as text or live regions, tiny touch targets, meaning conveyed by color alone, autoplaying media.
- Be precise. If you are not sure it is a real problem, leave it out. An empty list is a good answer.
- rule_id is a short kebab-case name for the problem. wcag_sc is the success criterion number, for example 2.4.4. problem is one sentence saying what is wrong and how to fix it.
- Put the selector in the "file" field and 1 in "line"; both are required by the output format.

When a saved W3C rule below covers the criterion, use its wording and requirement.

Saved W3C rules (reference):
"""

# Runs in the page: markup without code, styles, inline images and comments, so the budget goes to structure.
CLEAN_HTML_JS = """() => {
  const root = document.documentElement.cloneNode(true);
  root.querySelectorAll('script,style,noscript,link,meta,template').forEach(n => n.remove());
  root.querySelectorAll('svg').forEach(n => { n.innerHTML = ''; });
  root.querySelectorAll('[src^="data:"]').forEach(n => n.setAttribute('src', 'data:'));
  root.querySelectorAll('[style]').forEach(n => { const v = n.getAttribute('style'); if (v.length > 120) n.setAttribute('style', v.slice(0, 120)); });
  return root.outerHTML;
}"""

# Runs in the page: the first match's markup, or null when the selector is invalid or matches nothing.
LOOKUP_JS = """sel => { try { const el = document.querySelector(sel); return el ? el.outerHTML : null; } catch (e) { return null; } }"""


@dataclass
class PageIssue:
    selector: str
    rule_id: str
    wcag_sc: str
    impact: str
    problem: str
    html: str


async def page_markup(page: Page) -> str:
    html = re.sub(r"\s+", " ", await page.evaluate(CLEAN_HTML_JS))
    return html if len(html) <= HTML_CHARS else html[:HTML_CHARS]


def prompt(url: str, html: str, axe_found: list[tuple[str, str]]) -> str:
    known = "\n".join(f"- {rule}: {sel}" for rule, sel in axe_found[:60]) or "(none)"
    return f"Page: {url}\n\nAlready reported by axe-core:\n{known}\n\nHTML:\n{html}"


async def review(
    s: Settings, rules_text: str, page: Page, url: str, axe_found: list[tuple[str, str]], client=None, on_note=None
) -> list[PageIssue]:
    """Issues the model finds on this page whose selector matches a real element. Failures return what was found so far."""
    client = client or source_llm.make_client(s)
    note = on_note or (lambda _m: None)
    html = await page_markup(page)
    raw = await source_llm.ask_json(s, client, SYSTEM + (rules_text or "(none saved)"), prompt(url, html, axe_found), url, note)
    items = raw.get("issues") if isinstance(raw, dict) else None
    if not isinstance(items, list):
        return []
    known = {(sel, rule) for rule, sel in axe_found}
    out: list[PageIssue] = []
    dropped = 0
    seen: set[tuple[str, str]] = set()
    for i in items:
        try:
            selector, rule_id = str(i["file"]).strip(), str(i["rule_id"]).strip()
            sc, impact, problem = str(i["wcag_sc"]).strip(), str(i["impact"]), str(i["problem"]).strip()
        except (KeyError, TypeError):
            dropped += 1
            continue
        if not (selector and rule_id and problem and SC_RE.match(sc) and impact in IMPACTS) or (selector, sc) in seen:
            dropped += 1
            continue
        seen.add((selector, sc))
        if any(sel == selector for sel, _ in known):  # axe already flagged this element
            continue
        found_html = await page.evaluate(LOOKUP_JS, selector)
        if found_html is None:
            dropped += 1
            continue
        out.append(PageIssue(selector, rule_id, sc, impact, problem, found_html[:2000]))
    if dropped:
        note(f"dropped {dropped} OpenAI finding(s) that were malformed or matched no element")
    return out
