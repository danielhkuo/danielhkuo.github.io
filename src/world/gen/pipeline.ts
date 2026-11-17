// The generator's stages, in order. One place that says how a world is made.
// Stages not built yet are marked; the bake supplies stand-ins for them.

import { type Climate, climateFields } from "./climate.ts";
import { coast, coastContext } from "./coast.ts";
import { drown } from "./drown.ts";
import { runSchedule } from "./erode.ts";
import { type GlacialFeature, glacial, glacialContext } from "./glacial.ts";
import { type HydroResult, hydrology } from "./hydro.ts";
import type { WorldParams } from "./params.ts";
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
  // S6 coasts: exposure, cliffs, stacks, coves, beaches, shelf.
  const co = coast(t.h, gN, coastContext(plan, gN), p, seed);
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
  /** Moisture and wind on C. */
  climate: Climate;
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

/** The natural land: every stage before siting. */
export function makeTerrain(p: WorldParams, seed: number): Terrain {
  const land = makeLand(p, seed);
  const gN = p.gN;
  const hydro = hydrology(land.g, gN, land.isSea, p.hydro);
  const rv = rivers({ g: land.g, gN, isSea: land.isSea, hydro }, p.rivers, seed);
  const climate = climateFields(rv.ground, hydro.rain, land.isSea, gN, p.climate);
  return { land, hydro, rivers: rv, climate };
}
