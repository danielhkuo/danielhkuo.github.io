// Screenshots of the mobile flight for judging its look (mobile spec 9: review renders, not gates): the cards, the
// touch controls held and at rest, Land on offer, and the options panel, on an iPhone-sized and an Android-sized
// screen in landscape.
//
//   npm run build && node scripts/world-mobile-shots.mjs [--port 4361] [--out .cache/mobile-shots]

import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { layoutControls } from "../src/world/mobile/layout.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../out");
const arg = (name, d) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg("--port", 4361));
const OUT = path.resolve(arg("--out", ".cache/mobile-shots"));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".bin": "application/octet-stream",
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

const DEVICES = [
  {
    name: "iphone17",
    viewport: { width: 874, height: 338, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
    upright: { width: 402, height: 714, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: false },
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
    insets: { top: 0, right: 62, bottom: 20, left: 62 },
    platform: "ios",
  },
  {
    name: "pixel7",
    viewport: { width: 915, height: 412, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: true },
    upright: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: false },
    ua: "Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    platform: "android",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const browser = await puppeteer.launch({ headless: "shell", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const written = [];

async function open(d, query = "") {
  const page = await browser.newPage();
  await page.setUserAgent(d.ua);
  await page.setViewport(d.viewport);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: d.insets });
  await page.goto(`${ORIGIN}/world?stats${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__flight?.readyAt != null, { timeout: 60000 });
  await sleep(1200);
  return page;
}
const shot = async (page, name) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  written.push(file);
};
const layoutOf = async (page, d) => {
  const v = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { w: Math.round(visualViewport.width), h: Math.round(visualViewport.height), frame: { x: r.left, y: r.top, w: r.width, h: r.height } };
  });
  return layoutControls({ width: v.w, height: v.h, insets: d.insets, platform: d.platform, hand: "right", size: 1, frame: v.frame, land: true });
};

for (const d of DEVICES) {
  let page = await open(d);
  await shot(page, `${d.name}-1-gate`);
  await page.tap('[data-act="take-wing"]');
  await sleep(1500);
  await shot(page, `${d.name}-2-flying-ghost`);
  const l = await layoutOf(page, d);
  const sx = Math.round((l.zone.x0 + l.zone.x1) / 2);
  const sy = Math.round((l.zone.y0 + l.zone.y1) / 2 + 20);
  const thumb = await page.touchscreen.touchStart(sx, sy);
  for (let i = 1; i <= 5; i++) await thumb.move(sx + i * 7, sy - i * 6);
  const boost = await page.touchscreen.touchStart(Math.round(l.boost.x), Math.round(l.boost.y));
  await sleep(700);
  await shot(page, `${d.name}-3-stick-and-boost`);
  await boost.end();
  await thumb.end();
  await page.setViewport(d.upright);
  await sleep(600);
  await shot(page, `${d.name}-4-upright`);
  await page.setViewport(d.viewport);
  await sleep(600);
  await shot(page, `${d.name}-5-paused`);
  await page.tap('[data-act="options"]');
  await sleep(500);
  await shot(page, `${d.name}-6-options`);
  await page.close();

  page = await open(d, "&at=abbey-0");
  await page.tap('[data-act="take-wing"]');
  await page.waitForFunction(() => document.querySelector("[aria-live]")?.textContent?.includes("land"), { timeout: 15000 }).catch(() => undefined);
  await sleep(400);
  await shot(page, `${d.name}-7-land-offered`);
  await page.close();
}

await browser.close();
server.close();
for (const f of written) console.log(f);
