import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { getApi } from "@/lib/api";
import type { Scan } from "@/lib/types";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hrs = Math.round(mins / 60);
  return Math.abs(hrs) < 48 ? rtf.format(hrs, "hour") : rtf.format(Math.round(hrs / 24), "day");
}

const STATUS_LABEL: Record<Scan["status"], string> = {
  queued: "Queued",
  crawling: "Crawling",
  diagnosing: "Diagnosing",
  fixing: "Fixing",
  verifying: "Verifying",
  shipping: "Shipping",
  done: "Done",
  failed: "Failed",
};

function ScoreChip({ scan }: { scan: Scan }) {
  const s = scan.score_after ?? scan.score_before;
  return (
    <span className="tabular inline-flex min-w-14 justify-center rounded-chip border bg-surface-2 px-2 py-0.5 text-sm font-semibold">
      {s ?? "–"}
      <span className="sr-only">{s == null ? " no score yet" : " out of 100"}</span>
    </span>
  );
}

export function RecentScans() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => (await getApi()).listScans(),
  });

  return (
    <section aria-labelledby="recent-title" className="space-y-3">
      <h2 id="recent-title" className="text-xl">
        Recent scans
      </h2>
      {isPending ? (
        <div role="status" aria-label="Loading recent scans" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          as="h3"
          title="Couldn't load recent scans"
          description="Check that the API is reachable, then try again."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="min-h-11 rounded-md border px-4 text-sm font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState
          as="h3"
          icon={<History className="size-6" />}
          title="No scans yet"
          description="Your scans will show up here once you run one."
        />
      ) : (
        <ul className="divide-y rounded-card border bg-surface">
          {data.slice(0, 5).map((s, i) => (
            <Reveal key={s.id} index={i}>
              <Link
                to="/scans/$id"
                params={{ id: s.id }}
                className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <ScoreChip scan={s} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{s.url}</span>
                <span className="text-sm text-muted">{STATUS_LABEL[s.status]}</span>
                <time dateTime={s.created_at} className="text-sm text-muted">
                  {ago(s.created_at)}
                </time>
              </Link>
            </Reveal>
          ))}
        </ul>
      )}
    </section>
  );
}
