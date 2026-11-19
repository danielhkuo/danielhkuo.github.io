// Renders the world's sound offline, scene by scene, and checks it: opens the sound bench (/world-sound) in headless
// Chrome, asks it to render each scene with an OfflineAudioContext through the real engine, saves a WAV per scene and
// runs scripts/world-sound-check.mjs over them (loudness, peaks, clicks, spectrograms, an index.html to listen from).
//
//   npm run build && node scripts/world-sound.mjs [--scene name]... [--rate 48000] [--out .cache/world-sound]
//   node scripts/world-sound.mjs --origin http://localhost:3000/     (a running dev server instead of out/)
//
// The bench page reports through window.__sound:
//   scenes: { name: string; seconds: number; about: string }[]
//   render(name, { sampleRate }): Promise<{ wav: string /* base64 WAV */; onsets: number[] /* seconds */ }>

import { execFileSync } from "node:child_process";
import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { checkWav } from "./world-sound-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../out");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
};

function parseArgs(argv) {
  const o = { scenes: [], rate: 48000, port: 4372, out: ".cache/world-sound", origin: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene") o.scenes.push(argv[++i]);
    else if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--origin") o.origin = argv[++i].replace(/\/?$/, "/");
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

const opts = parseArgs(process.argv.slice(2));
rmSync(opts.out, { recursive: true, force: true });
mkdirSync(opts.out, { recursive: true });
const server = opts.origin ? null : await listen(opts.port);
const origin = opts.origin ?? `http://127.0.0.1:${opts.port}/`;
const browser = await puppeteer.launch({ headless: "shell" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warn") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${origin}world-sound?render`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__sound?.scenes, { timeout: 60000 });
  const all = await page.evaluate(() => window.__sound.scenes);
  const wanted = opts.scenes.length ? all.filter((s) => opts.scenes.includes(s.name)) : all;
  if (opts.scenes.length && wanted.length !== opts.scenes.length) {
    throw new Error(`no such scene: ${opts.scenes.filter((n) => !all.some((s) => s.name === n)).join(", ")}`);
  }
  const rows = [];
  for (const scene of wanted) {
    const t0 = Date.now();
    const { wav, onsets } = await page.evaluate((name, sampleRate) => window.__sound.render(name, { sampleRate }), scene.name, opts.rate);
    const file = path.join(opts.out, `${scene.name}.wav`);
    writeFileSync(file, Buffer.from(wav, "base64"));
    writeFileSync(path.join(opts.out, `${scene.name}.onsets.json`), JSON.stringify(onsets));
    writeFileSync(path.join(opts.out, `${scene.name}.about.txt`), scene.about ?? "");
    const row = { ...checkWav(file), renderMs: Date.now() - t0 };
    rows.push(row);
    console.log(
      `${scene.name.padEnd(28)} ${String(row.lufs).padStart(6)} LUFS  tp ${String(row.truePeakDb).padStart(6)}  clip ${row.clipped}  ` +
        `M +${row.loudnessSteps.rise}/−${row.loudnessSteps.fall}  corr ${row.correlation}  clicks ${row.clicks.length}  (${row.renderMs} ms)`,
    );
  }
  writeFileSync(path.join(opts.out, "render.json"), JSON.stringify({ origin, rows: rows.map(({ file, renderMs }) => ({ file, renderMs })), errors }, null, 2));
  // The contact sheet and report.json: the checker writes them from the WAVs now on disk.
  execFileSync(process.execPath, [fileURLToPath(new URL("./world-sound-check.mjs", import.meta.url)), opts.out], { stdio: "ignore" });
  if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
  console.log(`listen: ${path.resolve(opts.out, "index.html")}`);
} finally {
  await browser.close();
  server?.close();
}
