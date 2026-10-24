import { expect, test } from "@playwright/test";

// Stateful fake of the server's /sites endpoints so this test never touches a real database.
test("sites: add, validate, scan prefill and remove", async ({ page }) => {
  const sites: {
    id: number;
    url: string;
    host: string;
    repo: string | null;
    created_at: string;
  }[] = [];
  await page.route("http://localhost:8000/**", async (route) => {
    const req = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    const path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (path === "/integrations/github")
      return route.fulfill({ json: { connected: false, repos: [], mode: "none" }, headers: cors });
    if (path === "/sites" && req.method() === "GET")
      return route.fulfill({ json: sites, headers: cors });
    if (path === "/sites" && req.method() === "POST") {
      const b = req.postDataJSON() as { url: string; repo?: string };
      const site = {
        id: sites.length + 1,
        url: b.url,
        host: new URL(b.url).hostname,
        repo: b.repo ?? null,
        created_at: new Date().toISOString(),
      };
      sites.unshift(site);
      return route.fulfill({ status: 201, json: site, headers: cors });
    }
    if (path.startsWith("/sites/") && req.method() === "DELETE") {
      sites.splice(0, sites.length, ...sites.filter((s) => s.id !== Number(path.split("/")[2])));
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({ status: 404, headers: cors });
  });

  await page.goto("/sites");
  await page.waitForLoadState("networkidle"); // wait for hydration
  await expect(page.getByText("No sites yet")).toBeVisible();

  await page.getByLabel("Website URL").fill("not a url");
  await page.getByRole("button", { name: "Add site" }).click();
  await expect(page.getByText("That doesn't look like a valid URL.")).toBeVisible();

  await page.getByLabel("Website URL").fill("shopeasy.dev");
  await page.getByRole("button", { name: "Add site" }).click();
  await expect(page.getByRole("heading", { name: "shopeasy.dev" })).toBeVisible();
  await expect(page.getByText("Not scanned yet")).toBeVisible();

  await page.getByRole("link", { name: /Scan this site/ }).click();
  await expect(page).toHaveURL(/\/\?url=https%3A%2F%2Fshopeasy\.dev/);
  await expect(page.getByLabel("Website URL")).toHaveValue("https://shopeasy.dev/");

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Sites" })
    .click();
  await page.getByRole("button", { name: "Remove shopeasy.dev" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No sites yet")).toBeVisible();
});
