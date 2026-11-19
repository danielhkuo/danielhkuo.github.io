// Cover and scatter by climate, on synthetic inputs: what each latitude grows, what its water does, that a climate
// keeps the cover a pure periodic function of position, and that every climatic border is a wide mixed band.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "./core/rng.ts";
import { cover } from "./cover.ts";
import type { CoverInput } from "./look/contract.ts";
import { isCanopy, isCrop, isWater, MATERIAL as M, MATERIAL_NAMES } from "./look/materials.ts";
import { scatterAt } from "./scatter.ts";
import { loadMask } from "./testing/bakefix.ts";
import { sweep } from "./testing/sweep.ts";

const MASK = loadMask();

const LAKES = [0, 0, 0, 1, 0, 0];
const SKERRY = [0, 0, 0, 0, 0, 1];
const REGIONS = [[1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], LAKES, [0, 0, 0, 0, 1, 0], SKERRY];

function set(ids: number[]): Set<number> {
  return new Set(ids);
}

const ICE = set([M.snow, M.snowLate, M.iceFoot, M.glacier, M.firn, M.crevasse]);
const TUNDRA = set([M.tundraCool, M.tundraMid, M.tundraWarm, M.lichen, M.sedge, M.pool, M.frostNet, M.bog, M.bogRed]);
const DESERT = set([M.desertSand, M.desertSandDeep, M.reg, M.earthPale, M.salt]);
const GRASS_HOT = set([M.steppeCool, M.steppeMid, M.steppeWarm, M.savannaCool, M.savannaMid, M.savannaWarm, M.earthRed, M.tigerBush]);
const JUNGLE_CROWN = set([M.jungleCool, M.jungleMid, M.jungleWarm, M.jungleBright, M.jungleBloom]);
const PASTURE_MEADOW = set([M.pastureCool, M.pastureMid, M.pastureWarm, M.meadowCool, M.meadowMid, M.meadowWarm]);

function isField(id: number): boolean {
  return isCrop[id] === 1 || id === M.hedge || id === M.wall;
}

function name(id: number): string {
  return MATERIAL_NAMES[id] ?? String(id);
}

/** Plain low pasture on a skerry, as cover.test.ts's baseline. */
function cell(over: Partial<CoverInput> = {}): CoverInput {
  return {
    x: 1000, y: 2000, e: 12, slope: 0.3, northness: 0, hand: 12, moisture: 0.36, wind: 0.2, exposure: 0.7,
    debris: 0, rock: 1, region: SKERRY, water: 0, shore: 0, ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Sanity: the design's anti-goals.

test("polar land grows no field, pasture or meadow, and nothing stands on its snow and ice", () => {
  const n = 1024, inputs = sweep(4401, 4000, n);
  const crowns: string[] = [], stamps: string[] = [];
  for (let k = 0; k < inputs.length; k++) {
    const c = { ...inputs[k], water: 0, temp: (0.12 * k) / inputs.length };
    const m = cover(c, MASK, n);
    assert.ok(!isField(m), `${name(m)} at temp ${c.temp}`);
    assert.ok(!PASTURE_MEADOW.has(m), `${name(m)} at temp ${c.temp}`);
    if (ICE.has(m)) {
      const st = scatterAt(c, m, MASK, undefined, n);
      if (st) {
        stamps.push(`${name(st.mat)} on ${name(m)}`);
        if (isCanopy[st.mat] === 1) crowns.push(`${name(st.mat)} on ${name(m)}`);
      }
    }
  }
  assert.deepEqual(crowns, [], "no crown on snow or ice");
  assert.deepEqual(stamps, [], "no stamp of any kind on snow or ice");
});

test("tundra latitudes grow no field", () => {
  const n = 1024, inputs = sweep(4402, 4000, n);
  for (const input of inputs) {
    const c = { ...input, water: 0, temp: 0.2 };
    const m = cover(c, MASK, n);
    assert.ok(!isField(m), `${name(m)} at ${c.x},${c.y} e ${c.e}`);
  }
});

test("hot dry low ground is desert: no pasture, meadow, hedge or crop", () => {
  const n = 1024, r = rngFor(4403, "climate-zones");
  let desert = 0;
  const count = 3000, bad = new Map<string, number>();
  for (let k = 0; k < count; k++) {
    const slope = r.range(0, 0.1), e = r.range(1, 30);
    const c = cell({
      x: r.int(n), y: r.int(n), e, slope, steep: slope, form: e, northness: r.range(-1, 1), hand: r.range(1, 20),
      moisture: r.range(0, 0.12), wind: r.float(), region: REGIONS[r.int(6)], temp: 0.95, arid: 1,
    });
    const m = cover(c, MASK, n);
    if (isField(m) || PASTURE_MEADOW.has(m)) {
      const key = `${name(m)} in region ${Array.from(c.region).indexOf(1)}`;
      bad.set(key, (bad.get(key) ?? 0) + 1);
    }
    if (DESERT.has(m)) desert++;
  }
  assert.deepEqual([...bad], [], `fields or grass in the desert, of ${count}`);
  assert.ok(desert / count > 0.6, `desert share ${desert / count}`);
});

test("hot wet gentle low ground is jungle", () => {
  const n = 1024, r = rngFor(4404, "climate-zones");
  const seen = new Map<string, number>();
  let jungle = 0;
  const count = 3000;
  for (let k = 0; k < count; k++) {
    const slope = r.range(0, 0.3), e = r.range(5, 40);
    const c = cell({
      x: r.int(n), y: r.int(n), e, slope, steep: slope, form: e, northness: r.range(-1, 1), hand: r.range(4, 20),
      moisture: 0.9, wind: r.float(), region: REGIONS[r.int(6)], temp: 0.97,
    });
    const m = cover(c, MASK, n);
    seen.set(name(m), (seen.get(name(m)) ?? 0) + 1);
    if (m === M.floorJungle) jungle++;
  }
  assert.ok(jungle / count > 0.75, `jungle share ${jungle / count}: ${JSON.stringify([...seen])}`);
});

// ---------------------------------------------------------------------------
// 2. Water.

/** The covers of one input over a w × w patch from (x0, y0). */
function patchCounts(over: Partial<CoverInput>, n: number, x0: number, y0: number, w = 256): Map<number, number> {
  const out = new Map<number, number>();
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const m = cover(cell({ ...over, x: (x0 + x) % n, y: (y0 + y) % n }), MASK, n);
    out.set(m, (out.get(m) ?? 0) + 1);
  }
  return out;
}

test("polar sea carries pack ice; temperate-cold sea none; polar lakes freeze whole", () => {
  const n = 1024;
  const sea = { water: 1, e: -5, slope: 0, hand: 0, shore: 0 };
  for (const [x0, y0] of [[0, 0], [400, 700]]) {
    const polar = patchCounts({ ...sea, temp: 0.02 }, n, x0, y0);
    const ice = (polar.get(M.packIce) ?? 0) + (polar.get(M.packIceBlue) ?? 0);
    const total = 256 * 256;
    for (const id of polar.keys()) assert.ok(id === M.packIce || id === M.packIceBlue || id === M.sea || id === M.seaClear, `${name(id)} on polar sea`);
    assert.ok(ice / total > 0.4, `pack ice share ${ice / total} at ${x0},${y0}`);
    const cool = patchCounts({ ...sea, temp: 0.3 }, n, x0, y0);
    for (const id of cool.keys()) assert.ok(id === M.sea || id === M.seaClear, `${name(id)} on the sea at temp 0.3, ${x0},${y0}`);
  }
  const lake = patchCounts({ water: 2, e: 2, slope: 0, hand: 0, temp: 0.02 }, n, 300, 300, 128);
  for (const id of lake.keys()) assert.ok(id === M.lakeIce || id === M.packIce, `${name(id)} on a polar lake`);
});

test("a desert stream is a wadi, a wet one a river; no ice, wadi or pool is water", () => {
  const n = 1024;
  const stream = { water: 3, stream: 1, e: 4, slope: 0.02, hand: 0 };
  for (const [x, y] of [[10, 20], [500, 900], [1000, 3]]) {
    assert.equal(name(cover(cell({ ...stream, x, y, temp: 0.9, moisture: 0.1 }), MASK, n)), "wadi");
    assert.equal(name(cover(cell({ ...stream, x, y, temp: 0.9, moisture: 0.9 }), MASK, n)), "river");
  }
  for (const id of [M.packIce, M.packIceBlue, M.lakeIce, M.riverIce, M.iceFoot, M.berg, M.wadi, M.pool]) {
    assert.equal(isWater[id], 0, `${name(id)} is not water`);
  }
});

// ---------------------------------------------------------------------------
// 3. Pure and periodic with a climate.

/**
 * What the cover makes of a cell, less what is not periodic in the temperate cover either (2026-11-19): the stones
 * of a scree fan and the reed beds are hashed on the unwrapped cell, and a crop's row texture wraps with the 6400
 * world only. Those are folded into their ground, so what is left is what a climate adds.
 */
function canon(id: number): number {
  if (id === M.screeStone || id === M.screeSlate) return M.scree;
  if (id === M.reeds || id === M.bog || id === M.bogRed) return M.marsh;
  if (id >= M.wheatRow && id <= M.stubbleRow) return M.wheat;
  if (isCrop[id] === 1) return M.wheat;
  return id;
}

for (const n of [1024, 10240]) {
  test(`with a climate the cover is pure and tiles on the world (n = ${n})`, () => {
    const inputs = sweep(4405 + n, 300, n);
    const bad: string[] = [];
    for (const [temp, arid] of [[0.05, 0], [0.2, 0], [0.35, 0], [0.7, 0], [0.95, 0], [0.2, 1], [0.4, 1], [0.5, 1], [0.6, 1], [0.8, 1], [0.95, 0.5]]) {
      for (const input of inputs) {
        const c = Object.freeze({ ...input, temp, arid });
        const a = cover(c, MASK, n);
        assert.equal(cover(c, MASK, n), a);
        assert.equal(cover({ ...c }, MASK, n), a);
        const bx = cover({ ...c, x: c.x + n }, MASK, n), by = cover({ ...c, y: c.y + n }, MASK, n), bxy = cover({ ...c, x: c.x - n, y: c.y - n }, MASK, n);
        // A stray scree stone is the temperate cover's own seam: see canon.
        if ([a, bx, by, bxy].includes(M.screeStone)) continue;
        const k = canon(a);
        if (canon(bx) !== k || canon(by) !== k || canon(bxy) !== k) {
          bad.push(`temp ${temp} arid ${arid} water ${c.water} at ${c.x},${c.y}: ${name(a)} / +n x ${name(bx)}, +n y ${name(by)}, -n ${name(bxy)}`);
        }
      }
    }
    assert.deepEqual(bad, [], `${bad.length} inputs differ when shifted by n`);
  });
}

// ---------------------------------------------------------------------------
// 4. Gradual borders.

/** Smoothed share of each family per row, from cover over `cols` columns. */
function rowShares(rows: number, cols: number, x0: number, n: number, at: (y: number) => Partial<CoverInput>, families: ((id: number) => boolean)[]): number[][] {
  const raw = families.map(() => new Float64Array(rows));
  for (let y = 0; y < rows; y++) {
    const over = at(y);
    for (let x = 0; x < cols; x++) {
      const m = cover(cell({ ...over, x: x0 + x, y }), MASK, n);
      for (let f = 0; f < families.length; f++) if (families[f](m)) raw[f][y] += 1 / cols;
    }
  }
  // Smoothed over 16 rows.
  return raw.map((r) => {
    const out: number[] = [];
    for (let y = 0; y < rows; y++) {
      let s = 0, k = 0;
      for (let d = -8; d < 8; d++) if (y + d >= 0 && y + d < rows) { s += r[y + d]; k++; }
      out.push(s / k);
    }
    return out;
  });
}

interface Band { from: number; to: number; tall: number; firstB: number; lastA: number; first: number; last: number; rows: number }

/** The longest run of rows where both families hold 3–97 %, and where B first shows and A last shows. */
// A band's height is the number of rows in which both families are present. Its longest unbroken run is reported
// too, but not required: where two climates meet in patches, a row that is all one of them lies inside the band.
function bandOf(a: number[], b: number[]): Band {
  let best = { from: -1, to: -1 }, start = -1;
  for (let y = 0; y <= a.length; y++) {
    const mixed = y < a.length && a[y] >= 0.03 && a[y] <= 0.97 && b[y] >= 0.03 && b[y] <= 0.97;
    if (mixed && start < 0) start = y;
    if (!mixed && start >= 0) {
      if (y - start > best.to - best.from) best = { from: start, to: y };
      start = -1;
    }
  }
  const mixed = a.map((v, y) => v >= 0.03 && v <= 0.97 && b[y] >= 0.03 && b[y] <= 0.97);
  const first = mixed.indexOf(true), last = mixed.lastIndexOf(true);
  return { ...best, first, last, rows: mixed.filter(Boolean).length, tall: best.to - best.from, firstB: b.findIndex((v) => v > 0), lastA: a.length - 1 - [...a].reverse().findIndex((v) => v > 0) };
}

function report(label: string, band: Band): string {
  return `${label}: longest mixed run ${band.from}–${band.to} (${band.tall} tall); mixed rows ${band.rows} between ${band.first} and ${band.last}; B first at ${band.firstB}, A last at ${band.lastA}`;
}

const N_REAL = 10240;
const X_LINE = 3000;
const FLAT = { e: 6, slope: 0.03, steep: 0.03, form: 6, hand: 8, wind: 0.3, shore: 0, water: 0, northness: 0, formNorth: 0, curve: 0, relief: 0 };

for (const [label, region] of [["lakes", LAKES], ["skerry", SKERRY]] as const) {
  test(`cold borders are mixed bands at least 150 cells tall (${label})`, (t) => {
    const rows = 2600;
    const ice = (id: number) => ICE.has(id), tundra = (id: number) => TUNDRA.has(id), temperate = (id: number) => !ICE.has(id) && !TUNDRA.has(id);
    const [tem, tun, ic] = rowShares(rows, 64, X_LINE, N_REAL, (y) => ({ ...FLAT, moisture: 0.6, region, temp: 0.5 - (0.5 * y) / rows }), [temperate, tundra, ice]);
    const a = bandOf(tem, tun), b = bandOf(tun, ic);
    t.diagnostic(report(`${label} temperate→tundra`, a));
    t.diagnostic(report(`${label} tundra→ice`, b));
    t.diagnostic(`${label} ice at the pole end ${ic[rows - 1].toFixed(3)}, most ice in the first 1000 rows ${Math.max(...ic.slice(0, 1000)).toFixed(3)}`);
    assert.ok(a.firstB >= 0 && a.firstB < a.lastA, report("temperate→tundra", a));
    assert.ok(a.rows >= 150, report("temperate→tundra", a));
    assert.ok(b.firstB >= 0 && b.firstB < b.lastA, report("tundra→ice", b));
    assert.ok(b.rows >= 150, report("tundra→ice", b));
    assert.ok(ic[rows - 1] >= 0.95, `ice at the pole end ${ic[rows - 1]}`);
    assert.ok(Math.max(...ic.slice(0, 1000)) < 0.05, "ice in the first 1000 rows");
  });

  test(`the dry side's hot borders are mixed bands at least 150 cells tall (${label})`, (t) => {
    const rows = 3400;
    const desert = (id: number) => DESERT.has(id);
    const sward = (id: number) => !desert(id);
    const [sw, de] = rowShares(rows, 64, X_LINE, N_REAL, (y) => ({ ...FLAT, moisture: 0.08, region, temp: 0.5 + (0.5 * y) / rows, arid: 1 }), [sward, desert]);
    const b = bandOf(sw, de);
    t.diagnostic(report(`${label} sward→desert`, b));
    t.diagnostic(`${label} desert at the equator end ${de[rows - 1].toFixed(3)}`);
    assert.ok(b.rows >= 150, report("sward→desert", b));
    assert.ok(de[rows - 1] > 0.5, `desert at the equator end ${de[rows - 1]}`);
  });

  test(`the dry side's cold borders are mixed bands at least 150 cells tall (${label})`, (t) => {
    const rows = 2600;
    const ice = (id: number) => ICE.has(id), tundra = (id: number) => TUNDRA.has(id), steppe = (id: number) => !ICE.has(id) && !TUNDRA.has(id);
    const [st, tun, ic] = rowShares(rows, 64, X_LINE, N_REAL, (y) => ({ ...FLAT, moisture: 0.3, region, temp: 0.5 - (0.5 * y) / rows, arid: 1 }), [steppe, tundra, ice]);
    const a = bandOf(st, tun), b = bandOf(tun, ic);
    t.diagnostic(report(`${label} steppe→tundra`, a));
    t.diagnostic(report(`${label} tundra→ice`, b));
    assert.ok(a.rows >= 150, report("steppe→tundra", a));
    assert.ok(b.rows >= 150, report("tundra→ice", b));
    assert.ok(ic[rows - 1] >= 0.95, `ice at the pole end ${ic[rows - 1]}`);
  });

  test(`hot wet borders are mixed bands at least 150 cells tall (${label})`, (t) => {
    const rows = 3400;
    const jungle = (id: number) => id === M.floorJungle;
    const temperate = (id: number) => !jungle(id);
    const [tem, ju] = rowShares(rows, 64, X_LINE, N_REAL, (y) => ({ ...FLAT, moisture: 0.95, region, temp: 0.5 + (0.5 * y) / rows }), [temperate, jungle]);
    const a = bandOf(tem, ju);
    t.diagnostic(report(`${label} temperate→jungle`, a));
    t.diagnostic(`${label} jungle at the equator end ${ju[rows - 1].toFixed(3)}`);
    assert.ok(a.firstB >= 0 && a.firstB < a.lastA, report("temperate→jungle", a));
    assert.ok(a.rows >= 150, report("temperate→jungle", a));
    assert.ok(ju[rows - 1] > 0.5, `jungle at the equator end ${ju[rows - 1]}`);
  });
}

// ---------------------------------------------------------------------------
// 5. Each climate once a lap: what is the wet side's is not the dry side's.

const SAND = set([M.desertSand, M.desertSandDeep, M.reg, M.salt]);
const DRY_ONLY = set([...SAND, ...GRASS_HOT, M.garrigue, M.earthPale]);
const TAIGA_FLOOR = set([M.floorLichen, M.bog, M.bogRed, M.sedge]);

test("the wet side has no sand, steppe, savanna or garrigue at any temperature, rain shadows included", () => {
  const n = N_REAL, inputs = sweep(4410, 1500, n);
  const bad = new Map<string, number>();
  for (const moisture of [0.08, 0.3, 0.6, 0.95]) {
    for (let k = 0; k < inputs.length; k++) {
      const temp = 0.3 + (0.7 * k) / inputs.length;
      const m = cover({ ...inputs[k], water: 0, moisture, temp }, MASK, n);
      if (DRY_ONLY.has(m) && !(m === M.earthPale && temp <= 0.5)) bad.set(name(m), (bad.get(name(m)) ?? 0) + 1);
    }
  }
  assert.deepEqual([...bad], [], "dry country on the wet side");
});

test("the dry side is dressed whole: green sward only by water, no taiga floor, at the plateau's temperature too", () => {
  const n = N_REAL, r = rngFor(4411, "climate-zones");
  const count = 4000;
  for (const temp of [0.42, 0.497, 0.5, 0.503, 0.58]) {
    let green = 0, taiga = 0;
    for (let k = 0; k < count; k++) {
      const slope = r.range(0, 0.25), e = r.range(4, 30);
      const m = cover(cell({
        x: r.int(n), y: r.int(n), e, slope, steep: slope, form: e, northness: r.range(-1, 1), hand: r.range(5, 20),
        moisture: r.range(0.15, 0.4), wind: r.float(), region: REGIONS[r.int(6)], temp, arid: 1,
      }), MASK, n);
      if (PASTURE_MEADOW.has(m)) green++;
      if (TAIGA_FLOOR.has(m)) taiga++;
    }
    assert.ok(green / count < 0.1, `green sward share ${green / count} at temp ${temp}`);
    assert.equal(taiga, 0, `taiga floor at temp ${temp}`);
  }
});

test("on the dry side nothing changes where the temperature passes the plateau's: the sward is one across it", () => {
  const n = N_REAL, r = rngFor(4412, "climate-zones");
  let differ = 0;
  const count = 4000;
  for (let k = 0; k < count; k++) {
    const slope = r.range(0, 0.25), e = r.range(4, 30);
    const c = cell({
      x: r.int(n), y: r.int(n), e, slope, steep: slope, form: e, northness: r.range(-1, 1), hand: r.range(5, 20),
      moisture: r.range(0.15, 0.4), wind: r.float(), region: REGIONS[r.int(6)], arid: 1,
    });
    const below = cover({ ...c, temp: 0.499 }, MASK, n), at = cover({ ...c, temp: 0.5 }, MASK, n), above = cover({ ...c, temp: 0.501 }, MASK, n);
    if (below !== at || above !== at) differ++;
  }
  assert.ok(differ / count < 0.03, `cells that change across the plateau's temperature: ${differ / count}`);
});

test("the wet side's warm forest closes by degrees: more wood at each step from the plateau to the hot country", () => {
  const n = N_REAL;
  const wood = (temp: number): number => {
    const counts = patchCounts({ ...FLAT, moisture: 0.7, region: LAKES, temp }, n, X_LINE, 4000, 192);
    return ((counts.get(M.floorBroadleaf) ?? 0) + (counts.get(M.floorJungle) ?? 0)) / (192 * 192);
  };
  const shares = [0.52, 0.58, 0.64, 0.7, 0.8].map(wood);
  for (let k = 1; k < shares.length; k++) assert.ok(shares[k] >= shares[k - 1] - 0.02, `wood shares ${shares.map((v) => v.toFixed(2))}`);
  assert.ok(shares[0] < 0.6 && shares[shares.length - 1] > 0.9, `wood shares ${shares.map((v) => v.toFixed(2))}`);
});

// ---------------------------------------------------------------------------
// 6. Scatter by climate.

/** Every stamp over a 256 × 256 patch of one ground. */
function stampsOn(ground: number, over: Partial<CoverInput>, n = 1024): { count: number; mats: Set<number> } {
  let count = 0;
  const mats = new Set<number>();
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const st = scatterAt(cell({ ...over, x: 300 + x, y: 500 + y }), ground, MASK, undefined, n);
    if (st) { count++; mats.add(st.mat); }
  }
  return { count, mats };
}

test("scatter by climate: jungle is crown on crown, savanna sparse acacias, desert sand bare, tundra low", () => {
  const flat = { e: 10, slope: 0.05, hand: 8, wind: 0.3 };
  const jungle = stampsOn(M.floorJungle, { ...flat, moisture: 0.9, temp: 0.97 });
  assert.ok(jungle.count / 65536 >= 0.15, `jungle density ${jungle.count / 65536}`);
  for (const m of jungle.mats) assert.ok(JUNGLE_CROWN.has(m), `${name(m)} in the jungle`);
  const savanna = stampsOn(M.savannaMid, { ...flat, moisture: 0.5, temp: 0.9, arid: 1 });
  const sd = savanna.count / 65536;
  assert.ok(sd >= 0.003 && sd <= 0.03, `savanna density ${sd}`);
  const desert = stampsOn(M.desertSand, { ...flat, moisture: 0.05, temp: 0.85, arid: 1 });
  assert.equal(desert.count, 0, `stamps on desert sand: ${[...desert.mats].map(name)}`);
  const tundra = stampsOn(M.tundraMid, { ...flat, moisture: 0.5, temp: 0.2, debris: 0.5 });
  assert.ok(tundra.count > 0, "the tundra has some dwarf birch and erratics");
  for (const m of tundra.mats) assert.ok(m === M.dwarfBirch || m === M.boulder, `${name(m)} on the tundra`);
});
