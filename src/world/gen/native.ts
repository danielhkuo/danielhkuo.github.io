// Native land (design 6.7): every island outside home is grown again for its climate, and joined, island by
// island, to the land the generator grows today.
//
// The generator cannot simply take the climate: its erosion runs until all the land balances, its cap scales all
// land by one factor, its rivers draw their bends from one stream in scan order, and its regions blend every
// island into every node. Any change anywhere would move home. So two lands are grown. L0 is today's. L1 has the
// same islands in the same places, each but the kept ones built again from its climate's recipe and worn and
// drained under its climate's rain. The world takes each island whole from one of them; the join runs through
// open sea, where the plan's nearest-outline owner changes.

import { wrap } from "../core/torus.ts";
import type { Climate } from "./climate.ts";
import type { HydroResult, Lake } from "./hydro.ts";
import { ARCHETYPE, type ArchetypeSpec, FORM, lengthScale } from "./params.ts";
import type { Grown, Land } from "./pipeline.ts";
import type { Core } from "./plan.ts";
import type { Reach, RiversResult } from "./rivers.ts";

/** Bump when a recipe or the way L1 is grown changes: the cache keeps L1 under this. */
export const NATIVE_VERSION = 12;

export type Recipe = "keep" | "ice" | "tundraWet" | "tundraDry" | "taiga" | "steppe" | "mediterranean" | "desert" | "savanna" | "warmForest" | "jungle";

/** An island's climate, from the land the generator grows today: the mean over its land. */
export interface IslandClimate {
  /** C nodes of land. */
  land: number;
  temp: number;
  arid: number;
  moisture: number;
}

/** Islands whose land lies within this many cells of the start or abbey view are kept: the climate's blurs reach about 360. */
export const NEAR_VIEW = 400;

/** Half-sizes in cells of a view window as the build checks it (400 × 225 cells), with the bake's margins. */
const VIEW_HALF_X = 280, VIEW_HALF_Y = 220;

/** Each core's climate: the mean of the climate (on C) over the land it owns. */
export function islandClimates(land: Land, climate: Climate): IslandClimate[] {
  const { p, plan, isSea } = land;
  const gN = p.gN, cN = p.cN;
  const count = plan.cores.length;
  const sum = new Float64Array(count * 4);
  const temp = climate.temp, arid = climate.arid;
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const g = 2 * cy * gN + 2 * cx;
    if (isSea[g] && isSea[g + 1] && isSea[g + gN] && isSea[g + gN + 1]) continue;
    const i = cy * cN + cx, o = plan.owner[i] * 4;
    sum[o]++;
    sum[o + 1] += temp ? temp[i] : 0.5;
    sum[o + 2] += arid ? arid[i] : 0;
    sum[o + 3] += climate.moisture[i];
  }
  const out: IslandClimate[] = [];
  for (let c = 0; c < count; c++) {
    const k = sum[c * 4] || 1;
    out.push({ land: sum[c * 4], temp: sum[c * 4 + 1] / k, arid: sum[c * 4 + 2] / k, moisture: sum[c * 4 + 3] / k });
  }
  return out;
}

/** The recipe for an island of this climate (design 6.7). "keep": its land is the temperate generator's already. */
export function recipeOf(c: IslandClimate): Recipe {
  const t = c.temp, dry = c.arid >= 0.5, m = c.moisture;
  if (t < 0.2) return "ice";
  if (t < 0.29) return dry ? "tundraDry" : "tundraWet";
  if (!dry) return t < 0.44 ? "taiga" : t < 0.56 ? "keep" : t < 0.85 ? "warmForest" : "jungle";
  if (t < 0.5) return "steppe";
  if (t < 0.7) return "mediterranean";
  if (m < 0.27) return "desert";
  if (t >= 0.93 && m >= 0.6) return "jungle";
  return t >= 0.8 ? "savanna" : "mediterranean";
}

/**
 * Forms that are built again for their climate. Skerry groups keep theirs in every climate; cones and calderas keep
 * theirs where volcanoes are at home (the cold and the wet), and in dry country stand as mesas.
 */
function reformable(form: number, recipe: Recipe): boolean {
  if (form === FORM.cone || form === FORM.caldera) return false;
  if (form === FORM.table) return dryRecipe(recipe) || recipe === "jungle";
  return form === FORM.belts || form === FORM.fjord || form === FORM.fen;
}

function dryRecipe(recipe: Recipe): boolean {
  return recipe === "desert" || recipe === "mediterranean" || recipe === "steppe" || recipe === "savanna";
}

/**
 * The spec an island of this recipe is built from, at world size n. A table island stays a table, as a mesa in dry
 * country and a tepui in the tropics: a table is too small to carry belts.
 */
export function recipeSpec(recipe: Exclude<Recipe, "keep">, n: number, form: number = FORM.belts): ArchetypeSpec {
  const spec = recipeBase(recipe, n);
  if (form !== FORM.table) return spec;
  return { ...spec, form: FORM.table, aspect: [0.55, 0.9], ridges: [1, 1], rugged: 0, plateau: undefined, lowland: undefined, bite: undefined, grain: undefined, stripeWidth: [3000 * lengthScale(n), 3000 * lengthScale(n)] };
}

function recipeBase(recipe: Exclude<Recipe, "keep">, n: number): ArchetypeSpec {
  const s = lengthScale(n), A = ARCHETYPE, F = FORM;
  const stripes: [number, number] = [300 * s, 600 * s];
  const base = { count: [1, 1] as const, diameter: [0, 0] as const, stripeWidth: stripes };
  switch (recipe) {
    // The polar ice: a high massif with a broad top, cut by fjords; the ice sheet (gen/landforms.ts) fills it to a dome.
    case "ice":
      return { ...base, id: A.highland, form: F.fjord, look: [[A.highland, 0.75], [A.slate, 0.25]], aspect: [0.5, 0.65], turn: 0.5, peak: 150, rugged: 1, rockBias: [0.9, 0.1, 0], ridges: [2, 3], plateau: 0.55 };
    // The wet tundra: low lobes round a low core, studded with lakes, the coast ragged with islets.
    case "tundraWet":
      return { ...base, id: A.lakes, form: F.fen, look: [[A.lakes, 0.8], [A.skerry, 0.2]], aspect: [0.6, 0.8], turn: 1.2, peak: 22, rugged: 0.25, d: 0.008, rockBias: [0.6, 0.4, 0], ridges: [4, 6], bite: 1.7 };
    // The dry side's tundra: a low stony plateau.
    case "tundraDry":
      return { ...base, id: A.slate, form: F.belts, look: [[A.slate, 0.6], [A.lakes, 0.4]], aspect: [0.4, 0.62], turn: 0.9, peak: 40, rugged: 0.6, d: 0.01, rockBias: [0.7, 0.3, 0], ridges: [2, 4], bite: 1 };
    // The taiga: glaciated mountains and fjords.
    case "taiga":
      return { ...base, id: A.lakes, form: F.belts, look: [[A.lakes, 0.6], [A.highland, 0.4]], aspect: [0.5, 0.62], turn: 0.4, peak: 26, rugged: 0.5, d: 0.006, rockBias: [0.85, 0.15, 0], ridges: [2, 3], plateau: 0.5, bite: 1.4 };
    // The steppe: a plain. A wide lowland ramp, low swells, smooth slopes and a smooth coast.
    case "steppe":
      return { ...base, id: A.slate, form: F.belts, look: [[A.home, 0.42], [A.slate, 0.58]], aspect: [0.5, 0.75], turn: 0.9, peak: 30, rugged: 0, d: 0.03, rockBias: [0.2, 0.5, 0.3], ridges: [1, 1], plateau: 0.75, bite: 0.5, grain: 0.35 };
    // The Mediterranean: rugged limestone ridges, the coast in peninsulas, cliffs and coves.
    case "mediterranean":
      return { ...base, id: A.karst, form: F.belts, look: [[A.karst, 1]], aspect: [0.38, 0.6], turn: 0.9, peak: 85, rugged: 0.75, d: 0.006, rockBias: [0.85, 0.15, 0], ridges: [3, 5], bite: 1.3 };
    // The desert: a plateau with a broad flat top over lowland plains, hard beds over soft, a straight coast.
    case "desert":
      return { ...base, id: A.karst, form: F.belts, look: [[A.karst, 0.5], [A.slate, 0.5]], aspect: [0.4, 0.62], turn: 0.9, peak: 34, rugged: 0, d: 0.004, rockBias: [0.5, 0, 0.5], ridges: [1, 2], plateau: 0.7, lowland: 0.25, bite: 0.75, grain: 0.5 };
    // The savanna: a plain, its rock domes added by the landforms.
    case "savanna":
      return { ...base, id: A.slate, form: F.belts, look: [[A.home, 0.42], [A.slate, 0.58]], aspect: [0.5, 0.75], turn: 0.9, peak: 34, rugged: 0.1, d: 0.025, rockBias: [0.6, 0.4, 0], ridges: [1, 1], plateau: 0.7, bite: 0.55, grain: 0.45 };
    // The warm forest: steep ridges and deep valleys, the coast in rias.
    case "warmForest":
      return { ...base, id: A.slate, form: F.belts, look: [[A.slate, 0.6], [A.karst, 0.4]], aspect: [0.38, 0.6], turn: 0.9, peak: 95, rugged: 1, d: 0.0015, rockBias: [0.5, 0.5, 0], ridges: [3, 5], bite: 1.35 };
    // The jungle: rugged limestone mountains over wide coastal plains (the towers stand on them).
    case "jungle":
      return { ...base, id: A.karst, form: F.belts, look: [[A.karst, 0.58], [A.home, 0.42]], aspect: [0.4, 0.65], turn: 0.9, peak: 70, rugged: 0.9, d: 0.002, rockBias: [0.8, 0.2, 0], ridges: [3, 4], lowland: 0.42, bite: 1.2 };
  }
}

/** What L1 is grown from: each core's recipe, whether the world keeps L0's island, and the spec to build it again from. */
export interface NativePlan {
  recipes: Recipe[];
  kept: boolean[];
  specs: (ArchetypeSpec | null)[];
}

/**
 * The plan for L1. Kept from L0: home, every island whose recipe is "keep", and every island whose land lies within
 * NEAR_VIEW cells of a view window (`views`: the start and the abbey). Built again: the rest, where their form is
 * one a climate shapes.
 */
export function nativePlan(land: Land, climate: Climate, views: readonly { x: number; y: number }[]): NativePlan {
  const { p, plan, isSea } = land;
  const n = p.n, gN = p.gN, cN = p.cN;
  const climates = islandClimates(land, climate);
  const near = new Array<boolean>(plan.cores.length).fill(false);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const g = 2 * cy * gN + 2 * cx;
    if (isSea[g] && isSea[g + 1] && isSea[g + gN] && isSea[g + gN + 1]) continue;
    const o = plan.owner[cy * cN + cx];
    if (near[o]) continue;
    const x = cx * 8 + 4, y = cy * 8 + 4;
    for (const v of views) {
      const dx = Math.max(0, Math.abs(wrap(x - v.x + n / 2, n) - n / 2) - VIEW_HALF_X);
      const dy = Math.max(0, Math.abs(wrap(y - v.y + n / 2, n) - n / 2) - VIEW_HALF_Y);
      if (dx * dx + dy * dy < NEAR_VIEW * NEAR_VIEW) near[o] = true;
    }
  }
  const recipes: Recipe[] = [], kept: boolean[] = [], specs: (ArchetypeSpec | null)[] = [];
  plan.cores.forEach((core: Core, c: number) => {
    const recipe: Recipe = core.archetype === ARCHETYPE.home ? "keep" : recipeOf(climates[c]);
    recipes.push(recipe);
    // A fen keeps today's land in any climate: low lobes round meres are a tundra of pools, a delta of lagoons or a
    // swamp as the climate dresses them, and they hold the marshes and the still water the wonders need.
    // So does a table outside dry country and the jungle: a karst plateau of the cold is already its own land.
    // And the warm forest: its recipe (steep ridges, rias) is the land the generator grows already, and judged no
    // better side by side; the warm country's wonders (the bridge town) stand on it as they did. And an island on
    // the equator line, whose land is both sides' jungle (the cove hotel's cove is on one).
    const straddles = climates[c].arid > 0.2 && climates[c].arid < 0.8 && climates[c].temp > 0.85;
    // So do the steppe's and the Mediterranean's own islands (the steppe's plains are the fens at its latitude; the
    // windmill's headland is on today's land, and the limestone recipe judged no better side by side), and the
    // volcanoes of dry country (the Mediterranean's calanque is a caldera's wall).
    const dryVolcano = (core.form === FORM.cone || core.form === FORM.caldera) && dryRecipe(recipe);
    if (recipe === "keep" || recipe === "warmForest" || recipe === "steppe" || recipe === "mediterranean" || straddles || dryVolcano || near[c] || core.form === FORM.fen || (core.form === FORM.table && !reformable(core.form, recipe))) {
      kept.push(true);
      specs.push(null);
    } else {
      kept.push(false);
      specs.push(reformable(core.form, recipe) ? recipeSpec(recipe, n, core.form === FORM.belts || core.form === FORM.fjord ? core.form : FORM.table) : null);
    }
  });
  return { recipes, kept, specs };
}

/** The G mask of the nodes the world takes from L0: those whose C node is owned (in L0's plan) by a kept island. */
export function keptMask(land: Land, kept: readonly boolean[]): Uint8Array {
  const { gN, cN } = land.p, own = land.plan.owner;
  const out = new Uint8Array(gN * gN);
  for (let gy = 0; gy < gN; gy++) {
    const row = (gy >> 1) * cN;
    for (let gx = 0; gx < gN; gx++) if (kept[own[row + (gx >> 1)]]) out[gy * gN + gx] = 1;
  }
  return out;
}

type Typed = Float64Array | Float32Array | Uint8Array | Int32Array | Uint16Array | Uint32Array;

/** a where the mask is set, b elsewhere. */
function pick<T extends Typed>(mask: Uint8Array, a: T, b: T): T {
  const out = new (a.constructor as new (n: number) => T)(a.length);
  for (let i = 0; i < a.length; i++) out[i] = mask[i] ? a[i] : b[i];
  return out;
}

/** Each C node's mask from the G mask (its first G node, which lies in it). */
function onC(maskG: Uint8Array, gN: number): Uint8Array {
  const cN = gN / 2, out = new Uint8Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) out[cy * cN + cx] = maskG[2 * cy * gN + 2 * cx];
  return out;
}

/** The G node of a point in cells. */
function nodeAt(x: number, y: number, gN: number): number {
  return wrap(Math.floor(y / 4), gN) * gN + wrap(Math.floor(x / 4), gN);
}

/** Whether a reach lies in the kept land: its middle vertex does. */
function reachIn(r: Reach, mask: Uint8Array, gN: number): boolean {
  const v = r.vertices, m = Math.floor(v.length / 8) * 4;
  return mask[nodeAt(v[m], v[m + 1], gN)] === 1;
}

/** G nodes either side of the join over which the sea bed is blended. */
export const SEAM_BLEND = 30;

/** Each G node's distance in nodes (8-neighbour steps) to the nearest node on the other side of the join, up to `reach` + 1. */
export function seamDistance(mask: Uint8Array, gN: number, reach: number): Uint8Array {
  const far = reach + 1, d = new Uint8Array(gN * gN).fill(far), queue = new Int32Array(gN * gN);
  let qt = 0;
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x, m = mask[i];
    if (mask[y * gN + wrap(x + 1, gN)] !== m || mask[y * gN + wrap(x - 1, gN)] !== m || mask[wrap(y + 1, gN) * gN + x] !== m || mask[wrap(y - 1, gN) * gN + x] !== m) {
      d[i] = 0;
      queue[qt++] = i;
    }
  }
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh], x = i % gN, y = (i - x) / gN, next = d[i] + 1;
    if (next > reach) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = wrap(y + dy, gN) * gN + wrap(x + dx, gN);
      if (d[j] > next) { d[j] = next; queue[qt++] = j; }
    }
  }
  return d;
}

/**
 * The world joined from two grown lands: every node, lake, river reach, stamp and glacial feature of a kept island
 * from L0, the rest from L1. L0's lakes and reaches keep their numbers; L1's are numbered after them. The two lands'
 * sea beds differ, so within SEAM_BLEND nodes of the join, where both are sea, the bed is blended across it: at the
 * join half and half, at SEAM_BLEND wholly its own side's. The join runs through open sea, far from home's views.
 */
export function joinTerrain(t0: Grown, t1: Grown, kept: readonly boolean[]): Grown {
  const l0 = t0.land, l1 = t1.land, p = l0.p, gN = p.gN;
  const mask = keptMask(l0, kept), maskC = onC(mask, gN);
  const at = (x: number, y: number): boolean => mask[nodeAt(x, y, gN)] === 1;

  const pl0 = l0.plan, pl1 = l1.plan, nodes = pl0.n * pl0.n;
  const regions = new Float32Array(pl0.regions.length);
  for (let k = 0; k * nodes < regions.length; k++) for (let i = 0; i < nodes; i++) regions[k * nodes + i] = maskC[i] ? pl0.regions[k * nodes + i] : pl1.regions[k * nodes + i];
  const plan = {
    n: pl0.n,
    cores: pl0.cores.map((c, k) => (kept[k] ? c : pl1.cores[k])),
    uplift: pick(maskC, pl0.uplift, pl1.uplift),
    k: pick(maskC, pl0.k, pl1.k),
    d: pick(maskC, pl0.d, pl1.d),
    rock: pick(maskC, pl0.rock, pl1.rock),
    regions,
    fjord: pick(maskC, pl0.fjord, pl1.fjord),
    owner: pick(maskC, pl0.owner, pl1.owner),
  };
  const land: Land = {
    p, seed: l0.seed, plan,
    g: pick(mask, l0.g, l1.g),
    base: pick(mask, l0.base, l1.base),
    isSea: pick(mask, l0.isSea, l1.isSea),
    exposure: pick(mask, l0.exposure, l1.exposure),
    shoreClass: pick(mask, l0.shoreClass, l1.shoreClass),
    shoreDist: pick(mask, l0.shoreDist, l1.shoreDist),
    sandWidth: pick(mask, l0.sandWidth, l1.sandWidth),
    duneWidth: pick(mask, l0.duneWidth, l1.duneWidth),
    marsh: pick(mask, l0.marsh, l1.marsh),
    stamps: [...l0.stamps.filter((s) => at(s.x, s.y)), ...l1.stamps.filter((s) => !at(s.x, s.y))],
    glacial: {
      lakes: [...l0.glacial.lakes.filter((f) => at(f.x, f.y)), ...l1.glacial.lakes.filter((f) => !at(f.x, f.y))],
      tarns: [...l0.glacial.tarns.filter((f) => at(f.x, f.y)), ...l1.glacial.tarns.filter((f) => !at(f.x, f.y))],
      dams: [...l0.glacial.dams.filter((f) => at(f.x, f.y)), ...l1.glacial.dams.filter((f) => !at(f.x, f.y))],
    },
    debris: pick(mask, l0.debris, l1.debris),
    rock: pick(mask, l0.rock, l1.rock),
    steps: l1.steps,
  };

  const h0 = t0.hydro, h1 = t1.hydro;
  const offL = h0.lakes.length;
  const lakeId = new Int32Array(h0.lakeId.length);
  for (let i = 0; i < lakeId.length; i++) lakeId[i] = mask[i] ? h0.lakeId[i] : h1.lakeId[i] >= 0 ? h1.lakeId[i] + offL : -1;
  const lakes: Lake[] = [
    ...h0.lakes.filter((l) => mask[l.outlet] === 1),
    ...h1.lakes.filter((l) => mask[l.outlet] !== 1).map((l) => ({ ...l, id: l.id + offL })),
  ];
  const order0 = h0.order.filter((i) => mask[i] === 1), order1 = h1.order.filter((i) => mask[i] !== 1);
  const order = new Uint32Array(order0.length + order1.length);
  order.set(order0);
  order.set(order1, order0.length);
  const hydro: HydroResult = {
    ground: pick(mask, h0.ground, h1.ground),
    surface: pick(mask, h0.surface, h1.surface),
    lakeId,
    lakes,
    rain: pick(mask, h0.rain, h1.rain),
    rcv: pick(mask, h0.rcv, h1.rcv),
    order,
    q: pick(mask, h0.q, h1.q),
    channel: pick(mask, h0.channel, h1.channel),
    hand: pick(mask, h0.hand, h1.hand),
  };

  // The sea bed across the join.
  const seam = seamDistance(mask, gN, SEAM_BLEND);
  const beds: [Float64Array | Float32Array, ArrayLike<number>, ArrayLike<number>][] = [
    [land.g, l0.g, l1.g], [land.base, l0.base, l1.base], [hydro.ground, h0.ground, h1.ground], [hydro.surface, h0.surface, h1.surface],
    [land.shoreDist, l0.shoreDist, l1.shoreDist],
  ];
  const rivGround = pick(mask, t0.rivers.ground, t1.rivers.ground);
  beds.push([rivGround, t0.rivers.ground, t1.rivers.ground]);
  for (let i = 0; i < seam.length; i++) {
    if (seam[i] > SEAM_BLEND || !l0.isSea[i] || !l1.isSea[i]) continue;
    const t = seam[i] / SEAM_BLEND, own = 0.5 + 0.5 * t * t * (3 - 2 * t);
    for (const [out, a, b] of beds) {
      const mine = mask[i] ? a[i] : b[i], theirs = mask[i] ? b[i] : a[i];
      out[i] = own * mine + (1 - own) * theirs;
    }
  }

  const r0 = t0.rivers, r1 = t1.rivers;
  let offR = 0;
  for (const r of r0.reaches) if (r.id >= offR) offR = r.id + 1;
  const keep0 = new Set<number>(), keep1 = new Set<number>();
  const reaches: Reach[] = [];
  for (const r of r0.reaches) if (reachIn(r, mask, gN)) { keep0.add(r.id); reaches.push(r); }
  const lift = (v: number, off: number): number => (v >= 0 ? v + off : v);
  for (const r of r1.reaches) {
    if (reachIn(r, mask, gN)) continue;
    keep1.add(r.id);
    reaches.push({ ...r, id: r.id + offR, downstream: lift(r.downstream, offR), lake: lift(r.lake, offL), fromLake: lift(r.fromLake, offL) });
  }
  const rivers: RiversResult = {
    reaches,
    falls: [...r0.falls.filter((f) => keep0.has(f.reach)), ...r1.falls.filter((f) => keep1.has(f.reach)).map((f) => ({ ...f, reach: f.reach + offR }))],
    oxbows: [...r0.oxbows.filter((o) => keep0.has(o.reach)), ...r1.oxbows.filter((o) => keep1.has(o.reach)).map((o) => ({ ...o, reach: o.reach + offR }))],
    bars: [...r0.bars.filter((b) => keep0.has(b.reach)), ...r1.bars.filter((b) => keep1.has(b.reach)).map((b) => ({ ...b, reach: b.reach + offR }))],
    ground: rivGround,
  };
  return { land, hydro, rivers };
}
