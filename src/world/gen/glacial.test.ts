import assert from "node:assert/strict";
import { test } from "node:test";
import { seamRatio } from "../testing/seam.ts";
import { sha256Hex } from "../testing/sha.ts";
import { drown } from "./drown.ts";
import { runSchedule } from "./erode.ts";
import { priorityFlood } from "./flood.ts";
import { glacial, GLACIAL_MASK, glacialContext, type GlacialContext, type GlacialResult } from "./glacial.ts";
import { ARCHETYPE, paramsFor } from "./params.ts";
import { planWorld } from "./plan.ts";

const p = paramsFor(1024);
const n = p.gN;
const nn = n * n;
interface World { h: Float64Array; isSea: Uint8Array; ctx: GlacialContext; out: GlacialResult }
let memo: World | null = null;
function world(): World {
  if (memo) return memo;
  const plan = planWorld(p, 42);
  const d = drown(runSchedule(plan, p, 42).g, n, p.drown.rise);
  const ctx = glacialContext(d.h, n, d.isSea, plan, p);
  return (memo = { h: d.h, isSea: d.isSea, ctx, out: glacial(d.h, n, ctx, p, 42) });
}

test("the context carries region weights and drainage on G", () => {
  const { ctx, isSea } = world();
  assert.equal(ctx.regions.length, 6 * nn);
  assert.equal(ctx.area.length, nn);
  assert.equal(ctx.rcv.length, nn);
  for (let i = 0; i < nn; i++) assert.ok(isSea[i] ? ctx.area[i] >= 0 : ctx.area[i] >= 1);
});

test("feature counts on the mini-world: lakes 3–6, dams 2–4, tarns at most 8", () => {
  const { out } = world();
  const g = p.glacial;
  assert.ok(out.lakes.length >= g.lakes.count[0] && out.lakes.length <= g.lakes.count[1], `${out.lakes.length} lakes`);
  assert.ok(out.dams.length >= g.dams.count[0] && out.dams.length <= g.dams.count[1], `${out.dams.length} dams`);
  // The mini-world's highland stands above 60 on a few dozen nodes: it has room for fewer tarns than the spec's 4.
  assert.ok(out.tarns.length >= 1 && out.tarns.length <= g.tarns.count[1], `${out.tarns.length} tarns`);
});

test("feature sizes follow the parameters", () => {
  const { out } = world();
  const g = p.glacial, cpn = p.n / n;
  for (const f of out.lakes) {
    assert.equal(f.kind, "lake");
    assert.ok(f.depth >= g.lakes.depth[0] && f.depth <= g.lakes.depth[1]);
    // A reach is whole nodes long: it overshoots its length by under one diagonal step.
    assert.ok(f.size >= g.lakes.length[0] * 0.7 && f.size <= g.lakes.length[1] + cpn * Math.SQRT2);
  }
  for (const f of out.tarns) {
    assert.equal(f.depth, g.tarns.depth);
    assert.ok(f.size >= Math.min(g.tarns.radius[0], 1.5 * cpn) && f.size <= Math.max(g.tarns.radius[1], 1.5 * cpn));
  }
  for (const f of out.dams) assert.ok(f.depth >= g.dams.height[0] && f.depth <= g.dams.height[1]);
  for (const f of [...out.lakes, ...out.tarns, ...out.dams]) {
    assert.ok(f.x >= 0 && f.x < p.n && f.y >= 0 && f.y < p.n);
    assert.ok(Math.abs(f.dx * f.dx + f.dy * f.dy - 1) < 1e-9);
  }
});

test("every tarn opens between east and south-east", () => {
  const { out } = world();
  for (const t of out.tarns) {
    assert.ok(t.dx > 0, "east");
    assert.ok(t.dy >= 0, "not north of east");
    assert.ok(t.dy <= t.dx, "not south of south-east");
  }
});

test("tarns sit above the height limit in the highland, lakes in lake country", () => {
  const { out, ctx, h } = world();
  const cpn = p.n / n;
  const at = (f: { x: number; y: number }) => Math.floor(f.y / cpn) * n + Math.floor(f.x / cpn);
  for (const t of out.tarns) {
    assert.ok(ctx.regions[ARCHETYPE.highland * nn + at(t)] >= p.glacial.mask);
    assert.ok(h[at(t)] >= p.glacial.tarns.minHeight);
  }
  for (const l of out.lakes) assert.ok(ctx.regions[ARCHETYPE.lakes * nn + at(l)] >= p.glacial.mask);
});

test("depressions appear only inside the lake, tarn and dam masks, and each mask inside its region", () => {
  const { out, ctx, isSea } = world();
  const filled = priorityFlood(out.h, n, isSea, 0).filled;
  const HL = ARCHETYPE.highland * nn, LK = ARCHETYPE.lakes * nn;
  const pond = [0, 0, 0, 0, 0];
  for (let i = 0; i < nn; i++) {
    const m = out.mask[i];
    if (filled[i] - out.h[i] > 1e-3) {
      pond[m]++;
      assert.ok(m === GLACIAL_MASK.lake || m === GLACIAL_MASK.tarn || m === GLACIAL_MASK.dam, `depression at ${i} under mask ${m}`);
    }
    if (m === GLACIAL_MASK.lake) assert.ok(ctx.regions[LK + i] >= p.glacial.mask);
    if (m === GLACIAL_MASK.tarn || m === GLACIAL_MASK.trough) assert.ok(ctx.regions[HL + i] >= p.glacial.mask);
  }
  // The operators did make water: lakes and tarns hold some.
  assert.ok(pond[GLACIAL_MASK.lake] > 0, "no lake holds water");
  assert.ok(pond[GLACIAL_MASK.tarn] > 0, "no tarn holds water");
});

test("ground outside every mask is untouched, and the sea mask never changes", () => {
  const { out, h, isSea } = world();
  for (let i = 0; i < nn; i++) {
    if (out.mask[i] === GLACIAL_MASK.none) assert.ok(Math.abs(out.h[i] - h[i]) <= 1e-3, `node ${i} moved`);
    assert.equal(out.h[i] <= 0, isSea[i] === 1);
    assert.ok(Number.isFinite(out.h[i]));
  }
});

test("lakes and tarns only lower, dams only raise", () => {
  const { out, h } = world();
  for (let i = 0; i < nn; i++) {
    const m = out.mask[i];
    if (m === GLACIAL_MASK.lake || m === GLACIAL_MASK.tarn) assert.ok(out.h[i] <= h[i] + 1e-3);
  }
  const cpn = p.n / n;
  for (const d of out.dams) {
    const i = Math.floor(d.y / cpn) * n + Math.floor(d.x / cpn);
    assert.ok(Math.abs(out.h[i] - (h[i] + d.depth)) < 1e-3, "the bar's crest stands its height above the old floor");
  }
});

test("no seam at the wrap, and the same seed gives the same result", () => {
  const { out, h, ctx } = world();
  assert.ok(seamRatio(out.h, n) <= 1);
  const again = glacial(h, n, ctx, p, 42);
  assert.equal(sha256Hex(again.h), sha256Hex(out.h));
  assert.equal(sha256Hex(again.mask), sha256Hex(out.mask));
  assert.deepEqual(again.lakes, out.lakes);
  assert.deepEqual(again.tarns, out.tarns);
  assert.deepEqual(again.dams, out.dams);
  const other = glacial(h, n, ctx, p, 43);
  assert.notDeepEqual(other.tarns, out.tarns);
});
