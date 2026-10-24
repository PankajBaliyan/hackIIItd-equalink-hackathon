// Run the project's installed axe-core/Playwright against HTML snapshots.
// Repository scripts may run, but network requests and navigation are disabled.
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
  for (const pageInput of pages) {
    const input = typeof pageInput === "string" ? { html: pageInput, scripts: [] } : pageInput;
    let html = input.html;
    const scripts = input.scripts || [];
    // Put fetched repository scripts before </body>. Each script is wrapped so
    // elements it creates can be traced back to the source file in the report.
    const injected = scripts.map((script) => {
      const safeSource = String(script.source || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      const content = String(script.content || "").replace(/<\/script/gi, "<\\/script");
      return `<script data-equalink-source="${safeSource}">(function(){const before=new Set(document.querySelectorAll("*"));try{${content}}finally{document.querySelectorAll("*").forEach((element)=>{if(!before.has(element)&&!element.hasAttribute("data-equalink-source"))element.setAttribute("data-equalink-source","${safeSource}")})}})();</script>`;
    }).join("\n");
    if (injected) html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${injected}</body>`) : `${html}${injected}`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    // This CSP allows only inline repository scripts; all network requests remain blocked above.
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; frame-src \'none\'">';
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
        const matches = targets.filter((target) => {
          try { return element?.matches(target); } catch { return false; }
        });
        return { matches, source_file: element?.getAttribute("data-equalink-source") || null };
      } catch { return []; }
    }), { violations, targets });
    violations.forEach((violation, index) => {
      const target = targetMatches[index];
      violation.issue_selectors = Array.isArray(target) ? target : target.matches;
      violation.source_file = Array.isArray(target) ? null : target.source_file;
    });
    const screenshot = `data:image/png;base64,${(await page.screenshot({ type: "png", fullPage: true })).toString("base64")}`;
    results.push({ violations, incomplete: simplify(report.incomplete), matches, screenshot });
    await context.close();
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await browser.close();
}
