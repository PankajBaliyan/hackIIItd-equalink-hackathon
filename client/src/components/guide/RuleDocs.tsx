import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/ui/text-field";
import { ruleDocsApi } from "@/lib/api";
import type { RuleDocInput } from "@/lib/api";
import type { RuleDoc, RuleSyncStatus } from "@/lib/types";

const KEY = ["rule-docs"];
const SYNC_KEY = ["rule-docs", "sync"];
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : undefined);
const titleFromFile = (name: string) => name.replace(/\.[^.]+$/, "");

function AddDoc() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string>();

  const add = useMutation({
    mutationFn: (docs: RuleDocInput[]) => ruleDocsApi.create(docs),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(
        created.length === 1 ? `Added “${created[0]?.title}”` : `Added ${created.length} documents`,
      );
    },
    onError: (e) => setError(errMsg(e) ?? "Couldn't add the document."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Give the document a title.");
    if (!content.trim()) return setError("Paste the document's text.");
    setError(undefined);
    add.mutate([{ title, content, ...(sourceUrl.trim() && { source_url: sourceUrl }) }], {
      onSuccess: () => {
        setTitle("");
        setSourceUrl("");
        setContent("");
      },
    });
  };

  // Several files at once become several documents in one request.
  const importFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const docs = await Promise.all(
      files.map(async (f) => ({ title: titleFromFile(f.name), content: await f.text() })),
    );
    setError(undefined);
    add.mutate(docs);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add a document"
      className="space-y-4 rounded-card border bg-surface p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          placeholder="WCAG 2.2: 1.4.3 Contrast (Minimum)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="Source URL (optional)"
          type="url"
          inputMode="url"
          spellCheck={false}
          placeholder="https://www.w3.org/WAI/WCAG22/Understanding/"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rule-doc-content" className="block text-sm font-medium">
          Content
        </label>
        <Textarea
          id="rule-doc-content"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste the rule text or markdown"
          className="min-h-32 bg-surface font-mono text-text"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={add.isPending}>
          Add document
        </Button>
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />
          Import files
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,.html,text/*"
          className="sr-only"
          tabIndex={-1}
          aria-label="Import documents from files"
          onChange={(e) => void importFiles(e)}
        />
      </div>
    </form>
  );
}

function DocItem({ doc, onRemove }: { doc: RuleDoc; onRemove: (d: RuleDoc) => void }) {
  return (
    <li className="rounded-card border bg-surface p-4">
      <details>
        <summary className="flex cursor-pointer items-start justify-between gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="min-w-0">
            <span className="block font-medium">
              {doc.title}
              {doc.origin === "w3c-sync" && (
                <span className="ml-2 rounded-full border px-2 py-0.5 align-middle text-xs font-normal text-muted">
                  W3C sync
                </span>
              )}
            </span>
            <span className="block text-sm text-muted">
              {doc.content.length.toLocaleString()} characters ·{" "}
              <time dateTime={doc.created_at}>
                {new Date(doc.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </time>
            </span>
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          {doc.source_url && (
            <ul className="space-y-1">
              {doc.source_url.split(", ").map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all font-mono text-sm text-muted underline underline-offset-2 hover:text-text"
                  >
                    {url}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-surface-2 p-3 text-sm">
            {doc.content}
          </pre>
        </div>
      </details>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => onRemove(doc)}>
          <Trash2 aria-hidden />
          Remove<span className="sr-only"> {doc.title}</span>
        </Button>
      </div>
    </li>
  );
}

function syncMessage(s: RuleSyncStatus): string {
  if (!s.configured) return "Add TINYFISH_API_KEY to server/.env to turn this on.";
  if (s.status === "running")
    return "Fetching the latest W3C rules. This can take several minutes.";
  if (s.status === "done" && s.finished_at)
    return `Last synced ${fmt(s.finished_at)}: ${s.added} new, ${s.skipped} already stored.`;
  if (s.status === "failed") return "The last sync failed.";
  return "Not synced yet. Run the first sync now; after that it repeats every month.";
}

/** Monthly TinyFish agent run that adds new W3C rules; the server skips rules it already has. */
function SyncPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: SYNC_KEY,
    queryFn: ruleDocsApi.syncStatus,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false),
  });
  const running = data?.status === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    // A run just finished: show what it added.
    if (wasRunning.current && !running) void qc.invalidateQueries({ queryKey: KEY });
    wasRunning.current = running;
  }, [running, qc]);

  const start = useMutation({
    mutationFn: ruleDocsApi.startSync,
    onSuccess: (s) => qc.setQueryData(SYNC_KEY, s),
    onError: (e) => toast.error("Couldn't start the sync", { description: errMsg(e) }),
  });

  return (
    <section
      aria-labelledby="w3c-sync-h"
      className="flex flex-wrap items-start justify-between gap-4 rounded-card border bg-surface p-5"
    >
      <div className="min-w-0 space-y-1">
        <h2 id="w3c-sync-h" className="text-lg font-semibold">
          W3C rules sync
        </h2>
        <p role="status" className="text-sm text-muted">
          {data ? syncMessage(data) : "Loading sync status…"}
        </p>
        {data?.status === "failed" && data.error && (
          <p role="alert" className="text-sm text-critical">
            {data.error}
          </p>
        )}
        {data?.configured && data.scheduled && data.next_run_at && !running && (
          <p className="text-sm text-muted">
            An agent checks W3C once a month. Next run: {fmt(data.next_run_at)}.
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        loading={start.isPending || running}
        disabled={!data?.configured}
        onClick={() => start.mutate()}
      >
        <RefreshCw aria-hidden />
        Sync now
      </Button>
    </section>
  );
}

export function RuleDocs() {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: ruleDocsApi.list,
  });
  const remove = useMutation({
    mutationFn: (id: number) => ruleDocsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast.error("Couldn't remove the document", { description: errMsg(e) }),
  });

  return (
    <div className="space-y-4">
      <SyncPanel />
      <AddDoc />
      {isPending ? (
        <div role="status" aria-label="Loading documents" className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load documents"
          description="Is the server running on port 8000?"
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" />}
          title="No documents yet"
          description="Add rules by hand, import files, or let an agent POST them to /rule-docs."
        />
      ) : (
        <ul className="space-y-3">
          {data.map((d) => (
            <DocItem key={d.id} doc={d} onRemove={(x) => remove.mutate(x.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
