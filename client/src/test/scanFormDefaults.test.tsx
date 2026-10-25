import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScanForm } from "@/components/scan/ScanForm";
import { ScanStoreProvider } from "@/state/scanStore";

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({
  settingsApi: { get: m.get },
  sitesApi: { list: async () => [] },
  getApi: async () => ({ getGithub: async () => ({ connected: false, repos: [] }) }),
}));

const saved = (level: string, scope: string) => ({
  values: { default_level: level, default_scope: scope },
});

async function renderForm() {
  const root = createRootRoute({
    component: () => (
      <ScanStoreProvider>
        <ScanForm />
      </ScanStoreProvider>
    ),
  });
  const routes = ["/", "/integrations/github", "/scans/$id"].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Start a scan" });
  return client;
}

const checked = (name: string) =>
  screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";

beforeEach(() => {
  m.get.mockReset(); // not returned: Vitest would run a returned function as cleanup after each test
});

describe("New Scan form defaults", () => {
  it("starts from the level and scope saved in Settings", async () => {
    m.get.mockResolvedValue(saved("AAA", "site"));
    await renderForm();
    await waitFor(() => expect(checked("AAA")).toBe(true));
    expect(checked("Full site")).toBe(true);
  });

  it("falls back to AA and a single page when the settings can't be loaded", async () => {
    m.get.mockRejectedValue(new Error("offline"));
    const client = await renderForm();
    await waitFor(() => expect(client.getQueryState(["settings"])?.status).toBe("error"));
    expect(checked("AA")).toBe(true);
    expect(checked("Single page")).toBe(true);
    expect(screen.getByRole("button", { name: /Scan website/ })).toBeEnabled();
  });

  it("starts on AA and a single page, usable, while the settings are still loading", async () => {
    m.get.mockImplementation(() => new Promise(() => {})); // the server is slow
    await renderForm();
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    expect(checked("AA")).toBe(true);
    expect(checked("Single page")).toBe(true);
  });

  it("does not overwrite a choice the person already made when the settings change underneath", async () => {
    m.get.mockResolvedValue(saved("AAA", "page"));
    const client = await renderForm();
    await waitFor(() => expect(checked("AAA")).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "A" }));
    client.setQueryData(["settings"], saved("AA", "site")); // saved elsewhere meanwhile
    await waitFor(() => expect(checked("Full site")).toBe(true)); // scope was not touched, so it follows
    expect(checked("A")).toBe(true); // level was chosen here, so it stays
  });
});
