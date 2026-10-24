import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleDot, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Plus } from "lucide-react";
import { useState } from "react";

import { NewPullRequest } from "@/components/pulls/NewPullRequest";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getApi } from "@/lib/api";
import type { PullSummary } from "@/lib/types";
import { useGithub } from "@/lib/useGithub";

export const Route = createFileRoute("/pull-requests")({
  head: () => ({
    meta: [
      { title: "Pull Requests · EquaLink" },
      { name: "description", content: "Pull requests on your connected repositories." },
      { property: "og:title", content: "Pull Requests · EquaLink" },
      { property: "og:description", content: "Pull requests on your connected repositories." },
    ],
  }),
  component: Page,
});

function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

function StateIcon({ pr }: { pr: PullSummary }) {
  const cls = "mt-0.5 size-5 shrink-0";
  if (pr.state === "merged") return <GitMerge aria-label="Merged" className={`${cls} text-brand`} />;
  if (pr.state === "closed")
    return <GitPullRequestClosed aria-label="Closed" className={`${cls} text-critical`} />;
  if (pr.draft) return <GitPullRequestDraft aria-label="Draft" className={`${cls} text-muted`} />;
  return <GitPullRequest aria-label="Open" className={`${cls} text-success`} />;
}

function Page() {
  const github = useGithub();
  const [view, setView] = useState<"list" | "new">("list");
  const [state, setState] = useState<"open" | "closed">("open");
  const [repo, setRepo] = useState("");

  const enabled = github.data?.repos.filter((r) => r.enabled).map((r) => r.full_name) ?? [];
  const connected = github.data?.connected === true;

  const pulls = useQuery({
    queryKey: ["github-pulls", state, repo],
    enabled: connected && enabled.length > 0 && view === "list",
    retry: false,
    queryFn: async () => (await getApi()).listGithubPulls(state, repo || undefined),
  });
  const other = useQuery({
    queryKey: ["github-pulls", state === "open" ? "closed" : "open", repo],
    enabled: connected && enabled.length > 0 && view === "list",
    retry: false,
    queryFn: async () =>
      (await getApi()).listGithubPulls(state === "open" ? "closed" : "open", repo || undefined),
  });
  const openCount = (state === "open" ? pulls.data : other.data)?.length;
  const closedCount = (state === "closed" ? pulls.data : other.data)?.length;

  const tab = (value: "open" | "closed", label: string, count: number | undefined, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={state === value}
      onClick={() => setState(value)}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${state === value ? "font-semibold text-text" : "text-muted hover:text-text"}`}
    >
      {icon}
      {count ?? "–"} {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FocusHeading className="text-3xl font-semibold outline-none">Pull Requests</FocusHeading>
        {view === "list" && connected && enabled.length > 0 && (
          <Button variant="primary" onClick={() => setView("new")}>
            <Plus aria-hidden /> New pull request
          </Button>
        )}
      </div>

      {github.isPending ? (
        <p role="status">Loading…</p>
      ) : !connected || enabled.length === 0 ? (
        <EmptyState
          icon={<GitPullRequest className="size-6" />}
          title={connected ? "No repositories are switched on" : "GitHub isn't connected"}
          description="Connect GitHub and turn on a repository to list and open pull requests here."
          action={
            <Button variant="primary" asChild>
              <Link to="/integrations/github">Open GitHub settings</Link>
            </Button>
          }
        />
      ) : view === "new" ? (
        <NewPullRequest
          repos={enabled}
          onBack={() => setView("list")}
          onCreated={() => {
            setState("open");
            setView("list");
          }}
        />
      ) : (
        <section aria-label="Pull requests" className="overflow-hidden rounded-card border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background/50 px-3 py-2">
            <div className="flex gap-1">
              {tab("open", "Open", openCount, <CircleDot aria-hidden className="size-4" />)}
              {tab("closed", "Closed", closedCount, <GitMerge aria-hidden className="size-4" />)}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              Repository
              <select
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="min-h-9 rounded-md border bg-surface px-2 text-sm text-text"
              >
                <option value="">All enabled</option>
                {enabled.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {pulls.isPending ? (
            <p role="status" className="p-6 text-sm text-muted">
              Loading pull requests…
            </p>
          ) : pulls.isError ? (
            <p role="alert" className="p-6 text-sm text-critical">
              {pulls.error instanceof Error ? pulls.error.message : "Couldn't load pull requests."}
            </p>
          ) : pulls.data.length === 0 ? (
            <div className="p-10 text-center">
              <GitPullRequest aria-hidden className="mx-auto mb-2 size-6 text-muted" />
              <p className="font-medium">No {state} pull requests</p>
              <p className="text-sm text-muted">
                Review a scan&apos;s fixes and open a PR, or create one with “New pull request”.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {pulls.data.map((pr) => (
                <li key={`${pr.repo}#${pr.number}`} className="flex gap-3 px-4 py-3">
                  <StateIcon pr={pr} />
                  <div className="min-w-0 space-y-0.5">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:text-brand-2 hover:underline"
                    >
                      {pr.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    {pr.draft && (
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted">
                        Draft
                      </span>
                    )}
                    <p className="text-xs text-muted">
                      <span className="font-mono">{pr.repo}</span> #{pr.number} · {pr.state}{" "}
                      {ago(pr.updated_at)} by {pr.author} ·{" "}
                      <span className="font-mono">
                        {pr.head} → {pr.base}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
