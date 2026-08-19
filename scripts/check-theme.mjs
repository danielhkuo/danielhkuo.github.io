/**
 * Assert the built static export paints the persisted theme on the FIRST frame.
 *
 * The failure this guards is invisible to every other check in the repo: the
 * page ends up correct once React hydrates, so a screenshot, an axe run and the
 * eye all pass while the masthead and hover menu spend one frame in the wrong
 * palette. It only shows up when the stored choice disagrees with the OS, which
 * is exactly the case a developer on a matching pair never sees.
 *
 * Astryx builds every token as `light-dark()`, so the palette is decided by
 * `color-scheme`, and <Theme mode> paints that on its own wrapper div. A static
 * export cannot know the mode at build time, so the wrapper ships as
 * `color-scheme: light dark` (mode='system') and would follow the OS until
 * hydration. globals.css pins it from the `data-astryx-media` attribute that the
 * pre-paint script in layout.tsx stamps on <html>. That pin is unlayered author
 * CSS beating a StyleX class in @layer astryx-base — a cascade position we do
 * not control and cannot see break. Hence this file.
 *
 * Method: serve out/, block every .js request, load. The inline <head> script
 * is inline, so it still runs; React never hydrates. What the browser paints is
 * therefore precisely the first frame.
 *
 * Two guards keep a case from passing for the wrong reason, because a suite that
 * silently stops testing the first frame is worse than no suite: each case
 * asserts at least one .js request was actually aborted, and that the wrapper
 * carries no data-theme (which <Theme> writes as soon as it has a real mode).
 *
 * Usage: npm run build && node scripts/check-theme.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import puppeteer from "puppeteer";

const ROOT = "out";

// Atom One, from src/app/globals.css and src/theme/atomOneTheme.ts. Written as
// rgb() because that is what getComputedStyle returns.
const PALETTE = {
  light: { bg: "rgb(250, 250, 250)", fg: "rgb(56, 58, 66)" }, // #fafafa / #383a42
  dark: { bg: "rgb(40, 44, 52)", fg: "rgb(171, 178, 191)" }, // #282c34 / #abb2bf
};

/**
 * stored preference × OS preference → the mode the first frame must show.
 * The mismatched pairs are the bug; the null pairs are the first-ever visit.
 * The last two cover the validation the script does on the stored value: it
 * accepts only "dark"/"light", so anything else must fall back to the OS rather
 * than be written through as a mode.
 */
const CASES = [
  { stored: "light", os: "dark", expect: "light" },
  { stored: "dark", os: "light", expect: "dark" },
  { stored: null, os: "dark", expect: "dark" },
  { stored: null, os: "light", expect: "light" },
  { stored: "Dark", os: "light", expect: "light" },
  { stored: "system", os: "dark", expect: "dark" },
];

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    // normalize() before join() so ../ in a URL cannot escape the root.
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
      const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Helpers installed into the page before it loads.
 *
 * paint() renders a probe through the theme's own custom properties and reports
 * what the browser resolved. Reading the custom property directly would not do:
 * native `light-dark()` inside a custom property stays unresolved until it is
 * used, so only a real painted value proves what the visitor sees.
 *
 * schemeClass() asks the stylesheet which class <Theme mode> paints for a given
 * mode, rather than hardcoding a StyleX hash that changes on every upgrade. The
 * nested-theme case has to apply that real class: an inline `color-scheme` would
 * not carry the toggles LightningCSS pairs with each declaration, so the tokens
 * would stay frozen at the parent's mode and the case would fail for a reason
 * that has nothing to do with what it is testing.
 */
function installHelpers() {
  window.__paint = (sel) => {
    const probe = document.createElement("p");
    probe.style.background = "var(--color-background-body)";
    probe.style.color = "var(--color-text-primary)";
    document.querySelector(sel).appendChild(probe);
    const style = getComputedStyle(probe);
    const painted = { bg: style.backgroundColor, fg: style.color };
    probe.remove();
    return painted;
  };

  window.__schemeClass = (mode) => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet; none of ours are
      }
      // Test before recursing: a CSSStyleRule carries an empty `cssRules` of
      // its own (CSS nesting), so a recurse-first walk never reaches the check.
      const walk = (list) => {
        for (const rule of list) {
          if (
            rule.style?.colorScheme === mode &&
            // class-only selector — ours are attribute selectors
            /^\.[\w-]+(:not\([^)]*\))*$/.test(rule.selectorText ?? "")
          ) {
            return rule.selectorText.match(/^\.([\w-]+)/)[1];
          }
          if (rule.cssRules?.length) {
            const hit = walk(rule.cssRules);
            if (hit) return hit;
          }
        }
        return null;
      };
      const hit = walk(rules);
      if (hit) return hit;
    }
    return null;
  };
}

const failures = [];
const check = (label, actual, expected) => {
  if (actual !== expected) failures.push(`${label}\n    expected: ${expected}\n    actual:   ${actual}`);
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`No ${ROOT}/index.html — run \`npm run build\` first.`);
  process.exit(1);
}

const { server, port } = await serve(ROOT);
const browser = await puppeteer.launch();

try {
  for (const { stored, os, expect } of CASES) {
    const page = await browser.newPage();
    const name = `stored=${stored ?? "unset"} os=${os}`;

    let blocked = 0;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (extname(new URL(req.url()).pathname) === ".js") {
        blocked += 1;
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: os }]);
    await page.evaluateOnNewDocument(installHelpers);
    await page.evaluateOnNewDocument(
      (value) => {
        if (value === null) localStorage.removeItem("theme");
        else localStorage.setItem("theme", value);
      },
      stored,
    );

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });

    const before = failures.length;
    const wrapper = "body [data-astryx-theme]";
    const seen = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no ${sel} in the built page — did the Theme wrapper move?`);
      return {
        hydrated: el.hasAttribute("data-theme"),
        htmlAttr: document.documentElement.getAttribute("data-astryx-media"),
        htmlScheme: getComputedStyle(document.documentElement).colorScheme,
        wrapperScheme: getComputedStyle(el).colorScheme,
        painted: window.__paint(sel),
      };
    }, wrapper);

    // Guards first: if React ran, every assertion below is meaningless.
    check(`${name} — the page's JS must have been blocked`, blocked > 0, true);
    check(`${name} — page must be pre-hydration (wrapper has no data-theme)`, seen.hydrated, false);
    check(`${name} — <html> data-astryx-media`, seen.htmlAttr, expect);
    check(`${name} — <html> color-scheme`, seen.htmlScheme, expect);
    check(`${name} — wrapper color-scheme`, seen.wrapperScheme, expect);
    check(`${name} — painted background`, seen.painted.bg, PALETTE[expect].bg);
    check(`${name} — painted text`, seen.painted.fg, PALETTE[expect].fg);

    // A nested <Theme mode> must keep its own mode: the pin is deliberately
    // scoped away from wrappers that carry an explicit data-theme, so a dark
    // panel inside a light page (a documented Astryx pattern) survives.
    const opposite = expect === "dark" ? "light" : "dark";
    const nested = await page.evaluate(
      (sel, mode) => {
        const el = document.querySelector(sel);
        const cls = window.__schemeClass(mode);
        if (!cls) throw new Error(`no class declares color-scheme:${mode} — has <Theme> stopped emitting one?`);
        const node = document.createElement("div");
        node.id = "nested-theme-probe";
        node.className = cls;
        node.setAttribute("data-astryx-theme", el.getAttribute("data-astryx-theme"));
        node.setAttribute("data-theme", mode);
        el.appendChild(node);
        const out = {
          scheme: getComputedStyle(node).colorScheme,
          painted: window.__paint("#nested-theme-probe"),
        };
        node.remove();
        return out;
      },
      wrapper,
      opposite,
    );

    check(`${name} — nested <Theme mode="${opposite}"> keeps its scheme`, nested.scheme, opposite);
    check(`${name} — nested <Theme mode="${opposite}"> painted background`, nested.painted.bg, PALETTE[opposite].bg);

    await page.close();
    // Gate on THIS case, not the global list, or one failure silences the rest.
    if (failures.length === before) console.log(`  ok  ${name} → ${expect}`);
    else console.log(`  FAIL ${name} → expected ${expect}`);
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} theme assertion(s) failed:\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}

console.log(`\nFirst paint matches the persisted theme in all ${CASES.length} cases.`);
