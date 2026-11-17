// S2 fluvial erosion: the stream-power law dh/dt = U − K·√A·S + D∇²h, solved
// with Braun & Willett's implicit scheme, plus the C-then-G schedule.

import { upsampleBSpline } from "../core/bspline.ts";
import { fbm } from "../core/noise.ts";
import { accumulate, makeJitter, priorityFlood, receivers, type Jitter } from "./flood.ts";
import type { WorldParams } from "./params.ts";
import type { Plan } from "./plan.ts";
import { resampleToLattice } from "./resample.ts";

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
  /**
   * Threshold slope per node, as the greatest drop to the receiver per node of distance, or null for none.
   * Ground a river has undercut past it fails at once (landslides), so valley sides stand at the threshold
   * and the crests between two valleys come down with their floors.
   */
  sc?: Float64Array | null;
  /**
   * The threshold is for a node draining `scArea` nodes; one draining A stands at (scArea / A)^¼ of it, held within
   * `scRange`. Ribs that drain only themselves stand steeper than the gullies between them, so a face is fluted.
   */
  scArea?: number;
  scRange?: readonly [number, number];
}

export interface StepStats {
  /** Σ over land of U·dt. */
  upliftFlux: number;
  /** Σ over land of (h + U·dt − h after the fluvial update). */
  erosionFlux: number;
}

export function erodeStep(s: ErodeState, dt: number): StepStats {
  const n = s.n;
  const { filled, order } = priorityFlood(s.h, n, s.isSea, s.eps);
  const { rcv, dist } = receivers(filled, n, s.isSea, s.jitter);
  const area = accumulate(order, rcv, s.isSea, s.rain);
  const h = s.h;
  // Pits are filled; receivers were computed on this surface and are updated first.
  h.set(filled);
  const uplift = s.uplift;
  const k = s.k;
  const isSea = s.isSea;
  const eps = s.eps;
  const sc = s.sc ?? null;
  const scArea = s.scArea ?? 0;
  const scLo = s.scRange ? s.scRange[0] : 1, scHi = s.scRange ? s.scRange[1] : 1;
  let upliftFlux = 0;
  let erosionFlux = 0;
  for (let p = 0; p < order.length; p++) {
    const i = order[p]!;
    if (isSea[i] !== 0) continue;
    const hi = filled[i]!;
    const udt = uplift[i]! * dt;
    const F = (k[i]! * dt * Math.sqrt(area[i]!)) / dist[i]!;
    const hr = h[rcv[i]!]!;
    let hNew = Math.max((hi + udt + F * hr) / (1 + F), hr + eps);
    if (sc !== null) {
      let steep = 1;
      if (scArea > 0) {
        steep = Math.sqrt(Math.sqrt(scArea / area[i]!));
        steep = steep < scLo ? scLo : steep > scHi ? scHi : steep;
      }
      const limit = hr + steep * sc[i]! * dist[i]!;
      if (hNew > limit) hNew = limit;
    }
    h[i] = hNew;
    upliftFlux += udt;
    erosionFlux += hi + udt - hNew;
  }
  if (s.diffusionSweeps > 0) diffuseImplicit(h, n, s.d, dt, s.diffusionSweeps, isSea);
  return { upliftFlux, erosionFlux };
}

// Scratch for Jacobi. Sized up to the largest grid this process has diffused.
let diffA = new Float64Array(0);
let diffB = new Float64Array(0);

/** Jacobi sweeps on (I − dt·D∇²)h' = h over the 4-neighbour torus; fixed nodes are never written. */
export function diffuseImplicit(h: Float64Array, n: number, d: Float64Array, dt: number, sweeps: number, fixed: Uint8Array | null): void {
  const nn = n * n;
  if (diffA.length < nn) {
    diffA = new Float64Array(nn);
    diffB = new Float64Array(nn);
  }
  let x = diffA;
  let y = diffB;
  x.set(h.subarray(0, nn));
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let row = 0; row < n; row++) {
      const y0 = row * n;
      const yN = (row === 0 ? n - 1 : row - 1) * n;
      const yS = (row + 1 === n ? 0 : row + 1) * n;
      for (let col = 0; col < n; col++) {
        const i = y0 + col;
        if (fixed !== null && fixed[i] !== 0) {
          y[i] = h[i]!;
          continue;
        }
        const xW = col === 0 ? n - 1 : col - 1;
        const xE = col + 1 === n ? 0 : col + 1;
        const ai = dt * d[i]!;
        const sum = x[y0 + xW]! + x[y0 + xE]! + x[yN + col]! + x[yS + col]!;
        // a is uniform in the conservation test, so each neighbour enters once per edge.
        y[i] = (h[i]! + ai * sum) / (1 + 4 * ai);
      }
    }
    const swap = x;
    x = y;
    y = swap;
  }
  h.set(x.subarray(0, nn));
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
  const cN = plan.n;
  const cCount = cN * cN;
  const h = new Float64Array(cCount);
  const isSeaC = new Uint8Array(cCount);
  const upliftC = plan.uplift;
  for (let y = 0; y < cN; y++) {
    const fy = (y * 8) / p.cN;
    const row = y * cN;
    for (let x = 0; x < cN; x++) {
      const i = row + x;
      if (upliftC[i] === 0) {
        h[i] = -1;
        isSeaC[i] = 1;
      } else {
        h[i] = 0.1 * (fbm((x * 8) / p.cN, fy, 8, 4, 0.5, seed) + 1);
      }
    }
  }

  // Threshold slopes by rock, in height per node.
  const scC = new Float64Array(cCount);
  const cellsPerC = p.n / cN;
  for (let i = 0; i < cCount; i++) scC[i] = p.erode.sc[plan.rock[i]!]! * cellsPerC;

  const state: ErodeState = {
    n: cN,
    h,
    uplift: upliftC,
    k: plan.k,
    d: plan.d,
    isSea: isSeaC,
    jitter: makeJitter(cN, p.erode.jitter, seed),
    rain: null,
    eps: p.erode.eps,
    diffusionSweeps: p.erode.diffusionSweeps,
    sc: scC,
    scArea: p.erode.scArea / (cellsPerC * cellsPerC),
    scRange: p.erode.scRange,
  };

  let stepsC = 0;
  let steadinessC = 0;
  const dtC = p.erode.dtC;
  const stopAt = p.erode.stopAt;
  for (let step = 0; step < p.erode.cSteps; step++) {
    const st = erodeStep(state, dtC);
    stepsC++;
    steadinessC = st.erosionFlux / st.upliftFlux;
    if (steadinessC >= stopAt) break;
  }

  const lat = resampleToLattice(h, cN, state.jitter as Jitter);
  const gN = p.gN;
  let g = upsampleBSpline(lat, cN, 2);
  const gUplift = upsampleBSpline(upliftC, cN, 2);
  const gK = upsampleBSpline(plan.k, cN, 2);
  const gD = upsampleBSpline(plan.d, cN, 2);
  const gSc = upsampleBSpline(scC, cN, 2);
  const gCount = gN * gN;
  // Rock is not uniform: knots and beds of `grain` cells stand steeper and wear slower, weak ones the reverse, so
  // gullies find their own lines and faces break into crags and benches instead of planes.
  const grainPeriod = Math.max(1, Math.round(p.n / p.erode.grainCells));
  const grainAmp = p.erode.grain;
  for (let y = 0; y < gN; y++) {
    const fy = (y * grainPeriod) / gN;
    const row = y * gN;
    for (let x = 0; x < gN; x++) {
      const i = row + x;
      gD[i]! *= 4;
      const hard = grainAmp * Math.max(-1, Math.min(1, 1.7 * fbm((x * grainPeriod) / gN, fy, grainPeriod, 3, 0.6, seed + 3)));
      gSc[i]! *= 0.5 * (1 + hard);
      gK[i]! *= 1 - hard;
    }
  }

  const noise = p.erode.upsampleNoise;
  for (let y = 0; y < gN; y++) {
    const fy = (y * 16) / gN;
    const row = y * gN;
    for (let x = 0; x < gN; x++) {
      const i = row + x;
      const hi = g[i]!;
      if (hi > 0) g[i] = hi + noise * Math.abs(hi) * fbm((x * 16) / gN, fy, 16, 3, 0.5, seed + 1);
    }
  }

  const isSea = new Uint8Array(gCount);
  for (let i = 0; i < gCount; i++) {
    if (g[i]! <= 0) {
      isSea[i] = 1;
      g[i] = Math.min(g[i]!, 0);
      gUplift[i] = 0;
    }
  }

  state.n = gN;
  state.h = g;
  state.uplift = gUplift;
  state.k = gK;
  state.d = gD;
  state.isSea = isSea;
  state.sc = gSc;
  state.scArea = p.erode.scArea / ((p.n / gN) * (p.n / gN));
  state.jitter = makeJitter(gN, p.erode.jitter, seed + 2);

  let steadinessG = 0;
  const dtG = p.erode.dtG;
  for (let step = 0; step < p.erode.gSteps; step++) {
    const st = erodeStep(state, dtG);
    steadinessG = st.erosionFlux / st.upliftFlux;
  }

  g = resampleToLattice(state.h, gN, state.jitter as Jitter);
  g = priorityFlood(g, gN, isSea, p.erode.eps).filled;
  const eps = p.erode.eps;
  for (let i = 0; i < gCount; i++) {
    if (isSea[i] !== 0) g[i] = Math.min(g[i]!, 0);
    else if (g[i]! < eps) g[i] = eps;
  }

  return { g, gN, isSea, stepsC, steadinessC, steadinessG };
}
