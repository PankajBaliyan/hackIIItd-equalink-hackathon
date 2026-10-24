import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { LabeledSwitch } from "@/components/ui/labeled-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";

export const Route = createFileRoute("/integrations/ci")({
  head: () => ({
    meta: [
      { title: "CI / GitHub Action · EquaLink" },
      {
        name: "description",
        content: "Generate a GitHub Actions workflow that blocks accessibility regressions.",
      },
      { property: "og:title", content: "CI / GitHub Action · EquaLink" },
      {
        property: "og:description",
        content: "Generate a GitHub Actions workflow that blocks accessibility regressions.",
      },
    ],
  }),
  component: Page,
});

interface Cfg {
  url: string;
  level: "A" | "AA" | "AAA";
  minScore: number;
  failOn: "critical" | "serious" | "moderate" | "none";
  openPr: boolean;
  branch: string;
}
const DEFAULTS: Cfg = {
  url: "https://staging.example.com",
  level: "AA",
  minScore: 85,
  failOn: "serious",
  openPr: false,
  branch: "main",
};
const KEY = "equalink-ci-config";

function yaml(c: Cfg): string {
  return `name: Accessibility
on:
  pull_request:
    branches: [${c.branch}]

permissions:
  contents: read
  pull-requests: write

jobs:
  equalink:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: EquaLink scan
        uses: ./.github/actions/equalink
        with:
          url: ${c.url}
          level: ${c.level}
          min-score: ${c.minScore}
          fail-on: ${c.failOn}
          open-pr: ${c.openPr}
        env:
          EQUALINK_API_KEY: \${{ secrets.EQUALINK_API_KEY }}
`;
}

function Page() {
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setCfg({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Cfg>) });
    } catch {
      /* storage unavailable or corrupt */
    }
  }, []);
  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) =>
    setCfg((prev) => {
      const next = { ...prev, [k]: v };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  const code = useMemo(() => yaml(cfg), [cfg]);
  const scoreOk = Number.isInteger(cfg.minScore) && cfg.minScore >= 0 && cfg.minScore <= 100;
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "equalink.yml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <FocusHeading className="text-3xl font-semibold outline-none">
          CI / GitHub Action
        </FocusHeading>
        <p className="text-muted">
          Block accessibility regressions before they merge. Configure, copy the workflow, commit
          it.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          aria-label="Workflow settings"
          onSubmit={(e) => e.preventDefault()}
          className="space-y-5 rounded-card border bg-surface p-5"
        >
          <TextField
            label="URL to scan"
            value={cfg.url}
            onChange={(e) => set("url", e.target.value)}
            hint="A preview or staging URL that exists when the workflow runs."
          />
          <TextField
            label="Target branch"
            value={cfg.branch}
            onChange={(e) => set("branch", e.target.value)}
          />
          <SegmentedControl
            label="WCAG level"
            value={cfg.level}
            onValueChange={(v) => set("level", v)}
            options={[
              { value: "A", label: "A" },
              { value: "AA", label: "AA" },
              { value: "AAA", label: "AAA" },
            ]}
          />
          <TextField
            label="Minimum score"
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={String(cfg.minScore)}
            error={scoreOk ? undefined : "Enter a whole number from 0 to 100."}
            hint="The check fails when the score is lower."
            onChange={(e) =>
              set("minScore", e.target.value === "" ? Number.NaN : Number(e.target.value))
            }
          />
          <SegmentedControl
            label="Fail on severity"
            value={cfg.failOn}
            onValueChange={(v) => set("failOn", v)}
            options={[
              { value: "critical", label: "Critical" },
              { value: "serious", label: "Serious" },
              { value: "moderate", label: "Moderate" },
              { value: "none", label: "Never" },
            ]}
          />
          <LabeledSwitch
            label="Open a fix PR on failure"
            description="EquaLink proposes validated fixes as a separate pull request."
            checked={cfg.openPr}
            onCheckedChange={(v) => set("openPr", v)}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCfg(DEFAULTS);
              try {
                localStorage.removeItem(KEY);
              } catch {
                /* ignore */
              }
            }}
          >
            Reset to defaults
          </Button>
        </form>

        <section aria-labelledby="ci-out" className="space-y-4">
          <h2 id="ci-out" className="text-xl">
            Workflow
          </h2>
          <CodeBlock code={code} label="workflow YAML" filename=".github/workflows/equalink.yml" />
          <Button variant="secondary" onClick={download}>
            <Download /> Download equalink.yml
          </Button>

          <h2 className="pt-2 text-xl">Setup</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Save the file as <code className="font-mono">.github/workflows/equalink.yml</code>.
            </li>
            <li>
              Add a repository secret named <code className="font-mono">EQUALINK_API_KEY</code>.
            </li>
            <li>
              Open a pull request. EquaLink comments with the score and fails the check if it is
              below your threshold.
            </li>
          </ol>
          <p className="rounded-card border bg-surface p-3 text-sm text-muted">
            The composite action lives in this repository at{" "}
            <code className="font-mono">.github/actions/equalink</code> and has not been built yet.
            This page generates the workflow that will call it.
          </p>
        </section>
      </div>
    </div>
  );
}
