import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Github, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { LabeledSwitch } from "@/components/ui/labeled-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import type { Scan } from "@/lib/types";
import { useGithub } from "@/lib/useGithub";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sitesApi } from "@/lib/api";
import { useScanStore } from "@/state/scanStore";

/** Returns a normalized http(s) URL, or an error message. Bare domains get https://. */
export function parseScanUrl(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter the URL you want to scan." };
  if (/\s/.test(v)) return { error: "That doesn't look like a valid URL." };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { error: "Only http and https URLs can be scanned." };
    }
    if (!u.hostname.includes(".") && u.hostname !== "localhost") {
      return { error: "Enter a full address, for example https://shopeasy.dev." };
    }
    return { url: u.toString() };
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function ScanForm({
  initialUrl = "",
  initialRepo = "",
}: {
  initialUrl?: string;
  initialRepo?: string;
}) {
  const navigate = useNavigate();
  const { startScan } = useScanStore();
  const [target, setTarget] = useState<"site" | "repo">("site");
  const [url, setUrl] = useState(initialUrl);
  const [urlError, setUrlError] = useState<string>();
  const [level, setLevel] = useState<Scan["level"]>("AA");
  const [scope, setScope] = useState<Scan["scope"]>("page");
  const [repo, setRepo] = useState(initialRepo);
  const [repoError, setRepoError] = useState<string>();
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data: gh } = useGithub();
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: sitesApi.list, retry: false });
  const suggestions = gh?.connected ? gh.repos.filter((r) => r.enabled) : [];

  const repoConnected = repo.trim() !== "" && REPO_RE.test(repo.trim());

  const validateUrl = () => {
    if (!url.trim()) return setUrlError(undefined);
    const r = parseScanUrl(url);
    setUrlError("error" in r ? r.error : undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const repoScan = target === "repo";
    const parsed = repoScan ? { url: "" } : parseScanUrl(url);
    const repoBad = repoScan ? !repoConnected : repo.trim() !== "" && !REPO_RE.test(repo.trim());
    setUrlError("error" in parsed ? parsed.error : undefined);
    setRepoError(repoBad ? "Use the format owner/repo." : undefined);
    if ("error" in parsed || repoBad) {
      // Move focus to the first invalid field so keyboard and screen reader users land on it.
      document.getElementById("scan-url")?.focus();
      if (!("error" in parsed)) document.getElementById("scan-repo")?.focus();
      return;
    }
    setBusy(true);
    try {
      const scan = await startScan({
        ...(repoScan ? { target: "repo" as const } : { url: parsed.url }),
        level,
        scope,
        ...(repoConnected && { repo: repo.trim() }),
        auto_ship: auto,
      });
      void qc.invalidateQueries({ queryKey: ["scans"] });
      await navigate({ to: "/scans/$id", params: { id: scan.id } });
    } catch (err) {
      toast.error("Couldn't start the scan", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="scan-form-title"
      className="space-y-5 rounded-card border bg-surface p-5 shadow-soft sm:p-6"
    >
      <h2 id="scan-form-title" className="text-xl">
        Start a scan
      </h2>

      <SegmentedControl
        label="What to scan"
        value={target}
        onValueChange={setTarget}
        options={[
          { value: "site", label: "Website" },
          { value: "repo", label: "GitHub repo" },
        ]}
      />

      {target === "site" && sites && sites.length > 0 && (
        <label className="block space-y-1.5 text-sm font-medium">
          <span className="block">Your sites</span>
          <select
            value=""
            onChange={(e) => {
              const site = sites.find((x) => String(x.id) === e.target.value);
              if (!site) return;
              setUrl(site.url);
              setUrlError(undefined);
              if (site.repo) setRepo(site.repo);
            }}
            className="min-h-11 w-full rounded-md border bg-surface px-2 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 sm:text-sm"
          >
            <option value="">Choose a saved site…</option>
            {sites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.host}
                {x.repo ? ` (${x.repo})` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {target === "site" && (
        <TextField
          id="scan-url"
          label="Website URL"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://shopeasy.dev"
          hint="Paste any public page. We'll add https:// if you leave it out."
          value={url}
          error={urlError}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) setUrlError(undefined);
          }}
          onBlur={validateUrl}
        />
      )}

      {target === "site" && (
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <SegmentedControl
            label="WCAG level"
            value={level}
            onValueChange={setLevel}
            options={[
              { value: "A", label: "A" },
              { value: "AA", label: "AA" },
              { value: "AAA", label: "AAA" },
            ]}
          />
          <SegmentedControl
            label="Scope"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "page", label: "Single page" },
              { value: "site", label: "Full site" },
            ]}
          />
        </div>
      )}

      <div className="space-y-2">
        <TextField
          id="scan-repo"
          list="scan-repo-options"
          label={target === "repo" ? "GitHub repo" : "GitHub repo (optional)"}
          placeholder="owner/repo"
          autoComplete="off"
          spellCheck={false}
          hint={
            target === "repo"
              ? "We read the repo's HTML, JSX, TSX, Vue, Svelte and Astro files and report each issue with its file and line. Private repos need GitHub connected."
              : "Connect a repo so validated fixes can be opened as a pull request."
          }
          value={repo}
          error={repoError}
          onChange={(e) => {
            setRepo(e.target.value);
            if (repoError) setRepoError(undefined);
          }}
        />
        <datalist id="scan-repo-options">
          {suggestions.map((r) => (
            <option key={r.full_name} value={r.full_name} />
          ))}
        </datalist>
        {gh && !gh.connected && (
          <p className="text-sm text-muted">
            GitHub isn&apos;t connected.{" "}
            <Link
              to="/integrations/github"
              className="text-text underline underline-offset-2 hover:text-brand-2"
            >
              Connect it
            </Link>{" "}
            to pick from your repositories.
          </p>
        )}
        {repoConnected && (
          <p className="flex items-center gap-2" role="status">
            <Chip className="gap-1.5 text-success">
              <Check aria-hidden className="size-3.5" />
              <Github aria-hidden className="size-3.5" />
              Connected: {repo.trim()}
            </Chip>
            <button
              type="button"
              onClick={() => setRepo("")}
              className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
            >
              <X aria-hidden className="size-3.5" /> Disconnect
            </button>
          </p>
        )}
      </div>

      <LabeledSwitch
        label="Auto-open PR when done"
        description="Ships validated fixes as a pull request. Never a direct commit."
        checked={auto}
        onCheckedChange={setAuto}
        disabled={!repoConnected}
      />

      <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" loading={busy}>
        {busy ? "Starting scan…" : target === "repo" ? "Scan repo →" : "Scan with TinyFish →"}
      </Button>
    </form>
  );
}
