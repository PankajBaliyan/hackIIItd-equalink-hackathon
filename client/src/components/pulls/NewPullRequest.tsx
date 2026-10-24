import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getApi } from "@/lib/api";
import type { PullSummary } from "@/lib/types";

const field =
  "min-h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function titleFromBranch(branch: string) {
  const text = branch.replace(/^(feature|fix|bugfix|hotfix)\//, "").replace(/[-_/]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

/** GitHub's "Open a pull request" screen: choose base and compare branches, review, write, create. */
export function NewPullRequest({
  repos,
  onBack,
  onCreated,
}: {
  repos: string[];
  onBack: () => void;
  onCreated: (pr: PullSummary) => void;
}) {
  const qc = useQueryClient();
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);

  const branches = useQuery({
    queryKey: ["branches", repo],
    enabled: Boolean(repo),
    retry: false,
    queryFn: async () => (await getApi()).listBranches(repo),
  });

  useEffect(() => {
    if (!branches.data) return;
    const { default: main, branches: all } = branches.data;
    setBase(main);
    setHead(all.find((b) => b !== main) ?? "");
    setTitleTouched(false);
  }, [branches.data]);

  useEffect(() => {
    if (!titleTouched) setTitle(titleFromBranch(head));
  }, [head, titleTouched]);

  const ready = Boolean(repo && base && head && base !== head);
  const comparison = useQuery({
    queryKey: ["compare", repo, base, head],
    enabled: ready,
    retry: false,
    queryFn: async () => (await getApi()).compareBranches(repo, base, head),
  });

  const create = useMutation({
    mutationFn: async () => (await getApi()).createPull({ repo, base, head, title, body, draft }),
    onSuccess: (pr) => {
      void qc.invalidateQueries({ queryKey: ["github-pulls"] });
      toast.success(`Pull request #${pr.number} opened`);
      onCreated(pr);
    },
    onError: (e) =>
      toast.error("Couldn't create the pull request", {
        description: e instanceof Error ? e.message : undefined,
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && title.trim()) create.mutate();
  };

  const nothingToMerge = comparison.data && comparison.data.ahead_by === 0;
  const files = comparison.data?.files ?? [];
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-1">
        <Button type="button" variant="ghost" onClick={onBack} className="-ml-3">
          <ArrowLeft aria-hidden /> Back to pull requests
        </Button>
        <h2 className="text-2xl font-semibold">Open a pull request</h2>
        <p className="text-sm text-muted">
          Create a new pull request by comparing changes across two branches.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-card border bg-surface p-4">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Repository
          <select value={repo} onChange={(e) => setRepo(e.target.value)} className={field}>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-sm font-medium">
          <span className="flex items-center gap-1">
            <GitBranch aria-hidden className="size-3.5" /> base
          </span>
          <select value={base} onChange={(e) => setBase(e.target.value)} className={field}>
            {branches.data?.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden className="pb-2 text-muted">
          ←
        </span>
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-sm font-medium">
          <span className="flex items-center gap-1">
            <GitBranch aria-hidden className="size-3.5" /> compare
          </span>
          <select value={head} onChange={(e) => setHead(e.target.value)} className={field}>
            {branches.data?.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>

      {branches.isError && (
        <p role="alert" className="text-sm text-critical">
          {branches.error instanceof Error ? branches.error.message : "Couldn't load branches."}
        </p>
      )}
      {branches.data && branches.data.branches.length < 2 && (
        <p role="status" className="rounded-card border bg-surface p-4 text-sm">
          This repository has only one branch. Push another branch to GitHub, then compare it here.
        </p>
      )}
      {comparison.isPending && ready && (
        <p role="status" className="text-sm text-muted">
          Comparing branches…
        </p>
      )}
      {comparison.isError && (
        <p role="alert" className="text-sm text-critical">
          {comparison.error instanceof Error ? comparison.error.message : "Couldn't compare."}
        </p>
      )}
      {comparison.data && (
        <section
          aria-label="Comparison"
          className={`space-y-3 rounded-card border p-4 ${nothingToMerge ? "bg-surface" : "border-success bg-surface"}`}
        >
          <p className="text-sm font-medium">
            {nothingToMerge
              ? `There isn't anything to compare. ${head} is up to date with ${base}.`
              : `Able to create. ${comparison.data.ahead_by} commit${comparison.data.ahead_by === 1 ? "" : "s"} ahead` +
                (comparison.data.behind_by ? `, ${comparison.data.behind_by} behind` : "") +
                `, ${files.length} file${files.length === 1 ? "" : "s"} changed (+${additions} −${deletions}).`}
          </p>
          {comparison.data.commits.length > 0 && (
            <ul className="space-y-1 text-sm">
              {comparison.data.commits.map((c) => (
                <li key={c.sha} className="flex items-center gap-2">
                  <GitCommitHorizontal aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="truncate">{c.message}</span>
                  <code className="ml-auto text-xs text-muted">{c.sha}</code>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {files.map((f) => (
                <li key={f.filename} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono">{f.filename}</span>
                  <span className="text-success">+{f.additions}</span>
                  <span className="text-critical">−{f.deletions}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="space-y-4 rounded-card border bg-surface p-4">
        <div className="space-y-1.5">
          <label htmlFor="pr-title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="pr-title"
            value={title}
            maxLength={256}
            required
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pr-body" className="block text-sm font-medium">
            Description
          </label>
          <textarea
            id="pr-body"
            value={body}
            rows={7}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe what changed and why. Markdown is supported."
            className={`${field} py-2`}
          />
        </div>
        <div className="flex min-h-10 items-center gap-3 text-sm">
          <Checkbox id="pr-draft" checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
          <label htmlFor="pr-draft">Create as draft</label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!ready || !title.trim() || create.isPending || Boolean(nothingToMerge)}
          >
            <GitPullRequest aria-hidden /> {draft ? "Create draft pull request" : "Create pull request"}
          </Button>
          <p className="text-sm text-muted">EquaLink opens the pull request. It never merges it.</p>
        </div>
      </div>
    </form>
  );
}
