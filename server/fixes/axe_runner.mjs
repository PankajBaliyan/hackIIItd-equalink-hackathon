// Run the project's installed axe-core/Playwright against HTML snapshots.
// Scripts, network requests and navigation from imported HTML are disabled.
import { chromium } from "../../client/node_modules/playwright-core/index.mjs";
import AxeBuilder from "../../client/node_modules/@axe-core/playwright/dist/index.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { pages, level = "AA", targets = [] } = JSON.parse(input);
const tags = ["wcag2a", "wcag21a", "wcag22a"];
if (level !== "A") tags.push("wcag2aa", "wcag21aa", "wcag22aa");
if (level === "AAA") tags.push("wcag2aaa", "wcag21aaa", "wcag22aaa");
const browser = await chromium.launch({ headless: true, channel: "chromium" });
try {
  const results = [];
  for (const html of pages) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    // This CSP blocks page scripts while Playwright can still inject axe.
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; frame-src \'none\'">';
    // Put the policy first, before any source-controlled scripts or resources.
    await page.setContent(policy + html, { waitUntil: "domcontentloaded", timeout: 10_000 });
    const report = await new AxeBuilder({ page }).withTags(tags).analyze();
    const matches = await page.evaluate((selectors) => selectors.map((selector) => {
      try { return document.querySelectorAll(selector).length; } catch { return 0; }
    }), targets);
    const simplify = (rules) => rules.flatMap((rule) => rule.nodes.map((node) => ({
      rule: rule.id, selector: node.target.join(" "), impact: rule.impact,
      html: node.html, help: rule.help, tags: rule.tags,
    })));
    const violations = simplify(report.violations);
    // axe may choose "img" while the importer uses ".product-photo".
    // Match actual DOM elements instead of requiring identical CSS spelling.
    const targetMatches = await page.evaluate(({ violations, targets }) => violations.map((violation) => {
      try {
        const element = document.querySelector(violation.selector);
        return targets.filter((target) => {
          try { return element?.matches(target); } catch { return false; }
        });
      } catch { return []; }
    }), { violations, targets });
    violations.forEach((violation, index) => { violation.issue_selectors = targetMatches[index]; });
    results.push({ violations, incomplete: simplify(report.incomplete), matches });
    await context.close();
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await browser.close();
}
