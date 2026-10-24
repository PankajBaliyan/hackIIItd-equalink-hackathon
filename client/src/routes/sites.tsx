import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Github, Globe, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { parseScanUrl } from "@/components/scan/ScanForm";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { sitesApi } from "@/lib/api";
import type { Site } from "@/lib/types";
import { useGithub } from "@/lib/useGithub";

export const Route = createFileRoute("/sites")({
  head: () => ({
    meta: [
      { title: "Sites · EquaLink" },
      { name: "description", content: "The websites you track with EquaLink." },
      { property: "og:title", content: "Sites · EquaLink" },
      { property: "og:description", content: "The websites you track with EquaLink." },
    ],
  }),
  component: Page,
});

const KEY = ["sites"];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : undefined);

function AddSite() {
  const qc = useQueryClient();
  const { data: gh } = useGithub();
  const repos = gh?.connected ? gh.repos.filter((r) => r.enabled) : [];
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string>();

  const add = useMutation({
    mutationFn: (v: { url: string; repo?: string }) => sitesApi.create(v),
    onSuccess: (site) => {
      void qc.invalidateQueries({ queryKey: KEY });
      setUrl("");
      setRepo("");
      toast.success(`Added ${site.host}`);
    },
    onError: (e) => setError(errMsg(e) ?? "Couldn't add the site."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseScanUrl(url);
    if ("error" in parsed) return setError(parsed.error);
    setError(undefined);
    add.mutate({ url: parsed.url, ...(repo && { repo }) });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add a site"
      className="grid gap-4 rounded-card border bg-surface p-5 sm:grid-cols-[1fr_16rem_auto] sm:items-start"
    >
      <TextField
        label="Website URL"
        type="url"
        inputMode="url"
        spellCheck={false}
        placeholder="https://shopeasy.dev"
        value={url}
        error={error}
        onChange={(e) => {
          setUrl(e.target.value);
          if (error) setError(undefined);
        }}
      />
      <label className="space-y-1.5 text-sm font-medium">
        <span className="block">GitHub repo (optional)</span>
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          disabled={repos.length === 0}
          className="min-h-11 w-full rounded-md border bg-surface px-2 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-10 sm:text-sm"
        >
          <option value="">{repos.length ? "None" : "Enable a repo on the GitHub page"}</option>
          {repos.map((r) => (
            <option key={r.full_name} value={r.full_name}>
              {r.full_name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary" loading={add.isPending} className="sm:mt-[1.625rem]">
        Add site
      </Button>
    </form>
  );
}

function SiteCard({ site, onRemove }: { site: Site; onRemove: (s: Site) => void }) {
  return (
    <article className="space-y-3 rounded-card border bg-surface p-5 shadow-soft">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-all text-lg font-semibold">{site.host}</h2>
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-sm text-muted hover:text-text"
          >
            <span className="truncate font-mono">{site.url}</span>
            <ExternalLink aria-hidden className="size-3 shrink-0" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemove(site)}
          aria-label={`Remove ${site.host}`}
        >
          <Trash2 />
        </Button>
      </header>
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">Repository</dt>
          <dd>
            {site.repo ? (
              <a
                href={`https://github.com/${site.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-text underline underline-offset-2 hover:text-brand-2"
              >
                <Github aria-hidden className="size-3.5" />
                {site.repo}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-muted">Not linked</span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Added</dt>
          <dd>
            <time dateTime={site.created_at}>
              {new Date(site.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </time>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Last scan</dt>
          <dd className="text-muted">Not scanned yet</dd>
        </div>
      </dl>
      <Button variant="secondary" size="sm" asChild>
        <Link to="/" search={{ url: site.url, ...(site.repo && { repo: site.repo }) }}>
          Scan this site<span className="sr-only">: {site.host}</span>
        </Link>
      </Button>
    </article>
  );
}

function Page() {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: KEY, queryFn: sitesApi.list });
  const [removing, setRemoving] = useState<Site | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => sitesApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error("Couldn't remove the site", { description: errMsg(e) }),
    onSettled: () => setRemoving(null),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <FocusHeading className="text-3xl font-semibold outline-none">Sites</FocusHeading>
        <p className="text-muted">The websites you track. Add one, then scan it.</p>
      </div>

      <AddSite />

      {isPending ? (
        <div role="status" aria-label="Loading sites" className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load sites"
          description="Is the server running on port 8000?"
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<Globe className="size-6" />}
          title="No sites yet"
          description="Add your first website above to start tracking it."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.map((site, i) => (
            <Reveal key={site.id} index={i}>
              <SiteCard site={site} onRemove={setRemoving} />
            </Reveal>
          ))}
        </ul>
      )}

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will stop being tracked. Your website and repository are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && remove.mutate(removing.id)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
