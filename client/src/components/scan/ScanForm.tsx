import { useNavigate } from "@tanstack/react-router";
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
import { useScanStore } from "@/state/scanStore";

/** Returns a normalized http(s) URL, or an error message. Bare domains get https://. */
export function parseScanUrl(raw: string): { url: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: "Enter the URL you want to scan." };
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

export function ScanForm() {
  const navigate = useNavigate();
  const { startScan } = useScanStore();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string>();
  const [level, setLevel] = useState<Scan["level"]>("AA");
  const [scope, setScope] = useState<Scan["scope"]>("page");
  const [repo, setRepo] = useState("");
  const [repoError, setRepoError] = useState<string>();
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const repoConnected = repo.trim() !== "" && REPO_RE.test(repo.trim());

  const validateUrl = () => {
    if (!url.trim()) return setUrlError(undefined);
    const r = parseScanUrl(url);
    setUrlError("error" in r ? r.error : undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseScanUrl(url);
    const repoBad = repo.trim() !== "" && !REPO_RE.test(repo.trim());
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
        url: parsed.url,
        level,
        scope,
        ...(repoConnected && { repo: repo.trim() }),
        auto_ship: auto,
      });
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

      <div className="space-y-2">
        <TextField
          id="scan-repo"
          label="GitHub repo (optional)"
          placeholder="owner/repo"
          autoComplete="off"
          spellCheck={false}
          hint="Connect a repo so validated fixes can be opened as a pull request."
          value={repo}
          error={repoError}
          onChange={(e) => {
            setRepo(e.target.value);
            if (repoError) setRepoError(undefined);
          }}
        />
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
        {busy ? "Starting scan…" : "Scan with TinyFish →"}
      </Button>
    </form>
  );
}
