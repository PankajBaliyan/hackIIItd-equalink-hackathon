import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseRules } from "@/lib/parseRules";
import type { GithubStatus, ServerInfo, SettingsResponse, SettingsValues } from "@/lib/types";
import { Route as SettingsRoute } from "@/routes/settings";

const values: SettingsValues = {
  default_level: "AA",
  default_scope: "page",
  max_site_pages: 20,
  fix_max: 30,
  openai_model: "gpt-4.1",
  min_severity: "minor",
  disabled_rules: [],
  ai_review: true,
  ai_fixes: true,
};
const server: ServerInfo = {
  openai: { configured: true, model: "gpt-4.1" },
  tinyfish: { configured: false },
  github: { mode: "oauth" },
  scan_engine: "auto",
  allow_private_targets: true,
  screenshot_max_height: 4000,
  fix_batch: 8,
  source_max_files: 150,
  source_llm_max_files: 40,
  w3c_sync: { schedule: true, interval_days: 30 },
};
const response = (over: Partial<SettingsResponse> = {}): SettingsResponse => ({
  values,
  defaults: values,
  changed: [],
  server,
  ...over,
});

const m = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
  save: vi.fn(),
  github: { connected: false, repos: [] } as GithubStatus,
}));

vi.mock("@/lib/api", () => ({
  API_BASE_URL: "http://localhost:8000",
  ENV_API_BASE_URL: "http://localhost:8000",
  ENV_USE_MOCKS: false,
  USE_MOCKS: false,
  saveConnectionOverride: m.save,
  settingsApi: { get: m.get, update: m.update, reset: m.reset },
  getApi: async () => ({ getGithub: async () => m.github }),
}));

async function renderPage() {
  const root = createRootRoute();
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    component: SettingsRoute.options.component!,
  });
  const github = createRoute({
    getParentRoute: () => root,
    path: "/integrations/github",
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([settings, github]),
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Settings" });
}

beforeEach(() => {
  m.get.mockReset().mockResolvedValue(response());
  m.update.mockReset();
  m.reset.mockReset();
  m.save.mockReset();
  m.github = { connected: false, repos: [] };
});

describe("parseRules", () => {
  it("accepts lines, commas and spaces, lower-cases, de-duplicates and sorts", () => {
    expect(parseRules("Image-Alt\nlabel, region  image-alt\n\n")).toEqual([
      "image-alt",
      "label",
      "region",
    ]);
    expect(parseRules("  ")).toEqual([]);
  });
});

describe("Settings page", () => {
  it("shows the server's configuration, and the real GitHub state instead of the old fixed text", async () => {
    await renderPage();
    const status = await screen.findByRole("region", { name: "Server" });
    expect(within(status).getByText("Key set")).toBeInTheDocument(); // OpenAI
    expect(within(status).getByText(/No key: scans use local Chromium/)).toBeInTheDocument(); // TinyFish
    expect(within(status).getByText(/Automatic \(TinyFish/)).toBeInTheDocument();
    expect(within(status).getByText(/Up to 4000px tall/)).toBeInTheDocument();
    expect(await within(status).findByText("Not connected")).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "Connect" })).toHaveAttribute(
      "href",
      "/integrations/github",
    );
    expect(document.body.textContent).not.toMatch(/arrives with the backend/);
  });

  it("says Connected as <account> when GitHub is connected", async () => {
    m.github = { connected: true, account: "octocat", repos: [] };
    await renderPage();
    const status = await screen.findByRole("region", { name: "Server" });
    expect(await within(status).findByText(/Connected as octocat/)).toBeInTheDocument();
    expect(within(status).getByRole("link", { name: "Manage" })).toBeInTheDocument();
  });

  it("explains why there are no fixes when the OpenAI key is missing", async () => {
    m.get.mockResolvedValue(
      response({ server: { ...server, openai: { configured: false, model: "gpt-4.1" } } }),
    );
    await renderPage();
    const ai = await screen.findByRole("region", { name: "AI" });
    expect(within(ai).getByRole("status")).toHaveTextContent(
      /OPENAI_API_KEY isn't set on the server/,
    );
    expect(within(ai).getByRole("status")).toHaveTextContent(/propose no fixes/);
  });

  it("saves only what changed and shows what the server returns", async () => {
    m.update.mockResolvedValue(
      response({
        values: {
          ...values,
          default_level: "AAA",
          max_site_pages: 7,
          disabled_rules: ["image-alt", "label"],
        },
        changed: ["default_level", "max_site_pages", "disabled_rules"],
      }),
    );
    await renderPage();
    const save = await screen.findByRole("button", { name: "Save settings" });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.click(screen.getByRole("radio", { name: "AAA" }));
    fireEvent.change(screen.getByLabelText("Pages per full-site scan"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Rules to skip"), {
      target: { value: "Image-Alt\nlabel" },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1));
    expect(m.update.mock.calls[0]![0]).toEqual({
      default_level: "AAA",
      max_site_pages: 7,
      disabled_rules: ["image-alt", "label"],
    });
    expect(await screen.findByText(/3 changed from the defaults/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled(),
    );
  });

  it("flags a bad number before it is sent", async () => {
    await renderPage();
    fireEvent.change(await screen.findByLabelText("Pages per full-site scan"), {
      target: { value: "500" },
    });
    expect(screen.getByText("Enter a whole number from 1 to 100.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fixes per scan"), { target: { value: "" } });
    expect(screen.getAllByText("Enter a whole number from 0 to 100.")).toHaveLength(1);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("shows the server's message when saving fails", async () => {
    m.update.mockRejectedValue(
      new Error("disabled rules not a rule id: Foo Bar (use names like image-alt)"),
    );
    await renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: /Propose fixes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a rule id/);
  });

  it("resets to the server defaults, but only when something was changed", async () => {
    await renderPage();
    expect(await screen.findByRole("button", { name: "Reset to server defaults" })).toBeDisabled();
  });

  it("can reset when there are saved changes", async () => {
    m.get.mockResolvedValue(response({ values: { ...values, fix_max: 5 }, changed: ["fix_max"] }));
    m.reset.mockResolvedValue(response());
    await renderPage();
    const reset = await screen.findByRole("button", { name: "Reset to server defaults" });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    await waitFor(() => expect(m.reset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Fixes per scan")).toHaveValue(30));
  });

  it("still offers the browser-only sections when the server can't be reached", async () => {
    m.get.mockRejectedValue(new Error("Failed to fetch"));
    await renderPage();
    expect(await screen.findByText("Couldn't load the server's settings")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "API connection" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Appearance" })).toBeInTheDocument();
  });
});

describe("API connection", () => {
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockReset();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
    });
  });

  it("saves a new address for this browser and reloads", async () => {
    await renderPage();
    const field = await screen.findByLabelText("API base URL");
    fireEvent.change(field, { target: { value: "http://localhost:9000/" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and reload" }));
    expect(m.save).toHaveBeenCalledWith({ apiUrl: "http://localhost:9000", mocks: undefined });
    expect(reload).toHaveBeenCalled();
  });

  it("turns demo data on and reloads", async () => {
    await renderPage();
    fireEvent.click(await screen.findByRole("switch", { name: "Use demo data" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and reload" }));
    expect(m.save).toHaveBeenCalledWith({ apiUrl: undefined, mocks: true });
  });

  it("rejects an address that isn't http(s)", async () => {
    await renderPage();
    fireEvent.change(await screen.findByLabelText("API base URL"), {
      target: { value: "ftp://nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and reload" }));
    expect(await screen.findByText(/Enter the full address/)).toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("has nothing to save, and nothing to go back to, while it matches the build", async () => {
    await renderPage();
    expect(await screen.findByRole("button", { name: "Save and reload" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Use this build's defaults/ })).toBeDisabled();
  });
});
