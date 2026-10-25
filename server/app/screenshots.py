"""Screenshots of scanned pages, with the on-page position of each finding.

Taken from the same rendered page axe just ran on, so the boxes line up with what the image shows. Positions are
stored as percentages of the image, which keeps them correct at any display size.
"""

from playwright.async_api import Page
from sqlmodel import Session, select

from app.models import IssueRow, ShotRow

JPEG_QUALITY = 60
WHOLE_DOCUMENT = {"html", "body"}
MAX_BOX_SHARE = 0.5  # a box covering more than this share of the page says nothing about where the problem is

# Runs in the page: [width, height] of the full document, then for each selector its box in page pixels or null.
MEASURE_JS = """selectors => {
  const d = document.documentElement;
  const width = Math.max(d.clientWidth, window.innerWidth);
  const height = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const boxes = selectors.map(sel => {
    let el;
    try { el = document.querySelector(sel); } catch (e) { return null; }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return [r.left + window.scrollX, r.top + window.scrollY, r.width, r.height];
  });
  return {width, height, boxes};
}"""


def to_percent(box: list[float], width: int, height: int) -> str | None:
    """"x,y,w,h" in percent of the image, clipped to it, or None when the element is off-image or too large to help."""
    x, y, w, h = box
    if y >= height or x >= width:
        return None
    w, h = min(w, width - x), min(h, height - y)
    if w <= 0 or h <= 0 or (w * h) / (width * height) > MAX_BOX_SHARE:
        return None
    return ",".join(f"{v:.2f}" for v in (x / width * 100, y / height * 100, w / width * 100, h / height * 100))


async def capture(db: Session, scan_id: str, page: Page, url: str, max_height: int) -> ShotRow:
    """Screenshot the page as rendered now and store it, with a box on every issue of this page that can be located."""
    issues = list(db.exec(select(IssueRow).where(IssueRow.scan_id == scan_id, IssueRow.page_url == url)).all())
    wanted = [i for i in issues if i.selector.strip().lower() not in WHOLE_DOCUMENT]
    m = await page.evaluate(MEASURE_JS, [i.selector for i in wanted])
    width, height = int(m["width"]), min(int(m["height"]), max_height)
    data = await page.screenshot(
        type="jpeg", quality=JPEG_QUALITY, full_page=True, clip={"x": 0, "y": 0, "width": width, "height": height}
    )
    for issue, box in zip(wanted, m["boxes"]):
        if box:
            issue.box = to_percent(box, width, height)
            db.add(issue)
    shot = ShotRow(scan_id=scan_id, page_url=url, width=width, height=height, data=data)
    db.add(shot)
    db.commit()
    db.refresh(shot)
    return shot
