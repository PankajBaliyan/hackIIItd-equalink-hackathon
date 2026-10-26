import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Github, GitPullRequest, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getApi } from "@/lib/api";
import { useGithub, useGithubAction } from "@/lib/useGithub";

export const Route = createFileRoute("/integrations/github")({
  head: () => ({
    meta: [
      { title: "GitHub · EquaLink" },
      { name: "description", content: "Connect GitHub so EquaLink can open pull requests." },
      { property: "og:title", content: "GitHub · EquaLink" },
      { property: "og:description", content: "Connect GitHub so EquaLink can open pull requests." },
    ],
  }),
  component: Page,
});

const PERMISSIONS = [
  "Contents: read and write, to create a branch and commit fixes",
  "Pull requests: read and write, to open the PR",
  "Never merges, never pushes to your default branch",
];

function Page() {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useGithub();

  // The server redirects back here after GitHub sign-in with ?connected=1 or ?error=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get("error");
    if (!err && !q.get("connected")) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (err) toast.error("GitHub sign-in didn't complete", { description: err.replace(/_/g, " ") });
    else toast.success("GitHub connected");
    void qc.invalidateQueries({ queryKey: ["github"] });
  }, [qc]);
  const anyEnabled = !!data?.connected && data.repos.some((r) => r.enabled);
  const pulls = useQuery({
    queryKey: ["github-pulls", "all", ""],
    enabled: anyEnabled,
    retry: false,
    queryFn: async () => (await getApi()).listGithubPulls("all"),
  });
  const recent = (pulls.data ?? []).slice(0, 5);
  const fail = (title: string) => (e: unknown) =>
    toast.error(title, { description: e instanceof Error ? e.message : undefined });

  const connect = useGithubAction((api) => api.connectGithub());
  const disconnect = useGithubAction((api) => api.disconnectGithub());
  const toggle = useGithubAction((api, name: string, on: boolean) => api.setGithubRepo(name, on));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <FocusHeading className="text-3xl font-semibold outline-none">GitHub</FocusHeading>
        <p className="text-muted">Fixes arrive as pull requests, never direct commits.</p>
      </div>

      {isPending ? (
        <Skeleton
          role="status"
          aria-label="Loading GitHub status"
          className="h-48 w-full rounded-card"
        />
      ) : isError ? (
        <EmptyState
          title="Couldn't load GitHub status"
          description="Check that the API is reachable."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data.connected ? (
        <section
          aria-labelledby="gh-connect"
          className="space-y-4 rounded-card border bg-surface p-6"
        >
          <h2 id="gh-connect" className="flex items-center gap-2 text-xl">
            <Github aria-hidden className="size-5" /> Connect GitHub
          </h2>
          <p className="text-sm text-muted">
            You'll be sent to GitHub to sign in and approve access, then returned here.
          </p>
          <ul className="space-y-2 text-sm">
            {PERMISSIONS.map((p) => (
              <li key={p} className="flex gap-2">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            loading={connect.isPending}
            onClick={() => connect.mutate([], { onError: fail("Couldn't connect GitHub") })}
          >
            {connect.isPending ? "Connecting…" : "Sign in with GitHub"}
          </Button>
        </section>
      ) : (
        <>
          <section
            aria-labelledby="gh-account"
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border bg-surface p-5"
          >
            <div className="space-y-0.5">
              <h2 id="gh-account" className="flex items-center gap-2 text-lg font-semibold">
                <Check aria-hidden className="size-4 text-success" /> Connected
              </h2>
              <p className="text-sm text-muted">
                Account <span className="font-mono text-text">{data.account}</span>
              </p>
            </div>
            <Button
              variant="secondary"
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate([], { onError: fail("Couldn't disconnect") })}
            >
              Disconnect
            </Button>
          </section>

          <section aria-labelledby="gh-repos" className="space-y-3">
            <h2 id="gh-repos" className="text-xl">
              Repositories
            </h2>
            <ul className="divide-y rounded-card border bg-surface">
              {data.repos.map((r) => (
                <li
                  key={r.full_name}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
                >
                  <label
                    htmlFor={`repo-${r.full_name}`}
                    className="min-w-0 flex-1 cursor-pointer truncate font-mono text-sm"
                  >
                    {r.full_name}
                  </label>
                  <Switch
                    id={`repo-${r.full_name}`}
                    checked={r.enabled}
                    onCheckedChange={(on) =>
                      toggle.mutate([r.full_name, on], {
                        onError: fail("Couldn't update repository"),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted">
              Turn a repository off to stop EquaLink opening PRs on it.
            </p>
          </section>
        </>
      )}

      <section aria-labelledby="gh-prs" className="space-y-3">
        <h2 id="gh-prs" className="text-xl">
          Recent pull requests
        </h2>
        {!anyEnabled ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <GitPullRequest aria-hidden className="size-4" /> Turn on a repository to see its pull
            requests.
          </p>
        ) : pulls.isPending ? (
          <Skeleton
            role="status"
            aria-label="Loading pull requests"
            className="h-24 w-full rounded-card"
          />
        ) : pulls.isError ? (
          <p role="alert" className="text-sm text-critical">
            Couldn't load pull requests:{" "}
            {pulls.error instanceof Error ? pulls.error.message : "try again"}
          </p>
        ) : recent.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <GitPullRequest aria-hidden className="size-4" /> None yet.{" "}
            <Link to="/" className="text-text underline underline-offset-2 hover:text-brand-2">
              Run a scan
            </Link>
          </p>
        ) : (
          <>
            <ul className="divide-y rounded-card border bg-surface">
              {recent.map((pr) => (
                <li
                  key={`${pr.repo}#${pr.number}`}
                  className="flex flex-wrap items-center gap-x-4 px-4 py-3 text-sm"
                >
                  <span className="tabular font-medium">#{pr.number}</span>
                  <span className="min-w-0 truncate">{pr.title}</span>
                  <span className="font-mono text-muted">{pr.repo}</span>
                  <span className="text-muted">{pr.state}</span>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-text underline underline-offset-2 hover:text-brand-2"
                  >
                    View
                    <span className="sr-only"> pull request {pr.number} (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
            <Link
              to="/pull-requests"
              className="text-sm text-text underline underline-offset-2 hover:text-brand-2"
            >
              All pull requests
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
