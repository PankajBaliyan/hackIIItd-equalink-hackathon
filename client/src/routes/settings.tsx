import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Github } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { LabeledSwitch } from "@/components/ui/labeled-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import {
  API_BASE_URL,
  ENV_API_BASE_URL,
  ENV_USE_MOCKS,
  USE_MOCKS,
  saveConnectionOverride,
  settingsApi,
} from "@/lib/api";
import type { ServerInfo, SettingsResponse, SettingsValues } from "@/lib/types";
import { applyMotionPref, readMotionPref, useTheme } from "@/lib/theme";
import { parseRules } from "@/lib/parseRules";
import { useGithub } from "@/lib/useGithub";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · EquaLink" },
      { name: "description", content: "EquaLink scan settings, server status and appearance." },
      { property: "og:title", content: "Settings · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink scan settings, server status and appearance.",
      },
    ],
  }),
  component: Page,
});

const KEY = ["settings"];

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-card border bg-surface p-5">
      <div className="space-y-1">
        <h2 id={id} className="text-xl">
          {title}
        </h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const sameValues = (a: SettingsValues, b: SettingsValues) =>
  JSON.stringify(a) === JSON.stringify(b);

const SEVERITY_OPTIONS: [SettingsValues["min_severity"], string][] = [
  ["minor", "All issues (minor and above)"],
  ["moderate", "Moderate and above"],
  ["serious", "Serious and above"],
  ["critical", "Critical only"],
];

/** Whole-number field check that mirrors the server's, so mistakes show before saving. */
function intError(text: string, lo: number, hi: number): string | undefined {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= lo && n <= hi
    ? undefined
    : `Enter a whole number from ${lo} to ${hi}.`;
}

function ScanSettings({ data }: { data: SettingsResponse }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<SettingsValues>(data.values);
  const [pages, setPages] = useState(String(data.values.max_site_pages));
  const [fixes, setFixes] = useState(String(data.values.fix_max));
  const [rules, setRules] = useState(data.values.disabled_rules.join("\n"));
  const [error, setError] = useState<string>();
  const rulesId = useId();

  // A save (or reset) returns fresh values: show exactly what the server now has.
  useEffect(() => {
    setDraft(data.values);
    setPages(String(data.values.max_site_pages));
    setFixes(String(data.values.fix_max));
    setRules(data.values.disabled_rules.join("\n"));
  }, [data]);

  const current: SettingsValues = {
    ...draft,
    max_site_pages: Number(pages),
    fix_max: Number(fixes),
    disabled_rules: parseRules(rules),
  };
  const pagesError = intError(pages, 1, 100);
  const fixesError = intError(fixes, 0, 100);
  const dirty = !sameValues(current, data.values);

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(current) as (keyof SettingsValues)[]) {
        if (JSON.stringify(current[k]) !== JSON.stringify(data.values[k])) patch[k] = current[k];
      }
      return settingsApi.update(patch);
    },
    onSuccess: (res) => {
      qc.setQueryData(KEY, res);
      setError(undefined);
      toast.success("Settings saved", { description: "They apply to the next scan you start." });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save the settings."),
  });
  const reset = useMutation({
    mutationFn: settingsApi.reset,
    onSuccess: (res) => {
      qc.setQueryData(KEY, res);
      setError(undefined);
      toast.success("Back to the server defaults");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't reset the settings."),
  });

  const set = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const aiOff = !data.server.openai.configured;

  return (
    <form
      aria-label="Scan settings"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!pagesError && !fixesError && dirty) save.mutate();
      }}
      className="space-y-6"
    >
      <Section
        id="s-scanning"
        title="Scanning"
        description="What a new scan starts with, and what it reports. Applies to every scan you start after saving."
      >
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <SegmentedControl
            label="Default WCAG level"
            value={draft.default_level}
            onValueChange={(v) => set("default_level", v)}
            options={[
              { value: "A", label: "A" },
              { value: "AA", label: "AA" },
              { value: "AAA", label: "AAA" },
            ]}
          />
          <SegmentedControl
            label="Default scope"
            value={draft.default_scope}
            onValueChange={(v) => set("default_scope", v)}
            options={[
              { value: "page", label: "Single page" },
              { value: "site", label: "Full site" },
            ]}
          />
        </div>
        <TextField
          label="Pages per full-site scan"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={pages}
          error={pagesError}
          hint="A full-site scan stops after this many pages. More pages take longer."
          onChange={(e) => setPages(e.target.value)}
          className="max-w-40"
        />
        <label className="block max-w-sm space-y-1.5 text-sm font-medium">
          <span className="block">Report issues that are</span>
          <select
            value={draft.min_severity}
            onChange={(e) => set("min_severity", e.target.value as SettingsValues["min_severity"])}
            className="min-h-11 w-full rounded-md border bg-surface px-2 text-base font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 sm:text-sm"
          >
            {SEVERITY_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1.5">
          <label htmlFor={rulesId} className="text-sm font-medium">
            Rules to skip
          </label>
          <textarea
            id={rulesId}
            aria-describedby={`${rulesId}-hint`}
            rows={3}
            spellCheck={false}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder={"color-contrast\nregion"}
            className="w-full rounded-md border bg-surface px-3 py-2 font-mono text-base placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
          <p id={`${rulesId}-hint`} className="text-sm text-muted">
            One rule id per line, like <code className="font-mono">image-alt</code>. These are never
            recorded, so they don&apos;t count towards the score.
          </p>
        </div>
      </Section>

      <Section
        id="s-ai"
        title="AI"
        description="OpenAI reads the page for what axe-core can't see and proposes fixes that axe-core then checks."
      >
        {aiOff ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-card border border-moderate p-3 text-sm"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-moderate" />
            <span>
              <code className="font-mono">OPENAI_API_KEY</code> isn&apos;t set on the server, so
              scans skip the AI review and propose no fixes whatever these switches say. Add the key
              to <code className="font-mono">server/.env</code> and restart the server.
            </span>
          </p>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 aria-hidden className="size-4" /> OpenAI key is set on the server.
          </p>
        )}
        <LabeledSwitch
          label="AI review of pages and code"
          description="Finds problems axe-core and the static rules can't, like vague link text."
          checked={draft.ai_review}
          onCheckedChange={(v) => set("ai_review", v)}
        />
        <LabeledSwitch
          label="Propose fixes"
          description="Writes a fix for each issue and keeps only the ones axe-core confirms."
          checked={draft.ai_fixes}
          onCheckedChange={(v) => set("ai_fixes", v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="OpenAI model"
            spellCheck={false}
            value={draft.openai_model}
            hint={`Server default: ${data.defaults.openai_model}`}
            onChange={(e) => set("openai_model", e.target.value)}
          />
          <TextField
            label="Fixes per scan"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={fixes}
            error={fixesError}
            hint="Worst issues first. 0 proposes none."
            onChange={(e) => setFixes(e.target.value)}
          />
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={!dirty || !!pagesError || !!fixesError}
        >
          Save settings
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => reset.mutate()}
          loading={reset.isPending}
          disabled={data.changed.length === 0}
        >
          Reset to server defaults
        </Button>
        {data.changed.length > 0 && (
          <Chip>
            {data.changed.length} changed from the default{data.changed.length === 1 ? "" : "s"}
          </Chip>
        )}
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-critical">
            <span aria-hidden>✗</span> {error}
          </p>
        )}
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

const yesNo = (ok: boolean, yes: string, no: string) => (
  <Chip className={ok ? "text-success" : "text-moderate"}>{ok ? yes : no}</Chip>
);

const ENGINE: Record<ServerInfo["scan_engine"], string> = {
  auto: "Automatic (TinyFish for public URLs, local Chromium otherwise)",
  tinyfish: "Always TinyFish",
  local: "Always local Chromium",
};

function ServerStatus({ info }: { info: ServerInfo }) {
  const { data: gh } = useGithub();
  return (
    <Section
      id="s-server"
      title="Server"
      description="How the server was started. These come from server/.env and need a restart to change."
    >
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <Row label="OpenAI">
          {yesNo(info.openai.configured, "Key set", "No key: AI review and fixes are off")}
        </Row>
        <Row label="TinyFish">
          {yesNo(info.tinyfish.configured, "Key set", "No key: scans use local Chromium")}
        </Row>
        <Row label="Scan engine">{ENGINE[info.scan_engine]}</Row>
        <Row label="Private addresses">
          {info.allow_private_targets
            ? "Allowed (localhost and private networks can be scanned)"
            : "Blocked"}
        </Row>
        <Row label="Screenshots">Up to {info.screenshot_max_height}px tall</Row>
        <Row label="Repo scans">
          Up to {info.source_max_files} files read, {info.source_llm_max_files} reviewed by AI
        </Row>
        <Row label="W3C rules sync">
          {info.w3c_sync.schedule
            ? `Every ${info.w3c_sync.interval_days} days once started`
            : "Only when you press Sync now"}
        </Row>
        <Row label="GitHub">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Github aria-hidden className="size-4" />
            {gh?.connected ? `Connected as ${gh.account}` : "Not connected"}
            {info.github.mode === "none" && !gh?.connected && (
              <span className="text-muted">(sign-in isn&apos;t configured on the server)</span>
            )}
            <Link
              to="/integrations/github"
              className="text-text underline underline-offset-2 hover:text-brand-2"
            >
              {gh?.connected ? "Manage" : "Connect"}
            </Link>
          </span>
        </Row>
      </dl>
    </Section>
  );
}

function Connection() {
  // Read after mount: the saved override only exists in the browser, so the server render can't know it.
  const [now, setNow] = useState<{ url: string; mocks: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [mocks, setMocks] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setNow({ url: API_BASE_URL, mocks: USE_MOCKS });
    setUrl(API_BASE_URL);
    setMocks(USE_MOCKS);
  }, []);

  const save = () => {
    let clean = url.trim().replace(/\/+$/, "");
    try {
      const u = new URL(clean);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      clean = u.origin + u.pathname.replace(/\/+$/, "");
    } catch {
      return setError("Enter the full address, for example http://localhost:8000.");
    }
    saveConnectionOverride({
      apiUrl: clean === ENV_API_BASE_URL ? undefined : clean,
      mocks: mocks === ENV_USE_MOCKS ? undefined : mocks,
    });
    window.location.reload();
  };
  const useBuild = () => {
    saveConnectionOverride({});
    window.location.reload();
  };
  const changed = now && (url.trim() !== now.url || mocks !== now.mocks);
  const overridden = now && (now.url !== ENV_API_BASE_URL || now.mocks !== ENV_USE_MOCKS);

  return (
    <Section
      id="s-api"
      title="API connection"
      description="Where this dashboard talks to the server. Saved in this browser only; the page reloads to apply it."
    >
      {now ? (
        <>
          <TextField
            label="API base URL"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={url}
            error={error}
            hint={`This build's default: ${ENV_API_BASE_URL}`}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(undefined);
            }}
          />
          <LabeledSwitch
            label="Use demo data"
            description={
              mocks
                ? "Scans, fixes and history are built-in samples, not from the server."
                : "Everything comes from the server. Turn on to try the dashboard without one."
            }
            checked={mocks}
            onCheckedChange={setMocks}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" onClick={save} disabled={!changed}>
              Save and reload
            </Button>
            <Button type="button" variant="ghost" onClick={useBuild} disabled={!overridden}>
              Use this build&apos;s defaults
            </Button>
            <Chip className={now.mocks ? "text-moderate" : "text-success"}>
              {now.mocks ? "Demo data" : "Live backend"}
            </Chip>
          </div>
        </>
      ) : (
        <Skeleton className="h-32 w-full rounded-card" />
      )}
    </Section>
  );
}

function Page() {
  const { theme, toggle } = useTheme();
  const [reduce, setReduce] = useState(() => readMotionPref() === "reduce");
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: settingsApi.get,
    retry: false,
  });
  const body = useMemo(
    () =>
      isPending ? (
        <Skeleton
          role="status"
          aria-label="Loading settings"
          className="h-64 w-full rounded-card"
        />
      ) : isError || !data ? (
        <EmptyState
          title="Couldn't load the server's settings"
          description="Check that the server is running and the API address below is right."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <ScanSettings data={data} />
          <ServerStatus info={data.server} />
        </>
      ),
    [data, isPending, isError, refetch],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FocusHeading className="text-3xl font-semibold outline-none">Settings</FocusHeading>

      {body}

      <Section id="s-appearance" title="Appearance">
        <SegmentedControl
          label="Theme"
          value={theme}
          onValueChange={(v) => v !== theme && toggle()}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
          ]}
        />
        <LabeledSwitch
          label="Reduce motion"
          description="Turns off animations even if your system allows them."
          checked={reduce}
          onCheckedChange={(v) => {
            setReduce(v);
            applyMotionPref(v ? "reduce" : "system");
          }}
        />
      </Section>

      <Connection />
    </div>
  );
}
