import { createFileRoute } from "@tanstack/react-router";
import { FixesPage } from "@/components/fixes/FixesPage";

export const Route = createFileRoute("/scans/$id/fixes")({
  head: () => ({
    meta: [
      { title: "Fixes · EquaLink" },
      { name: "description", content: "EquaLink Fixes — autonomous accessibility agent." },
      { property: "og:title", content: "Fixes · EquaLink" },
      { property: "og:description", content: "EquaLink Fixes — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <FixesPage id={id} />;
}
