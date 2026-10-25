import { ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import type { Issue, Severity, Shot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ruleTitle } from "@/lib/wcag";

const BOX: Record<Severity, string> = {
  critical: "border-critical bg-critical/15",
  serious: "border-serious bg-serious/15",
  moderate: "border-moderate bg-moderate/15",
  minor: "border-minor bg-minor/15",
};

function Placeholder({ children }: { children: string }) {
  return (
    <div className="grid h-48 place-items-center rounded-card border border-dashed bg-surface p-4 text-center text-sm text-muted">
      <p className="flex items-center gap-2">
        <ImageIcon aria-hidden className="size-4 shrink-0" /> {children}
      </p>
    </div>
  );
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
};

/**
 * The scanned page as the browser rendered it, with a box over each element that has a finding.
 * The boxes are decorative (the findings are listed elsewhere); the image has a text alternative.
 */
export function AnnotatedScreenshot({
  scanId,
  shots,
  issues,
  source = false,
  finished = false,
}: {
  scanId: string;
  shots: Shot[];
  issues: Issue[];
  /** A source-code scan: there is no rendered page to show. */
  source?: boolean;
  finished?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const shot = shots.find((s) => s.id === picked) ?? shots[0];
  const boxes = useMemo(
    () => (shot ? issues.filter((i) => i.box && i.page_url === shot.page_url) : []),
    [issues, shot],
  );

  if (source)
    return <Placeholder>Source scans read code, so there is no page to show.</Placeholder>;
  if (!shot) {
    return (
      <Placeholder>
        {finished
          ? "No screenshot was captured for this scan."
          : "The screenshot appears once the first page has been scanned."}
      </Placeholder>
    );
  }

  return (
    <div className="space-y-2">
      {shots.length > 1 && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Page
          <select
            value={shot.id}
            onChange={(e) => setPicked(Number(e.target.value))}
            className="min-h-11 rounded-md border bg-surface px-2 text-sm font-normal text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
          >
            {shots.map((s) => (
              <option key={s.id} value={s.id}>
                {pathOf(s.page_url)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        tabIndex={0}
        role="region"
        aria-label={`Screenshot of ${pathOf(shot.page_url)}, scrollable`}
        className="max-h-[32rem] overflow-auto overscroll-contain rounded-card border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <figure className="relative m-0">
          <img
            src={`${API_BASE_URL}/scans/${scanId}/shots/${shot.id}`}
            alt={`Screenshot of ${shot.page_url} with ${boxes.length} highlighted ${boxes.length === 1 ? "problem" : "problems"}`}
            width={shot.width}
            height={shot.height}
            className="block h-auto w-full"
          />
          {boxes.map((i) => (
            <span
              key={i.id}
              aria-hidden
              title={`${ruleTitle(i.rule_id)} (WCAG ${i.wcag_sc})`}
              className={cn("absolute rounded-sm border-2", BOX[i.impact])}
              style={{
                left: `${i.box!.x}%`,
                top: `${i.box!.y}%`,
                width: `${i.box!.w}%`,
                height: `${i.box!.h}%`,
              }}
            />
          ))}
        </figure>
      </div>
    </div>
  );
}
