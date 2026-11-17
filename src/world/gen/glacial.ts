// S4 Glacial imprint: no ice simulation, four geometric operators on G.
// Troughs give large highland channels a parabolic U section; ribbon lakes
// overdeepen valley floors in lake country; tarns lie in cirques, armchair
// hollows cut into highland slopes that open southward, where the camera
// sees in over the lip; moraine dams are bars across valleys.

import { rngFor, type Rng } from "../core/rng.ts";
import { torusDelta, wrapIndex } from "../core/torus.ts";
import { drainage, regionsOn } from "./field.ts";
import { priorityFlood } from "./flood.ts";
import { ARCHETYPE, type WorldParams } from "./params.ts";
import type { Plan } from "./plan.ts";
import { type CirqueStamp, cirqueAt, stamped, stampReach } from "./stamps.ts";

export interface GlacialContext {
  /** Six planes of n², archetype-major, on the same grid as the heights. */
  regions: Float32Array;
  /** Drainage area in nodes. */
  area: Float64Array;
  rcv: Int32Array;
  isSea: Uint8Array;
}

export interface GlacialFeature {
  kind: "lake" | "tarn" | "dam";
  /** Centre in cells: a lake's midpoint, the middle of a tarn's water, the middle of a dam. */
  x: number;
  y: number;
  /** Cells: a lake's length, half a tarn's length, a dam's half-length. */
  size: number;
  /** Units: how far the floor was lowered, or how high the bar stands. */
  depth: number;
  /** Unit vector: downstream for a lake or a dam; for a tarn, downslope from its headwall to its outlet. */
  dx: number;
  dy: number;
}

/** Which operator touched a node. Depressions exist only where this is lake, tarn or dam. */
export const GLACIAL_MASK = { none: 0, lake: 1, tarn: 2, dam: 3, trough: 4 } as const;

export interface GlacialResult {
  h: Float64Array;
  lakes: GlacialFeature[];
  tarns: GlacialFeature[];
  dams: GlacialFeature[];
  /** One stamp per tarn, in the same order: the bake cuts them again at cell size. */
  cirques: CirqueStamp[];
  mask: Uint8Array;
}

/** Land is never lowered below this, so the sea mask does not change. */
const LAND_MIN = 0.5;
/** A lake's reach keeps this far inside its region's mask, so the water it holds stays inside too. */
const REGION_MARGIN = 0.1;
/** Features keep this many of their own sizes apart. */
const KEEP_APART = 2.5;
/** A cirque's wall and lip must meet the slope within this many lake lengths of the water. */
const TARN_REACH = 1.6;
/** A tarn is at least this many nodes long and holds at least as many, however small the world. */
const TARN_NODES = 5;
/** A tarn's half-width as a share of its length. */
const TARN_ASPECT: readonly [number, number] = [0.3, 0.42];
/** The water stands this far above the old ground at the outlet. */
const TARN_LIP = 0.3;
/** Behind this share of the lake's length (from its back), the old ground within TARN_BAND nodes of the shore is what the headwall is cut from. */
const TARN_BACK = 0.6;
const TARN_BAND = 2;
/** Each tarn is the best of this many sites that fit. */
const TARN_PICKS = 8;
/** A depression shallower than this is rounding, not a lake. */
const DEPRESSION = 1e-3;

export function glacialContext(h: Float64Array, n: number, isSea: Uint8Array, plan: Plan, p: WorldParams): GlacialContext {
  const d = drainage(h, n, isSea, p.erode.eps);
  return { regions: regionsOn(plan, n / plan.n), area: d.area, rcv: d.rcv, isSea };
}

function pick(rng: Rng, range: readonly [number, number]): number {
  return range[0] + rng.int(range[1] - range[0] + 1);
}

/** Marks every node within r nodes of (x, y). */
function block(blocked: Uint8Array, n: number, x: number, y: number, r: number): void {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy <= r * r) blocked[wrapIndex(x + dx, y + dy, n)] = 1;
    }
  }
}

export function glacial(h: Float64Array, n: number, ctx: GlacialContext, p: WorldParams, seed: number): GlacialResult {
  const nn = n * n;
  const cpn = p.n / n;
  const node2 = cpn * cpn;
  const rng = rngFor(seed, "glacial");
  const g = p.glacial;
  const { regions, area, rcv, isSea } = ctx;
  const HL = ARCHETYPE.highland * nn;
  const LK = ARCHETYPE.lakes * nn;
  let out: Float64Array = new Float64Array(h);
  const mask = new Uint8Array(nn);
  const blocked = new Uint8Array(nn);

  // 1. Troughs: every large highland channel node lowers the ground beside it
  // to a parabola through its own floor.
  const tr = g.trough;
  const trArea = tr.minArea / node2;
  for (let i = 0; i < nn; i++) {
    if (isSea[i] || regions[HL + i] < g.mask || h[i] < tr.minFloor || area[i] < trArea) continue;
    const grow = Math.min(1, Math.max(0, Math.sqrt(area[i] / trArea) - 1));
    const W = tr.halfWidth[0] + (tr.halfWidth[1] - tr.halfWidth[0]) * grow;
    const R = Math.ceil(W / cpn);
    const x = i % n;
    const y = (i - x) / n;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy) * cpn;
        if (d >= W || d === 0) continue;
        const j = wrapIndex(x + dx, y + dy, n);
        if (isSea[j]) continue;
        const target = h[i] + (tr.wall * d * d) / W;
        if (target < out[j]) {
          out[j] = target;
          mask[j] = GLACIAL_MASK.trough;
        }
      }
    }
  }
  // A trough must not pond: fill whatever pits the carving left.
  out = priorityFlood(out, n, isSea, p.erode.eps).filled;

  // 2. Ribbon lakes: the flattest reach of the wanted length in lake country.
  const lakes: GlacialFeature[] = [];
  const lk = g.lakes;
  const lakeArea = lk.minArea / node2;
  const lakeCands: number[] = [];
  for (let i = 0; i < nn; i++) {
    if (!isSea[i] && regions[LK + i] >= g.mask && area[i] >= lakeArea && out[i] >= lk.minFloor) lakeCands.push(i);
  }
  const lakeCount = pick(rng, lk.count);
  const path: number[] = [];
  const along: number[] = [];
  /** Walks downstream from c for `length` cells; returns the drop, or −1 when the reach leaves the mask. */
  const reach = (c: number, length: number): number => {
    path.length = 0;
    along.length = 0;
    let i = c;
    let len = 0;
    while (true) {
      if (isSea[i] || blocked[i] || regions[LK + i] < g.mask + REGION_MARGIN || out[i] < lk.minFloor) return -1;
      path.push(i);
      along.push(len);
      if (len >= length) break;
      const j = rcv[i];
      if (j === i) return -1;
      const dx = torusDelta(i % n, j % n, n);
      const dy = torusDelta(Math.floor(i / n), Math.floor(j / n), n);
      len += Math.sqrt(dx * dx + dy * dy) * cpn;
      i = j;
    }
    return Math.max(0, out[c] - out[i]);
  };
  const lower = new Float64Array(nn);
  for (let k = 0; k < lakeCount; k++) {
    let length = rng.range(lk.length[0], lk.length[1]);
    const depth = rng.range(lk.depth[0], lk.depth[1]);
    const half = Math.max(rng.range(lk.halfWidth[0], lk.halfWidth[1]), 1.5 * cpn);
    let best = -1;
    for (let attempt = 0; attempt < 4 && best < 0; attempt++) {
      let bestDrop = Infinity;
      for (const c of lakeCands) {
        const drop = reach(c, length);
        if (drop >= 0 && drop < bestDrop) {
          bestDrop = drop;
          best = c;
        }
      }
      if (best < 0) length = Math.max(lk.length[0], length * 0.7);
    }
    if (best < 0) continue;
    reach(best, length);
    const total = along[along.length - 1];
    const last = path[path.length - 1];
    const lip = out[last];
    // A rock bar raises the outlet by part of the depth and the floor is
    // deepened by the rest, so the water stands against the valley's own
    // sides: its shore is their contour, long and narrow, shelving at the head.
    const sill = lk.sill * depth;
    const dig = depth - sill;
    const level = lip + sill;
    const R = Math.ceil(half / cpn);
    const touched: number[] = [];
    for (let s = 0; s < path.length; s++) {
      const t = along[s] / total;
      // Dig what brings the floor under the water along the reach, but never more
      // than maxDig, and nothing at the head: there the old floor shelves into the lake.
      const want = out[path[s]] - (level - 0.5 - dig * 4 * t * (1 - t));
      const amp = Math.min(lk.maxDig, Math.max(0, want)) * Math.min(1, t / lk.head);
      if (amp <= 0) continue;
      const x = path[s] % n;
      const y = (path[s] - x) / n;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy) * cpn;
          if (d >= half) continue;
          const j = wrapIndex(x + dx, y + dy, n);
          if (isSea[j] || regions[LK + j] < g.mask) continue;
          // A bell with no wall: the lowering fades to nothing, and to no slope, at the half-width.
          const bell = 1 - (d * d) / (half * half);
          const low = amp * bell * bell;
          if (low > lower[j]) {
            if (lower[j] === 0) touched.push(j);
            lower[j] = low;
          }
        }
      }
    }
    for (const j of touched) {
      if (out[j] > LAND_MIN) out[j] = Math.max(LAND_MIN, out[j] - lower[j]);
      lower[j] = 0;
      mask[j] = GLACIAL_MASK.lake;
    }
    // The bar: from the lip the valley floor is filled to a ramp that falls downstream.
    const before = path[Math.max(0, path.length - 4)];
    let bx = torusDelta(before % n, last % n, n);
    let by = torusDelta(Math.floor(before / n), Math.floor(last / n), n);
    const bl = Math.sqrt(bx * bx + by * by) || 1;
    bx /= bl;
    by /= bl;
    const lx = last % n;
    const ly = (last - lx) / n;
    const span = Math.ceil((2 * half) / cpn);
    let node = last;
    let run = 0;
    for (let guard = 0; guard < 400; guard++) {
      const fill = level - lk.sillSlope * run;
      if (isSea[node] || fill <= out[node]) break;
      const x = node % n;
      const y = (node - x) / n;
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          if (dx * dx + dy * dy > span * span) continue;
          const j = wrapIndex(x + dx, y + dy, n);
          if (isSea[j] || regions[LK + j] < g.mask || fill <= out[j]) continue;
          // Never upstream of the lip: that is the lake.
          if (torusDelta(lx, x + dx, n) * bx + torusDelta(ly, y + dy, n) * by < -0.5) continue;
          out[j] = fill;
          mask[j] = GLACIAL_MASK.lake;
        }
      }
      const next = rcv[node];
      if (next === node) break;
      const dx = torusDelta(x, next % n, n);
      const dy = torusDelta(y, Math.floor(next / n), n);
      run += Math.sqrt(dx * dx + dy * dy) * cpn;
      node = next;
    }
    // A delta where the stream enters: a low fan at the first drowned node of the reach.
    for (let s = 0; s < path.length; s++) {
      if (out[path[s]] >= level) continue;
      const x = path[s] % n;
      const y = (path[s] - x) / n;
      const fanR = Math.ceil((0.8 * half) / cpn);
      for (let dy = -fanR; dy <= fanR; dy++) {
        for (let dx = -fanR; dx <= fanR; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy) * cpn;
          if (d >= 0.8 * half) continue;
          const j = wrapIndex(x + dx, y + dy, n);
          const fan = level + 0.1 - lk.fanSlope * d;
          if (isSea[j] || regions[LK + j] < g.mask || fan <= out[j]) continue;
          out[j] = fan;
          mask[j] = GLACIAL_MASK.lake;
        }
      }
      break;
    }
    const first = path[0];
    const mid = path[path.length >> 1];
    const vx = torusDelta(first % n, last % n, n);
    const vy = torusDelta(Math.floor(first / n), Math.floor(last / n), n);
    const vl = Math.sqrt(vx * vx + vy * vy) || 1;
    lakes.push({ kind: "lake", x: ((mid % n) + 0.5) * cpn, y: (Math.floor(mid / n) + 0.5) * cpn, size: total, depth, dx: vx / vl, dy: vy / vl });
    const apart = (KEEP_APART * 2 * half) / cpn + 2;
    for (const i of path) block(blocked, n, i % n, Math.floor(i / n), apart);
  }

  // Water held behind a bar lies outside the ground it touched: mark it.
  if (lakes.length > 0) {
    const filled = priorityFlood(out, n, isSea, p.erode.eps).filled;
    for (let i = 0; i < nn; i++) {
      if ((mask[i] === GLACIAL_MASK.none || mask[i] === GLACIAL_MASK.trough) && filled[i] - out[i] > DEPRESSION) mask[i] = GLACIAL_MASK.lake;
    }
  }

  // 3. Tarns: cirques at the heads of small highland valleys, on slopes that fall
  // southward, so the camera looks in over the lip at the headwall. Each is a
  // stamp: cut here on G, and again at cell size by the bake.
  const tarns: GlacialFeature[] = [];
  const cirques: CirqueStamp[] = [];
  const tn = g.tarns;
  const tarnCands: number[] = [];
  for (let i = 0; i < nn; i++) {
    if (!isSea[i] && regions[HL + i] >= g.mask && out[i] >= tn.minHeight && area[i] * node2 >= tn.minArea && area[i] * node2 <= tn.maxArea && mask[i] !== GLACIAL_MASK.lake) tarnCands.push(i);
  }
  const tarnCount = pick(rng, tn.count);
  const changed: number[] = [];
  const heights: number[] = [];
  let bestChanged: number[] = [];
  let bestHeights: number[] = [];
  let tries = 0;
  for (let k = 0; k < tarnCount && tries < 4000 && tarnCands.length > 0; k++) {
    // Of the first few sites that fit, the one with the most ground standing behind it: a valley head, not a gullied face.
    let best: CirqueStamp | null = null;
    let bestRise = 0;
    let bestAt = 0;
    for (let found = 0; found < TARN_PICKS && tries < 4000; tries++) {
      const c = tarnCands[rng.int(tarnCands.length)];
      const len = Math.max(rng.range(tn.length[0], tn.length[1]), TARN_NODES * cpn);
      const width = Math.max(len * rng.range(TARN_ASPECT[0], TARN_ASPECT[1]), 0.3 * TARN_NODES * cpn);
      const stampSeed = rng.next();
      if (blocked[c]) continue;
      const x = c % n;
      const y = (c - x) / n;
      const q = Math.max(1, Math.round((0.5 * len) / cpn));
      // Downhill along the lake's length.
      const gx = out[wrapIndex(x - q, y, n)] - out[wrapIndex(x + q, y, n)];
      const gy = out[wrapIndex(x, y - q, n)] - out[wrapIndex(x, y + q, n)];
      const gl = Math.sqrt(gx * gx + gy * gy);
      if (gl === 0) continue;
      const ox = gx / gl;
      const oy = gy / gl;
      // Open within 60° of south (+y): the headwall faces the camera.
      if (oy < 0.5) continue;
      // A cirque needs a slope to cut its headwall from, but a wall would need a quarry.
      const fall = gl / (2 * q * cpn);
      if (fall < tn.slope[0] || fall > tn.slope[1]) continue;
      const lip = wrapIndex(Math.round(x + (ox * 0.5 * len) / cpn), Math.round(y + (oy * 0.5 * len) / cpn), n);
      if (isSea[lip] || regions[HL + lip] < g.mask || out[lip] >= out[c]) continue;
      // The water stands at the old ground of the outlet: the lake is cut back into the slope, and only its lip is banked.
      const level = out[lip] + TARN_LIP;
      if (level - tn.depth < LAND_MIN) continue;
      const far = TARN_REACH * len;
      const stamp: CirqueStamp = { kind: "cirque", x: (x + 0.5) * cpn, y: (y + 0.5) * cpn, ax: ox, ay: oy, len, width, level, depth: tn.depth, wall: tn.wall, fall: tn.fall + 1.2 * fall, reach: far, seed: stampSeed };
      const R = Math.ceil(stampReach(stamp) / cpn);
      changed.length = 0;
      heights.length = 0;
      let fits = true;
      let need = 0;
      let wet = 0;
      // The lowest old ground in a band behind and beside the water, over the water: what the headwall is cut from.
      let rise = Infinity;
      for (let dy = -R; dy <= R && fits; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const j = wrapIndex(x + dx, y + dy, n);
          const at = cirqueAt(stamp, dx * cpn, dy * cpn);
          const d = at.d;
          const behind = at.t < TARN_BACK;
          if (behind && d > 0 && d <= TARN_BAND * cpn) {
            // A deep gully through the back or the rim beside it would leave the lake banked like a pond: the stamp's shoulder fills only a shallow one.
            if (isSea[j] || out[j] < level + tn.rise) {
              fits = false;
              break;
            }
            if (out[j] - level < rise) rise = out[j] - level;
          }
          const v = stamped(stamp, out[j], dx * cpn, dy * cpn);
          if (v === out[j]) continue;
          // Everything it moves is highland, and the wall and the lip both meet the slope within reach.
          if (isSea[j] || regions[HL + j] < g.mask || blocked[j] || d > far - cpn) {
            fits = false;
            break;
          }
          if (d < 0) wet++;
          if (d > need) need = d;
          changed.push(j);
          heights.push(v);
        }
      }
      if (!fits || wet < TARN_NODES) continue;
      found++;
      if (best !== null && rise <= bestRise) continue;
      best = { ...stamp, reach: need + cpn };
      bestRise = rise;
      bestAt = c;
      bestChanged = changed.slice();
      bestHeights = heights.slice();
    }
    if (best === null) break;
    for (let m = 0; m < bestChanged.length; m++) {
      out[bestChanged[m]] = bestHeights[m];
      mask[bestChanged[m]] = GLACIAL_MASK.tarn;
    }
    cirques.push(best);
    tarns.push({ kind: "tarn", x: best.x, y: best.y, size: 0.5 * best.len, depth: tn.depth, dx: best.ax, dy: best.ay });
    block(blocked, n, bestAt % n, Math.floor(bestAt / n), (KEEP_APART * best.len) / cpn);
  }

  // 4. Moraine dams: a bar across a valley whose sides rise above it within the span.
  const dams: GlacialFeature[] = [];
  const dm = g.dams;
  const damArea = dm.minArea / node2;
  const damCands: number[] = [];
  for (let i = 0; i < nn; i++) {
    if (!isSea[i] && regions[HL + i] + regions[LK + i] >= g.mask && area[i] >= damArea && out[i] >= dm.minFloor && mask[i] !== GLACIAL_MASK.lake && mask[i] !== GLACIAL_MASK.tarn) damCands.push(i);
  }
  const damCount = pick(rng, dm.count);
  const thick = Math.max(dm.thickness, 2.5 * cpn);
  for (let k = 0, tries = 0; k < damCount && tries < 4000 && damCands.length > 0; tries++) {
    const c = damCands[rng.int(damCands.length)];
    const height = rng.range(dm.height[0], dm.height[1]);
    if (blocked[c]) continue;
    const x = c % n;
    const y = (c - x) / n;
    let e = c;
    for (let s = 0; s < 3; s++) e = rcv[e];
    const fx0 = torusDelta(x, e % n, n);
    const fy0 = torusDelta(y, Math.floor(e / n), n);
    const fl = Math.sqrt(fx0 * fx0 + fy0 * fy0);
    if (fl === 0 || isSea[e]) continue;
    const fx = fx0 / fl;
    const fy = fy0 / fl;
    const floor = out[c];
    const top = floor + height;
    // How far the bar runs each way before the valley side stands above it.
    const side = (sign: number): number => {
      const steps = Math.ceil(dm.span / cpn);
      for (let s = 1; s <= steps; s++) {
        const j = wrapIndex(Math.round(x - sign * fy * s), Math.round(y + sign * fx * s), n);
        if (isSea[j]) return -1;
        if (out[j] >= top) return s * cpn;
      }
      return -1;
    };
    const left = side(-1);
    const right = side(1);
    if (left < 0 || right < 0) continue;
    const R = Math.ceil((Math.max(left, right) + thick) / cpn);
    const halfT = thick / 2;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const a = (dx * fx + dy * fy) * cpn;
        const b = (dy * fx - dx * fy) * cpn;
        if (Math.abs(a) >= halfT || b < -left - cpn || b > right + cpn) continue;
        const j = wrapIndex(x + dx, y + dy, n);
        if (isSea[j] || regions[HL + j] + regions[LK + j] < g.mask) continue;
        const q = (a * a) / (halfT * halfT);
        const target = floor + height * (1 - q * q);
        if (target > out[j]) {
          out[j] = target;
          mask[j] = GLACIAL_MASK.dam;
        }
      }
    }
    dams.push({ kind: "dam", x: (x + 0.5) * cpn, y: (y + 0.5) * cpn, size: Math.max(left, right), depth: height, dx: fx, dy: fy });
    block(blocked, n, x, y, (KEEP_APART * dm.span) / cpn);
    k++;
  }

  // Water held behind a dam lies outside the bar itself: mark it.
  if (dams.length > 0) {
    const filled = priorityFlood(out, n, isSea, p.erode.eps).filled;
    for (let i = 0; i < nn; i++) {
      if (mask[i] === GLACIAL_MASK.none || mask[i] === GLACIAL_MASK.trough) {
        if (filled[i] - out[i] > DEPRESSION) mask[i] = GLACIAL_MASK.dam;
      }
    }
  }

  return { h: out, lakes, tarns, dams, cirques, mask };
}

