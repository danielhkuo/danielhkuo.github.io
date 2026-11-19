// First-flight check: serves the static export in out/, opens /world?stats in
// headless Chrome, flies a scripted route by key presses, and reports how soon
// the start view was ready, main-thread ms per frame (and the sky's and the guides' shares), chunks baked a second, and
// how many frames showed haze under the view. Saves screenshots of the canvas.
//
//   npm run build && node scripts/world-fly.mjs [--rate 4] [--seconds 30] [--out .cache/world-fly]
//                                              [--viewport 1920x1080] [--query pixels=130000] [--phone]
//
// --phone flies as an iPhone 17 in landscape Safari (874×338 at 3×, touch): it takes wing on the first card and flies the
// same route with the touch stick and the Boost button (mobile spec 8, the phone perf gate). It sets its own viewport.
//
// The page reports through window.__flight (set only with ?stats). The frame fills the window, so --viewport sets how
// many frame pixels are drawn (runtime/fit.ts); --query adds to the page's query: ?pixels= to try another budget, or
// ?time= and ?weather= to hold the light and the weather still (time=night&weather=rain).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { layoutControls } from "../src/world/mobile/layout.ts";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
};

function parseArgs(argv) {
  const o = { rate: 4, seconds: 30, port: 4318, out: ".cache/world-fly", width: 1600, height: 900, query: "", phone: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--seconds") o.seconds = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--viewport") [o.width, o.height] = argv[++i].split("x").map(Number);
    else if (a === "--query") o.query = argv[++i];
    else if (a === "--phone") o.phone = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent((urlPath ?? "/").split("?")[0]).replace(/^\/+/, "");
  for (const file of [path.join(root, rel), path.join(root, `${rel}.html`), path.join(root, rel, "index.html")]) {
    const r = path.relative(root, path.normalize(file));
    if (r.startsWith("..") || path.isAbsolute(r)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // try the next spelling
    }
  }
  return null;
}

function listen(port) {
  const server = createServer((req, res) => {
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/** Key presses: [key, seconds held]. A loop of turns and boosts, then cruise. */
const ROUTE = [["ArrowUp", 4], [null, 2], ["ArrowRight", 2.5], ["ArrowUp", 3], ["ArrowLeft", 4], [null, 3], ["ArrowDown", 2], ["ArrowRight", 1.5]];

/** The phone: measured in the iOS 26.5 Simulator (iPhone 17, Safari, landscape, one tab). */
const PHONE = {
  viewport: { width: 874, height: 338, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true },
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
  insets: { top: 0, right: 62, bottom: 20, left: 62 },
};
/** The keys of ROUTE as a stick direction on screen and Boost. */
const TOUCH = { ArrowUp: { dx: 0, dy: -1, boost: true }, ArrowDown: { dx: 0, dy: 1, boost: false }, ArrowLeft: { dx: -1, dy: 0, boost: false }, ArrowRight: { dx: 1, dy: 0, boost: false } };

/** Holds the route's step by touch: the stick pushed that way (and Boost for Up) for `held` seconds. */
async function touchStep(page, layout, key, held) {
  if (!key) return new Promise((r) => setTimeout(r, held * 1000));
  const t = TOUCH[key];
  const sx = Math.round((layout.zone.x0 + layout.zone.x1) / 2);
  const sy = Math.round((layout.zone.y0 + layout.zone.y1) / 2);
  const thumb = await page.touchscreen.touchStart(sx, sy);
  await thumb.move(sx + t.dx * layout.travel, sy + t.dy * layout.travel);
  const boost = t.boost ? await page.touchscreen.touchStart(Math.round(layout.boost.x), Math.round(layout.boost.y)) : null;
  await new Promise((r) => setTimeout(r, held * 1000));
  await boost?.end();
  await thumb.end();
}

async function fly(browser, origin, opts, label, rate) {
  const page = await browser.newPage();
  if (opts.phone) {
    await page.setUserAgent(PHONE.ua);
    await page.setViewport(PHONE.viewport);
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: PHONE.insets });
  } else {
    await page.setViewport({ width: opts.width, height: opts.height });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (rate > 1) await page.emulateCPUThrottling(rate);
  const t0 = Date.now();
  await page.goto(`${origin}world?stats${opts.query ? `&${opts.query}` : ""}`, { waitUntil: "load" });
  // Under phone emulation the navigation lands in a fresh renderer that drops the throttle: set it again.
  if (opts.phone && rate > 1) await page.emulateCPUThrottling(rate);
  await page.waitForFunction(() => window.__flight?.readyAt != null || window.__flight?.error, { timeout: 60000 });
  const boot = await page.evaluate(() => ({ ...window.__flight, frameMs: undefined }));
  if (boot.error) throw new Error(`${label}: page error ${boot.error}`);
  let layout = null;
  if (opts.phone) {
    await page.tap('[data-act="take-wing"]');
    await page.waitForFunction(() => !document.querySelector("[data-card]"));
    const v = await page.evaluate(() => {
      const r = document.querySelector("canvas").getBoundingClientRect();
      return { w: Math.round(visualViewport.width), h: Math.round(visualViewport.height), frame: { x: r.left, y: r.top, w: r.width, h: r.height } };
    });
    layout = layoutControls({ width: v.w, height: v.h, insets: PHONE.insets, platform: "ios", hand: "right", size: 1, frame: v.frame, land: false });
  }
  const shots = [];
  const shot = async (name) => {
    const file = path.join(opts.out, `${label}-${name}.png`);
    const canvas = await page.$("canvas");
    await canvas.screenshot({ path: file });
    shots.push(file);
  };
  await page.evaluate(() => { window.__flight.frameMs.length = 0; window.__flight.skyMs.length = 0; if (window.__flight.guideMs) window.__flight.guideMs.length = 0; window.__flight.hazeFrames = 0; window.__flight.frames = 0; });
  const bakedAt0 = (await page.evaluate(() => window.__flight.baked())) ?? 0;
  await shot("00s");
  const start = Date.now();
  let step = 0;
  while ((Date.now() - start) / 1000 < opts.seconds) {
    const [key, held] = ROUTE[step++ % ROUTE.length];
    if (layout) await touchStep(page, layout, key, held);
    else {
      if (key) await page.keyboard.down(key);
      await new Promise((r) => setTimeout(r, held * 1000));
      if (key) await page.keyboard.up(key);
    }
    const t = (Date.now() - start) / 1000;
    if (t >= 10 && !shots.some((s) => s.endsWith("-10s.png"))) await shot("10s");
  }
  await shot(`${opts.seconds}s`);
  const res = await page.evaluate(() => ({
    frame: `${document.querySelector("canvas").width}x${document.querySelector("canvas").height}`,
    frameMs: [...window.__flight.frameMs], skyMs: [...window.__flight.skyMs], guideMs: [...(window.__flight.guideMs ?? [])],
    hazeFrames: window.__flight.hazeFrames, frames: window.__flight.frames, baked: window.__flight.baked(),
    air: window.__flight.air, paletteMs: [...(window.__flight.paletteMs ?? [])], state: window.__flight.state?.() ?? null,
  }));
  const secs = (Date.now() - start) / 1000;
  await page.close();
  return {
    label, rate, viewport: `${opts.width}x${opts.height}`, frame: res.frame, readyMs: boot.readyAt - boot.navStart, wallToReadyMs: Date.now() - t0 - secs * 1000,
    frames: res.frames, fps: res.frames / secs,
    frameMsP50: pct(res.frameMs, 0.5), frameMsP95: pct(res.frameMs, 0.95), frameMsMax: pct(res.frameMs, 1),
    skyMsP50: pct(res.skyMs, 0.5), skyMsP95: pct(res.skyMs, 0.95), skyMsMax: pct(res.skyMs, 1),
    guideMsP50: pct(res.guideMs, 0.5), guideMsP95: pct(res.guideMs, 0.95), guideMsMax: pct(res.guideMs, 1),
    hazeFrames: res.hazeFrames, chunksPerSecond: (res.baked - bakedAt0) / secs, shots, errors,
    air: res.air, palettes: res.paletteMs.length, paletteMsMax: pct(res.paletteMs, 1),
    ...(opts.phone ? { workers: res.state?.workers, pacedTo: res.state?.rate } : {}),
  };
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(opts.out, { recursive: true });
const server = await listen(opts.port);
const origin = `http://127.0.0.1:${opts.port}/`;
const browser = await puppeteer.launch({ headless: "shell" });
try {
  const results = [await fly(browser, origin, opts, "plain", 1), await fly(browser, origin, opts, `throttled-x${opts.rate}`, opts.rate)];
  writeFileSync(path.join(opts.out, "result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}
