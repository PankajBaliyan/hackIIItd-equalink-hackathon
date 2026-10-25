import { createFileRoute } from "@tanstack/react-router";

import { DocHeader, PageToc, Section, Table } from "@/components/guide/parts";

export const Route = createFileRoute("/docs/api")({
  head: () => ({
    meta: [
      { title: "API & setup · EquaLink" },
      { name: "description", content: "EquaLink API routes and environment variables." },
      { property: "og:title", content: "API & setup · EquaLink" },
      { property: "og:description", content: "EquaLink API routes and environment variables." },
    ],
  }),
  component: Page,
});

const SECTIONS = [
  ["api", "API reference"],
  ["env", "Environment variables"],
] as const;

const ENDPOINTS = [
  ["POST", "/scans", 'Start a scan. Body: url (or target: "repo" with repo), level, scope.'],
  ["GET", "/scans", "List scans."],
  ["GET", "/scans/{id}", "Scan state: issues, fixes, score, PR."],
  ["GET", "/scans/{id}/events", "Server-Sent Events stream of progress."],
  ["POST", "/scans/{id}/ship", "Open a PR from validated fixes."],
  ["GET", "/rule-docs", "List reference documents."],
  ["POST", "/rule-docs", "Add one document or a list. Body: title, content, source_url?."],
  ["DELETE", "/rule-docs/{id}", "Remove a document."],
] as const;

const ENV = [
  ["VITE_USE_MOCKS", "true runs the dashboard on built-in mock data"],
  ["VITE_API_BASE_URL", "Backend base URL, default http://localhost:8000"],
  ["TINYFISH_API_KEY", "Backend: TinyFish remote browser for scans, and the W3C rules sync"],
  ["SCAN_ENGINE", "auto (default), tinyfish or local. auto uses TinyFish for public URLs"],
  ["OPENAI_API_KEY", "Backend: OpenAI review in repo scans (and fixes, later)"],
  ["GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET", "Backend: GitHub App"],
] as const;

function Page() {
  return (
    <>
      <DocHeader
        title="API & setup"
        intro="Routes the backend exposes and the variables it needs."
      />
      <PageToc sections={SECTIONS} />
      <Section id="api" title="API reference">
        <Table head={["Method", "Route", "Purpose"]} rows={ENDPOINTS} />
        <p className="text-sm text-muted">
          Each SSE event has <code className="font-mono">stage</code>,{" "}
          <code className="font-mono">message</code>, <code className="font-mono">type</code> and an
          optional <code className="font-mono">counters</code> and{" "}
          <code className="font-mono">issue</code>.
        </p>
      </Section>

      <Section id="env" title="Environment variables">
        <Table head={["Variable", "Purpose"]} rows={ENV} />
      </Section>
    </>
  );
}
