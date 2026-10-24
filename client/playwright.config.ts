import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:5174" },
  webServer: {
    // separate port + mocked GitHub so tests never depend on your running servers or real GitHub
    command: "VITE_GITHUB_LIVE=false npm run dev -- --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
