import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { API_BASE_URL, getApi } from "@/lib/api";

export function ImportFixes() {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-card border bg-surface p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
          if (file.size > 2_000_000) throw new Error("Choose a JSON file smaller than 2 MB.");
          let payload: unknown;
          try {
            payload = JSON.parse(await file.text());
          } catch {
            throw new Error("This file is not valid JSON.");
          }
          const detail = await (await getApi()).importScan(payload);
          await queries.invalidateQueries({ queryKey: ["scans"] });
          await navigate({ to: "/scans/$id/fixes", params: { id: detail.scan.id } });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Import failed. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Import fixes for review</h2>
      <p className="text-sm text-muted">
        Upload an HTML snapshot with issues and proposed fixes as JSON. Each candidate is checked
        with axe-core before it can be included in a PR. For shipping, include a repository and
        source file mappings.
      </p>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Scan JSON
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          aria-describedby={error ? "import-error" : undefined}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="min-h-11 rounded-md border p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {error && (
        <p id="import-error" role="alert" className="break-words text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!file || busy}>
          {busy ? "Validating fixes…" : "Import and validate"}
        </Button>
        <a
          href={`${API_BASE_URL}/docs#/default/import_scan_scans_import_post`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-brand underline underline-offset-2"
        >
          JSON format (opens in a new tab)
        </a>
      </div>
    </form>
  );
}
