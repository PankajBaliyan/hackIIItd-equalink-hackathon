import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Github, GitPullRequest, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useGithub, useGithubAction } from "@/lib/useGithub";
import { useScanStore } from "@/state/scanStore";

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
  const { data, isPending, isError, refetch } = useGithub();
  const { pullRequests } = useScanStore();
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
            Install the EquaLink GitHub App on the repositories you choose.
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
            {connect.isPending ? "Connecting…" : "Connect GitHub"}
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
        {pullRequests.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <GitPullRequest aria-hidden className="size-4" /> None yet.{" "}
            <Link to="/" className="text-brand underline underline-offset-2">
              Run a scan
            </Link>
          </p>
        ) : (
          <ul className="divide-y rounded-card border bg-surface">
            {pullRequests.map((pr) => (
              <li
                key={pr.scan_id}
                className="flex flex-wrap items-center gap-x-4 px-4 py-3 text-sm"
              >
                <span className="tabular font-medium">#{pr.number}</span>
                <span className="font-mono text-muted">{pr.repo}</span>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-brand underline underline-offset-2"
                >
                  View
                  <span className="sr-only"> pull request {pr.number} (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
