import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { bumpy } from "../testing/fixtures.ts";
import { seamRatio } from "../testing/seam.ts";
import { sha256Hex } from "../testing/sha.ts";
import { diffuseImplicit, type ErodeState, erodeStep, runSchedule, type ScheduleResult } from "./erode.ts";
import { priorityFlood } from "./flood.ts";
import { ARCHETYPE, paramsFor } from "./params.ts";
import { planWorld } from "./plan.ts";

const fill = (n: number, v: number) => new Float64Array(n).fill(v);

test("a uniform-uplift channel reaches the analytic steady profile", () => {
  const n = 65, U = 1e-3, K = 1e-4, N = n * n;
  const isSea = new Uint8Array(N), uplift = fill(N, U);
  for (let y = 0; y < n; y++) { isSea[y * n] = 1; uplift[y * n] = 0; }
  const s: ErodeState = { n, h: new Float64Array(N), uplift, k: fill(N, K), d: fill(N, 0), isSea, jitter: null, rain: null, eps: 1e-9, diffusionSweeps: 0 };
  let last = { upliftFlux: 0, erosionFlux: 0 };
  for (let i = 0; i < 300; i++) last = erodeStep(s, 1e4);
  const want = new Float64Array(n);
  for (let x = 1; x <= 32; x++) want[x] = want[x - 1] + U / (K * Math.sqrt(33 - x));
  for (let x = 64; x >= 33; x--) want[x] = (x === 64 ? 0 : want[x + 1]) + U / (K * Math.sqrt(x - 32));
  for (let y = 0; y < n; y++) for (let x = 1; x < n; x++) {
    const got = s.h[y * n + x];
    assert.ok(Math.abs(got - want[x]) <= 1e-6 * want[x], `(${x},${y}) ${got} vs ${want[x]}`);
  }
  assert.ok(Math.abs(last.erosionFlux / last.upliftFlux - 1) <= 1e-6);
});

test("with U = 0 and D = 0 no node rises by more than ε on a pit-free field", () => {
  const f = bumpy(64, 11), N = 64 * 64, h = priorityFlood(f.h, 64, f.isSea, 1e-6).filled;
  const s: ErodeState = { n: 64, h: h.slice(), uplift: fill(N, 0), k: fill(N, 2e-3), d: fill(N, 0), isSea: f.isSea, jitter: null, rain: null, eps: 1e-6, diffusionSweeps: 0 };
  for (let i = 0; i < 20; i++) {
    const before = s.h.slice();
    erodeStep(s, 100);
    for (let j = 0; j < N; j++) assert.ok(s.h[j] <= before[j] + 1e-6 + 1e-12);
  }
});

test("erosion lowers land under no uplift", () => {
  const f = bumpy(64, 12), N = 64 * 64, h = priorityFlood(f.h, 64, f.isSea, 1e-6).filled;
  const s: ErodeState = { n: 64, h: h.slice(), uplift: fill(N, 0), k: fill(N, 2e-3), d: fill(N, 0), isSea: f.isSea, jitter: null, rain: null, eps: 1e-6, diffusionSweeps: 0 };
  const sum0 = s.h.reduce((a, b) => a + b, 0);
  const st = erodeStep(s, 100);
  assert.ok(s.h.reduce((a, b) => a + b, 0) < sum0 - 1);
  assert.equal(st.upliftFlux, 0);
  assert.ok(st.erosionFlux > 0);
});

test("implicit diffusion conserves mass on an all-land torus and smooths it", () => {
  const f = bumpy(48, 13), h = f.h.map((v) => v + 20), sum0 = h.reduce((a, b) => a + b, 0);
  let var0 = 0;
  for (const v of h) var0 += (v - sum0 / h.length) ** 2;
  diffuseImplicit(h, 48, fill(48 * 48, 0.5), 10, 8, null);
  const sum1 = h.reduce((a, b) => a + b, 0);
  let var1 = 0;
  for (const v of h) var1 += (v - sum1 / h.length) ** 2;
  assert.ok(Math.abs(sum1 - sum0) <= 1e-9 * Math.abs(sum0));
  assert.ok(var1 < var0 * 0.5);
});

test("diffusion never writes fixed nodes", () => {
  const f = bumpy(48, 14), h = f.h.slice();
  diffuseImplicit(h, 48, fill(48 * 48, 0.5), 10, 8, f.isSea);
  for (let i = 0; i < h.length; i++) if (f.isSea[i]) assert.equal(h[i], f.h[i]);
});

const p = paramsFor(1024);
let memo: ScheduleResult | null = null;
const run = () => (memo ??= runSchedule(planWorld(p, 42), p, 42));

test("schedule output is sized, finite and pit-free", () => {
  const r = run();
  assert.equal(r.gN, 256);
  assert.equal(r.g.length, 256 * 256);
  assert.equal(r.isSea.length, 256 * 256);
  let land = 0;
  for (let i = 0; i < r.g.length; i++) {
    assert.ok(Number.isFinite(r.g[i]));
    if (r.isSea[i]) assert.ok(r.g[i] <= 0);
    else { land++; assert.ok(r.g[i] > 0); }
  }
  assert.ok(land > 0.15 * r.g.length);
  const f = priorityFlood(r.g, r.gN, r.isSea, 0).filled;
  for (let i = 0; i < r.g.length; i++) if (!r.isSea[i]) assert.ok(Math.abs(f[i] - r.g[i]) <= 1e-6, `pit at ${i}`);
});

test("schedule reports steadiness and stops early or at the cap", () => {
  const r = run();
  assert.ok(r.steadinessC > 0 && r.steadinessC <= 1.5);
  assert.ok(r.steadinessG > 0 && r.steadinessG <= 1.5);
  assert.ok(r.stepsC >= 1 && r.stepsC <= p.erode.cSteps);
  assert.ok(r.steadinessC >= p.erode.stopAt || r.stepsC === p.erode.cSteps);
});

test("no seam at the wrap after erosion", () => {
  const r = run();
  assert.ok(seamRatio(r.g, r.gN) <= 1);
});

test("deterministic twice and in a worker_threads worker", async () => {
  const want = sha256Hex(run().g);
  assert.equal(sha256Hex(runSchedule(planWorld(p, 42), p, 42).g), want);
  const got = await new Promise<string>((resolve, reject) => {
    const w = new Worker(new URL("../testing/schedule.worker.ts", import.meta.url), { workerData: { n: 1024, seed: 42 } });
    w.once("message", resolve);
    w.once("error", reject);
  });
  assert.equal(got, want);
});

test("with a threshold slope no node stands steeper above its receiver, ribs steeper than gullies", () => {
  const f = bumpy(64, 15), N = 64 * 64, h = priorityFlood(f.h, 64, f.isSea, 1e-6).filled;
  const base: ErodeState = { n: 64, h: h.slice(), uplift: fill(N, 0), k: fill(N, 2e-3), d: fill(N, 0), isSea: f.isSea, jitter: null, rain: null, eps: 1e-6, diffusionSweeps: 0 };
  // The fall to the lowest neighbour, per node of distance: the steepest way down.
  const steepest = (g: Float64Array) => {
    let worst = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      if (f.isSea[i]) continue;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const j = ((y + dy + 64) % 64) * 64 + ((x + dx + 64) % 64);
        s = Math.max(s, (g[i] - Math.max(g[j], 0)) / Math.sqrt(dx * dx + dy * dy));
      }
      worst = Math.max(worst, s);
    }
    return worst;
  };
  assert.ok(steepest(h) > 2, "the field is steep without a threshold");
  // No river power: only the threshold acts, and the ground settles to it.
  const cut: ErodeState = { ...base, k: fill(N, 0), h: h.slice(), sc: fill(N, 0.5) };
  for (let i = 0; i < 40; i++) erodeStep(cut, 100);
  assert.ok(steepest(cut.h) <= 0.5 + 1e-6, `steepest ${steepest(cut.h)}`);
  const fluted: ErodeState = { ...base, k: fill(N, 0), h: h.slice(), sc: fill(N, 0.5), scArea: 4, scRange: [0.5, 1.5] };
  for (let i = 0; i < 40; i++) erodeStep(fluted, 100);
  const s = steepest(fluted.h);
  assert.ok(s > 0.5 && s <= 0.75 + 1e-6, `steepest ${s}`);
  const pits = priorityFlood(fluted.h, 64, f.isSea, 0).filled;
  for (let i = 0; i < N; i++) assert.ok(Math.abs(pits[i] - fluted.h[i]) <= 1e-6, `pit at ${i}`);
});

/** How far the highest ground strays to either side of the highland's spine, in G nodes (RMS about its mean), over the middle of its length. */
function crestWander(r: ScheduleResult, spine: Float64Array, cellsPerNode: number): number {
  const reach = 8, offs: number[] = [];
  for (let k = 0; k + 3 < spine.length; k += 2) {
    const ax = spine[k], ay = spine[k + 1], bx = spine[k + 2], by = spine[k + 3];
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let t = 0; t < Math.floor(len / cellsPerNode); t++) {
      const px = ax + ux * t * cellsPerNode, py = ay + uy * t * cellsPerNode;
      let best = -1, at = 0;
      for (let c = -reach; c <= reach; c++) {
        const gx = ((Math.floor((px - uy * c * cellsPerNode) / cellsPerNode) % r.gN) + r.gN) % r.gN;
        const gy = ((Math.floor((py + ux * c * cellsPerNode) / cellsPerNode) % r.gN) + r.gN) % r.gN;
        if (r.g[gy * r.gN + gx] > best) { best = r.g[gy * r.gN + gx]; at = c; }
      }
      offs.push(at);
    }
  }
  const mid = offs.slice(Math.floor(offs.length / 5), offs.length - Math.floor(offs.length / 5));
  const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
  return Math.sqrt(mid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / mid.length);
}

test("the highland's crest wanders: it strays from the spine, far more than a smooth fold belt's", () => {
  const plan = planWorld(p, 42), spine = plan.cores.find((c) => c.archetype === ARCHETYPE.highland)!.spine;
  const rugged = crestWander(run(), spine, p.n / p.gN);
  const smooth = { ...p, uplift: { ...p.uplift, rugged: [0, 0, 0, 0, 0, 0] } };
  const tent = crestWander(runSchedule(planWorld(smooth, 42), smooth, 42), spine, p.n / p.gN);
  assert.ok(rugged >= 2, `the crest strays ${rugged} nodes`);
  assert.ok(rugged >= 2 * tent, `rugged ${rugged} against a fold belt's ${tent}`);
});
