// First-flight check: serves the static export in out/, opens /world?stats in
// headless Chrome, flies a scripted route by key presses, and reports how soon
// the start view was ready, main-thread ms per frame (and the sky's share), chunks baked a second, and
// how many frames showed haze under the view. Saves screenshots of the canvas.
//
//   npm run build && node scripts/world-fly.mjs [--rate 4] [--seconds 30] [--out .cache/world-fly]
//
// The page reports through window.__flight (set only with ?stats).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
};

function parseArgs(argv) {
  const o = { rate: 4, seconds: 30, port: 4318, out: ".cache/world-fly" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--seconds") o.seconds = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
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

async function fly(browser, origin, opts, label, rate) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (rate > 1) await page.emulateCPUThrottling(rate);
  const t0 = Date.now();
  await page.goto(`${origin}world?stats`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__flight?.readyAt != null || window.__flight?.error, { timeout: 60000 });
  const boot = await page.evaluate(() => ({ ...window.__flight, frameMs: undefined }));
  if (boot.error) throw new Error(`${label}: page error ${boot.error}`);
  const shots = [];
  const shot = async (name) => {
    const file = path.join(opts.out, `${label}-${name}.png`);
    const canvas = await page.$("canvas");
    await canvas.screenshot({ path: file });
    shots.push(file);
  };
  await page.evaluate(() => { window.__flight.frameMs.length = 0; window.__flight.skyMs.length = 0; window.__flight.hazeFrames = 0; window.__flight.frames = 0; });
  const bakedAt0 = (await page.evaluate(() => window.__flight.baked())) ?? 0;
  await shot("00s");
  const start = Date.now();
  let step = 0;
  while ((Date.now() - start) / 1000 < opts.seconds) {
    const [key, held] = ROUTE[step++ % ROUTE.length];
    if (key) await page.keyboard.down(key);
    await new Promise((r) => setTimeout(r, held * 1000));
    if (key) await page.keyboard.up(key);
    const t = (Date.now() - start) / 1000;
    if (t >= 10 && !shots.some((s) => s.endsWith("-10s.png"))) await shot("10s");
  }
  await shot(`${opts.seconds}s`);
  const res = await page.evaluate(() => ({ frameMs: [...window.__flight.frameMs], skyMs: [...window.__flight.skyMs], hazeFrames: window.__flight.hazeFrames, frames: window.__flight.frames, baked: window.__flight.baked() }));
  const secs = (Date.now() - start) / 1000;
  await page.close();
  return {
    label, rate, readyMs: boot.readyAt - boot.navStart, wallToReadyMs: Date.now() - t0 - secs * 1000,
    frames: res.frames, fps: res.frames / secs,
    frameMsP50: pct(res.frameMs, 0.5), frameMsP95: pct(res.frameMs, 0.95), frameMsMax: pct(res.frameMs, 1),
    skyMsP50: pct(res.skyMs, 0.5), skyMsP95: pct(res.skyMs, 0.95), skyMsMax: pct(res.skyMs, 1),
    hazeFrames: res.hazeFrames, chunksPerSecond: (res.baked - bakedAt0) / secs, shots, errors,
  };
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(opts.out, { recursive: true });
const server = await listen(opts.port);
const origin = `http://127.0.0.1:${opts.port}/`;
const browser = await puppeteer.launch({ headless: true });
try {
  const results = [await fly(browser, origin, opts, "plain", 1), await fly(browser, origin, opts, `throttled-x${opts.rate}`, opts.rate)];
  writeFileSync(path.join(opts.out, "result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.close();
}
