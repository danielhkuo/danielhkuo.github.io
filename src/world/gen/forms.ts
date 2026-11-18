// S5b Forms: what rivers alone do not make. Erosion gives every island valleys and spurs; this stage, on G after
// talus and before the coast, gives a cone its crater, a table its flat top and sheer sides, and a fen its level.
// Heights only: the sea stays sea and the land stays land.

import { rngFor, type Rng } from "../core/rng.ts";
import { torusDelta, wrapIndex } from "../core/torus.ts";
import { FORM, lengthScale, type WorldParams } from "./params.ts";
import type { Core, Plan } from "./plan.ts";

/** A crater's radius in cells and depth in units; its rim stands RIM over the slope it was cut in, and a notch NOTCH wide (radians) lets the lake out within NOTCH_TURN of south. */
const CRATER_R: readonly [number, number] = [46, 70];
const CRATER_DEPTH: readonly [number, number] = [10, 16];
const RIM = 3;
const RIM_VARY = 2.5;
const RIM_FALL = 0.75;
const NOTCH = 0.35;
const NOTCH_TURN = 0.8;
/** A table's top stands at TABLE_TOP; ground reaches it within TABLE_EDGE units of the sea's level, and keeps TABLE_RELIEF of its old relief on top. */
const TABLE_TOP: readonly [number, number] = [30, 42];
const TABLE_EDGE = 1.6;
const TABLE_RELIEF = 0.22;
/** A fen's ground levels off at FEN_TOP. */
const FEN_TOP = 5.5;

/** The land nodes of the island a core stands on, no farther than `reach` cells from it. */
function islandNodes(h: Float64Array, gN: number, isSea: Uint8Array, core: Core, cpn: number, reach: number, seen: Uint8Array): Int32Array {
  const n = gN * cpn;
  const cx = Math.floor(core.x / cpn), cy = Math.floor(core.y / cpn);
  // Start on the land nearest the core.
  let start = -1;
  const R = Math.ceil((0.4 * core.radius) / cpn);
  for (let r = 0; r <= R && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const i = wrapIndex(cx + dx, cy + dy, gN);
      if (!isSea[i]) { start = i; break; }
    }
  }
  if (start < 0) return new Int32Array(0);
  const out: number[] = [start];
  seen[start] = 1;
  for (let k = 0; k < out.length; k++) {
    const i = out[k], x = i % gN, y = (i - x) / gN;
    for (let q = 0; q < 4; q++) {
      const j = wrapIndex(x + (q === 0 ? 1 : q === 1 ? -1 : 0), y + (q === 2 ? 1 : q === 3 ? -1 : 0), gN);
      if (seen[j] || isSea[j]) continue;
      const jx = j % gN, jy = (j - jx) / gN;
      const dx = torusDelta(core.x, (jx + 0.5) * cpn, n), dy = torusDelta(core.y, (jy + 0.5) * cpn, n);
      if (dx * dx + dy * dy > reach * reach) continue;
      seen[j] = 1;
      out.push(j);
    }
  }
  for (const i of out) seen[i] = 0;
  return Int32Array.from(out);
}

/** A crater in the summit of a cone: a bowl inside a raised rim, with one low notch, so a lake stands in it and spills. */
function crater(h: Float64Array, gN: number, isSea: Uint8Array, nodes: Int32Array, cpn: number, s: number, rng: Rng, eps: number): void {
  const radius = rng.range(CRATER_R[0], CRATER_R[1]) * s, depth = rng.range(CRATER_DEPTH[0], CRATER_DEPTH[1]);
  const notch = Math.PI / 2 + rng.range(-NOTCH_TURN, NOTCH_TURN), ph1 = rng.range(0, 2 * Math.PI), ph2 = rng.range(0, 2 * Math.PI);
  if (radius < 3 * cpn || nodes.length === 0) return;
  let top = nodes[0];
  for (const i of nodes) if (h[i] > h[top]) top = i;
  const tx = top % gN, ty = (top - tx) / gN;
  const R = Math.ceil((2.2 * radius) / cpn);
  // The slope's height where the rim will stand.
  let sum = 0, count = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const r = Math.sqrt(dx * dx + dy * dy) * cpn;
    if (r < radius || r >= radius + cpn) continue;
    const i = wrapIndex(tx + dx, ty + dy, gN);
    if (isSea[i]) return;
    sum += h[i];
    count++;
  }
  const level = sum / count;
  if (level - depth < 3) return;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const r = Math.sqrt(dx * dx + dy * dy) * cpn;
    const i = wrapIndex(tx + dx, ty + dy, gN);
    if (isSea[i]) continue;
    const th = Math.atan2(dy, dx);
    let turn = Math.abs(th - notch) % (2 * Math.PI);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const rim = level + RIM + RIM_VARY * (0.6 * Math.sin(th + ph1) + 0.4 * Math.sin(2 * th + ph2)) - (RIM + RIM_VARY) * Math.exp(-(turn / NOTCH) * (turn / NOTCH));
    const q = r / radius;
    if (q <= 1) h[i] = Math.max(eps, level - depth + (rim - level + depth) * Math.pow(q, 2.5));
    else h[i] = Math.max(h[i], rim - (r - radius) * RIM_FALL);
  }
}

export function shapeForms(h: Float64Array, gN: number, isSea: Uint8Array, plan: Plan, p: WorldParams, seed: number): void {
  const cpn = p.n / gN, s = lengthScale(p.n);
  const seen = new Uint8Array(gN * gN);
  plan.cores.forEach((core, k) => {
    if (core.form !== FORM.cone && core.form !== FORM.table && core.form !== FORM.fen) return;
    const rng = rngFor(seed, `form-${k}`);
    const nodes = islandNodes(h, gN, isSea, core, cpn, 1.3 * core.radius, seen);
    if (core.form === FORM.cone) {
      crater(h, gN, isSea, nodes, cpn, s, rng, p.erode.eps);
    } else if (core.form === FORM.table) {
      const top = rng.range(TABLE_TOP[0], TABLE_TOP[1]);
      for (const i of nodes) h[i] = top * (1 - Math.exp(-h[i] / TABLE_EDGE)) + TABLE_RELIEF * h[i];
    } else {
      for (const i of nodes) h[i] = FEN_TOP * (1 - Math.exp(-h[i] / FEN_TOP));
    }
  });
}
