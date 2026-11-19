import assert from "node:assert/strict";
import { test } from "node:test";
import { torusDist } from "../core/torus.ts";
import { seamRatio } from "../testing/seam.ts";
import { ARCHETYPE, FORM, paramsFor } from "./params.ts";
import { type Plan, planWorld } from "./plan.ts";

const p = paramsFor(1024);
const cN = p.cN;
let memo: Plan | null = null;
const plan = () => (memo ??= planWorld(p, 42));

test("arrays sized to C", () => {
  const pl = plan();
  assert.equal(pl.n, 128);
  for (const a of [pl.uplift, pl.k, pl.d, pl.rock]) assert.equal(a.length, cN * cN);
  assert.equal(pl.regions.length, 6 * cN * cN);
});

test("archetype and form quota", () => {
  const pl = plan();
  const count = (a: number) => pl.cores.filter((c) => c.archetype === a).length;
  const forms = (f: number) => pl.cores.filter((c) => c.form === f).length;
  assert.equal(count(ARCHETYPE.home), 1);
  // Belts of every archetype but the skerries, and one each of the other forms.
  assert.equal(forms(FORM.belts), 5);
  for (const f of [FORM.fjord, FORM.fen, FORM.table, FORM.cone, FORM.caldera]) assert.equal(forms(f), 1, `form ${f}`);
  assert.equal(count(ARCHETYPE.highland), 2);
  assert.equal(count(ARCHETYPE.slate), 3);
  assert.equal(count(ARCHETYPE.lakes), 2);
  assert.equal(count(ARCHETYPE.karst), 2);
  const sk = count(ARCHETYPE.skerry);
  assert.ok(sk >= 5 && sk <= 7 && forms(FORM.cluster) === sk, `skerries ${sk}`);
  assert.ok(pl.cores.length >= 15 && pl.cores.length <= 17);
});

test("Poisson spacing on the torus", () => {
  const cs = plan().cores;
  for (let i = 0; i < cs.length; i++) {
    assert.ok(cs[i].x >= 0 && cs[i].x < p.n && cs[i].y >= 0 && cs[i].y < p.n);
    for (let j = i + 1; j < cs.length; j++) {
      const d = torusDist(cs[i].x, cs[i].y, cs[j].x, cs[j].y, p.n);
      assert.ok(d >= p.cores.poissonR, `cores ${i},${j} at ${d}`);
    }
  }
});

test("spines have 3–6 segments, and no island's strike turns past maxTurn from west–east", () => {
  const most = Math.tan(p.strike.maxTurn);
  for (const c of plan().cores) {
    const s = c.spine, segs = s.length / 2 - 1;
    assert.ok(segs >= 3 && segs <= 6, `segments ${segs}`);
    // A caldera's spine is its islet's, which lies any way.
    if (c.form === FORM.caldera) continue;
    const dx = s[s.length - 2] - s[0], dy = s[s.length - 1] - s[1];
    // psin and pcos are good to about 1e-6, so an island turned the whole way may sit a hair past tan(maxTurn).
    assert.ok(Math.abs(dx) > 0 && Math.abs(dy) <= most * Math.abs(dx) * (1 + 1e-4), `strike ${dx},${dy}`);
  }
});

test("islands lie at different strikes", () => {
  const turns = plan().cores.filter((c) => c.form !== FORM.caldera).map((c) => {
    const s = c.spine;
    return Math.atan2(s[s.length - 1] - s[1], s[s.length - 2] - s[0]);
  });
  assert.ok(Math.max(...turns) - Math.min(...turns) > 0.8, `strikes span ${Math.max(...turns) - Math.min(...turns)}`);
});

test("erodibility uses the three rock multipliers, all present", () => {
  const pl = plan(), seen = new Set<number>();
  for (let i = 0; i < cN * cN; i++) {
    assert.ok(pl.rock[i] <= 2);
    assert.ok(Math.abs(pl.k[i] - p.rock.kBase * p.rock.kMul[pl.rock[i]]) <= 1e-12);
    seen.add(pl.rock[i]);
  }
  assert.equal(seen.size, 3);
});

test("region weights sum to one; diffusion blends the islands' values", () => {
  // An island's diffusion is its archetype's unless its form sets its own.
  const all = [...p.erode.d, ...p.cores.archetypes.flatMap((a) => (a.d === undefined ? [] : [a.d]))];
  const pl = plan(), lo = Math.min(...all), hi = Math.max(...all);
  for (let i = 0; i < cN * cN; i++) {
    let sum = 0;
    for (let a = 0; a < 6; a++) {
      const w = pl.regions[a * cN * cN + i];
      assert.ok(w >= 0);
      sum += w;
    }
    assert.ok(Math.abs(sum - 1) <= 1e-6);
    assert.ok(pl.d[i] >= lo - 1e-9 && pl.d[i] <= hi + 1e-9);
  }
});

test("each core's own region dominates at its centre", () => {
  const pl = plan(), cellsPerNode = p.n / cN;
  for (const c of pl.cores) {
    if (c.archetype === ARCHETYPE.skerry) continue;
    const i = Math.floor(c.y / cellsPerNode) * cN + Math.floor(c.x / cellsPerNode);
    assert.ok(pl.regions[c.archetype * cN * cN + i] >= 0.5, `archetype ${c.archetype}`);
  }
});

test("uplift ≥ 0, positive at every core, and land share before erosion 0.2–0.55", () => {
  const pl = plan(), cellsPerNode = p.n / cN;
  let land = 0;
  for (const u of pl.uplift) { assert.ok(u >= 0 && Number.isFinite(u)); if (u > 0) land++; }
  const share = land / (cN * cN);
  assert.ok(share >= 0.2 && share <= 0.55, `land share ${share}`);
  for (const c of pl.cores) assert.ok(pl.uplift[Math.floor(c.y / cellsPerNode) * cN + Math.floor(c.x / cellsPerNode)] > 0);
});

test("the highland core lifts hardest", () => {
  const pl = plan(), cellsPerNode = p.n / cN;
  const peakNear = (c: { x: number; y: number }) => {
    let m = 0;
    const cx = Math.floor(c.x / cellsPerNode), cy = Math.floor(c.y / cellsPerNode);
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      m = Math.max(m, pl.uplift[(((cy + dy) % cN) + cN) % cN * cN + ((((cx + dx) % cN) + cN) % cN)]);
    }
    return m;
  };
  const high = pl.cores.find((c) => c.archetype === ARCHETYPE.highland)!;
  for (const c of pl.cores) if (c !== high) assert.ok(peakNear(high) > peakNear(c));
});

test("deterministic by seed", () => {
  assert.deepEqual(planWorld(p, 42), plan());
  assert.notDeepEqual(planWorld(p, 43).uplift, plan().uplift);
});

test("no seam at the wrap", () => {
  const pl = plan();
  for (const a of [pl.uplift, pl.d]) assert.ok(seamRatio(a, cN) <= 1);
  for (let r = 0; r < 6; r++) assert.ok(seamRatio(pl.regions.subarray(r * cN * cN, (r + 1) * cN * cN), cN) <= 1, `region ${r}`);
});

test("an impossible quota throws, naming the cores", () => {
  assert.throws(() => planWorld({ ...p, cores: { ...p.cores, poissonR: 600 } }, 42), /cores/);
});
