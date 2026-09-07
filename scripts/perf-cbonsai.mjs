#!/usr/bin/env node
/**
 * Frame-time and main-thread cost of cbonsai in a real (headless) Chrome.
 *
 *   npm run dev            # in another shell
 *   node scripts/perf-cbonsai.mjs [http://localhost:3000]
 *
 * Opens the site, opens the terminal, runs a few cbonsai configurations and
 * samples requestAnimationFrame deltas, long tasks, the CPU time of every
 * growth tick and every paint, and the JS heap. Background throttling is
 * disabled so the numbers reflect a visible tab.
 */
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:3000";
const SAMPLE_SECONDS = 6;

const RUNS = [
  { label: "default live, -t 0.03", cmd: "cbonsai -l -s 1" },
  { label: "fast live, -t 0.001 (max paint rate)", cmd: "cbonsai -l -t 0.001 -s 1" },
  { label: "infinite fast, -w 0.3", cmd: "cbonsai -li -t 0.001 -w 0.3 -s 1" },
  { label: "heavy tree, -L 200 -M 20 -t 0.001", cmd: "cbonsai -l -t 0.001 -L 200 -M 20 -s 3" },
  { label: "heavy tree non-live (1.7M steps, sliced)", cmd: "cbonsai -L 200 -M 20 -s 3", seconds: 3 },
  { label: "infinite default, 60 s heap check", cmd: "cbonsai -li -t 0.005 -w 0.2 -s 1", seconds: 60, heapOnly: true },
];

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(url, { waitUntil: "networkidle0" });

async function openTerminal() {
  await page.click(".term-launch");
  await page.waitForSelector(".term-input");
}

async function run(cmd) {
  await page.focus(".term-input");
  await page.keyboard.type(cmd);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".term-grid-live", { timeout: 5000 });
}

async function quit() {
  await page.keyboard.press("q");
  await page.waitForSelector(".term-input", { timeout: 5000 });
}

await page.evaluate(() => {
  const perf = { ticks: [], flushes: [] };
  window.__perf = perf;
  const oRaf = window.requestAnimationFrame.bind(window);
  const oST = window.setTimeout.bind(window);
  window.requestAnimationFrame = (cb) =>
    oRaf((t) => {
      const s = performance.now();
      cb(t);
      perf.flushes.push(performance.now() - s);
    });
  window.setTimeout = (cb, ms, ...a) =>
    oST(
      typeof cb === "function"
        ? (...args) => {
            const s = performance.now();
            cb(...args);
            perf.ticks.push(performance.now() - s);
          }
        : cb,
      ms,
      ...a,
    );
});

function sample(seconds) {
  return page.evaluate(async (secs) => {
    const perf = window.__perf;
    perf.ticks.length = 0;
    perf.flushes.length = 0;
    const heapStart = performance.memory?.usedJSHeapSize ?? 0;
    const r = await new Promise((res) => {
      const deltas = [];
      const long = [];
      let last = performance.now();
      const start = last;
      let po = null;
      try {
        po = new PerformanceObserver((l) => {
          for (const e of l.getEntries()) long.push(e.duration);
        });
        po.observe({ entryTypes: ["longtask"] });
      } catch {
        /* no longtask support */
      }
      const frame = (t) => {
        deltas.push(t - last);
        last = t;
        if (t - start < secs * 1000) requestAnimationFrame(frame);
        else {
          if (po) po.disconnect();
          res({ deltas, long });
        }
      };
      requestAnimationFrame(frame);
    });
    const stats = (arr) => {
      const d = [...arr].sort((a, b) => a - b);
      const p = (q) => (d.length ? d[Math.floor(q * (d.length - 1))] : 0);
      return {
        n: d.length,
        mean: +(d.reduce((a, b) => a + b, 0) / (d.length || 1)).toFixed(3),
        p50: +p(0.5).toFixed(2),
        p95: +p(0.95).toFixed(2),
        p99: +p(0.99).toFixed(2),
        max: +(d[d.length - 1] ?? 0).toFixed(2),
      };
    };
    const fr = r.deltas.slice(1);
    const grid = document.querySelector(".term-grid-live");
    return {
      fps: +(fr.length / secs).toFixed(1),
      frameMs: stats(fr),
      framesOver33ms: fr.filter((x) => x > 33).length,
      longTasks: r.long.length,
      longTaskMaxMs: +Math.max(0, ...r.long).toFixed(1),
      tickCpuMs: stats(perf.ticks),
      flushCpuMs: stats(perf.flushes),
      heapStartMB: +(heapStart / 1048576).toFixed(1),
      heapEndMB: +((performance.memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(1),
      grid: grid ? `${grid.children.length} rows × ${Math.round(grid.getBoundingClientRect().width / 7.8)} cols` : "gone",
    };
  }, seconds);
}

await openTerminal();
const results = [];
for (const r of RUNS) {
  await run(r.cmd);
  const s = await sample(r.seconds ?? SAMPLE_SECONDS);
  await quit();
  results.push({ label: r.label, cmd: r.cmd, ...s });
  const line = r.heapOnly
    ? `heap ${s.heapStartMB} MB -> ${s.heapEndMB} MB over ${r.seconds} s, ${s.longTasks} long tasks`
    : `${s.fps} fps, frame p50 ${s.frameMs.p50} / p95 ${s.frameMs.p95} / max ${s.frameMs.max} ms, ` +
      `${s.framesOver33ms} frames >33 ms, ${s.longTasks} long tasks, ` +
      `tick cpu mean ${s.tickCpuMs.mean} / max ${s.tickCpuMs.max} ms, paint cpu mean ${s.flushCpuMs.mean} / max ${s.flushCpuMs.max} ms`;
  console.log(`${r.label.padEnd(40)} ${line}`);
}
await browser.close();
console.log("\n" + JSON.stringify(results, null, 2));
