// S5b Forms: what rivers alone do not make. Erosion gives every island valleys and spurs; this stage, on G after
// talus and before the coast, gives a cone its crater, a table its flat top and sheer sides, and a fen its level and
// its meres. It also tells the coast where the water is quiet or deep: a caldera's lagoon and a fen's flats are
// sheltered and shallow, a fjord deep to its walls.

import { fbm } from "../core/noise.ts";
import { pcos, psin } from "../core/psin.ts";
import { rngFor, type Rng } from "../core/rng.ts";
import { NB8_DX, NB8_DY, torusDelta, wrapIndex } from "../core/torus.ts";
import { type Nearest, nearestSource } from "./field.ts";
import { FORM, lengthScale, type WorldParams } from "./params.ts";
import type { Core, Plan } from "./plan.ts";

/**
 * A crater's radius in cells and depth in units, cut in the highest ground within CRATER_NEAR of the cone's radius
 * from its core. Its rim stands RIM over the slope it was cut in, and a notch NOTCH wide (radians) lets the lake out
 * within NOTCH_TURN of south. Within CAP_REACH radii nothing stands above the rim: the ground there is held under a
 * cone falling CAP_FALL a cell from it, so the crater is the summit.
 */
const CRATER_R: readonly [number, number] = [70, 100];
const CRATER_DEPTH: readonly [number, number] = [12, 18];
const CRATER_NEAR = 0.45;
const RIM = 3;
const RIM_VARY = 2.5;
const RIM_FALL = 0.75;
const NOTCH = 0.35;
const NOTCH_TURN = 0.8;
const CAP_FALL = 0.22;
const CAP_REACH: readonly [number, number] = [2, 3.5];
/**
 * A table's top stands at TABLE_TOP, falling TABLE_TILT to the south so its rivers run off the edge the camera sees.
 * Its old relief is kept TABLE_RELIEF strong above a softened TABLE_SOFT, and its sides rise over TABLE_RIM cells
 * from the sea: a wall.
 */
const TABLE_TOP: readonly [number, number] = [32, 44];
const TABLE_TILT: readonly [number, number] = [3, 7];
const TABLE_SOFT = 1.6;
const TABLE_RELIEF = 0.12;
const TABLE_RIM = 12;
/**
 * A fen's ground levels off at FEN_TOP. Meres stand in hollows MERE_DEPTH deep wherever a noise of MERE_CELLS rises
 * past MERE_AT; a hollow's bed never falls below MERE_BED, so the fen stays land and the hollow holds a lake.
 */
const FEN_TOP = 2.8;
const MERE_CELLS = 150;
const MERE_AT = 0.2;
const MERE_DEPTH = 2.4;
const MERE_BED = 0.35;
/**
 * Lodes: LODES slow rivers wind across a fen to the sea, each at least LODE_MIN of its radius long, bending by up
 * to LODE_SWING (radians) every LODE_WAVE cells. The ground within LODE_BAND cells of one falls to it, its bed sinking
 * from LODE_BED[0] at the head to LODE_BED[1] at the mouth, so the fen's water gathers into a few wide rivers that
 * meander.
 */
const LODES: readonly [number, number] = [2, 3];
const LODE_SWING = 1.05;
const LODE_WAVE: readonly [number, number] = [140, 220];
const LODE_BAND = 240;
const LODE_BED: readonly [number, number] = [1.1, 0.12];
const LODE_MIN = 0.45;

/**
 * A caldera's walls. The ring's inner slope is pulled in towards its lagoon: ground d cells from the water takes the
 * height the ring had WALL_PULL · (1 − d / WALL_REACH) cells farther out (never less than its own), so the crest comes
 * to the water's edge and the wall stands sheer, while every valley keeps falling the way it fell and spills over the
 * wall instead of being dammed. WALL_REACH is kept over WALL_PULL so the pull never folds the ground over itself.
 */
const WALL_PULL = 48;
const WALL_REACH = 2.2 * WALL_PULL;

/** The share of a shore's exposure taken away on a fen (its flats break the waves) and round a lagoon. */
const FEN_CALM = 0.85;
const LAGOON_CALM = 0.95;
/** Tidal flats round a fen reach FLATS cells out, from FLATS_DEPTH[0] at the shore to FLATS_DEPTH[1] at their edge. */
const FLATS = 260;
const FLATS_DEPTH: readonly [number, number] = [0.3, 3];
/** Past the flats the bed falls FLATS_FALL a cell until it is as deep as the open sea gets (coast.bathy.max). */
const FLATS_FALL = 0.06;
/** A lagoon is the sea within LAGOON_REACH of a caldera's radius from its core that its islet stands in; its bed lies no deeper than LAGOON_DEPTH. */
const LAGOON_REACH = 0.72;
const LAGOON_DEPTH = 3.2;
/** A fjord's water is FJORD_DEEP deep once it is FJORD_SHELF cells from its walls. */
const FJORD_DEEP = 22;
const FJORD_SHELF = 7;

/**
 * The land nodes of the island core `k` stands on that are its own (the plan's `owner`), no farther than `reach` cells
 * from it: where two islands have grown together, each keeps its side of the join.
 */
function islandNodes(h: Float64Array, gN: number, isSea: Uint8Array, plan: Plan, k: number, cpn: number, reach: number, seen: Uint8Array): Int32Array {
  const core = plan.cores[k], n = gN * cpn, cN = plan.n;
  const own = (j: number): boolean => {
    const x = j % gN, y = (j - x) / gN;
    return plan.owner[(y >> 1) * cN + (x >> 1)] === k;
  };
  const cx = Math.floor(core.x / cpn), cy = Math.floor(core.y / cpn);
  // Start on the land nearest the core.
  let start = -1;
  const R = Math.ceil((0.4 * core.radius) / cpn);
  for (let r = 0; r <= R && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const i = wrapIndex(cx + dx, cy + dy, gN);
      if (!isSea[i] && own(i)) { start = i; break; }
    }
  }
  if (start < 0) return new Int32Array(0);
  const out: number[] = [start];
  seen[start] = 1;
  for (let q = 0; q < out.length; q++) {
    const i = out[q], x = i % gN, y = (i - x) / gN;
    for (let e = 0; e < 4; e++) {
      const j = wrapIndex(x + (e === 0 ? 1 : e === 1 ? -1 : 0), y + (e === 2 ? 1 : e === 3 ? -1 : 0), gN);
      if (seen[j] || isSea[j] || !own(j)) continue;
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
function crater(h: Float64Array, gN: number, isSea: Uint8Array, nodes: Int32Array, core: Core, cpn: number, s: number, rng: Rng, eps: number): void {
  const radius = rng.range(CRATER_R[0], CRATER_R[1]) * s, depth = rng.range(CRATER_DEPTH[0], CRATER_DEPTH[1]);
  const notch = Math.PI / 2 + rng.range(-NOTCH_TURN, NOTCH_TURN), ph1 = rng.range(0, 2 * Math.PI), ph2 = rng.range(0, 2 * Math.PI);
  if (radius < 3 * cpn || nodes.length === 0) return;
  const n = gN * cpn, near = CRATER_NEAR * core.radius;
  let top = -1;
  for (const i of nodes) {
    const x = i % gN, y = (i - x) / gN;
    const dx = torusDelta(core.x, (x + 0.5) * cpn, n), dy = torusDelta(core.y, (y + 0.5) * cpn, n);
    if (dx * dx + dy * dy <= near * near && (top < 0 || h[i] > h[top])) top = i;
  }
  if (top < 0) return;
  const tx = top % gN, ty = (top - tx) / gN, nx = pcos(notch), ny = psin(notch);
  const R = Math.ceil((CAP_REACH[1] * radius) / cpn);
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
    if (r > CAP_REACH[1] * radius) continue;
    const i = wrapIndex(tx + dx, ty + dy, gN);
    if (isSea[i]) continue;
    // The bearing as a unit vector; the notch is weighed by the chord to its own bearing.
    const len = Math.sqrt(dx * dx + dy * dy), c = len > 0 ? dx / len : 1, sn = len > 0 ? dy / len : 0;
    const chord = Math.sqrt((c - nx) * (c - nx) + (sn - ny) * (sn - ny));
    const wave = 0.6 * (sn * pcos(ph1) + c * psin(ph1)) + 0.4 * (2 * sn * c * pcos(ph2) + (c * c - sn * sn) * psin(ph2));
    const rim = level + RIM + RIM_VARY * wave - (RIM + RIM_VARY) * (1 - smoothstep(chord / (2 * NOTCH)));
    const q = r / radius;
    if (q <= 1) {
      h[i] = Math.max(eps, level - depth + (rim - level + depth) * q * q * Math.sqrt(q));
      continue;
    }
    if (r < 2.2 * radius) h[i] = Math.max(h[i], rim - (r - radius) * RIM_FALL);
    // Held under the cap, fading out between CAP_REACH radii so the flanks meet it without a step.
    const cap = level + RIM - (r - radius) * CAP_FALL;
    const w = 1 - smoothstep((q - CAP_REACH[0]) / (CAP_REACH[1] - CAP_REACH[0]));
    if (h[i] > cap) h[i] -= w * (h[i] - cap);
  }
}

function smoothstep(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** A soft ceiling at 1: rises at slope 1 from 0 and levels off at 1 by u = 2. */
function softCap(u: number): number {
  return u <= 0 ? u : u >= 2 ? 1 : u - (u * u) / 4;
}

/** A table: a flat top tilted to the south, walls straight up from the sea. `toSea` is each node's distance to the sea in nodes. */
function table(h: Float64Array, gN: number, nodes: Int32Array, core: Core, cpn: number, s: number, toSea: Float32Array, rng: Rng, eps: number): void {
  const top = rng.range(TABLE_TOP[0], TABLE_TOP[1]), tilt = rng.range(TABLE_TILT[0], TABLE_TILT[1]);
  const n = gN * cpn, rim = TABLE_RIM * s;
  for (const i of nodes) {
    const y = Math.floor(i / gN);
    const south = torusDelta(core.y, (y + 0.5) * cpn, n) / core.radius;
    const surface = top * softCap(h[i] / TABLE_SOFT) + TABLE_RELIEF * h[i] - tilt * south;
    const wall = smoothstep((toSea[i] * cpn - 0.5 * cpn) / rim);
    h[i] = Math.max(eps, surface * wall);
  }
}

/** A lode's course from the land node `from` to the sea, as points in cells relative to the core; null if it never reaches the sea or reaches it within LODE_MIN of the radius. */
function lodePath(gN: number, isSea: Uint8Array, core: Core, from: number, cpn: number, s: number, rng: Rng): Float64Array | null {
  const n = gN * cpn, fx = from % gN, fy = (from - fx) / gN;
  const heading = rng.range(0, 2 * Math.PI), wave = rng.range(LODE_WAVE[0], LODE_WAVE[1]) * s, phase = rng.range(0, 2 * Math.PI);
  const drift = rng.range(-0.25, 0.25);
  const step = cpn / 2, pts: number[] = [torusDelta(core.x, (fx + 0.5) * cpn, n), torusDelta(core.y, (fy + 0.5) * cpn, n)];
  let x = pts[0], y = pts[1];
  for (let k = 1; k * step < 2 * core.radius; k++) {
    const t = k * step;
    const th = heading + LODE_SWING * psin(phase + (2 * Math.PI * t) / wave) + (drift * t) / core.radius;
    x += step * pcos(th);
    y += step * psin(th);
    pts.push(x, y);
    if (isSea[wrapIndex(Math.floor((core.x + x) / cpn), Math.floor((core.y + y) / cpn), gN)]) return t >= LODE_MIN * core.radius ? Float64Array.from(pts) : null;
  }
  return null;
}

/** A fen: the ground levelled to a little above the sea, gathered into lodes, with meres in its hollows. */
function fen(h: Float64Array, gN: number, isSea: Uint8Array, nodes: Int32Array, core: Core, cpn: number, s: number, seed: number, rng: Rng): void {
  const n = gN * cpn, period = Math.max(1, Math.round(n / (MERE_CELLS * s)));
  const lodes: Float64Array[] = [];
  const want = LODES[0] + rng.int(LODES[1] - LODES[0] + 1);
  for (let tries = 0; tries < 12 * want && lodes.length < want && nodes.length > 0; tries++) {
    const path = lodePath(gN, isSea, core, nodes[rng.int(nodes.length)], cpn, s, rng);
    if (path !== null) lodes.push(path);
  }
  const band = LODE_BAND * s;
  for (const i of nodes) {
    const x = i % gN, y = (i - x) / gN;
    let level = FEN_TOP * softCap(h[i] / FEN_TOP);
    // The nearest lode, and how far along it.
    const px = torusDelta(core.x, (x + 0.5) * cpn, n), py = torusDelta(core.y, (y + 0.5) * cpn, n);
    let near = Infinity, along = 0;
    for (const path of lodes) {
      const m = path.length / 2;
      for (let k = 0; k + 1 < m; k++) {
        const ax = path[2 * k], ay = path[2 * k + 1], bx = path[2 * k + 2] - ax, by = path[2 * k + 3] - ay;
        const qx = px - ax, qy = py - ay;
        if (Math.abs(qx) > band + 8 || Math.abs(qy) > band + 8) continue;
        const tau = Math.min(1, Math.max(0, (qx * bx + qy * by) / (bx * bx + by * by)));
        const ex = qx - tau * bx, ey = qy - tau * by, d = Math.sqrt(ex * ex + ey * ey);
        if (d < near) {
          near = d;
          along = (k + tau) / (m - 1);
        }
      }
    }
    if (near < band) {
      // The band is squeezed down onto the lode: its relief is kept, but everything in it falls towards the river.
      const bed = LODE_BED[0] + (LODE_BED[1] - LODE_BED[0]) * along;
      if (level > bed) level = bed + (level - bed) * (near / band);
    }
    const v = 1.6 * fbm(((x + 0.5) * cpn * period) / n, ((y + 0.5) * cpn * period) / n, period, 2, 0.5, seed);
    // Meres keep clear of the lodes, so the rivers are not drowned in them.
    const dent = MERE_DEPTH * smoothstep((v - MERE_AT) / 0.12) * smoothstep((near - 0.15 * band) / (0.15 * band));
    h[i] = Math.max(Math.min(level, MERE_BED), level - dent);
  }
}

/** The sea a caldera holds: reached from round its islet without going farther than LAGOON_REACH of its radius from the core. `seen` is left clear. */
function lagoonOf(gN: number, isSea: Uint8Array, core: Core, cpn: number, seen: Uint8Array): number[] {
  const n = gN * cpn, cx = Math.floor(core.x / cpn), cy = Math.floor(core.y / cpn), reach = LAGOON_REACH * core.radius;
  const R0 = Math.ceil((0.3 * core.radius) / cpn);
  const lagoon: number[] = [];
  for (let dy = -R0; dy <= R0; dy++) for (let dx = -R0; dx <= R0; dx++) {
    if ((dx * dx + dy * dy) * cpn * cpn > 0.09 * core.radius * core.radius) continue;
    const i = wrapIndex(cx + dx, cy + dy, gN);
    if (isSea[i] && !seen[i]) {
      seen[i] = 1;
      lagoon.push(i);
    }
  }
  for (let k = 0; k < lagoon.length; k++) {
    const i = lagoon[k], x = i % gN, y = (i - x) / gN;
    for (let q = 0; q < 8; q += 2) {
      const j = wrapIndex(x + NB8_DX[q], y + NB8_DY[q], gN);
      if (seen[j] || !isSea[j]) continue;
      const jx = j % gN, jy = (j - jx) / gN;
      const dx = torusDelta(core.x, (jx + 0.5) * cpn, n), dy = torusDelta(core.y, (jy + 0.5) * cpn, n);
      if (dx * dx + dy * dy > reach * reach) continue;
      seen[j] = 1;
      lagoon.push(j);
    }
  }
  for (const i of lagoon) seen[i] = 0;
  return lagoon;
}

/** Height of `h` at (x, y) in nodes, bilinear, on the torus. */
function sampleAt(h: Float64Array, gN: number, x: number, y: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
  const a = h[wrapIndex(fx, fy, gN)], b = h[wrapIndex(fx + 1, fy, gN)], c = h[wrapIndex(fx, fy + 1, gN)], d = h[wrapIndex(fx + 1, fy + 1, gN)];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** A caldera's walls: the ring stands sheer from its lagoon. `toLagoon` is each node's nearest lagoon node; `was` the heights before any wall. */
function calderaWalls(h: Float64Array, was: Float64Array, gN: number, isSea: Uint8Array, core: Core, cpn: number, s: number, toLagoon: Nearest): void {
  const n = gN * cpn, pull = WALL_PULL * s, reach = WALL_REACH * s;
  const cx = Math.floor(core.x / cpn), cy = Math.floor(core.y / cpn), R = Math.ceil((1.15 * core.radius) / cpn);
  // The ring, not the islets: land beyond `inner` of the core.
  const inner = 0.36 * core.radius;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = (((cx + dx) % gN) + gN) % gN, y = (((cy + dy) % gN) + gN) % gN, i = y * gN + x;
    const d = toLagoon.dist[i] * cpn, src = toLagoon.src[i];
    if (isSea[i] || src < 0 || d >= reach) continue;
    const ox = torusDelta(core.x, (x + 0.5) * cpn, n), oy = torusDelta(core.y, (y + 0.5) * cpn, n);
    if (ox * ox + oy * oy < inner * inner) continue;
    const sx = src % gN, sy = (src - sx) / gN;
    const ux = torusDelta(sx, x, gN), uy = torusDelta(sy, y, gN), len = Math.sqrt(ux * ux + uy * uy);
    if (len === 0) continue;
    const shift = (pull * (1 - d / reach)) / cpn;
    const v = sampleAt(was, gN, x + (ux / len) * shift, y + (uy / len) * shift);
    if (v > h[i]) h[i] = v;
  }
}

export function shapeForms(h: Float64Array, gN: number, isSea: Uint8Array, plan: Plan, p: WorldParams, seed: number): void {
  const cpn = p.n / gN, s = lengthScale(p.n);
  const seen = new Uint8Array(gN * gN);
  let toSea: Float32Array | null = null;
  const mereSeed = rngFor(seed, "form-meres").next();
  // Every caldera's lagoon at once: one distance field serves them all.
  const calderas = plan.cores.filter((c) => c.form === FORM.caldera);
  if (calderas.length > 0) {
    const lagoon = new Uint8Array(gN * gN);
    for (const core of calderas) for (const i of lagoonOf(gN, isSea, core, cpn, seen)) lagoon[i] = 1;
    const toLagoon = nearestSource(gN, lagoon), was = Float64Array.from(h);
    for (const core of calderas) calderaWalls(h, was, gN, isSea, core, cpn, s, toLagoon);
  }
  plan.cores.forEach((core, k) => {
    if (core.form !== FORM.cone && core.form !== FORM.table && core.form !== FORM.fen) return;
    const rng = rngFor(seed, `form-${k}`);
    const nodes = islandNodes(h, gN, isSea, plan, k, cpn, 1.3 * core.radius, seen);
    if (core.form === FORM.cone) crater(h, gN, isSea, nodes, core, cpn, s, rng, p.erode.eps);
    else if (core.form === FORM.table) {
      toSea ??= nearestSource(gN, isSea).dist;
      table(h, gN, nodes, core, cpn, s, toSea, rng, p.erode.eps);
    } else fen(h, gN, isSea, nodes, core, cpn, s, mereSeed, rng);
  });
}

/** Where the coast should treat the water as quiet, shallow or deep (see CoastContext). Every field is on G. */
export interface FormWaters {
  calm: Float32Array;
  shoal: Float32Array;
  deep: Float32Array;
}

/** The waters of the forms, on the land `h` as shapeForms left it: a caldera's lagoon, a fen's flats and a fjord's deeps. */
export function formWaters(h: Float64Array, gN: number, plan: Plan, p: WorldParams): FormWaters {
  const nn = gN * gN, cpn = p.n / gN, s = lengthScale(p.n);
  const calm = new Float32Array(nn), shoal = new Float32Array(nn), deep = new Float32Array(nn);
  const isSea = new Uint8Array(nn), isLand = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    if (h[i] <= 0) isSea[i] = 1;
    else isLand[i] = 1;
  }
  const toLand = nearestSource(gN, isLand);
  const seen = new Uint8Array(nn);
  const fenLand = new Uint8Array(nn);
  plan.cores.forEach((core, k) => {
    if (core.form === FORM.fen) {
      for (const i of islandNodes(h, gN, isSea, plan, k, cpn, 1.3 * core.radius, seen)) {
        fenLand[i] = 1;
        calm[i] = FEN_CALM;
      }
    } else if (core.form === FORM.caldera) {
      const lagoon = lagoonOf(gN, isSea, core, cpn, seen);
      for (const i of lagoon) {
        shoal[i] = LAGOON_DEPTH;
        // Its shores, inside the ring and round the islets, are calm.
        const x = i % gN, y = (i - x) / gN;
        for (let q = 0; q < 8; q++) {
          const j = wrapIndex(x + NB8_DX[q], y + NB8_DY[q], gN);
          if (isLand[j]) calm[j] = LAGOON_CALM;
        }
      }
    }
  });
  const flats = FLATS * s;
  // The flats are measured from the fen alone, so another island's shore nearby does not cut them off.
  const toFen = plan.cores.some((c) => c.form === FORM.fen) ? nearestSource(gN, fenLand).dist : null;
  for (let i = 0; i < nn; i++) {
    if (!isSea[i]) continue;
    const d = toLand.dist[i] * cpn;
    if (toFen !== null && toFen[i] < Infinity && shoal[i] === 0) {
      const f = toFen[i] * cpn, t = f / flats;
      const bed = t <= 1 ? FLATS_DEPTH[0] + (FLATS_DEPTH[1] - FLATS_DEPTH[0]) * t * t : FLATS_DEPTH[1] + FLATS_FALL * (f - flats);
      if (bed < p.coast.bathy.max) shoal[i] = bed;
    }
    const x = i % gN, y = (i - x) / gN;
    if (plan.fjord[(y >> 1) * plan.n + (x >> 1)]) deep[i] = FJORD_DEEP * Math.min(1, Math.max(0, d - 0.5 * cpn) / (FJORD_SHELF * s));
  }
  return { calm, shoal, deep };
}
