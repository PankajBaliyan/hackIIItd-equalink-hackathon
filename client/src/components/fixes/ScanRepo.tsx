import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Github } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getApi } from "@/lib/api";
import { useGithub } from "@/lib/useGithub";

const selectClass =
  "min-h-11 rounded-md border bg-surface px-2 text-sm font-normal text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Pick a connected repository, scan its HTML, then review explained fixes. */
export function ScanRepo() {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const github = useGithub();
  const [repo, setRepo] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = github.data?.repos.filter((r) => r.enabled) ?? [];
  const connected = github.data?.connected === true;

  useEffect(() => {
    if (!repo && enabled[0]) setRepo(enabled[0].full_name);
  }, [enabled, repo]);

  const files = useQuery({
    queryKey: ["repo-files", repo],
    enabled: Boolean(repo),
    retry: false,
    queryFn: async () => (await getApi()).listRepoFiles(repo),
  });

  useEffect(() => setPath(""), [repo]);

  const scan = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await (await getApi()).scanRepo(repo, path || undefined);
      await queries.invalidateQueries({ queryKey: ["scans"] });
      await navigate({ to: "/scans/$id/fixes", params: { id: detail.scan.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="scan-repo" className="space-y-3 rounded-card border bg-surface p-4">
      <h2 id="scan-repo" className="text-lg font-semibold">
        Scan a repository
      </h2>
      <p className="text-sm text-muted">
        Pick one of your connected repositories. EquaLink reads its HTML, finds accessibility
        issues, explains each one and prepares a fix that axe-core has checked. Then open a single
        pull request with every fix you keep.
      </p>

      {github.isPending ? (
        <p role="status" className="text-sm text-muted">
          Loading your repositories…
        </p>
      ) : !connected ? (
        <p className="text-sm">
          GitHub isn&apos;t connected.{" "}
          <Link to="/integrations/github" className="text-brand underline underline-offset-2">
            Connect GitHub
          </Link>
        </p>
      ) : enabled.length === 0 ? (
        <p className="text-sm">
          No repositories are switched on yet.{" "}
          <Link to="/integrations/github" className="text-brand underline underline-offset-2">
            Turn on the repositories to review
          </Link>
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Repository
              <select
                value={repo}
                disabled={busy}
                onChange={(e) => setRepo(e.target.value)}
                className={selectClass}
              >
                {enabled.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              HTML file
              <select
                value={path}
                disabled={busy || files.isPending || !files.data?.files.length}
                onChange={(e) => setPath(e.target.value)}
                className={selectClass}
              >
                {files.data?.files.map((f, i) => (
                  <option key={f} value={i === 0 ? "" : f}>
                    {f}
                  </option>
                ))}
                {!files.data?.files.length && (
                  <option value="">{files.isPending ? "Loading files…" : "No HTML files"}</option>
                )}
              </select>
            </label>
          </div>
          {files.isError && (
            <p role="alert" className="break-words text-sm text-critical">
              {files.error instanceof Error ? files.error.message : "Couldn't list files."}
            </p>
          )}
          {files.data && files.data.files.length === 0 && (
            <p className="text-sm text-muted">
              No HTML files were found on {files.data.branch}. Framework apps build their HTML at
              deploy time, so there is nothing static to scan.
            </p>
          )}
          {error && (
            <p role="alert" className="break-words text-sm text-critical">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || !repo || !files.data?.files.length}
            onClick={() => void scan()}
          >
            <Github aria-hidden /> {busy ? "Scanning and validating fixes…" : "Scan repository"}
          </Button>
        </>
      )}
    </section>
  );
}
