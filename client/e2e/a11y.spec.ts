import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = [
  "/",
  "/scans/demo",
  "/scans/demo/fixes",
  "/pull-requests",
  "/history",
  "/reports",
  "/sites",
  "/integrations/github",
  "/integrations/ci",
  "/settings",
  "/docs",
  "/docs/api",
  "/docs/reference",
  "/_design",
  "/does-not-exist",
];

for (const theme of ["dark", "light"] as const) {
  for (const route of ROUTES) {
    test(`axe: ${route} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("equalink-theme", t), theme);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
        ),
      ).toEqual([]);
    });
  }
}
