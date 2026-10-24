import { createFileRoute } from "@tanstack/react-router";
import { Workflow } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";

export const Route = createFileRoute("/integrations/ci")({
  head: () => ({
    meta: [
      { title: "CI / GitHub Action · EquaLink" },
      {
        name: "description",
        content: "EquaLink CI / GitHub Action — autonomous accessibility agent.",
      },
      { property: "og:title", content: "CI / GitHub Action · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink CI / GitHub Action — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ComingSoon
      icon={Workflow}
      title="CI / GitHub Action"
      summary="Block accessibility regressions before they merge."
      points={[
        "Run EquaLink on every pull request",
        "Fail the build below a score or severity threshold",
        "SARIF output for GitHub code scanning",
      ]}
    />
  );
}
