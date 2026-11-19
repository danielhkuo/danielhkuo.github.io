// Renders the world's sound offline, scene by scene, and checks it: opens the sound bench (/world-sound) in headless
// Chrome, asks it to render each scene with an OfflineAudioContext through the real engine, saves a WAV per scene and
// runs scripts/world-sound-check.mjs over them (loudness, peaks, clicks, spectrograms, an index.html to listen from).
//
//   npm run build && node scripts/world-sound.mjs [--scene name]... [--rate 48000] [--out .cache/world-sound]
//   node scripts/world-sound.mjs --origin http://localhost:3000/     (a running dev server instead of out/)
//   node scripts/world-sound.mjs --mode ahead        (the unstepped render: the whole timeline scheduled, then one render)
//   node scripts/world-sound.mjs --browser firefox   (headless Firefox; it has no stepped mode, so it renders ahead)
//   node scripts/world-sound.mjs --set K_WIND.a=0    (calibration: try a level constant, e.g. to solo a layer)
//   node scripts/world-sound.mjs --mode ahead --best 5   (the audio thread's share, least of five renders; printed last)
//
// The bench page reports through window.__sound:
//   scenes: { name: string; seconds: number; about: string }[]
//   render(name, { sampleRate, mode? }): Promise<{ wav: string /* base64 WAV */; onsets: number[] /* seconds */; stats }>
//
// Beside each WAV it writes <scene>.onsets.json, <scene>.about.txt and <scene>.stats.json (the render's stats: the
// limiter's deepest reduction, the audio thread's share, the scene's marks). A scene that fails to render is reported
// and the run goes on. Exit code 1 when any scene failed to render or failed a check.

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
  const o = { scenes: [], rate: 48000, port: 4372, out: ".cache/world-sound", origin: null, mode: null, browser: "chrome", set: {}, best: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scene") o.scenes.push(argv[++i]);
    else if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--origin") o.origin = argv[++i].replace(/\/?$/, "/");
    else if (a === "--mode") o.mode = argv[++i];
    else if (a === "--browser") o.browser = argv[++i];
    else if (a === "--best") o.best = Number(argv[++i]);
    else if (a === "--set") {
      // Calibration: --set K_WIND.a=0 tries a level constant for this run only.
      const [k, v] = argv[++i].split("=");
      o.set[k] = Number(v);
    }
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
const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const browser =
  opts.browser === "firefox"
    ? await puppeteer.launch({ browser: "firefox", executablePath: process.env.FIREFOX_BIN ?? FIREFOX, headless: true, protocolTimeout: 1_800_000 })
    : await puppeteer.launch({ headless: "shell", protocolTimeout: 1_800_000 });
let failed = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warn") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${origin}world-sound?render`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__sound?.scenes, { timeout: 60000 });
  page.setDefaultTimeout(0);
  const all = await page.evaluate(() => window.__sound.scenes);
  const wanted = opts.scenes.length ? all.filter((s) => opts.scenes.includes(s.name)) : all;
  if (opts.scenes.length && wanted.length !== opts.scenes.length) {
    throw new Error(`no such scene: ${opts.scenes.filter((n) => !all.some((s) => s.name === n)).join(", ")}`);
  }
  const rows = [];
  const broken = [];
  for (const scene of wanted) {
    const t0 = Date.now();
    let result;
    try {
      const ask = { sampleRate: opts.rate, ...(opts.mode ? { mode: opts.mode } : {}), ...(Object.keys(opts.set).length ? { set: opts.set } : {}) };
      result = await page.evaluate((name, o) => window.__sound.render(name, o), scene.name, ask);
      // --best N: the audio thread's share is wall time over duration, so a busy machine inflates it. Render again
      // and keep the least.
      for (let k = 1; k < opts.best; k++) {
        const again = await page.evaluate((name, o) => window.__sound.render(name, o).then((r) => r.stats.audioThreadShare), scene.name, ask);
        if (again < result.stats.audioThreadShare) result.stats.audioThreadShare = again;
      }
    } catch (e) {
      // One scene failing does not stop the run.
      failed = true;
      broken.push({ scene: scene.name, error: e instanceof Error ? e.message : String(e) });
      console.log(`${scene.name.padEnd(28)} FAILED TO RENDER: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      continue;
    }
    const { wav, onsets, stats } = result;
    const file = path.join(opts.out, `${scene.name}.wav`);
    writeFileSync(file, Buffer.from(wav, "base64"));
    writeFileSync(path.join(opts.out, `${scene.name}.onsets.json`), JSON.stringify(onsets));
    writeFileSync(path.join(opts.out, `${scene.name}.about.txt`), scene.about ?? "");
    writeFileSync(path.join(opts.out, `${scene.name}.stats.json`), JSON.stringify({ ...(stats ?? {}), browser: opts.browser }, null, 2));
    const row = { ...checkWav(file), renderMs: Date.now() - t0 };
    rows.push(row);
    if (row.fails.length) failed = true;
    console.log(
      `${scene.name.padEnd(28)} ${String(row.lufs).padStart(6)} LUFS  tp ${String(row.truePeakDb).padStart(6)}  clip ${row.clipped}  ` +
        `M +${row.loudnessSteps.rise}/−${row.loudnessSteps.fall}  corr ${row.correlation}  bal ${row.balanceDb}  clicks ${row.clicks.length}  ` +
        `lim ${typeof row.stats?.limiterMinDb === "number" ? row.stats.limiterMinDb.toFixed(3) : "?"}  hp200 −${row.smallSpeakerLossLu}  (${row.stats?.mode ?? "?"}, ${row.renderMs} ms)${row.fails.length ? `  FAIL: ${row.fails.join("; ")}` : ""}`,
    );
    const st = row.stats ?? {};
    if (st.strokes?.length) {
      // Bells: strokes started from their top and joined in progress; the hour's count; any stroke started twice
      // without a stop between (a mute or a hide stops everything, so a stroke may then be joined again, once).
      const hour = st.strokes.filter((b) => b.bell === 5);
      const hours = [...new Set(hour.map((b) => b.H))].map((H) => `hour ${H}: ${new Set(hour.filter((b) => b.H === H).map((b) => b.k)).size} strokes`);
      const seen = new Map();
      let doubled = 0;
      for (const b of st.strokes) {
        const key = `${b.H}:${b.bell}:${b.k}`;
        const before = seen.get(key);
        // A ring is at most 10 s: a second start while the first could still sound is a double unless everything was stopped between.
        // (A stroke is scheduled up to 0.3 s before it sounds: one started just after a hide began was stopped by it.)
        if (before !== undefined && b.at - before < 10 && !(st.stops ?? []).some((t) => t > before - 0.3 && t <= b.at)) doubled++;
        seen.set(key, b.at);
      }
      console.log(`    bell strokes: ${st.strokes.filter((b) => b.offset === 0).length} struck, ${st.strokes.filter((b) => b.offset > 0).length} joined in progress; ${hours.join(", ") || "no hour"}; doubled ${doubled}`);
    }
    if (st.falls?.length) console.log(`    falls: ${st.fallsBound} given a chain, ${st.fallHandovers} took the spare (${st.falls.map((f) => `${f.handover ? "handover" : "bound"} at ${f.at} s`).join(", ")})`);
    if (st.gullCalls?.length || st.gullStartles) console.log(`    gulls: ${st.gullCalls.length} calls (${st.gullCalls.map((g) => `${["yelp", "keks", "mew", "long"][g.call]} b${g.bird} ${g.at}`).join(", ")}), ${st.gullsDropped} dropped, ${st.gullStartles} birds put up`);
    if (st.momentCues?.length) {
      const by = {};
      for (const c of st.momentCues) by[`${c.kind}:${c.variant}`] = (by[`${c.kind}:${c.variant}`] ?? 0) + 1;
      console.log(`    moments: ${Object.entries(by).map(([k, v]) => `${k} ×${v}`).join(", ")}`);
    }
    if (st.wavesPerMinute?.length) console.log(`    waves a minute, by lane: ${st.wavesPerMinute.join(", ")}; closest two of one train in a lane: ${st.closestTrainGap === null ? "—" : st.closestTrainGap.toFixed(2)} s`);
    if (typeof st.repeatMax === "number") console.log(`    repeatMax ${st.repeatMax.toFixed(4)} over ${st.repeatPairs} pairs of ${st.repeatWaves} waves; control (one wave copied over another) ${st.repeatControl?.toFixed(4)}`);
    for (const m of row.marks ?? []) {
      console.log(`    ${m.name.padEnd(24)} ${String(m.lufs).padStart(6)} LUFS  M mean ${String(m.momentaryMean).padStart(6)} max ${String(m.momentaryMax).padStart(6)}  bal ${m.balanceDb} dB  rms ${m.rmsDb} dBFS  mid ${m.midDb} dBFS bal ${m.midBalanceDb} dB${m.lowShares ? `  <60 Hz ${(m.lowShares[0] * 100).toFixed(1)} % 60–120 ${(m.lowShares[1] * 100).toFixed(1)} %` : ""}`);
    }
  }
  if (opts.best > 1 || opts.mode === "ahead") console.log(`audio thread, % of real time: ${rows.map((r) => `${r.file.replace(".wav", "")} ${((r.stats?.audioThreadShare ?? 0) * 100).toFixed(2)}`).join(", ")}`);
  writeFileSync(path.join(opts.out, "render.json"), JSON.stringify({ origin, browser: opts.browser, mode: opts.mode, rows: rows.map(({ file, renderMs }) => ({ file, renderMs })), broken, errors }, null, 2));
  // The contact sheet and report.json: the checker writes them from the WAVs now on disk.
  execFileSync(process.execPath, [fileURLToPath(new URL("./world-sound-check.mjs", import.meta.url)), opts.out], { stdio: "ignore" });
  if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
  console.log(`listen: ${path.resolve(opts.out, "index.html")}`);
} finally {
  await browser.close();
  server?.close();
}
if (failed) process.exitCode = 1;
