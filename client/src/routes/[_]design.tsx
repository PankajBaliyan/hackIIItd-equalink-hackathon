import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { PrimitivesShowcase } from "@/components/design/PrimitivesShowcase";
import { FocusHeading } from "@/components/shell/PagePlaceholder";

export const Route = createFileRoute("/_design")({
  head: () => ({
    meta: [
      { title: "Design system · EquaLink" },
      { name: "description", content: "EquaLink design tokens, type scale and components." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Design system · EquaLink" },
      { property: "og:description", content: "EquaLink design tokens, type scale and components." },
    ],
  }),
  component: DesignPage,
});

const swatches = [
  "bg",
  "surface",
  "surface-2",
  "border-c",
  "text",
  "muted-c",
  "accent-c",
  "accent-2",
  "ring-c",
  "critical",
  "serious",
  "moderate",
  "minor",
  "success",
];

function lum(hex: string) {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return 0;
  const [r, g, b] = m.map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const ratio = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((l1 ?? 0) + 0.05) / ((l2 ?? 0) + 0.05);
};

function useTokens() {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setVals(Object.fromEntries(swatches.map((s) => [s, cs.getPropertyValue(`--${s}`).trim()])));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return vals;
}

const sev = [
  { k: "Critical", c: "text-critical", I: AlertOctagon },
  { k: "Serious", c: "text-serious", I: AlertTriangle },
  { k: "Moderate", c: "text-moderate", I: AlertCircle },
  { k: "Minor", c: "text-minor", I: Info },
  { k: "Validated", c: "text-success", I: CheckCircle2 },
];

function DesignPage() {
  const t = useTokens();
  return (
    <div className="space-y-12">
      <header className="space-y-2">
        <FocusHeading className="text-4xl outline-none">
          <span className="text-brand-gradient">Design system</span>
        </FocusHeading>
        <p className="text-muted">Toggle the theme in the top bar to review both modes.</p>
      </header>

      <section aria-labelledby="pal" className="space-y-4">
        <h2 id="pal" className="text-2xl">
          Palette
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {swatches.map((s) => {
            const v = t[s] ?? "";
            const vsBg = v && t["bg"] ? ratio(v, t["bg"]).toFixed(2) : "–";
            const vsSurface = v && t["surface"] ? ratio(v, t["surface"]).toFixed(2) : "–";
            return (
              <li key={s} className="overflow-hidden rounded-card border bg-surface">
                <div className="h-16 border-b" style={{ background: `var(--${s})` }} />
                <div className="space-y-0.5 p-3 font-mono text-xs">
                  <p className="font-medium text-text">--{s.replace(/-c$/, "")}</p>
                  <p className="text-muted">{v}</p>
                  <p className="tabular text-muted">
                    bg {vsBg}:1 · surface {vsSurface}:1
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted">
          Accent with white text:{" "}
          <span className="tabular">
            {t["accent-c"] ? ratio(t["accent-c"], "#ffffff").toFixed(2) : "–"}:1
          </span>
        </p>
      </section>

      <section aria-labelledby="sev" className="space-y-4">
        <h2 id="sev" className="text-2xl">
          Severity
        </h2>
        <ul className="flex flex-wrap gap-2">
          {sev.map(({ k, c, I }) => (
            <li
              key={k}
              className={`inline-flex items-center gap-1.5 rounded-chip border bg-surface px-2.5 py-1 text-sm font-medium ${c}`}
            >
              <I aria-hidden className="size-4" /> {k}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="type" className="space-y-4">
        <h2 id="type" className="text-2xl">
          Type scale
        </h2>
        <div className="space-y-2 rounded-card border bg-surface p-6">
          {(
            [
              "text-4xl",
              "text-3xl",
              "text-2xl",
              "text-xl",
              "text-lg",
              "text-base",
              "text-sm",
              "text-xs",
            ] as const
          ).map((c) => (
            <p key={c} className={c}>
              <span className="font-mono text-xs text-muted">{c} </span>Scan, diagnose, fix, verify.
            </p>
          ))}
          <p className="font-mono text-sm text-muted">
            button.cta &gt; svg[aria-hidden="true"] — Geist Mono
          </p>
        </div>
      </section>

      <section aria-labelledby="rad" className="space-y-4">
        <h2 id="rad" className="text-2xl">
          Radii
        </h2>
        <div className="flex flex-wrap gap-4">
          {[
            ["chip 8", "rounded-chip"],
            ["input 10", "rounded-md"],
            ["card 14", "rounded-card"],
            ["pill", "rounded-full"],
          ].map(([l, c]) => (
            <div
              key={l}
              className={`grid h-16 w-28 place-items-center border bg-surface-2 text-sm text-muted ${c}`}
            >
              {l}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="cmp" className="space-y-4">
        <h2 id="cmp" className="text-2xl">
          Components
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg shadow-[0_8px_24px_-8px_var(--accent-c)] transition-transform duration-fast hover:-translate-y-px"
          >
            Start scan
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
          >
            Secondary
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md px-4 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text"
          >
            Ghost
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Accessibility score", "92"],
            ["Issues found", "37"],
            ["Fixes validated", "31"],
          ].map(([l, v]) => (
            <article key={l} className="rounded-card border bg-surface p-5 shadow-soft">
              <h3 className="text-sm font-medium text-muted">{l}</h3>
              <p className="tabular mt-2 text-3xl font-semibold">{v}</p>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="prim" className="space-y-6">
        <h2 id="prim" className="text-2xl">
          UI primitives
        </h2>
        <PrimitivesShowcase />
      </section>
    </div>
  );
}
