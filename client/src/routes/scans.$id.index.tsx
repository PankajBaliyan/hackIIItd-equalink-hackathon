import { createFileRoute } from "@tanstack/react-router";
import { LiveScan } from "@/components/scan/LiveScan";

export const Route = createFileRoute("/scans/$id/")({
  head: () => ({
    meta: [
      { title: "Live Scan · EquaLink" },
      { name: "description", content: "EquaLink Live Scan — autonomous accessibility agent." },
      { property: "og:title", content: "Live Scan · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink Live Scan — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  const { id } = Route.useParams();
  return <LiveScan id={id} />;
}
