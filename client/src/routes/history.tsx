import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useMemo, useState } from "react";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { getApi } from "@/lib/api";
import type { Scan } from "@/lib/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Scan History · EquaLink" },
      { name: "description", content: "Past EquaLink scans and their scores." },
      { property: "og:title", content: "Scan History · EquaLink" },
      { property: "og:description", content: "Past EquaLink scans and their scores." },
    ],
  }),
  component: Page,
});

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const target = (s: Scan) => (s.status === "done" ? "/scans/$id/fixes" : "/scans/$id");

function Page() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => (await getApi()).listScans(),
  });
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (s) =>
          (status === "all" ||
            (status === "done"
              ? s.status === "done"
              : status === "failed"
                ? s.status === "failed"
                : s.status !== "done" && s.status !== "failed")) &&
          s.url.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [data, status, q],
  );

  const score = (s: Scan) => (
    <span className="tabular">
      {s.score_before ?? "–"} → {s.score_after ?? "–"}
      <span className="sr-only"> score before and after</span>
    </span>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <FocusHeading className="text-3xl font-semibold outline-none">Scan History</FocusHeading>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium sm:max-w-xs">
          Search URL
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-h-11 rounded-md border bg-surface px-3 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="min-h-11 rounded-md border bg-surface px-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
          >
            <option value="all">All</option>
            <option value="done">Done</option>
            <option value="running">In progress</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>

      {isPending ? (
        <div role="status" aria-label="Loading history" className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState title="Couldn't load history" description="Check that the API is reachable." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No scans found"
          description="Run a scan or clear the filters."
        />
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <caption className="sr-only">Past scans</caption>
            <thead className="text-muted">
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  URL
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Level
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Score
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b">
                  <td className="max-w-xs truncate py-3 pr-4 font-mono">{s.url}</td>
                  <td className="py-3 pr-4">{s.level}</td>
                  <td className="py-3 pr-4">{score(s)}</td>
                  <td className="py-3 pr-4 capitalize">{s.status}</td>
                  <td className="py-3 pr-4 text-muted">{when(s.created_at)}</td>
                  <td className="py-3">
                    <Link
                      to={target(s)}
                      params={{ id: s.id }}
                      className="text-brand underline underline-offset-2"
                    >
                      {s.status === "done" ? "Fixes" : "View"}
                      <span className="sr-only"> for {s.url}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-3 md:hidden">
            {rows.map((s, i) => (
              <Reveal key={s.id} index={i}>
                <Link
                  to={target(s)}
                  params={{ id: s.id }}
                  className="block space-y-1 rounded-card border bg-surface p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block break-all font-mono text-sm">{s.url}</span>
                  <span className="flex flex-wrap gap-x-4 text-sm text-muted">
                    {score(s)}
                    <span className="capitalize">{s.status}</span>
                    <span>{when(s.created_at)}</span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
