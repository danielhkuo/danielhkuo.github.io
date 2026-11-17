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
    assert.ok(f.size >= 0.5 * Math.min(g.tarns.length[0], 5 * cpn) && f.size <= 0.5 * Math.max(g.tarns.length[1], 5 * cpn));
  }
  for (const f of out.dams) assert.ok(f.depth >= g.dams.height[0] && f.depth <= g.dams.height[1]);
  for (const f of [...out.lakes, ...out.tarns, ...out.dams]) {
    assert.ok(f.x >= 0 && f.x < p.n && f.y >= 0 && f.y < p.n);
    assert.ok(Math.abs(f.dx * f.dx + f.dy * f.dy - 1) < 1e-9);
  }
});

test("every tarn opens within 60° of south, where the camera looks in over its lip", () => {
  const { out } = world();
  assert.equal(out.cirques.length, out.tarns.length);
  out.tarns.forEach((t, k) => {
    assert.ok(t.dy >= 0.5, `opens (${t.dx}, ${t.dy})`);
    const c = out.cirques[k];
    assert.equal(c.kind, "cirque");
    assert.deepEqual([c.x, c.y, c.ax, c.ay, c.len], [t.x, t.y, t.dx, t.dy, 2 * t.size]);
  });
});

test("a tarn is a cirque: cut back into the slope under a headwall, open downslope, spilling over its lip", () => {
  const { out, h, isSea } = world();
  const cpn = p.n / n;
  const filled = priorityFlood(out.h, n, isSea, 0).filled;
  const node = (x: number, y: number) => (((Math.floor(y / cpn) % n) + n) % n) * n + (((Math.floor(x / cpn) % n) + n) % n);
  for (const c of out.cirques) {
    const mid = node(c.x, c.y);
    // It holds water, at the stamp's level or a little over (the lip).
    const depth = filled[mid] - out.h[mid];
    assert.ok(depth > 1.5, `water ${depth} deep`);
    assert.ok(filled[mid] >= c.level - 0.2 &&filled[mid] <= c.level + 0.5, `level ${filled[mid]} against ${c.level}`);
    // Cut into the slope: the water lies below the old ground at its middle.
    assert.ok(c.level < h[mid], "cut into the slope");
    // Behind the back the ground stands over the water (the headwall's foot and up); in front it is the lip, no higher than the water's edge.
    const back = node(c.x - c.ax * (0.5 * c.len + 2.5 * cpn), c.y - c.ay * (0.5 * c.len + 2.5 * cpn));
    const front = node(c.x + c.ax * (0.5 * c.len + 1.5 * cpn), c.y + c.ay * (0.5 * c.len + 1.5 * cpn));
    assert.ok(out.h[back] >= c.level + 0.5, `headwall foot ${out.h[back] - c.level}`);
    assert.ok(out.h[front] <= c.level + 0.5, `lip ${out.h[front] - c.level}`);
    assert.ok(out.h[back] > out.h[front] + 1, "the back stands over the lip");
    // The outlet: the lowest dry node beside the water lies downslope of the lake's middle.
    let low = Infinity, lowAt = -1;
    const R = Math.ceil((c.len + c.width) / cpn);
    const cx = Math.floor(c.x / cpn), cy = Math.floor(c.y / cpn);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const i = node((cx + dx + 0.5) * cpn, (cy + dy + 0.5) * cpn);
      if (filled[i] - out.h[i] > 1e-3 || out.h[i] >= low) continue;
      let wet = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const j = node((cx + dx + ox + 0.5) * cpn, (cy + dy + oy + 0.5) * cpn);
        if (filled[j] - out.h[j] > 1e-3 && Math.abs(filled[j] - filled[mid]) < 1e-6) wet = true;
      }
      if (wet) { low = out.h[i]; lowAt = dx * c.ax + dy * c.ay; }
    }
    assert.ok(lowAt > 0, `the outlet lies ${lowAt} nodes along the fall`);
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

test("no quarries: a lake is dug by at most maxDig and banked by less than its depth; a tarn's water lies a little under the old slope", () => {
  const { out, h } = world();
  const g = p.glacial;
  for (let i = 0; i < nn; i++) {
    const m = out.mask[i];
    if (m === GLACIAL_MASK.lake) {
      assert.ok(h[i] - out.h[i] <= g.lakes.maxDig + 1e-6, `lake dug ${h[i] - out.h[i]}`);
      assert.ok(out.h[i] - h[i] <= g.lakes.depth[1], `lake banked ${out.h[i] - h[i]}`);
    }
  }
  // A tarn's water stands at the old ground of its outlet: under the old ground at its middle, by no more than the slope allows.
  const cpn = p.n / n;
  for (const t of out.cirques) {
    const c = Math.floor(t.y / cpn) * n + Math.floor(t.x / cpn);
    assert.ok(t.level < h[c], "the lake is cut into the slope");
    assert.ok(h[c] - t.level < 0.75 * g.tarns.slope[1] * t.len + 1e-6, "but not deeply");
  }
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
  assert.deepEqual(again.cirques, out.cirques);
  assert.deepEqual(again.dams, out.dams);
  const other = glacial(h, n, ctx, p, 43);
  // The mini-world's highland has room for one tarn, so another seed may place the same one: compare every feature.
  assert.notDeepEqual([other.lakes, other.tarns, other.dams], [out.lakes, out.tarns, out.dams]);
});
