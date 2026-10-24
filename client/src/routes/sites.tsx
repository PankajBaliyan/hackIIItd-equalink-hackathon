import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { useMemo } from "react";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { getApi } from "@/lib/api";
import type { Scan } from "@/lib/types";

export const Route = createFileRoute("/sites")({
  head: () => ({
    meta: [
      { title: "Sites · EquaLink" },
      {
        name: "description",
        content: "Every site you've scanned with EquaLink, with score trends.",
      },
      { property: "og:title", content: "Sites · EquaLink" },
      {
        property: "og:description",
        content: "Every site you've scanned with EquaLink, with score trends.",
      },
    ],
  }),
  component: Page,
});

interface Site {
  host: string;
  scans: Scan[]; // newest first
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const finalScore = (s: Scan) => s.score_after ?? s.score_before;

/** Decorative trend line (oldest → newest); the numbers beside it carry the meaning. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const pts = values
    .map(
      (v, i) => `${(i / (values.length - 1)) * w},${h - (Math.max(0, Math.min(100, v)) / 100) * h}`,
    )
    .join(" ");
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className="h-7 w-24 text-brand">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Page() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => (await getApi()).listScans(),
  });

  const sites = useMemo<Site[]>(() => {
    const m = new Map<string, Scan[]>();
    for (const s of data ?? []) m.set(hostOf(s.url), [...(m.get(hostOf(s.url)) ?? []), s]);
    return [...m.entries()]
      .map(([host, scans]) => ({
        host,
        scans: scans.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }))
      .sort((a, b) => b.scans[0]!.created_at.localeCompare(a.scans[0]!.created_at));
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <FocusHeading className="text-3xl font-semibold outline-none">Sites</FocusHeading>
          <p className="text-muted">Every site you've scanned, grouped by domain.</p>
        </div>
        <Button variant="primary" asChild>
          <Link to="/">New scan</Link>
        </Button>
      </div>

      {isPending ? (
        <div role="status" aria-label="Loading sites" className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load sites"
          description="Check that the API is reachable."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : sites.length === 0 ? (
        <EmptyState
          icon={<Globe className="size-6" />}
          title="No sites yet"
          description="Scan a URL and its site will show up here."
          action={
            <Button variant="primary" asChild>
              <Link to="/">Start a scan</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sites.map((site, i) => {
            const latest = site.scans[0]!;
            const trend = site.scans
              .map(finalScore)
              .filter((v): v is number => v != null)
              .reverse();
            const first = trend[0];
            const last = trend[trend.length - 1];
            const delta =
              first != null && last != null && trend.length > 1 ? last - first : undefined;
            return (
              <Reveal key={site.host} index={i}>
                <article className="space-y-3 rounded-card border bg-surface p-5 shadow-soft">
                  <header className="flex items-start justify-between gap-3">
                    <h2 className="break-all text-lg font-semibold">{site.host}</h2>
                    <p className="tabular text-3xl font-semibold">
                      {last ?? "–"}
                      <span className="sr-only"> latest score out of 100</span>
                    </p>
                  </header>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted">
                    <span className="tabular">
                      {site.scans.length} {site.scans.length === 1 ? "scan" : "scans"}
                      {delta != null && (
                        <span className={delta >= 0 ? "text-success" : "text-critical"}>
                          {" · "}
                          {delta >= 0 ? "▲ +" : "▼ "}
                          {delta} overall
                        </span>
                      )}
                    </span>
                    <Sparkline values={trend} />
                  </div>
                  <p className="text-sm text-muted">
                    Last scanned{" "}
                    <time dateTime={latest.created_at}>
                      {new Date(latest.created_at).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </time>
                    {" · "}
                    WCAG {latest.level}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" asChild>
                      <Link
                        to={latest.status === "done" ? "/scans/$id/fixes" : "/scans/$id"}
                        params={{ id: latest.id }}
                      >
                        {latest.status === "done" ? "Latest fixes" : "View scan"}
                        <span className="sr-only"> for {site.host}</span>
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/history">All scans</Link>
                    </Button>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </ul>
      )}
    </div>
  );
}
