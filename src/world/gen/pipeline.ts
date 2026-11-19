// The generator's stages, in order. One place that says how a world is made.
// Stages not built yet are marked; the bake supplies stand-ins for them.

import { type Climate, climateFields, type ZoneLayout } from "./climate.ts";
import { type Landforms, shapeByClimate } from "./landforms.ts";
import { coast, coastContext } from "./coast.ts";
import { drown } from "./drown.ts";
import { runSchedule } from "./erode.ts";
import { formWaters, shapeForms } from "./forms.ts";
import { type GlacialFeature, glacial, glacialContext } from "./glacial.ts";
import { type HydroResult, hydrology } from "./hydro.ts";
import { ARCHETYPE, type WorldParams } from "./params.ts";
import { type Plan, planWorld } from "./plan.ts";
import { rivers, type RiversResult } from "./rivers.ts";
import { settle, type SettleOptions, type Settlement } from "./settle.ts";
import { applyStamps, type Stamp } from "./stamps.ts";
import { scree, talus } from "./talus.ts";

export interface Land {
  p: WorldParams;
  seed: number;
  plan: Plan;
  /** Ground heights on G after erosion, cap, drowning, glacial imprint, talus and coasts (coast stamps applied). */
  g: Float64Array;
  /** The same before coast stamps: the bake upsamples this and stamps at cell size. */
  base: Float64Array;
  isSea: Uint8Array;
  /** Coastal exposure 0–1 and shore class (0 none, 1 beach, 2 rocky, 3 cliff, 4 cove, 5 dune, 6 saltmarsh) on G. */
  exposure: Float32Array;
  shoreClass: Uint8Array;
  /** Smooth fields on G for drawing shore bands at cell size (see CoastResult): signed distance to the waterline, sand and dune widths in cells, and saltmarsh 0–1. */
  shoreDist: Float32Array;
  sandWidth: Float32Array;
  duneWidth: Float32Array;
  marsh: Float32Array;
  /** The tarns' cirques, then the coast stamps (cliff cuts, stacks, coves, beaches, deltas, spits, mouths), in cells. */
  stamps: Stamp[];
  glacial: { lakes: GlacialFeature[]; tarns: GlacialFeature[]; dams: GlacialFeature[] };
  /** Talus debris on G (scree is drawn where it is thick). */
  debris: Float64Array;
  /** Rock class on G (nearest C node). */
  rock: Uint8Array;
  steps: { stepsC: number; steadinessC: number; steadinessG: number; capScale: number };
}

/** Scale land heights uniformly so the highest stays at or below `cap`; returns the factor used. */
export function capLand(g: Float64Array, isSea: Uint8Array, cap: number): number {
  let max = 0;
  for (let i = 0; i < g.length; i++) if (!isSea[i] && g[i] > max) max = g[i];
  if (max <= cap) return 1;
  const k = cap / max;
  for (let i = 0; i < g.length; i++) if (!isSea[i]) g[i] *= k;
  return k;
}

/** Rock class on G from the plan's C grid (G is twice as fine). */
export function rockOnG(plan: Plan, gN: number): Uint8Array {
  const out = new Uint8Array(gN * gN), cN = plan.n;
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) out[y * gN + x] = plan.rock[(y >> 1) * cN + (x >> 1)];
  return out;
}

export function makeLand(p: WorldParams, seed: number): Land {
  const plan = planWorld(p, seed);
  const r = runSchedule(plan, p, seed);
  const gN = r.gN;
  const capScale = capLand(r.g, r.isSea, p.talus.cap);
  // S3 drowning: valley mouths become inlets.
  const dr = drown(r.g, gN, p.drown.rise);
  // S4 glacial imprint: ribbon lakes, tarns, moraine dams, U-sections.
  const gl = glacial(dr.h, gN, glacialContext(dr.h, gN, dr.isSea, plan, p), p, seed);
  // S5 talus: slopes relax to repose; debris collects below.
  const rock = rockOnG(plan, gN);
  const slid = talus(gl.h, gN, rock, p.talus.repose, 4, p.talus.sweeps);
  for (let i = 0; i < slid.h.length; i++) {
    if (dr.isSea[i]) slid.h[i] = gl.h[i];
    else if (slid.h[i] <= 0) slid.h[i] = p.erode.eps;
  }
  // Rockfall: steep faces shed, and the debris lies in cones and aprons at their feet.
  const t = scree(slid.h, gN, dr.isSea, 4, p.talus.scree, p.erode.eps);
  for (let i = 0; i < t.h.length; i++) t.debris[i] += slid.debris[i];
  // Scree does not soften a cirque: its headwall and lip are cut again, as the bake will cut them at cell size.
  applyStamps(t.h, gN, p.n / gN, gl.cirques);
  // S5b forms: a cone's crater, a table's top and sides, a fen's level and meres.
  shapeForms(t.h, gN, dr.isSea, plan, p, seed);
  // S6 coasts: exposure, cliffs, stacks, coves, beaches, shelf; a lagoon and a fen's flats calm and shallow, a fjord deep.
  const co = coast(t.h, gN, { ...coastContext(plan, gN), ...formWaters(t.h, gN, plan, p) }, p, seed);
  return {
    p, seed, plan, g: co.h, base: co.base, isSea: co.isSea, debris: t.debris, rock,
    exposure: co.exposure, shoreClass: co.shoreClass, stamps: [...gl.cirques, ...co.stamps],
    shoreDist: co.shoreDist, sandWidth: co.sandWidth, duneWidth: co.duneWidth, marsh: co.marsh,
    glacial: { lakes: gl.lakes, tarns: gl.tarns, dams: gl.dams },
    steps: { stepsC: r.stepsC, steadinessC: r.steadinessC, steadinessG: r.steadinessG, capScale },
  };
}

/** The stages before siting: the natural land and its water. */
export interface Terrain {
  land: Land;
  /** Hydrology on the land (lakes, discharge, channels, HAND, rain). */
  hydro: HydroResult;
  /** River vectors, falls, oxbows; `rivers.ground` is the final ground on G. */
  rivers: RiversResult;
  /** Moisture, wind and sea-level temperature on C. */
  climate: Climate;
  /** G nodes each landform of the climates moved (gen/landforms.ts). Absent in a world with one climate. */
  landforms?: Landforms["moved"];
}

export interface World extends Terrain {
  /** S10: sites, buildings, hamlets and roads; `settlement.ground` is the final ground on G. */
  settlement: Settlement;
}

/**
 * Every built stage, in order. Siting is lenient here: a type the land cannot place is listed in
 * `settlement.shortfall` and the world is still made. Pass `{ strict: true }` to reject the seed instead.
 */
export function makeWorld(p: WorldParams, seed: number, opts: SettleOptions = {}): World {
  return settleWorld(makeTerrain(p, seed), opts);
}

/** Sites and buildings on land that is already made (or read from a cache). */
export function settleWorld(t: Terrain, opts: SettleOptions = {}): World {
  return { ...t, settlement: settle(t, { strict: false, ...opts }) };
}

/**
 * Where the zones are laid out from: the row of the home island's core, and the home island itself on C, which is
 * the piece of land the home archetype owns most of (as gen/sites.ts finds it on G).
 */
export function zoneLayout(land: Land, seed: number): ZoneLayout {
  const { p, plan } = land;
  const n = p.n, gN = p.gN, cN = p.cN, nodes = cN * cN;
  let homeY = n / 2;
  for (const core of plan.cores) if (core.archetype === ARCHETYPE.home) { homeY = core.y; break; }
  // Land on C: a node with any land under it.
  const isLand = new Uint8Array(nodes);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const g = 2 * cy * gN + 2 * cx;
    if (!land.isSea[g] || !land.isSea[g + 1] || !land.isSea[g + gN] || !land.isSea[g + gN + 1]) isLand[cy * cN + cx] = 1;
  }
  // Its pieces, 8-connected on the torus, and the home archetype's nodes in each.
  const piece = new Int32Array(nodes).fill(-1), stack: number[] = [], votes: number[] = [];
  const plane = ARCHETYPE.home * nodes;
  for (let start = 0; start < nodes; start++) {
    if (isLand[start] === 0 || piece[start] >= 0) continue;
    const id = votes.length;
    let vote = 0;
    piece[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if (plan.regions[plane + i] > 0.5) vote++;
      const x = i % cN, y = (i - x) / cN;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const j = ((y + dy + cN) % cN) * cN + ((x + dx + cN) % cN);
        if (isLand[j] === 1 && piece[j] < 0) { piece[j] = id; stack.push(j); }
      }
    }
    votes.push(vote);
  }
  let best = -1;
  for (let k = 0; k < votes.length; k++) if (votes[k] > 0 && (best < 0 || votes[k] > votes[best])) best = k;
  if (best < 0) return { n, seed, homeY };
  const home = new Uint8Array(nodes);
  for (let i = 0; i < nodes; i++) if (piece[i] === best) home[i] = 1;
  return { n, seed, homeY, home };
}

/** S8: the climate of land that is made. Cheap, so a cached terrain's is worked out afresh (cli/worldcache.ts). */
export function climateOf(land: Land, hydro: HydroResult, rv: RiversResult, seed: number): Climate {
  return climateFields(rv.ground, hydro.rain, land.isSea, land.p.gN, land.p.climate, zoneLayout(land, seed));
}

/** The land as it is grown: every stage before the climate. This is what a cache holds (cli/worldcache.ts). */
export interface Grown {
  land: Land;
  hydro: HydroResult;
  rivers: RiversResult;
}

export function growTerrain(p: WorldParams, seed: number): Grown {
  const land = makeLand(p, seed);
  const gN = p.gN;
  const hydro = hydrology(land.g, gN, land.isSea, p.hydro);
  const rv = rivers({ g: land.g, gN, isSea: land.isSea, hydro }, p.rivers, seed);
  return { land, hydro, rivers: rv };
}

/**
 * S8 and S8b: the climate of the grown land, and the landforms the climates give it (gen/landforms.ts). The ground
 * and the height above drainage that come back are final for the natural land; the rain, the wind and the
 * temperature are read off the land as grown. Cheap, so it runs afresh on a cached land.
 */
export function climateStage(g: Grown, seed: number): Terrain {
  const { land, hydro, rivers: rv } = g;
  const climate = climateOf(land, hydro, rv, seed);
  const f = shapeByClimate({
    n: land.p.n, gN: land.p.gN, ground: rv.ground, hand: hydro.hand, isSea: land.isSea, lakeId: hydro.lakeId, shoreDist: land.shoreDist,
    temp: climate.temp, arid: climate.arid, moisture: climate.moisture,
  });
  if (f.ground === rv.ground) return { land, hydro, rivers: rv, climate };
  return { land, hydro: { ...hydro, hand: f.hand }, rivers: { ...rv, ground: f.ground }, climate, landforms: f.moved };
}

/** The natural land: every stage before siting. */
export function makeTerrain(p: WorldParams, seed: number): Terrain {
  return climateStage(growTerrain(p, seed), seed);
}
