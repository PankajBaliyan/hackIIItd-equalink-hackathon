import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("full demo path on mocks: scan → live → fixes → diff → PR", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // wait for hydration
  await page.getByLabel("Website URL").fill("not a url");
  await page.getByRole("button", { name: /Scan with TinyFish/ }).click();
  await expect(page.getByText("That doesn't look like a valid URL.")).toBeVisible();

  await page.getByLabel("Website URL").fill("shopeasy.dev");
  await page.getByLabel("GitHub repo (optional)").fill("shopeasy/shopeasy-demo");
  await page.getByRole("button", { name: /Scan with TinyFish/ }).click();

  await expect(page).toHaveURL(/\/scans\/scan_/);
  await expect(page.getByRole("log")).toContainText("promo-modal", { timeout: 30_000 });
  await page.getByRole("link", { name: /Review fixes/ }).click({ timeout: 40_000 });

  await expect(page.getByRole("heading", { name: "Review fixes" })).toBeVisible();
  await expect(page.getByText("Verified by TinyFish").first()).toBeVisible();
  await page.getByRole("button", { name: /Link has no accessible name/ }).click();
  await expect(page.getByText("Caught by the rules engine")).toBeVisible();
  await page.getByRole("button", { name: /Clickable element is not a button/ }).click();
  await expect(page.getByRole("region", { name: "Code diff" })).toBeVisible({ timeout: 20_000 });

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await page
    .getByRole("button", { name: /Open PR/ })
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Open PR" }).click();
  await expect(page.getByRole("article", { name: "Pull request 7" })).toBeVisible({
    timeout: 10_000,
  });

  // client-side navigation: PRs live in the in-memory store, so a full reload would clear them
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Pull Requests" })
    .click();
  await expect(page.getByRole("article", { name: "Pull request 7" })).toBeVisible();
});
