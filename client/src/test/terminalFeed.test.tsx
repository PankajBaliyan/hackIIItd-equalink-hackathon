import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TerminalFeed } from "@/components/scan/TerminalFeed";
import type { ScanEvent } from "@/lib/types";

const events: ScanEvent[] = [
  { stage: "queued", message: "scan queued", type: "info", ts: "2026-10-25T10:00:00Z" },
  {
    stage: "crawling",
    message: "rendering https://x.dev",
    type: "info",
    ts: "2026-10-25T10:00:01Z",
  },
];

describe("TerminalFeed layout", () => {
  it("contains its screen-reader-only labels and its scrolling", () => {
    render(<TerminalFeed events={events} />);
    const log = screen.getByRole("log");
    // The labels are position:absolute. If the log is not positioned they escape it and stretch the whole page
    // (24px of blank scroll area per log line), so the log must be the containing block.
    expect(log).toHaveClass("relative", "overflow-auto", "overscroll-contain");
  });
});
