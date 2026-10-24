import { createFileRoute } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { useState } from "react";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Chip } from "@/components/ui/chip";
import { LabeledSwitch } from "@/components/ui/labeled-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { API_BASE_URL, USE_MOCKS } from "@/lib/api";
import { applyMotionPref, readMotionPref, useTheme } from "@/lib/theme";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · EquaLink" },
      { name: "description", content: "EquaLink appearance and connection settings." },
      { property: "og:title", content: "Settings · EquaLink" },
      { property: "og:description", content: "EquaLink appearance and connection settings." },
    ],
  }),
  component: Page,
});

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-card border bg-surface p-5">
      <h2 id={id} className="text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Page() {
  const { theme, toggle } = useTheme();
  const [reduce, setReduce] = useState(() => readMotionPref() === "reduce");
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <FocusHeading className="text-3xl font-semibold outline-none">Settings</FocusHeading>

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

      <Section id="s-api" title="API">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Base URL</dt>
          <dd className="break-all font-mono">{API_BASE_URL}</dd>
          <dt className="text-muted">Mode</dt>
          <dd>
            <Chip className={USE_MOCKS ? "text-moderate" : "text-success"}>
              {USE_MOCKS ? "Mock data (VITE_USE_MOCKS=true)" : "Live backend"}
            </Chip>
          </dd>
        </dl>
      </Section>

      <Section id="s-github" title="GitHub">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Github aria-hidden className="size-4" /> Not connected. GitHub App installation arrives
          with the backend integration.
        </p>
      </Section>
    </div>
  );
}
