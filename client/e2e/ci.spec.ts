import { expect, test } from "@playwright/test";

test("ci generator updates the workflow from the form", async ({ page }) => {
  await page.goto("/integrations/ci");
  await page.waitForLoadState("networkidle"); // wait for hydration
  const yaml = page.getByRole("region", { name: "workflow YAML" });
  await expect(yaml).toContainText("min-score: 85");
  await page.getByLabel("Minimum score").fill("92");
  await page.getByLabel("URL to scan").fill("https://shop.test");
  await page.getByRole("radio", { name: "AAA" }).click();
  await expect(yaml).toContainText("min-score: 92");
  await expect(yaml).toContainText("url: https://shop.test");
  await expect(yaml).toContainText("level: AAA");
  await page.getByLabel("Minimum score").fill("500");
  await expect(page.getByText("Enter a whole number from 0 to 100.")).toBeVisible();
});
