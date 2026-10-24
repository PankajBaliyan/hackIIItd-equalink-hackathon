import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AnnotatedScreenshot } from "@/components/scan/AnnotatedScreenshot";
import { ScoreRing } from "@/components/scan/ScoreRing";
import { TerminalFeed } from "@/components/scan/TerminalFeed";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { SEVERITY_ORDER } from "@/lib/score";
import type { Stage } from "@/lib/types";
import { countBySeverity } from "@/lib/wcag";
import { useScanStore } from "@/state/scanStore";

const STAGES: { id: Stage; label: string }[] = [
  { id: "queued", label: "Queued" },
  { id: "crawling", label: "Crawling" },
  { id: "diagnosing", label: "Diagnosing" },
  { id: "fixing", label: "Fixing" },
  { id: "verifying", label: "Verifying" },
  { id: "shipping", label: "Shipping" },
  { id: "done", label: "Done" },
];

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useElapsed(start: string | undefined, running: boolean, endTs: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!start) return undefined;
  const end = running ? now : endTs ? new Date(endTs).getTime() : undefined;
  return end ? fmt(end - new Date(start).getTime()) : undefined;
}

export function LiveScan({ id }: { id: string }) {
  const s = useScanStore();
  useEffect(() => s.openScan(id), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = s.scan?.id === id ? s.scan : null;
  const failed = scan?.status === "failed";
  const done = scan?.status === "done";
  const running = !!scan && !done && !failed;
  const counters = useMemo(() => countBySeverity(s.issues), [s.issues]);
  const elapsed = useElapsed(scan?.created_at, running, s.events[s.events.length - 1]?.ts);

  const pages = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of s.issues) m.set(i.page_url, (m.get(i.page_url) ?? 0) + 1);
    return [...m.entries()];
  }, [s.issues]);

  if (s.error && !scan) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Couldn't load this scan"
          description={s.error}
          action={
            <Button variant="secondary" asChild>
              <Link to="/">Start a new scan</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!scan) {
    return (
      <div role="status" aria-label="Loading scan" className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-72 w-full rounded-card" />
      </div>
    );
  }

  const current = failed
    ? Math.max(
        0,
        STAGES.findIndex((x) => x.id === s.events.at(-2)?.stage),
      )
    : STAGES.findIndex((x) => x.id === scan.status);
  const pageProgress = done
    ? 100
    : Math.min(95, (Math.max(current, 0) / (STAGES.length - 1)) * 100);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <FocusHeading className="break-all text-2xl font-semibold outline-none sm:text-3xl">
          {scan.url}
        </FocusHeading>
        <div className="flex flex-wrap items-center gap-2">
          <Chip>WCAG {scan.level}</Chip>
          <Chip>{scan.scope === "site" ? "Full site" : "Single page"}</Chip>
          <Chip>{scan.mode === "repo" ? "Repo connected" : "URL only"}</Chip>
          {elapsed && (
            <Chip>
              Elapsed <span className="tabular">{elapsed}</span>
            </Chip>
          )}
        </div>
        <Stepper steps={STAGES} current={done ? STAGES.length : current} failed={failed} />
      </header>

      {s.connection === "reconnecting" || s.connection === "polling" ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-card border border-moderate bg-surface p-3 text-sm"
        >
          {s.connection === "polling" ? (
            <RefreshCw aria-hidden className="size-4" />
          ) : (
            <WifiOff aria-hidden className="size-4" />
          )}
          {s.connection === "polling"
            ? "Live connection lost. Checking for updates every few seconds."
            : "Live connection lost. Reconnecting…"}
        </div>
      ) : null}

      {failed && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-card border border-critical bg-surface p-4"
        >
          <AlertTriangle aria-hidden className="size-5 text-critical" />
          <p>
            <strong>Scan failed.</strong>{" "}
            <span className="text-muted">Check the log below, then start a new scan.</span>
          </p>
        </div>
      )}

      {done && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success bg-surface p-4">
          <p className="font-medium">
            Scan complete. {s.issues.length} issues found and fixes are ready to review.
          </p>
          <Button variant="primary" asChild>
            <Link to="/scans/$id/fixes" params={{ id }}>
              Review fixes <ArrowRight />
            </Link>
          </Button>
        </div>
      )}

      <section aria-labelledby="live-stats" className="grid gap-4 md:grid-cols-[auto_1fr]">
        <h2 id="live-stats" className="sr-only">
          Live results
        </h2>
        <div className="grid place-items-center rounded-card border bg-surface p-4">
          <ScoreRing score={scan.score_before} label="Score before" />
        </div>
        <div className="space-y-4 rounded-card border bg-surface p-4">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SEVERITY_ORDER.map((sev) => (
              <li key={sev} className="space-y-1">
                <SeverityBadge severity={sev} />
                <p className="text-3xl font-semibold">
                  <AnimatedCounter value={counters[sev]} />
                </p>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <p className="flex justify-between text-sm text-muted">
              <span>Pipeline progress</span>
              <span className="tabular">
                {pages.length} {pages.length === 1 ? "page" : "pages"} with issues
              </span>
            </p>
            <Progress aria-label="Pipeline progress" value={pageProgress} />
          </div>
        </div>
      </section>

      <TerminalFeed events={s.events} />

      <section aria-labelledby="pages-title" className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h2 id="pages-title" className="text-lg">
            Pages
          </h2>
          {pages.length === 0 ? (
            <p className="text-sm text-muted">No pages with findings yet.</p>
          ) : (
            <ul className="divide-y rounded-card border bg-surface">
              {pages.map(([url, n]) => (
                <li key={url} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate font-mono text-sm">{url}</span>
                  <span className="tabular text-sm text-muted">
                    {n} {n === 1 ? "issue" : "issues"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-lg">Screenshot</h2>
          <AnnotatedScreenshot />
        </div>
      </section>
    </div>
  );
}
