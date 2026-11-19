// Screenshots of the phone's title screen for judging its look (mobile spec 2): its noindex bench route on an iPhone,
// an SE-sized phone and a small Android phone, upright and sideways, and the front door at desktop widths.
//
//   npm run build && node scripts/title-phone-shots.mjs [--port 4479] [--out .cache/title-shots]

import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../out");
const arg = (name, d) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg("--port", 4479));
const OUT = path.resolve(arg("--out", ".cache/title-shots"));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
};

function resolveFile(urlPath) {
  const rel = decodeURIComponent((urlPath ?? "/").split("?")[0]).replace(/^\/+/, "");
  for (const file of [path.join(root, rel), path.join(root, `${rel}.html`), path.join(root, rel, "index.html")]) {
    const r = path.relative(root, path.normalize(file));
    if (r.startsWith("..") || path.isAbsolute(r)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // the next spelling
    }
  }
  return null;
}

const TOUCH = { isMobile: true, hasTouch: true };
const SHOTS = [
  { name: "iphone17-upright", path: "/phone-title", viewport: { width: 402, height: 874, deviceScaleFactor: 3, ...TOUCH } },
  { name: "iphone17-sideways", path: "/phone-title", viewport: { width: 874, height: 402, deviceScaleFactor: 3, ...TOUCH, isLandscape: true } },
  { name: "se-upright", path: "/phone-title", viewport: { width: 375, height: 667, deviceScaleFactor: 2, ...TOUCH } },
  { name: "android-small-upright", path: "/phone-title", viewport: { width: 360, height: 760, deviceScaleFactor: 2, ...TOUCH } },
  { name: "desktop-1280", path: "/", viewport: { width: 1280, height: 800 } },
  { name: "desktop-700", path: "/", viewport: { width: 700, height: 900 } },
];

const server = createServer((req, res) => {
  const file = resolveFile(req.url);
  if (!file) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: "shell" });
for (const s of SHOTS) {
  const page = await browser.newPage();
  await page.setViewport(s.viewport);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`http://127.0.0.1:${PORT}${s.path}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 400));
  const file = path.join(OUT, `${s.name}.png`);
  await page.screenshot({ path: file, fullPage: !s.name.startsWith("desktop") });
  console.log(file);
  await page.close();
}
await browser.close();
server.close();
