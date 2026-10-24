import { defineConfig } from "@playwright/test";

const fixesBackendE2E = process.env["FIXES_API_E2E"] === "true";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:5174" },
  webServer: {
    // separate port + mocked GitHub so tests never depend on your running servers or real GitHub
    command: "npm run dev -- --port 5174",
    env: {
      ...process.env,
      VITE_USE_MOCKS: fixesBackendE2E ? "false" : "true",
      VITE_GITHUB_LIVE: fixesBackendE2E ? "true" : "false",
    },
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
