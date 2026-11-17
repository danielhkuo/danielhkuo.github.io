// S2 fluvial erosion: the stream-power law dh/dt = U − K·√A·S + D∇²h, solved
// with Braun & Willett's implicit scheme, plus the C-then-G schedule.

import type { Jitter } from "./flood.ts";
import type { WorldParams } from "./params.ts";
import type { Plan } from "./plan.ts";

export interface ErodeState {
  n: number;
  h: Float64Array;
  uplift: Float64Array;
  k: Float64Array;
  d: Float64Array;
  isSea: Uint8Array;
  jitter: Jitter | null;
  rain: Float64Array | null;
  eps: number;
  diffusionSweeps: number;
}

export interface StepStats {
  /** Σ over land of U·dt. */
  upliftFlux: number;
  /** Σ over land of (h + U·dt − h after the fluvial update). */
  erosionFlux: number;
}

export function erodeStep(s: ErodeState, dt: number): StepStats {
  throw new Error("not implemented");
}

/** Jacobi sweeps on (I − dt·D∇²)h' = h over the 8-neighbour torus; fixed nodes are never written. */
export function diffuseImplicit(h: Float64Array, n: number, d: Float64Array, dt: number, sweeps: number, fixed: Uint8Array | null): void {
  throw new Error("not implemented");
}

export interface ScheduleResult {
  g: Float64Array;
  gN: number;
  isSea: Uint8Array;
  stepsC: number;
  steadinessC: number;
  steadinessG: number;
}

export function runSchedule(plan: Plan, p: WorldParams, seed: number): ScheduleResult {
  throw new Error("not implemented");
}
