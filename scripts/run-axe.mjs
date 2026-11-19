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

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import puppeteer from "puppeteer";

/** The pages held to zero violations. Add a page here once it passes. */
const PAGES = ["/recruiter"];

const OUT = path.resolve("out");

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1280, height: 800 },
];
const SCHEMES = ["light", "dark"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/** The file GitHub Pages serves for a path: the file itself, else path.html, else path/index.html. */
async function fileFor(urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  const base = path.join(OUT, pathname);
  if (base !== OUT && !base.startsWith(OUT + path.sep)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, "index.html")]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this one; try the next.
    }
  }
  return null;
}

/** A static server for out/ on a free local port. */
async function serveExport() {
  const server = createServer(async (req, res) => {
    const file = await fileFor(req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      res.end(await readFile(path.join(OUT, "404.html")).catch(() => "Not found"));
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

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
  try {
    await stat(path.join(OUT, "index.html"));
  } catch {
    console.error("No static export in out/. Run `npm run build` first.");
    return 2;
  }

  const args = process.argv.slice(2);
  const pages = (args.length ? args : PAGES).map((p) => (p.startsWith("/") ? p : `/${p}`));
  const axeSource = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

  const server = await serveExport();
  const origin = `http://127.0.0.1:${server.address().port}`;
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
