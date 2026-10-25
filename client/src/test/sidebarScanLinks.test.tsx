import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavList } from "@/components/shell/AppShell";

let scans: { id: string }[] = [];
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  getApi: async () => ({ listScans: async () => scans }),
}));

async function renderNav() {
  const root = createRootRoute({ component: () => <NavList /> });
  const paths = [
    "/",
    "/scans/$id",
    "/scans/$id/fixes",
    "/pull-requests",
    "/history",
    "/reports",
    "/sites",
    "/integrations/github",
    "/integrations/ci",
    "/settings",
    "/docs",
  ];
  const router = createRouter({
    routeTree: root.addChildren(
      paths.map((path) => createRoute({ getParentRoute: () => root, path, component: () => null })),
    ),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("navigation", { name: "Primary" });
}

describe("sidebar links that open a scan", () => {
  beforeEach(() => {
    scans = [];
  });

  it("are disabled, not links to a made-up scan, until a scan exists", async () => {
    await renderNav();
    for (const name of [/Live Scan/, /Fixes/]) {
      const item = screen.getByRole("link", { name });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).not.toHaveAttribute("href");
      expect(item).toHaveTextContent("run a scan first");
    }
    expect(document.querySelector('a[href*="demo"]')).toBeNull();
    // Everything else is still a normal link.
    expect(screen.getByRole("link", { name: "New Scan" })).toHaveAttribute("href", "/");
  });

  it("point at the most recent scan once one exists", async () => {
    scans = [{ id: "scan_latest" }, { id: "scan_older" }];
    await renderNav();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Live Scan/ })).toHaveAttribute(
        "href",
        "/scans/scan_latest",
      ),
    );
    expect(screen.getByRole("link", { name: /Fixes/ })).toHaveAttribute(
      "href",
      "/scans/scan_latest/fixes",
    );
    expect(screen.getByRole("link", { name: /Live Scan/ })).not.toHaveAttribute("aria-disabled");
  });
});
