import { Link } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Github, Search, ShieldCheck } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfidenceMeter } from "@/components/fixes/ConfidenceMeter";
import { buildRows, patchText, SEV_RANK, type Row } from "@/components/fixes/model";
import { PRCard } from "@/components/fixes/PRCard";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip, type FixStatus } from "@/components/ui/status-chip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Severity } from "@/lib/types";
import { PRINCIPLES, RULE_TITLES, ruleTitle, understandingUrl } from "@/lib/wcag";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/state/scanStore";

const ScoreGauge = lazy(() => import("@/components/fixes/ScoreGauge"));
const DiffViewer = lazy(() => import("@/components/fixes/DiffViewer"));

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-md border bg-surface px-2 text-sm font-normal text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Detail({
  row,
  included,
  onInclude,
}: {
  row: Row;
  included: boolean;
  onInclude: (v: boolean) => void;
}) {
  const { issue, fix } = row;
  const info = RULE_TITLES[issue.rule_id];
  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={issue.impact} />
          <StatusChip status={row.status} />
          {fix && <Chip>{fix.strategy === "rule" ? "Rule-based" : "LLM-assisted"}</Chip>}
        </div>
        <h3 className="text-xl font-semibold">{ruleTitle(issue.rule_id)}</h3>
        {info && <p className="text-sm text-muted">{info.description}</p>}
      </header>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">WCAG</dt>
        <dd>
          <a
            href={understandingUrl(issue.wcag_sc)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand underline underline-offset-2"
          >
            {issue.wcag_sc} Understanding <ExternalLink aria-hidden className="size-3" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </dd>
        <dt className="text-muted">Page</dt>
        <dd className="break-all font-mono">{issue.page_url}</dd>
        <dt className="text-muted">Selector</dt>
        <dd className="break-all font-mono">{issue.selector}</dd>
        {issue.source_file && (
          <>
            <dt className="text-muted">Source</dt>
            <dd className="break-all font-mono">
              {issue.source_file}
              {issue.source_line ? `:${issue.source_line}` : ""}
            </dd>
          </>
        )}
        {issue.context && (
          <>
            <dt className="text-muted">Context</dt>
            <dd>{issue.context}</dd>
          </>
        )}
      </dl>

      {fix ? (
        <>
          <section
            aria-label="Fix summary"
            className="space-y-3 rounded-card border bg-surface p-4"
          >
            <p className="text-sm">{fix.explanation}</p>
            <ConfidenceMeter value={fix.confidence} />
            <p className="tabular text-sm">
              Violations <strong>{fix.violations_before}</strong> →{" "}
              <strong>{fix.violations_after}</strong>
            </p>
          </section>

          {fix.validated ? (
            <p className="flex items-center gap-2 text-sm text-success" role="status">
              <ShieldCheck aria-hidden className="size-4" /> Validated: axe-core confirms this fix
              removes the violation and adds none.
            </p>
          ) : (
            <div
              role="status"
              className="space-y-1 rounded-card border border-moderate bg-surface p-4 text-sm"
            >
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle aria-hidden className="size-4 text-moderate" /> Caught by the rules
                engine
              </p>
              <p className="text-muted">{fix.rejected_reason}</p>
              <p className="text-muted">
                The LLM never decides alone. This fix will not be shipped.
              </p>
            </div>
          )}

          <Suspense fallback={<Skeleton className="h-32 w-full rounded-card" />}>
            <DiffViewer before={fix.original} after={fix.patched} />
          </Suspense>

          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <Checkbox
              checked={included && fix.validated}
              disabled={!fix.validated}
              onCheckedChange={(v) => onInclude(v === true)}
            />
            {fix.validated ? "Include in pull request" : "Not eligible for the pull request"}
          </label>
        </>
      ) : (
        <p className="rounded-card border bg-surface p-4 text-sm text-muted">
          No automatic fix was proposed. This issue needs human review.
        </p>
      )}
    </div>
  );
}

function ShipControls({
  canShip,
  included,
  onOpen,
  onCopy,
  repoMode,
}: {
  canShip: boolean;
  included: number;
  onOpen: () => void;
  onCopy: () => void;
  repoMode: boolean;
}) {
  return repoMode ? (
    <Button
      variant="primary"
      className="w-full"
      disabled={!canShip || included === 0}
      onClick={onOpen}
    >
      <Github /> Open PR ({included})
    </Button>
  ) : (
    <div className="flex w-full flex-col gap-2 sm:flex-row lg:flex-col">
      <Button variant="primary" asChild className="flex-1">
        <Link to="/integrations/github">Connect repo to ship</Link>
      </Button>
      <Button variant="secondary" className="flex-1" disabled={included === 0} onClick={onCopy}>
        Copy patch
      </Button>
    </div>
  );
}

export function FixesPage({ id }: { id: string }) {
  const s = useScanStore();
  useEffect(() => s.openScan(id), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const desktop = useMediaQuery("(min-width: 1024px)");
  const [selected, setSelected] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sev, setSev] = useState("all");
  const [status, setStatus] = useState("all");
  const [principle, setPrinciple] = useState("all");
  const [sort, setSort] = useState("severity");
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [shipping, setShipping] = useState(false);

  const scan = s.scan?.id === id ? s.scan : null;
  const rows = useMemo(() => buildRows(s.issues, s.fixes), [s.issues, s.fixes]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          (sev === "all" || r.issue.impact === sev) &&
          (status === "all" || r.status === status) &&
          (principle === "all" || r.principle === principle) &&
          (!needle ||
            [ruleTitle(r.issue.rule_id), r.issue.selector, r.issue.wcag_sc, r.issue.page_url].some(
              (t) => t.toLowerCase().includes(needle),
            )),
      )
      .sort((a, b) =>
        sort === "wcag"
          ? a.issue.wcag_sc.localeCompare(b.issue.wcag_sc, undefined, { numeric: true })
          : sort === "status"
            ? a.status.localeCompare(b.status)
            : SEV_RANK[a.issue.impact] - SEV_RANK[b.issue.impact],
      );
  }, [rows, sev, status, principle, sort, q]);

  const counts = {
    validated: rows.filter((r) => r.status === "validated").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    review: rows.filter((r) => r.status === "needs-review").length,
  };
  const includedRows = rows.filter((r) => r.fix?.validated && !excluded.has(r.fix.id));
  const selectedRow = rows.find((r) => r.issue.id === selected) ?? null;
  const repoMode = scan?.mode === "repo";
  const files = [
    ...new Set(includedRows.map((r) => r.issue.source_file).filter((f): f is string => !!f)),
  ];

  const ship = async () => {
    setShipping(true);
    try {
      await s.ship(includedRows.map((r) => r.fix!.id));
      setConfirm(false);
      toast.success("Pull request opened");
    } catch (e) {
      toast.error("Couldn't open the pull request", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setShipping(false);
    }
  };
  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(patchText(includedRows));
      toast.success("Patch copied");
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  if (!scan) {
    return s.error ? (
      <EmptyState
        icon={<AlertTriangle className="size-6" />}
        title="Couldn't load this scan"
        description={s.error}
      />
    ) : (
      <div role="status" aria-label="Loading fixes" className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    );
  }

  const detail = selectedRow && (
    <Detail
      row={selectedRow}
      included={!!selectedRow.fix && !excluded.has(selectedRow.fix.id)}
      onInclude={(v) =>
        setExcluded((prev) => {
          const n = new Set(prev);
          if (selectedRow.fix) {
            if (v) n.delete(selectedRow.fix.id);
            else n.add(selectedRow.fix.id);
          }
          return n;
        })
      }
    />
  );

  const shipControls = (
    <ShipControls
      canShip={scan.status === "done"}
      included={includedRows.length}
      onOpen={() => setConfirm(true)}
      onCopy={() => void copyPatch()}
      repoMode={repoMode}
    />
  );

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-28 lg:pb-0">
        <header className="space-y-1">
          <FocusHeading className="text-3xl font-semibold outline-none">Review fixes</FocusHeading>
          <p className="break-all font-mono text-sm text-muted">{scan.url}</p>
        </header>

        {s.pr && <PRCard pr={s.pr} files={files} />}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_15rem]">
          <aside
            aria-label="Summary"
            className="space-y-4 lg:sticky lg:top-20 lg:order-3 lg:self-start"
          >
            <div className="space-y-4 rounded-card border bg-surface p-4">
              <Suspense fallback={<Skeleton className="mx-auto size-44 rounded-full" />}>
                <ScoreGauge before={scan.score_before} after={scan.score_after} />
              </Suspense>
              <p className="flex items-center justify-center gap-1.5 text-sm text-success">
                <ShieldCheck aria-hidden className="size-4" /> Verified by TinyFish
              </p>
              <ul className="grid grid-cols-3 gap-2 text-center text-sm">
                <li>
                  <p className="tabular text-2xl font-semibold">{counts.validated}</p>
                  <p className="text-muted">Accepted</p>
                </li>
                <li>
                  <p className="tabular text-2xl font-semibold">{counts.rejected}</p>
                  <p className="text-muted">Rejected</p>
                </li>
                <li>
                  <p className="tabular text-2xl font-semibold">{counts.review}</p>
                  <p className="text-muted">Review</p>
                </li>
              </ul>
            </div>
            <div className="hidden lg:block">{shipControls}</div>
          </aside>

          <section aria-labelledby="issues-title" className="space-y-4 lg:order-1">
            <h2 id="issues-title" className="text-xl">
              Issues <span className="tabular text-muted">({visible.length})</span>
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="relative col-span-2 flex flex-col gap-1 text-sm font-medium">
                Search
                <Search
                  aria-hidden
                  className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted"
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rule, selector or WCAG number"
                  className="min-h-11 rounded-md border bg-surface pl-9 pr-3 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:text-sm"
                />
              </label>
              <Select
                label="Severity"
                value={sev}
                onChange={setSev}
                options={[
                  ["all", "All"],
                  ...(["critical", "serious", "moderate", "minor"] as Severity[]).map(
                    (v): [string, string] => [v, v[0]!.toUpperCase() + v.slice(1)],
                  ),
                ]}
              />
              <Select
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  ["all", "All"],
                  ["validated", "Validated"],
                  ["rejected", "Rejected"],
                  ["needs-review", "Needs review"],
                ]}
              />
              <Select
                label="Principle"
                value={principle}
                onChange={setPrinciple}
                options={[
                  ["all", "All"],
                  ...PRINCIPLES.map((p): [string, string] => [p.id, p.name]),
                ]}
              />
              <Select
                label="Sort by"
                value={sort}
                onChange={setSort}
                options={[
                  ["severity", "Severity"],
                  ["wcag", "WCAG criterion"],
                  ["status", "Status"],
                ]}
              />
            </div>

            {visible.length === 0 ? (
              <EmptyState
                as="h3"
                title="No issues match"
                description="Try clearing a filter or the search."
              />
            ) : (
              <Accordion type="multiple" defaultValue={PRINCIPLES.map((p) => p.id)}>
                {PRINCIPLES.map((p) => {
                  const group = visible.filter((r) => r.principle === p.id);
                  if (group.length === 0) return null;
                  return (
                    <AccordionItem key={p.id} value={p.id}>
                      <AccordionTrigger>
                        {p.name} <span className="tabular ml-2 text-muted">({group.length})</span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <ul className="space-y-2">
                          {group.map((r) => (
                            <li
                              key={r.issue.id}
                              style={{
                                contentVisibility: "auto",
                                containIntrinsicSize: "auto 80px",
                              }}
                            >
                              <button
                                type="button"
                                aria-pressed={selected === r.issue.id}
                                onClick={() => setSelected(r.issue.id)}
                                className={cn(
                                  "w-full space-y-1.5 rounded-card border bg-surface p-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  selected === r.issue.id && "border-brand bg-surface-2",
                                )}
                              >
                                <span className="flex flex-wrap items-center gap-2">
                                  <SeverityBadge severity={r.issue.impact} />
                                  <StatusChip status={r.status as FixStatus} />
                                  <span className="tabular text-xs text-muted">
                                    WCAG {r.issue.wcag_sc}
                                  </span>
                                </span>
                                <span className="block text-sm font-medium">
                                  {ruleTitle(r.issue.rule_id)}
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="block truncate font-mono text-xs text-muted">
                                      {r.issue.selector}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="font-mono">
                                    {r.issue.selector}
                                  </TooltipContent>
                                </Tooltip>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </section>

          <section aria-label="Issue detail" className="lg:order-2">
            {desktop ? (
              detail ? (
                <div className="rounded-card border bg-surface p-5">{detail}</div>
              ) : (
                <EmptyState
                  as="h3"
                  title="Select an issue"
                  description="Choose an issue on the left to see its fix and diff."
                />
              )
            ) : (
              <Sheet open={!!selectedRow} onOpenChange={(o) => !o && setSelected(null)}>
                <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                  <SheetHeader>
                    <SheetTitle>Issue detail</SheetTitle>
                    <SheetDescription>Fix explanation and diff</SheetDescription>
                  </SheetHeader>
                  <div className="mt-4">{detail}</div>
                </SheetContent>
              </Sheet>
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-surface p-3 lg:hidden">
          {shipControls}
        </div>

        <Dialog open={confirm} onOpenChange={(o) => !shipping && setConfirm(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Open pull request?</DialogTitle>
              <DialogDescription>
                {includedRows.length} validated {includedRows.length === 1 ? "fix" : "fixes"} will
                be committed to a new branch of{" "}
                {scan.mode === "repo" ? "your repository" : "the repo"}. Nothing is merged
                automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Files</p>
                <ul className="font-mono text-muted">
                  {files.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">Fixes</p>
                <ul className="list-disc pl-5 text-muted">
                  {includedRows.map((r) => (
                    <li key={r.issue.id}>
                      {ruleTitle(r.issue.rule_id)} (WCAG {r.issue.wcag_sc})
                    </li>
                  ))}
                </ul>
              </div>
              {shipping && <Progress aria-label="Opening pull request" />}
            </div>
            <DialogFooter>
              <Button variant="ghost" disabled={shipping} onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={shipping} onClick={() => void ship()}>
                {shipping ? "Opening…" : "Open PR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
