// BakeWorld: everything the bake reads, on the torus. Heights, water and
// rivers live on the solver grid G (4 cells per node); climate, rock and
// region weights on the coarse grid C (8 cells per node).
//
// buildBakeWorld adapts generator outputs. Stages that are not built yet are
// filled by the stand-ins in standin-land.ts, each marked STAND-IN there.

import type { Plan } from "../gen/plan.ts";
import type { WorldParams } from "../gen/params.ts";
import { standinClimate, standinHeights, standinHydro, standinShore } from "./standin-land.ts";

export const WATER = { land: 0, sea: 1, lake: 2, river: 3 } as const;
export const SHORE = { none: 0, beach: 1, rocky: 2, cliff: 3, cove: 4 } as const;
/** No surface, canopy included, stands above this. */
export const HMAX = 160;

export interface BakeWorld {
  /** Cells a side; a multiple of 256. */
  n: number;
  /** n / 4 and n / 8. */
  gN: number;
  cN: number;

  // --- G grid, gN² each ---
  /** Ground height in units; sea bed is negative. */
  ground: Float32Array;
  /** Water surface: 0 on sea nodes, the lake's level on lake nodes; unused on land. */
  waterLevel: Float32Array;
  /** 0 land, 1 sea, 2 lake. */
  waterKind: Uint8Array;
  /** River width class in pixels, 0 (no river) to 6. */
  riverWidth: Uint8Array;
  /** Downstream neighbour as an NB8 index (E, SE, S, SW, W, NW, N, NE); 255 where there is no river. */
  riverTo: Uint8Array;
  /** Cells along the flow from this node to the river's end; drives the flow phase. */
  riverRun: Float32Array;
  /** Height above nearest drainage, units. */
  hand: Float32Array;
  /** Shore class: 0 none, 1 beach, 2 rocky, 3 cliff, 4 cove. */
  shore: Uint8Array;

  // --- C grid, cN² each ---
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  /** 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** Six planes of cN², archetype-major, summing to 1 per node. */
  regions: Float32Array;
}

export interface HydroInput {
  waterLevel: Float32Array;
  waterKind: Uint8Array;
  riverWidth: Uint8Array;
  riverTo: Uint8Array;
  riverRun: Float32Array;
  hand: Float32Array;
}

export interface ClimateInput {
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
}

export interface BakeWorldInput {
  params: WorldParams;
  plan: Plan;
  seed: number;
  /** Eroded ground on G, units. STAND-IN when absent. */
  heights?: ArrayLike<number>;
  /** Lakes, rivers and HAND on G. STAND-IN when absent. */
  hydro?: HydroInput;
  /** Shore classes on G. STAND-IN when absent. */
  shore?: Uint8Array;
  /** Climate and debris on C. STAND-IN when absent. */
  climate?: ClimateInput;
}

export function buildBakeWorld(inp: BakeWorldInput): BakeWorld {
  const { params: p, plan, seed } = inp;
  const { n, gN, cN } = p;
  if (n % 256 !== 0) throw new Error(`the bake needs a world of whole 256-cell tiles, not ${n}`);
  if (plan.n !== cN) throw new Error("plan grid does not match params");

  const ground = new Float32Array(gN * gN);
  if (inp.heights) {
    if (inp.heights.length !== gN * gN) throw new Error("heights must be on G");
    for (let i = 0; i < ground.length; i++) ground[i] = inp.heights[i];
  } else {
    ground.set(standinHeights(p, plan, seed));
  }

  // The stand-in hydrology fills small pits, so it may raise the ground.
  const hydro = inp.hydro ?? standinHydro(ground, gN, n);
  const shore = inp.shore ?? standinShore(ground, hydro.waterKind, gN);
  const climate = inp.climate ?? standinClimate(ground, hydro.hand, gN, cN, seed);

  return {
    n, gN, cN, ground,
    waterLevel: hydro.waterLevel, waterKind: hydro.waterKind,
    riverWidth: hydro.riverWidth, riverTo: hydro.riverTo, riverRun: hydro.riverRun,
    hand: hydro.hand, shore,
    moisture: climate.moisture, wind: climate.wind, exposure: climate.exposure, debris: climate.debris,
    rock: plan.rock, regions: plan.regions,
  };
}

/** A blank world of the given size: flat ground at `level`, no water, one region. For tests and fixtures. */
export function blankWorld(n: number, level: number): BakeWorld {
  const gN = n / 4, cN = n / 8;
  const regions = new Float32Array(6 * cN * cN);
  regions.fill(1, 0, cN * cN);
  return {
    n, gN, cN,
    ground: new Float32Array(gN * gN).fill(level),
    waterLevel: new Float32Array(gN * gN),
    waterKind: new Uint8Array(gN * gN),
    riverWidth: new Uint8Array(gN * gN),
    riverTo: new Uint8Array(gN * gN).fill(255),
    riverRun: new Float32Array(gN * gN),
    hand: new Float32Array(gN * gN),
    shore: new Uint8Array(gN * gN),
    moisture: new Float32Array(cN * cN).fill(0.5),
    wind: new Float32Array(cN * cN),
    exposure: new Float32Array(cN * cN),
    debris: new Float32Array(cN * cN),
    rock: new Uint8Array(cN * cN).fill(1),
    regions,
  };
}
