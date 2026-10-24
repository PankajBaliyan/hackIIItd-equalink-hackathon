import {
  ArrowDown,
  Check,
  Copy,
  CircleSlash,
  Pencil,
  X,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScanEvent } from "@/lib/types";

const META: Record<ScanEvent["type"], { Icon: LucideIcon; cls: string; label: string }> = {
  info: { Icon: ChevronRight, cls: "text-muted", label: "Info" },
  issue: { Icon: X, cls: "text-critical", label: "Issue" },
  fix: { Icon: Pencil, cls: "text-minor", label: "Fix proposed" },
  validated: { Icon: Check, cls: "text-success", label: "Validated" },
  rejected: { Icon: CircleSlash, cls: "text-moderate", label: "Rejected" },
};
const GLYPH = /^[▸✗✎✓⊘]\s*/;

/**
 * a11y: role=log, focusable and scrollable. Live announcements are throttled through a separate
 * polite status region (one summary every few seconds) so the stream doesn't flood screen readers.
 */
export function TerminalFeed({ events }: { events: ScanEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [copied, setCopied] = useState(false);
  const [announce, setAnnounce] = useState("");
  const latest = useRef<ScanEvent | undefined>(undefined);
  latest.current = events[events.length - 1];

  useEffect(() => {
    const el = ref.current;
    if (pinned && el) el.scrollTop = el.scrollHeight;
  }, [events.length, pinned]);

  useEffect(() => {
    const t = setInterval(() => {
      const e = latest.current;
      if (e) setAnnounce((prev) => (prev === e.message ? prev : e.message.replace(GLYPH, "")));
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  }, []);

  const copy = async () => {
    const text = events.map((e) => `${e.ts} [${e.stage}] ${e.message}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section aria-labelledby="feed-title" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="feed-title" className="text-lg">
          Agent log
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy log"}
        </Button>
      </div>
      <div className="relative">
        <div
          ref={ref}
          role="log"
          aria-live="off"
          aria-label="Scan event log"
          tabIndex={0}
          onScroll={onScroll}
          className="h-72 overflow-auto rounded-card border bg-bg p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {events.length === 0 && <p className="text-muted">Waiting for the agent…</p>}
          <ul className="space-y-1">
            {events.map((e, i) => {
              const { Icon, cls, label } = META[e.type];
              return (
                <li key={i} className="flex items-start gap-2">
                  <Icon aria-hidden className={cn("mt-1 size-3.5 shrink-0", cls)} />
                  <span className="sr-only">{label}: </span>
                  <span className="break-words">{e.message.replace(GLYPH, "")}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {!pinned && (
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-3 right-3 shadow-soft"
            onClick={() => {
              setPinned(true);
              const el = ref.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <ArrowDown /> Jump to latest
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
