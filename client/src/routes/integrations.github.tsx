import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ExternalLink, Github, GitPullRequest, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  const [token, setToken] = useState("");
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
  const { pullRequests } = useScanStore();
  const fail = (title: string) => (e: unknown) =>
    toast.error(title, { description: e instanceof Error ? e.message : undefined });

  const redirects = data?.mode === "oauth" || data?.mode === "app";
  const connect = useGithubAction((api) => api.connectGithub());
  const connectToken = useGithubAction((api, value: string) => api.connectGithubToken(value));
  const disconnect = useGithubAction((api) => api.disconnectGithub());
  const toggle = useGithubAction((api, name: string, on: boolean) => api.setGithubRepo(name, on));
  const submitToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    connectToken.mutate([token], {
      onSuccess: () => setToken(""),
      onError: fail("Couldn't connect GitHub"),
    });
  };
  const tokenAccessForm = (
    <form className="space-y-3" onSubmit={submitToken}>
      <a
        href="https://github.com/settings/personal-access-tokens/new"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm font-medium text-brand underline underline-offset-2"
      >
        Open GitHub token page
        <ExternalLink aria-hidden className="size-4" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <div className="space-y-1.5">
        <label htmlFor="github-token" className="block text-sm font-medium">
          GitHub personal access token
        </label>
        <input
          id="github-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
          minLength={20}
          placeholder="github_pat_…"
          className="h-10 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        loading={connectToken.isPending}
        disabled={token.trim().length < 20}
      >
        {connectToken.isPending
          ? "Checking token…"
          : data?.connected
            ? "Replace token and refresh repositories"
            : "Connect and load repositories"}
      </Button>
    </form>
  );

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
            {redirects
              ? "You'll be sent to GitHub to sign in and approve access, then returned here."
              : "Create a fine-grained token on GitHub, then paste it below. The backend validates it and keeps it server-side."}
          </p>
          <ul className="space-y-2 text-sm">
            {PERMISSIONS.map((p) => (
              <li key={p} className="flex gap-2">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
          {redirects ? (
            <Button
              variant="primary"
              loading={connect.isPending}
              onClick={() => connect.mutate([], { onError: fail("Couldn't connect GitHub") })}
            >
              {connect.isPending ? "Connecting…" : "Sign in with GitHub"}
            </Button>
          ) : (
            tokenAccessForm
          )}
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

          <section aria-labelledby="gh-token" className="space-y-4 rounded-card border bg-surface p-5">
            <div className="space-y-1">
              <h2 id="gh-token" className="text-xl">GitHub token access</h2>
              <p className="text-sm text-muted">
                Paste a different token to replace the current connection and reload its repositories.
                The token is sent only to FastAPI and is never stored in the browser.
              </p>
            </div>
            {tokenAccessForm}
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
            <Link to="/" className="text-text underline underline-offset-2 hover:text-brand-2">
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
                  className="ml-auto text-text underline underline-offset-2 hover:text-brand-2"
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
