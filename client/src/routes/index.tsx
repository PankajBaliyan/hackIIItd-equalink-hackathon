import { createFileRoute } from "@tanstack/react-router";
import { PipelineGraphic } from "@/components/scan/PipelineGraphic";
import { RecentScans } from "@/components/scan/RecentScans";
import { ScanForm } from "@/components/scan/ScanForm";
import { TrustStrip } from "@/components/scan/TrustStrip";
import { FocusHeading } from "@/components/shell/PagePlaceholder";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "New Scan · EquaLink" },
      { name: "description", content: "EquaLink New Scan — autonomous accessibility agent." },
      { property: "og:title", content: "New Scan · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink New Scan — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <section className="space-y-6 pt-4 text-center">
        <FocusHeading className="text-4xl font-semibold outline-none">
          Don&apos;t just find accessibility bugs.{" "}
          <span className="text-brand-gradient">Ship the fix.</span>
        </FocusHeading>
        <p className="mx-auto max-w-2xl text-lg text-muted">
          EquaLink scans your site, fixes what it finds, proves each fix with a rules engine, and
          opens the pull request for you.
        </p>
        <PipelineGraphic />
      </section>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ScanForm />
        <RecentScans />
      </div>
      <TrustStrip />
    </div>
  );
}
