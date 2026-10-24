import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, Printer } from "lucide-react";
import { useMemo, useState } from "react";

import { buildRows } from "@/components/fixes/model";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getApi } from "@/lib/api";
import { SEVERITY_ORDER } from "@/lib/score";
import { PRINCIPLES, countBySeverity, ruleTitle } from "@/lib/wcag";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · EquaLink" },
      { name: "description", content: "Compliance reports for completed EquaLink scans." },
      { property: "og:title", content: "Reports · EquaLink" },
      { property: "og:description", content: "Compliance reports for completed EquaLink scans." },
    ],
  }),
  component: Page,
});

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Report({ id }: { id: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["scan", id],
    queryFn: async () => (await getApi()).getScan(id),
  });
  const rows = useMemo(() => (data ? buildRows(data.issues, data.fixes) : []), [data]);

  if (isPending)
    return (
      <Skeleton role="status" aria-label="Loading report" className="h-96 w-full rounded-card" />
    );
  if (isError || !data) return <EmptyState title="Couldn't load this report" />;

  const { scan } = data;
  const counters = countBySeverity(data.issues);
  const validated = rows.filter((r) => r.status === "validated").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const review = rows.filter((r) => r.status === "needs-review").length;

  const download = () => {
    const payload = {
      generated_at: new Date().toISOString(),
      standard: `WCAG 2.2 ${scan.level}`,
      ...data,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `equalink-report-${scan.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article
      aria-label={`Report for ${scan.url}`}
      className="space-y-6 rounded-card border bg-surface p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="break-all text-2xl font-semibold">{scan.url}</h2>
          <p className="text-sm text-muted">
            WCAG 2.2 level {scan.level} · scanned {fmtDate(scan.created_at)}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="secondary" onClick={download}>
            <Download /> Download JSON
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer /> Print / PDF
          </Button>
        </div>
      </header>

      <section aria-labelledby="r-summary" className="grid gap-3 sm:grid-cols-4">
        <h3 id="r-summary" className="sr-only">
          Summary
        </h3>
        {[
          ["Score before", scan.score_before ?? "–"],
          ["Score after", scan.score_after ?? "–"],
          ["Fixes validated", validated],
          ["Rejected / review", `${rejected} / ${review}`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-card border p-3">
            <p className="text-sm text-muted">{l}</p>
            <p className="tabular text-2xl font-semibold">{v}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="r-sev" className="space-y-2">
        <h3 id="r-sev" className="text-lg">
          Issues by severity
        </h3>
        <ul className="flex flex-wrap gap-4">
          {SEVERITY_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <SeverityBadge severity={s} />{" "}
              <span className="tabular font-semibold">{counters[s]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="r-pour" className="space-y-2">
        <h3 id="r-pour" className="text-lg">
          By WCAG principle
        </h3>
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b">
              <th scope="col" className="py-2 font-medium">
                Principle
              </th>
              <th scope="col" className="py-2 font-medium">
                Issues
              </th>
              <th scope="col" className="py-2 font-medium">
                Validated fixes
              </th>
            </tr>
          </thead>
          <tbody>
            {PRINCIPLES.map((p) => {
              const g = rows.filter((r) => r.principle === p.id);
              return (
                <tr key={p.id} className="border-b">
                  <th scope="row" className="py-2 font-normal">
                    {p.name}
                  </th>
                  <td className="tabular py-2">{g.length}</td>
                  <td className="tabular py-2">
                    {g.filter((r) => r.status === "validated").length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="r-issues" className="space-y-2">
        <h3 id="r-issues" className="text-lg">
          All findings
        </h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No issues were recorded for this scan.</p>
        ) : (
          <ul className="divide-y rounded-card border">
            {rows.map((r) => (
              <li
                key={r.issue.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm"
              >
                <SeverityBadge severity={r.issue.impact} />
                <span className="font-medium">{ruleTitle(r.issue.rule_id)}</span>
                <span className="tabular text-muted">WCAG {r.issue.wcag_sc}</span>
                <span className="ml-auto capitalize text-muted">{r.status.replace("-", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function Page() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => (await getApi()).listScans(),
  });
  const done = useMemo(() => (data ?? []).filter((s) => s.status === "done"), [data]);
  const [picked, setPicked] = useState<string>();
  const current = picked && done.some((s) => s.id === picked) ? picked : done[0]?.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print space-y-1">
        <FocusHeading className="text-3xl font-semibold outline-none">Reports</FocusHeading>
        <p className="text-muted">Audit-ready summaries of completed scans.</p>
      </div>

      {isPending ? (
        <Skeleton role="status" aria-label="Loading reports" className="h-40 w-full rounded-card" />
      ) : isError ? (
        <EmptyState
          title="Couldn't load reports"
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : done.length === 0 || !current ? (
        <EmptyState
          icon={<FileBarChart className="size-6" />}
          title="No reports yet"
          description="Reports appear once a scan completes."
          action={
            <Button variant="primary" asChild>
              <Link to="/">Start a scan</Link>
            </Button>
          }
        />
      ) : (
        <>
          <label className="no-print flex max-w-md flex-col gap-1 text-sm font-medium">
            Scan
            <select
              value={current}
              onChange={(e) => setPicked(e.target.value)}
              className="min-h-11 rounded-md border bg-surface px-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
            >
              {done.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.url} · {fmtDate(s.created_at)}
                </option>
              ))}
            </select>
          </label>
          <Report id={current} />
        </>
      )}
    </div>
  );
}
