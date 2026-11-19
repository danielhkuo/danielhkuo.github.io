// First-flight check: serves the static export in out/, opens /world?stats in
// headless Chrome, flies a scripted route by key presses, and reports how soon
// the start view was ready, main-thread ms per frame (and the sky's share), chunks baked a second, and
// how many frames showed haze under the view. Saves screenshots of the canvas.
//
//   npm run build && node scripts/world-fly.mjs [--rate 4] [--seconds 30] [--out .cache/world-fly] [--sound]
//                                              [--soundlog <file>]
//
// --sound flies with the sound on (the stored choice set to "on", autoplay allowed, the first key press unlocking it)
// and also reports the main-thread ms the sound took each frame: over all frames, and with the kit's share (the
// buffers being adopted in the first seconds) taken out.
// --soundlog <file> adds &soundlog to the page and writes the flight it records (the unthrottled run's) to <file>, for
// the sound bench's flight-replay scene (public/world-sound/flight.json).
//
// Bisecting what the sound costs a frame:
//   --arms off,on,frozen,earoff --pairs 5   flies each arm in turn, `pairs` times round (interleaved, one build), and
//                                           prints the medians. Arms: off (no sound), on, and the page's measuring arms
//                                           (?soundarm=): noctx (wanted, no context ever), frozen (everything runs, the
//                                           context suspended once built: no audio thread), earoff (no ear), earlocal (the
//                                           ear in the frame loop), nosurf (no waves or beds), muted (on, volume 0).
//   --rates 4          which CPU rates to fly at (default 1,<rate>)
//   --warm 8           seconds to fly before the timed window starts (the kit and the graphs are built by then)
//   --gc               traces V8's garbage collections on the main thread and counts them (adds overhead: its own runs)
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
  const o = { rate: 4, seconds: 30, port: 4318, out: ".cache/world-fly", sound: false, soundlog: null, arms: null, pairs: 1, rates: null, warm: 0, gc: false, arm: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--seconds") o.seconds = Number(argv[++i]);
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--sound") o.sound = true;
    else if (a === "--soundlog") o.soundlog = argv[++i];
    else if (a === "--arms") o.arms = argv[++i].split(",");
    else if (a === "--pairs") o.pairs = Number(argv[++i]);
    else if (a === "--rates") o.rates = argv[++i].split(",").map(Number);
    else if (a === "--warm") o.warm = Number(argv[++i]);
    else if (a === "--gc") o.gc = true;
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
  // Counts the AudioContexts the page makes: with sound off there must be none.
  await page.evaluateOnNewDocument(() => {
    window.__audioContexts = 0;
    const Real = window.AudioContext;
    if (Real) {
      window.AudioContext = class extends Real {
        constructor(...args) {
          super(...args);
          window.__audioContexts++;
        }
      };
    }
  });
  if (!opts.sound) {
    // Arms share one browser: an earlier arm's stored "on" must not leak into this one.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.removeItem("world.sound");
        localStorage.removeItem("world.sound.volume");
      } catch {
        // storage blocked: nothing stored
      }
    });
  }
  if (opts.sound) {
    await page.evaluateOnNewDocument((volume) => {
      try {
        if (volume !== null) localStorage.setItem("world.sound.volume", volume);
        else localStorage.removeItem("world.sound.volume");
        localStorage.setItem("world.sound", "on");
      } catch {
        // storage blocked: the page starts muted
      }
    }, opts.arm === "muted" ? "0" : null);
  }
  const t0 = Date.now();
  const pageArm = opts.arm && !["on", "off", "muted"].includes(opts.arm) ? `&soundarm=${opts.arm}` : "";
  await page.goto(`${origin}world?stats${opts.soundlog ? "&soundlog" : ""}${pageArm}`, { waitUntil: "load" });
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
  let warmStep = 0;
  if (opts.warm > 0) {
    // Fly first, so the sound (if any) has unlocked and built everything before the timed window opens.
    const until = Date.now() + opts.warm * 1000;
    while (Date.now() < until) {
      const [key, held] = ROUTE[warmStep++ % ROUTE.length];
      if (key) await page.keyboard.down(key);
      await new Promise((r) => setTimeout(r, Math.min(held * 1000, Math.max(0, until - Date.now()))));
      if (key) await page.keyboard.up(key);
    }
  }
  if (opts.gc) await page.tracing.start({ categories: ["v8", "disabled-by-default-v8.gc", "devtools.timeline"] });
  await page.evaluate(() => {
    window.__flight.frameMs.length = 0;
    window.__flight.skyMs.length = 0;
    if (window.__flight.soundMs) window.__flight.soundMs.length = 0;
    if (window.__flight.soundKit) window.__flight.soundKit.length = 0;
    if (window.__flight.soundWork) window.__flight.soundWork.length = 0;
    // The noise floor of the measure itself: a fixed, tiny piece of work timed each frame. Under CPU throttling the
    // main thread is paused in slices, so even this reads long now and then; nothing shorter than it can be told.
    window.__null = [];
    const tick = () => {
      const a = performance.now();
      let x = 0;
      for (let i = 0; i < 300; i++) x += i;
      window.__null.push(performance.now() - a + x * 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__flight.hazeFrames = 0;
    window.__flight.frames = 0;
  });
  const bakedAt0 = (await page.evaluate(() => window.__flight.baked())) ?? 0;
  await shot("00s");
  const start = Date.now();
  let step = warmStep;
  while ((Date.now() - start) / 1000 < opts.seconds) {
    const [key, held] = ROUTE[step++ % ROUTE.length];
    if (key) await page.keyboard.down(key);
    await new Promise((r) => setTimeout(r, held * 1000));
    if (key) await page.keyboard.up(key);
    const t = (Date.now() - start) / 1000;
    if (t >= 10 && !shots.some((s) => s.endsWith("-10s.png"))) await shot("10s");
  }
  await shot(`${opts.seconds}s`);
  const res = await page.evaluate(() => ({
    frameMs: [...window.__flight.frameMs],
    skyMs: [...window.__flight.skyMs],
    soundMs: window.__flight.soundMs ? [...window.__flight.soundMs] : [],
    soundKit: window.__flight.soundKit ? [...window.__flight.soundKit] : [],
    soundWork: window.__flight.soundWork ? [...window.__flight.soundWork] : [],
    nullMs: [...window.__null],
    soundState: window.__flight.soundState ?? null,
    soundSettled: window.__flight.soundSettled ?? null,
    heap: performance.memory ? performance.memory.usedJSHeapSize : null,
    audioContexts: window.__audioContexts ?? 0,
    hazeFrames: window.__flight.hazeFrames,
    frames: window.__flight.frames,
    baked: window.__flight.baked(),
  }));
  const secs = (Date.now() - start) / 1000;
  let gc = null;
  if (opts.gc) {
    // Garbage collections on the renderer's main thread during the window: how many, and how long they took in all.
    const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString("utf8"));
    const events = trace.traceEvents ?? [];
    const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
    const mine = events.filter((e) => (!main || (e.pid === main.pid && e.tid === main.tid)) && e.ph === "X");
    const sum = (name) => {
      const xs = mine.filter((e) => e.name === name);
      return { n: xs.length, ms: Number((xs.reduce((a, e) => a + (e.dur ?? 0), 0) / 1000).toFixed(2)) };
    };
    gc = { minor: sum("MinorGC"), major: sum("MajorGC"), perSecond: Number((sum("MinorGC").n / secs).toFixed(2)) };
  }
  if (opts.soundlog && rate === 1) {
    const log = await page.evaluate(() => JSON.stringify(window.__flight.soundLog ?? null));
    mkdirSync(path.dirname(path.resolve(opts.soundlog)), { recursive: true });
    writeFileSync(opts.soundlog, log);
  }
  await page.close();
  // The sound's ms with the kit's share taken out, frame by frame.
  const soundNoKit = res.soundMs.map((ms, i) => Math.max(0, ms - (res.soundKit[i] ?? 0)));
  // The unlock frame is the first in which the sound did anything; the longest frames after it, with what they did
  // (bits: 1 a build step, 2 kit, 4 the mix, 8 a wave started, 16 a lap, 32 enabling, 64 a clock sample).
  const unlock = res.soundMs.findIndex((ms, i) => ms > 0 || (res.soundWork[i] ?? 0) !== 0);
  const after = res.soundMs.map((ms, i) => ({ ms, frame: i - unlock, work: res.soundWork[i] ?? 0, kit: res.soundKit[i] ?? 0 })).filter((f) => f.frame > 0);
  const longest = [...after].sort((a, b) => b.ms - a.ms).slice(0, 6).map((f) => ({ ms: Number(f.ms.toFixed(2)), frame: f.frame, work: f.work, kitMs: Number(f.kit.toFixed(2)) }));
  return {
    label, rate, readyMs: boot.readyAt - boot.navStart, wallToReadyMs: Date.now() - t0 - secs * 1000,
    frames: res.frames, fps: res.frames / secs,
    frameMsP50: pct(res.frameMs, 0.5), frameMsP95: pct(res.frameMs, 0.95), frameMsMax: pct(res.frameMs, 1),
    skyMsP50: pct(res.skyMs, 0.5), skyMsP95: pct(res.skyMs, 0.95), skyMsMax: pct(res.skyMs, 1),
    ...(opts.sound
      ? {
          soundMsP50: pct(res.soundMs, 0.5), soundMsP95: pct(res.soundMs, 0.95), soundMsMax: pct(res.soundMs, 1),
          soundNoKitMsP50: pct(soundNoKit, 0.5), soundNoKitMsP95: pct(soundNoKit, 0.95), soundNoKitMsMax: pct(soundNoKit, 1),
          soundMsMean: res.soundMs.reduce((a, b) => a + b, 0) / Math.max(1, res.soundMs.length),
          soundKitFrames: res.soundKit.filter((ms) => ms > 0).length,
          soundMsUnlockFrame: unlock >= 0 ? res.soundMs[unlock] : null,
          soundMsMaxAfterUnlock: after.length ? Math.max(...after.map((f) => f.ms)) : 0,
          soundFramesOver1ms: after.filter((f) => f.ms > 1).length,
          soundLongest: longest,
          // Once everything is built (from 5 s after the unlock): the figure the game lives with.
          soundSteady: (() => {
            const from = unlock + Math.round(5 * (res.frames / secs));
            const ms = res.soundMs.slice(from), work = res.soundWork.slice(from);
            const mean = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null);
            const of = (pick) => ms.filter((_, i) => pick(work[i]));
            return {
              frames: ms.length, p95: pct(ms, 0.95), max: pct(ms, 1), mean: mean(ms), over1ms: ms.filter((x) => x > 1).length,
              meanPlain: mean(of((w) => (w & 132) === 0)), meanMix: mean(of((w) => (w & 4) !== 0)), meanWaves: mean(of((w) => (w & 128) !== 0)),
              shareMix: Number((of((w) => (w & 4) !== 0).length / Math.max(1, ms.length)).toFixed(3)),
            };
          })(),
        }
      : { soundMsMax: res.soundMs.length ? Math.max(...res.soundMs) : 0 }),
    soundState: res.soundState, soundSettled: res.soundSettled, audioContexts: res.audioContexts, gc,
    soundMsMeanAll: res.soundMs.length ? res.soundMs.reduce((a, b) => a + b, 0) / res.soundMs.length : 0,
    soundMsP95All: pct(res.soundMs, 0.95),
    nullMsP95: pct(res.nullMs, 0.95), nullMsMax: pct(res.nullMs, 1), nullFramesOver1ms: res.nullMs.filter((ms) => ms > 1).length,
    hazeFrames: res.hazeFrames, chunksPerSecond: (res.baked - bakedAt0) / secs, shots, errors,
  };
}

const opts = parseArgs(process.argv.slice(2));
mkdirSync(opts.out, { recursive: true });
const server = await listen(opts.port);
const origin = `http://127.0.0.1:${opts.port}/`;
const browser = await puppeteer.launch({ headless: "shell", args: opts.sound || opts.arms ? ["--autoplay-policy=no-user-gesture-required"] : [] });
try {
  const rates = opts.rates ?? [1, opts.rate];
  if (opts.arms) {
    // Each arm in turn, `pairs` times round: interleaved, so slow minutes of the machine fall on every arm alike.
    const runs = [];
    for (let i = 0; i < opts.pairs; i++) {
      for (const arm of opts.arms) {
        for (const rate of rates) {
          const r = await fly(browser, origin, { ...opts, arm, sound: arm !== "off" }, `${arm}-x${rate}`, rate);
          runs.push({ arm, rate, round: i, ...r, shots: undefined });
          console.log(`${String(i + 1).padStart(2)} ${arm.padEnd(9)} x${rate}  frame p50 ${r.frameMsP50.toFixed(1)} p95 ${r.frameMsP95.toFixed(1)}  sound mean ${(r.soundMsMeanAll * 1000).toFixed(0)} µs p95 ${r.soundMsP95All.toFixed(1)}  null max ${r.nullMsMax.toFixed(1)}  ${r.soundState}${r.gc ? `  gc minor ${r.gc.minor.n} (${r.gc.minor.ms} ms) major ${r.gc.major.n} (${r.gc.major.ms} ms)` : ""}${r.errors.length ? `  errors ${r.errors.length}` : ""}`);
        }
      }
    }
    const median = (xs) => {
      const v = [...xs].sort((a, b) => a - b);
      return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
    };
    console.log("\nmedians");
    for (const rate of rates) {
      const off = runs.filter((r) => r.arm === "off" && r.rate === rate);
      for (const arm of opts.arms) {
        const mine = runs.filter((r) => r.arm === arm && r.rate === rate);
        const p95 = mine.map((r) => r.frameMsP95);
        console.log(
          `${arm.padEnd(9)} x${rate}  frame p50 ${median(mine.map((r) => r.frameMsP50)).toFixed(2)}  p95 ${median(p95).toFixed(2)} (${Math.min(...p95).toFixed(1)}–${Math.max(...p95).toFixed(1)})` +
            `${off.length && arm !== "off" ? `  on − off ${(median(p95) - median(off.map((r) => r.frameMsP95))).toFixed(2)}` : ""}` +
            `  sound mean ${(median(mine.map((r) => r.soundMsMeanAll)) * 1000).toFixed(0)} µs  p95 ${median(mine.map((r) => r.soundMsP95All)).toFixed(2)}` +
            `${mine[0]?.gc ? `  minor GCs ${median(mine.map((r) => r.gc.minor.n))} (${median(mine.map((r) => r.gc.minor.ms)).toFixed(1)} ms)  major ${median(mine.map((r) => r.gc.major.n))}` : ""}`,
        );
      }
    }
    writeFileSync(path.join(opts.out, "arms.json"), JSON.stringify(runs, null, 2));
  } else {
  const results = [];
  for (const rate of rates) results.push(await fly(browser, origin, opts, rate === 1 ? "plain" : `throttled-x${rate}`, rate));
  writeFileSync(path.join(opts.out, "result.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  }
} finally {
  await browser.close();
  server.close();
}
