import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnnotatedScreenshot } from "@/components/scan/AnnotatedScreenshot";
import type { Issue, Shot } from "@/lib/types";

const issue = (id: string, page: string, box?: Issue["box"]): Issue =>
  ({
    id,
    scan_id: "s1",
    page_url: page,
    rule_id: "image-alt",
    wcag_sc: "1.1.1",
    impact: "critical",
    selector: "img",
    html: "<img>",
    box,
  }) as Issue;

const shots: Shot[] = [
  { id: 1, page_url: "https://x.dev/", width: 1280, height: 900 },
  { id: 2, page_url: "https://x.dev/about", width: 1280, height: 700 },
];

describe("AnnotatedScreenshot", () => {
  it("explains the empty states instead of showing a fake image", () => {
    const { rerender } = render(<AnnotatedScreenshot scanId="s1" shots={[]} issues={[]} />);
    expect(screen.getByText(/appears once the first page has been scanned/)).toBeInTheDocument();
    rerender(<AnnotatedScreenshot scanId="s1" shots={[]} issues={[]} finished />);
    expect(screen.getByText("No screenshot was captured for this scan.")).toBeInTheDocument();
    rerender(<AnnotatedScreenshot scanId="s1" shots={[]} issues={[]} source />);
    expect(screen.getByText(/no page to show/)).toBeInTheDocument();
  });

  it("shows the stored image with a box only for issues on that page that have a position", () => {
    const issues = [
      issue("a", "https://x.dev/", { x: 10, y: 20, w: 30, h: 5 }),
      issue("b", "https://x.dev/", null), // not locatable
      issue("c", "https://x.dev/about", { x: 1, y: 1, w: 1, h: 1 }), // another page
    ];
    const { container } = render(<AnnotatedScreenshot scanId="s1" shots={shots} issues={issues} />);
    const img = screen.getByRole("img", { name: /with 1 highlighted problem/ });
    expect(img.getAttribute("src")).toMatch(/\/scans\/s1\/shots\/1$/);
    const boxes = container.querySelectorAll("span[aria-hidden]");
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLElement).style.left).toBe("10%");
    expect((boxes[0] as HTMLElement).style.width).toBe("30%");
  });

  it("switches page with the picker", () => {
    render(<AnnotatedScreenshot scanId="s1" shots={shots} issues={[]} />);
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "2" } });
    expect(screen.getByRole("img").getAttribute("src")).toMatch(/\/shots\/2$/);
    expect(screen.getByRole("region", { name: /Screenshot of \/about/ })).toBeInTheDocument();
  });

  it("keeps wheel scrolling inside the screenshot instead of dragging the whole page along", () => {
    render(<AnnotatedScreenshot scanId="s1" shots={shots.slice(0, 1)} issues={[]} />);
    // Without overscroll containment, scrolling past either end of the box scrolls the page (even to its top).
    expect(screen.getByRole("region", { name: /Screenshot of/ })).toHaveClass(
      "overflow-auto",
      "overscroll-contain",
    );
  });

  it("has no page picker for a single page", () => {
    render(<AnnotatedScreenshot scanId="s1" shots={shots.slice(0, 1)} issues={[]} />);
    expect(screen.queryByLabelText("Page")).not.toBeInTheDocument();
  });
});
