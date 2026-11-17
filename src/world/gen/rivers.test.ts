import assert from "node:assert/strict";
import { test } from "node:test";
import { PI, pcos, psin } from "../core/psin.ts";
import { wrap } from "../core/torus.ts";
import { runSchedule } from "./erode.ts";
import { priorityFlood } from "./flood.ts";
import { type HydroParams, hydrology } from "./hydro.ts";
import { paramsFor } from "./params.ts";
import { planWorld } from "./plan.ts";
import { meanderAlong, meanderMeans, rasterizeRivers, type Reach, type RiverParams, type RiversResult, riverWidth, rivers, selfIntersects } from "./rivers.ts";

const HP: HydroParams = { rainBase: 1, orographic: 0, recharge: 1, depletion: 0, lakeMinNodes: 8, lakeMinDepth: 1.5, qChannel: 64 };
const RP: RiverParams = { ...paramsFor(6400).rivers };
const GN = 96;
const N = GN * 4;

/**
 * A plain draining to a sea strip, gathered into one valley. `flow` is the way
 * the river runs; `step` adds a cliff of that height across its course.
 */
function plain(flow: "south" | "north" | "east", step = 0) {
  const h = new Float64Array(GN * GN), isSea = new Uint8Array(GN * GN);
  for (let y = 0; y < GN; y++) for (let x = 0; x < GN; x++) {
    // along: nodes upstream of the shore; across: nodes from the valley line.
    let along: number, across: number;
    if (flow === "south") { along = GN - 5 - y; across = Math.abs(x - GN / 2); }
    else if (flow === "north") { along = y - 4; across = Math.abs(x - GN / 2); }
    else { along = wrap(39 - x, GN); across = Math.abs(y - GN / 2); }
    const i = y * GN + x;
    if (along < 0 || along > GN - 5) { isSea[i] = 1; h[i] = -3; continue; }
    h[i] = 0.3 + 0.016 * along + 0.05 * across + (along > 50 ? step : 0);
  }
  return { h, isSea };
}

function run(flow: "south" | "north" | "east", step = 0, seed = 7): RiversResult {
  const { h, isSea } = plain(flow, step);
  return rivers({ g: h, gN: GN, isSea, hydro: hydrology(h, GN, isSea, HP) }, RP, seed);
}

const count = (r: Reach) => r.vertices.length / 4;
const xs = (r: Reach) => Array.from({ length: count(r) }, (_, i) => r.vertices[i * 4]);
const ys = (r: Reach) => Array.from({ length: count(r) }, (_, i) => r.vertices[i * 4 + 1]);

function length(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let s = 0;
  for (let i = 1; i < x.length; i++) s += Math.sqrt((x[i] - x[i - 1]) ** 2 + (y[i] - y[i - 1]) ** 2);
  return s;
}

/** The invariants every river network must hold. */
function checkNetwork(res: RiversResult, n: number, lakeLevels: number[] = []) {
  const { reaches } = res;
  assert.ok(reaches.length > 0);
  for (const r of reaches) {
    assert.equal(reaches[r.id], r);
    assert.ok(count(r) >= 2, `reach ${r.id} has ${count(r)} vertices`);
    const v = r.vertices;
    for (let i = 0; i < count(r); i++) {
      const w = v[i * 4 + 2];
      assert.ok(Number.isInteger(w) && w >= 1 && w <= 6, `reach ${r.id} width ${w}`);
      assert.equal(v[i * 4] * 4, Math.round(v[i * 4] * 4));
      assert.equal(v[i * 4 + 1] * 4, Math.round(v[i * 4 + 1] * 4));
      assert.ok(v[i * 4 + 3] >= 0);
      if (i === 0) continue;
      assert.ok(v[i * 4 + 3] <= v[i * 4 - 1], `reach ${r.id} level rises at vertex ${i}`);
      const d = Math.sqrt((v[i * 4] - v[i * 4 - 4]) ** 2 + (v[i * 4 + 1] - v[i * 4 - 3]) ** 2);
      assert.ok(d <= 1.5, `reach ${r.id} jumps ${d} cells at vertex ${i}`);
    }
    const end = v.length - 4;
    if (r.endsIn === "reach") {
      const d = reaches[r.downstream];
      assert.ok(d, `reach ${r.id} flows into nothing`);
      assert.equal(r.lake, -1);
      // The confluence is one point on the torus, and water does not climb into the trunk.
      assert.equal(wrap(v[end], n), wrap(d.vertices[0], n));
      assert.equal(wrap(v[end + 1], n), wrap(d.vertices[1], n));
      assert.ok(v[end + 3] >= d.vertices[3]);
      assert.ok(d.order >= r.order);
    } else {
      assert.equal(r.downstream, -1);
      if (r.endsIn === "lake") assert.ok(v[end + 3] >= lakeLevels[r.lake] - 1e-4);
      else assert.equal(r.lake, -1);
    }
  }
  // Following downstream always ends, at the sea or a lake.
  for (const r of reaches) {
    let cur = r, hops = 0;
    while (cur.endsIn === "reach") { cur = reaches[cur.downstream]; assert.ok(++hops <= reaches.length); }
    assert.ok(cur.endsIn === "sea" || cur.endsIn === "lake");
  }
  for (const f of res.falls) {
    assert.ok(reaches[f.reach]);
    assert.ok(f.drop >= 1);
  }
}

test("width is clamp(round(sqrt(Q / qScale)), 1, 6)", () => {
  assert.equal(riverWidth(40, 420), 1);
  assert.equal(riverWidth(945, 420), 2);
  assert.equal(riverWidth(420 * 9, 420), 3);
  assert.equal(riverWidth(1e9, 420), 6);
});

test("a sine-generated curve on a straight valley has the sinuosity its ω predicts", () => {
  const ax = Array.from({ length: 801 }, (_, i) => i), ay = ax.map(() => 0);
  for (const omega of [0.6, 0.9, 1.2]) {
    // Path length per unit of valley: 1 / mean cos(ω·sin φ) over a wave.
    let c = 0;
    const steps = 4096;
    for (let i = 0; i < steps; i++) c += pcos(omega * psin((2 * PI * (i + 0.5)) / steps));
    const want = steps / c;
    if (omega === 1.2) assert.ok(Math.abs(want - 1.49) < 0.01, `${want}`);
    assert.ok(Math.abs(1 / meanderMeans(omega)[1] - want) < 1e-3);
    const m = meanderAlong(ax, ay, { spec: () => ({ omega, lambda: 40, width: 4 }), wobble: 0, taper: false, scale: 1, step: 0.5, rng: null, oxbowEvery: 0, oxbowMinWidth: 3 });
    assert.ok(m);
    const got = length(m.x, m.y) / 800;
    assert.ok(Math.abs(got / want - 1) < 0.02, `ω ${omega}: sinuosity ${got}, want ${want}`);
    assert.equal(selfIntersects(m.x, m.y), false);
    // It is a wave about the valley line: it comes back to it and never strays far.
    for (let i = 0; i < m.y.length; i++) assert.ok(Math.abs(m.y[i]) < 40);
  }
});

test("selfIntersects sees a crossing and passes a simple line", () => {
  assert.equal(selfIntersects([0, 4, 4, 2, 2], [0, 0, 4, 4, -2]), true);
  assert.equal(selfIntersects([0, 4, 4, 0], [0, 0, 4, 4]), false);
});

test("a wide river on flat land meanders, stays whole and reaches the sea", () => {
  const res = run("south");
  checkNetwork(res, N);
  const main = res.reaches.reduce((a, b) => (count(b) > count(a) ? b : a));
  assert.equal(main.endsIn, "sea");
  const x = xs(main), y = ys(main);
  const straight = Math.sqrt((x[x.length - 1] - x[0]) ** 2 + (y[y.length - 1] - y[0]) ** 2);
  const sinuosity = length(x, y) / straight;
  assert.ok(sinuosity > 1.12 && sinuosity < 1.7, `sinuosity ${sinuosity}`);
  for (const r of res.reaches) assert.equal(selfIntersects(xs(r), ys(r)), false, `reach ${r.id} crosses itself`);
  // It widens downstream.
  assert.ok(main.vertices[main.vertices.length - 2] >= 4);
  assert.ok(main.vertices[2] <= 2);
});

test("the ground is conformed: beds under the water, floors beside it, no new pits", () => {
  const { h, isSea } = plain("south");
  const hy = hydrology(h, GN, isSea, HP);
  const res = rivers({ g: h, gN: GN, isSea, hydro: hy }, RP, 7);
  const filled = priorityFlood(res.ground, GN, isSea, 0).filled;
  let changed = 0;
  for (let i = 0; i < GN * GN; i++) {
    assert.ok(filled[i] - res.ground[i] <= 1e-9, `pit at ${i}`);
    if (isSea[i]) assert.equal(res.ground[i], h[i]);
    else if (res.ground[i] !== hy.ground[i]) changed++;
  }
  assert.ok(changed > 0);
  for (const r of res.reaches) for (let i = 0; i < count(r); i++) {
    const node = wrap(Math.floor(r.vertices[i * 4 + 1] / 4), GN) * GN + wrap(Math.floor(r.vertices[i * 4] / 4), GN);
    if (!isSea[node]) assert.ok(res.ground[node] <= r.vertices[i * 4 + 3] + 1e-6, `bed above water on reach ${r.id}`);
  }
});

test("a drop on a south-flowing river is a waterfall; on a north-flowing one it is graded away", () => {
  const south = run("south", 6);
  checkNetwork(south, N);
  assert.ok(south.falls.length >= 1);
  const f = south.falls.reduce((a, b) => (b.drop > a.drop ? b : a));
  assert.ok(f.drop >= 4, `drop ${f.drop}`);
  const r = south.reaches[f.reach];
  let at = -1;
  for (let i = 0; i < count(r); i++) if (r.vertices[i * 4] === f.x && r.vertices[i * 4 + 1] === f.y) at = i;
  assert.ok(at > 0);
  assert.ok(Math.abs(r.vertices[at * 4 - 1] - r.vertices[at * 4 + 3] - f.drop) < 1e-4);

  const north = run("north", 6);
  checkNetwork(north, N);
  assert.equal(north.falls.length, 0);
  for (const reach of north.reaches) for (let i = 1; i < count(reach); i++) {
    assert.ok(reach.vertices[i * 4 - 1] - reach.vertices[i * 4 + 3] < 1, "a hidden drop was left steep");
  }
});

test("a river runs into a lake and out again by its outlet", () => {
  const { h, isSea } = plain("south");
  for (let y = 0; y < GN; y++) for (let x = 0; x < GN; x++) {
    const r2 = (x - GN / 2) ** 2 + (y - 40) ** 2;
    if (r2 < 36) h[y * GN + x] -= 6 * (1 - r2 / 36);
  }
  const hy = hydrology(h, GN, isSea, HP);
  assert.equal(hy.lakes.length, 1);
  const res = rivers({ g: h, gN: GN, isSea, hydro: hy }, RP, 7);
  checkNetwork(res, N, hy.lakes.map((l) => l.level));
  const into = res.reaches.filter((r) => r.endsIn === "lake");
  const out = res.reaches.filter((r) => r.fromLake === 0);
  assert.ok(into.length >= 1 && into.every((r) => r.lake === 0));
  assert.equal(out.length, 1);
  assert.ok(out[0].vertices[3] <= hy.lakes[0].level + 1e-4);
  // The lake bed keeps its depth, and what flows out has gathered what flowed in.
  const centre = 40 * GN + GN / 2;
  assert.equal(res.ground[centre], hy.ground[centre]);
  assert.ok(out[0].order >= Math.max(...into.map((r) => r.order)));
});

test("a reach that crosses the seam carries on unwrapped", () => {
  const res = run("east");
  checkNetwork(res, N);
  const main = res.reaches.reduce((a, b) => (count(b) > count(a) ? b : a));
  const x = xs(main);
  assert.ok(Math.min(...x) < N && Math.max(...x) > N + 40, `x runs ${Math.min(...x)}..${Math.max(...x)}`);
  // The raster wraps it: cells are painted on both sides of x = 0.
  const mask = rasterizeRivers(res.reaches, N);
  let west = 0, east = 0;
  for (let y = 0; y < N; y++) { for (let k = 0; k < 8; k++) { if (mask[y * N + k]) west++; if (mask[y * N + N - 1 - k]) east++; } }
  assert.ok(west > 0 && east > 0);
});

test("the raster is 8-connected along every reach and a window equals the same crop", () => {
  const res = run("south");
  const mask = rasterizeRivers(res.reaches, N);
  for (const r of res.reaches) {
    const cell = (i: number) => wrap(Math.floor(r.vertices[i * 4 + 1]), N) * N + wrap(Math.floor(r.vertices[i * 4]), N);
    const goal = cell(count(r) - 1), seen = new Uint8Array(N * N), stack = [cell(0)];
    assert.ok(mask[stack[0]] > 0 && mask[goal] > 0);
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack.pop() as number, cx = c % N, cy = (c - cx) / N;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = wrap(cy + dy, N) * N + wrap(cx + dx, N);
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    assert.equal(seen[goal], 1, `reach ${r.id} is broken in the raster`);
  }
  const win = { x0: N - 30, y0: 100, w: 90, h: 70 };
  const crop = rasterizeRivers(res.reaches, N, win);
  for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) {
    assert.equal(crop[y * win.w + x], mask[wrap(win.y0 + y, N) * N + wrap(win.x0 + x, N)]);
  }
});

test("a generated world: every reach leads to the sea, levels fall, and the result is deterministic", () => {
  const p = paramsFor(1024), seed = 42;
  const s = runSchedule(planWorld(p, seed), p, seed);
  const hy = hydrology(s.g, s.gN, s.isSea, p.hydro);
  const a = rivers({ g: s.g, gN: s.gN, isSea: s.isSea, hydro: hy }, p.rivers, seed);
  checkNetwork(a, p.n, hy.lakes.map((l) => l.level));
  assert.ok(a.reaches.length > 20, `${a.reaches.length} reaches`);
  assert.ok(a.reaches.some((r) => r.endsIn === "reach") && a.reaches.some((r) => r.endsIn === "sea"));
  assert.ok(a.reaches.some((r) => r.order >= 2));
  for (const r of a.reaches) assert.equal(selfIntersects(xs(r), ys(r)), false, `reach ${r.id} crosses itself`);

  // Every channel node the hydrology found is on a river.
  const mask = rasterizeRivers(a.reaches, p.n);
  let wet = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) wet++;
  let channels = 0;
  for (let i = 0; i < hy.channel.length; i++) channels += hy.channel[i];
  assert.ok(wet >= channels * 3, `${wet} river cells for ${channels} channel nodes`);

  const filled = priorityFlood(a.ground, s.gN, s.isSea, 0).filled;
  for (let i = 0; i < filled.length; i++) if (hy.lakeId[i] < 0) assert.ok(filled[i] - a.ground[i] <= 1e-9);

  const b = rivers({ g: s.g, gN: s.gN, isSea: s.isSea, hydro: hy }, p.rivers, seed);
  assert.equal(b.reaches.length, a.reaches.length);
  for (let i = 0; i < a.reaches.length; i++) {
    assert.deepEqual(b.reaches[i].vertices, a.reaches[i].vertices);
    assert.equal(b.reaches[i].downstream, a.reaches[i].downstream);
  }
  assert.deepEqual(b.ground, a.ground);
  assert.deepEqual(b.falls, a.falls);
  assert.deepEqual(b.oxbows, a.oxbows);
});
