// The generator's stages, in order. One place that says how a world is made.
// Stages not built yet are marked; the bake supplies stand-ins for them.

import { type Climate, climateFields } from "./climate.ts";
import { runSchedule } from "./erode.ts";
import { type HydroResult, hydrology } from "./hydro.ts";
import type { WorldParams } from "./params.ts";
import { type Plan, planWorld } from "./plan.ts";
import { rivers, type RiversResult } from "./rivers.ts";
import { talus } from "./talus.ts";

export interface Land {
  p: WorldParams;
  seed: number;
  plan: Plan;
  /** Ground heights on G after erosion, the height cap and talus. */
  g: Float64Array;
  isSea: Uint8Array;
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
  const capScale = capLand(r.g, r.isSea, p.talus.cap);
  // S3 drowning, S4 glacial, S6 coasts: in progress (stand-ins in bake/standin-land.ts).
  const rock = rockOnG(plan, r.gN);
  const t = talus(r.g, r.gN, rock, p.talus.repose, 4, p.talus.sweeps);
  // Talus only moves land; keep the sea floor and the coastline where erosion left them.
  const g = t.h;
  for (let i = 0; i < g.length; i++) {
    if (r.isSea[i]) g[i] = r.g[i];
    else if (g[i] <= 0) g[i] = p.erode.eps;
  }
  return { p, seed, plan, g, isSea: r.isSea, debris: t.debris, rock, steps: { stepsC: r.stepsC, steadinessC: r.steadinessC, steadinessG: r.steadinessG, capScale } };
}

export interface World {
  land: Land;
  /** Hydrology on the land (lakes, discharge, channels, HAND, rain). */
  hydro: HydroResult;
  /** River vectors, falls, oxbows; `rivers.ground` is the final ground on G. */
  rivers: RiversResult;
  /** Moisture and wind on C. */
  climate: Climate;
}

/** Every built stage, in order. Later stages (coasts, sites, roads, parcels) slot in here. */
export function makeWorld(p: WorldParams, seed: number): World {
  const land = makeLand(p, seed);
  const gN = p.gN;
  const hydro = hydrology(land.g, gN, land.isSea, p.hydro);
  const rv = rivers({ g: land.g, gN, isSea: land.isSea, hydro }, p.rivers, seed);
  const climate = climateFields(rv.ground, hydro.rain, land.isSea, gN, p.climate);
  return { land, hydro, rivers: rv, climate };
}
