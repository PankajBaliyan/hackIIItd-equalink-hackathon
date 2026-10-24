import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ channel: "chromium" });

// Opt in with FIXES_API_E2E=true and run the local backend first.
test.skip(process.env["FIXES_API_E2E"] !== "true", "Requires the running FastAPI fixes backend");

test("imports actual HTML, shows backend validation, and persists inclusion after reload", async ({
  page,
}) => {
  const payload = JSON.parse(
    readFileSync(new URL("../../server/fixes/example_scan.json", import.meta.url), "utf8"),
  );
  // Never ship to GitHub from this test.
  delete payload.repo;
  await page.goto("/scans/demo/fixes");
  await expect(page.getByText("Demo HTML, checked by the backend", { exact: false })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Checked with axe-core", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified by TinyFish", { exact: true })).toHaveCount(0);
  await page.getByLabel("Scan JSON").setInputFiles({
    name: "scan.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page.getByRole("button", { name: "Import and validate" }).click();
  await expect(page).toHaveURL(/\/scans\/scan_[^/]+\/fixes/, { timeout: 60_000 });
  await page.getByRole("button", { name: /Image missing alternative text/ }).click();
  await expect(
    page.getByText("the reported violation was removed", { exact: false }),
  ).toBeVisible();
  const included = page.getByRole("checkbox", { name: "Include in pull request" });
  await expect(included).toBeChecked();
  await included.click();
  await expect(included).not.toBeChecked();
  await expect(included).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: /Image missing alternative text/ }).click();
  await expect(page.getByRole("checkbox", { name: "Include in pull request" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Copy patch" })).toBeDisabled();
});

test("invalid JSON is visible and rejected fixes stay ineligible", async ({ page }) => {
  await page.goto("/scans/demo/fixes");
  await page.getByLabel("Scan JSON").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await page.getByRole("button", { name: "Import and validate" }).click();
  await expect(page.getByRole("alert")).toHaveText("This file is not valid JSON.");
  await page.getByLabel("Status", { exact: true }).selectOption("rejected");
  await page.getByRole("button", { name: /Link has no accessible name/ }).click();
  await expect(
    page.getByRole("checkbox", { name: "Not eligible for the pull request" }),
  ).toBeDisabled();
  await expect(
    page.getByText("The proposed fix does not remove the reported violation."),
  ).toBeVisible();
});
