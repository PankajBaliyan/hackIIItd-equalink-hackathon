import { createFileRoute } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";

export const Route = createFileRoute("/integrations/github")({
  head: () => ({
    meta: [
      { title: "GitHub · EquaLink" },
      { name: "description", content: "EquaLink GitHub — autonomous accessibility agent." },
      { property: "og:title", content: "GitHub · EquaLink" },
      { property: "og:description", content: "EquaLink GitHub — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ComingSoon
      icon={Github}
      title="GitHub integration"
      summary="Install the EquaLink GitHub App so fixes arrive as pull requests."
      points={[
        "Scoped permissions: contents and pull requests only",
        "Every fix is a reviewed PR, never a direct commit",
        "Pick which repositories EquaLink can open PRs on",
      ]}
    />
  );
}
