// Runs axe-core against the built static export, the way a visitor gets it:
// out/ is served over HTTP the way GitHub Pages serves it, each page opens in
// headless Chrome at phone and desktop width, in light and in dark, and axe's
// full rule set runs on it. Any violation fails the run.
//
//   npm run build && npm run a11y      the pages in PAGES
//   npm run a11y -- /world /           any pages, by path
//
// Exit status: 0 clean, 1 violations (or a page that would not load),
// 2 nothing to check (no out/: run `npm run build` first).

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";
import { hasExport, origin as originOf, serveExport } from "./serve-export.mjs";

/** The pages held to zero violations. Add a page here once it passes. */
const PAGES = ["/minimal"];

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1280, height: 800 },
];
const SCHEMES = ["light", "dark"];

/** One violation as a few readable lines: the rule, why, and where. */
function describe(violation) {
  const lines = [`  ${violation.id} (${violation.impact}): ${violation.help}`, `    ${violation.helpUrl}`];
  for (const node of violation.nodes.slice(0, 5)) {
    lines.push(`    at ${node.target.join(" ")}`);
    if (node.failureSummary) lines.push(...node.failureSummary.split("\n").map((l) => `      ${l}`));
  }
  if (violation.nodes.length > 5) lines.push(`    …and ${violation.nodes.length - 5} more`);
  return lines.join("\n");
}

async function main() {
  if (!(await hasExport())) {
    console.error("No static export in out/. Run `npm run build` first.");
    return 2;
  }

  const args = process.argv.slice(2);
  const pages = (args.length ? args : PAGES).map((p) => (p.startsWith("/") ? p : `/${p}`));
  const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

  const server = await serveExport();
  const origin = originOf(server);
  const browser = await puppeteer.launch();
  let failed = 0;
  try {
    for (const page of pages) {
      for (const viewport of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          const where = `${page} (${viewport.name}, ${scheme})`;
          const tab = await browser.newPage();
          try {
            await tab.setViewport(viewport);
            // Reduced motion: text that is still fading in would be measured mid-fade.
            await tab.emulateMediaFeatures([
              { name: "prefers-color-scheme", value: scheme },
              { name: "prefers-reduced-motion", value: "reduce" },
            ]);
            const response = await tab.goto(origin + page, { waitUntil: "networkidle0" });
            if (!response?.ok()) {
              failed++;
              console.log(`✗ ${where}: HTTP ${response?.status() ?? "no response"}`);
              continue;
            }
            await tab.addScriptTag({ content: axeSource });
            const violations = await tab.evaluate(
              async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations,
            );
            if (violations.length) {
              failed++;
              console.log(`✗ ${where}: ${violations.length} violation${violations.length === 1 ? "" : "s"}`);
              for (const v of violations) console.log(describe(v));
            } else {
              console.log(`✓ ${where}`);
            }
          } finally {
            await tab.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
