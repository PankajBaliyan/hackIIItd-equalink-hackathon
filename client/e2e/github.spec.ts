import { expect, test } from "@playwright/test";

test.skip(process.env["FIXES_API_E2E"] === "true", "Runs only in the browser-mock suite");

test("github integration: connect, toggle a repo, disconnect", async ({ page }) => {
  await page.goto("/integrations/github");
  await page.waitForLoadState("networkidle"); // wait for hydration
  await expect(page.getByRole("heading", { name: "Connect GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  await expect(page.getByRole("link", { name: /GitHub: shopeasy/ })).toBeVisible();

  const sw = page.getByRole("switch", { name: "shopeasy/marketing-site" });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect GitHub" })).toBeVisible();
});
