// S6 Coasts on G: the shoreline evened out where the rock is soft, exposure
// from open-water fetch, cliff retreat to a wave-cut platform with the
// orientation gate, stacks, coves, beaches whose width follows the bays,
// dunes, saltmarsh, river mouths and bathymetry. Sharp features are written
// as stamps and cut into the returned heights with the same code the bake
// runs on cells.

import { sortIndicesBy } from "../core/heap.ts";
import { fbm, GRADIENTS } from "../core/noise.ts";
import { rngFor } from "../core/rng.ts";
import { NB8_DX, NB8_DY, torusDelta, wrapIndex } from "../core/torus.ts";
import { boxBlur, drainage, nearestSource, nodeAt, regionsOn, rockOn } from "./field.ts";
import { ARCHETYPE_COUNT, lengthScale, type WorldParams } from "./params.ts";
import type { Plan } from "./plan.ts";
import { applyStamps, type CoveStamp, deltaAt, inCove, spitCentre, type SpitStamp, type Stamp, stampReach } from "./stamps.ts";

export interface CoastContext {
  /** Rock class per node (0 hard, 1 medium, 2 soft) on the same grid as the heights. */
  rock: Uint8Array;
  /** Six planes of region weights on the same grid, archetype-major; without them every shore is treated alike. */
  regions: Float32Array | null;
  /** Hold the cliffs to one retreat and one cap along the shore (for tests that compare a coast node for node). */
  plain?: boolean;
}

/**
 * Shore classes. `beach` is sand and nothing else; `rocky` is a shingle strand or a rock ledge;
 * `dune` is the grassed, hummocky band behind a wide beach; `marsh` is saltmarsh on sheltered flats.
 * `none` on a shore is a low grass bluff that meets the water.
 */
export const SHORE = { none: 0, beach: 1, rocky: 2, cliff: 3, cove: 4, dune: 5, marsh: 6 } as const;

export interface CoastResult {
  /** Heights with every stamp applied: what hydrology runs on. */
  h: Float64Array;
  /** Heights before the stamps (bathymetry in, cliffs uncut): what the bake upsamples and stamps at cell size. */
  base: Float64Array;
  isSea: Uint8Array;
  /** Exposure of the nearest shore, for every node. */
  exposure: Float32Array;
  /**
   * SHORE class per node of `h`. Cliff, rocky and cove sit on shore nodes only. Beach covers every
   * node of the sand, dune the band behind it and marsh the whole flat, so these three reach inland.
   */
  shoreClass: Uint8Array;
  /**
   * Distance to the waterline of `h` in cells: positive on land, negative at sea, 0 on the line,
   * held to ±coast.shoreReach. Smooth enough to sample bilinearly.
   */
  shoreDist: Float32Array;
  /**
   * Width of the sand in cells, measured inland from the waterline, at the nearest shore: 0 where
   * that shore holds no sand. Set within shoreReach of the shore and smooth along it, so a cell is
   * sand when it lies no farther from the sea than the bilinear sample of this field.
   */
  sandWidth: Float32Array;
  /** Width in cells of the dune band behind the sand, likewise: dunes lie between sandWidth and sandWidth + duneWidth from the sea. */
  duneWidth: Float32Array;
  /** Saltmarsh, 0–1: 1 on marsh nodes and the water against them, blurred one node. A land cell is marsh where the bilinear sample is at least 0.5. */
  marsh: Float32Array;
  stamps: Stamp[];
}

export function coastContext(plan: Plan, n: number): CoastContext {
  return { rock: rockOn(plan, n / plan.n), regions: regionsOn(plan, n / plan.n) };
}

export interface Shore {
  /** Land nodes with a sea neighbour, in index order. */
  nodes: Int32Array;
  /** Position of each node in `nodes`, or −1. */
  slot: Int32Array;
  /** Exposure per node; 0 away from the shore. */
  e: Float32Array;
}

/** Labels the largest 4-connected body of sea. */
function ocean(isSea: Uint8Array, n: number): Uint8Array {
  const nn = n * n;
  const label = new Int32Array(nn);
  const stack = new Int32Array(nn);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < nn; s++) {
    if (!isSea[s] || label[s] !== 0) continue;
    next++;
    let top = 0;
    let size = 0;
    stack[top++] = s;
    label[s] = next;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % n;
      const y = (i - x) / n;
      for (let k = 0; k < 8; k += 2) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (isSea[j] && label[j] === 0) {
          label[j] = next;
          stack[top++] = j;
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(nn);
  if (best !== 0) for (let i = 0; i < nn; i++) if (label[i] === best) out[i] = 1;
  return out;
}

/**
 * Exposure of every shore node: the weighted mean, over 16 rays, of the open
 * water crossed before land (at most maxFetch cells) as a share of maxFetch,
 * then stretched so `range` maps to [0, 1]. A straight shore can see at most
 * half the sky, so the raw share tops out near 0.6 on a real coast. Rays
 * between south and west weigh swWeight. Water cut off from the largest sea
 * shelters its shore completely.
 */
export function shoreExposure(isSea: Uint8Array, n: number, cellsPerNode: number, maxFetch: number, swWeight: number, range: readonly [number, number]): Shore {
  const nn = n * n;
  const open = ocean(isSea, n);
  const slot = new Int32Array(nn).fill(-1);
  const list: number[] = [];
  const faces = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    if (isSea[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    let sea = false;
    for (let k = 0; k < 8; k++) {
      const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
      if (isSea[j]) {
        sea = true;
        if (open[j]) faces[i] = 1;
      }
    }
    if (sea) {
      slot[i] = list.length;
      list.push(i);
    }
  }
  const nodes = Int32Array.from(list);
  const steps = Math.max(1, Math.round(maxFetch / cellsPerNode));
  let e = new Float32Array(nn);
  let total = 0;
  for (let k = 0; k < 16; k++) total += k >= 4 && k <= 8 ? swWeight : 1;
  for (const i of nodes) {
    if (!faces[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const dx = GRADIENTS[2 * k];
      const dy = GRADIENTS[2 * k + 1];
      // The first step may land on the shore itself: a ray leaving at a low
      // angle is not blocked by the coast it starts from.
      let t = 1;
      let water = 0;
      for (; t <= steps; t++) {
        if (isSea[wrapIndex(Math.round(x + t * dx), Math.round(y + t * dy), n)]) water++;
        else if (t > 1) break;
      }
      sum += (k >= 4 && k <= 8 ? swWeight : 1) * (t > steps ? steps : water);
    }
    e[i] = Math.min(1, Math.max(0, (sum / (total * steps) - range[0]) / (range[1] - range[0])));
  }
  // Two passes of smoothing along the shore take out ray aliasing.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(nn);
    for (const i of nodes) {
      if (!faces[i]) continue;
      const x = i % n;
      const y = (i - x) / n;
      let sum = e[i];
      let count = 1;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (slot[j] >= 0 && faces[j]) {
          sum += e[j];
          count++;
        }
      }
      next[i] = sum / count;
    }
    e = next;
  }
  return { nodes, slot, e };
}

/** Facing is taken from the sea within this many nodes of a shore node. */
const FACING_R = 4;
/** A beach needs this many beach nodes within two nodes of it, itself included. */
const BEACH_RUN = 3;
/** Cuts narrower than this many cells (of the 6400 world) are dropped. */
const MIN_CUT = 1.5;
/** Passes of averaging the retreat along the shore. */
const RETREAT_SMOOTH = 10;
/** A channel with this many times the least drainage gets the largest cove. */
const COVE_FULL = 6;
/** A channel drains at least this many nodes, and a cove's channel this many, however small the world. */
const CHANNEL_NODES = 16;
const COVE_NODES = 40;
/** Share of the retreat band, from the old shore, at which a surviving stack stands. */
const STACK_AT = 0.45;
/** Feature sizes, in cells of the 6400 world, of the noise that varies the shelf's width and of the one that frays its edge. */
const SHELF_CELLS = 220;
const EDGE_CELLS = 60;
/** The exposure field is blurred over this many cells before it shapes the sea bed. */
const BATHY_BLUR = 32;
/** The sea is at least this deep, so a sea node never reads as land. */
const SEA_MIN = 0.05;
/** The cap falls from the cliff cap to the gate's over this much of |facing·east| short of the gate, and is then evened over CAP_SMOOTH passes along the shore. */
const CAP_RAMP = 0.35;
const CAP_SMOOTH = 12;
/** Feature size, in cells of the 6400 world, of the noise that varies the slope behind a cap along the shore. */
const CAP_CELLS = 240;
/**
 * A cliff is as tall as the sea has cut it back, and that wanders along the shore: a broad noise of BLUFF_CELLS (of the 6400
 * world) makes the long bluffs and the low stretches, a finer one of CRAG_CELLS notches them, a headland is cut BLUFF_HEAD
 * deeper and a bay's head as much less. The retreat is never under BLUFF_MIN of the plain one nor over BLUFF_MAX.
 */
const BLUFF_CELLS = 130;
const CRAG_CELLS = 56;
const BLUFF_HEAD = 0.5;
const BLUFF_MIN = 0.2;
const BLUFF_MAX = 2.1;
/** The cap wanders too, between these shares of cliffCap, over CAP_VARY_CELLS; a headland's stands CAP_HEAD of cliffCap higher, a bay's as much lower. */
const CAP_VARY: readonly [number, number] = [0.32, 1.3];
const CAP_VARY_CELLS = 105;
const CAP_HEAD = 0.2;
const CAP_MAX = 1.35;
/**
 * A stream too small for a cove still wears the cliff down where it meets the sea: one draining NOTCH_AREA of a channel's
 * least drainage or more. The retreat beside its mouth is at most NOTCH_SLOPE times the distance along the shore, so the
 * cliff line comes down to the water there in a V and no neighbour's cut overruns it.
 */
const NOTCH_AREA = 0.3;
const NOTCH_SLOPE = 0.6;
/** Block size, in nodes, of the coarse height maxima used to bound a cap's reach. */
const BLOCK = 8;
/** The waterline is the half-land contour of the land mask blurred over this many nodes, twice. */
const WATERLINE_R = 2;
/** A shore node's point on the waterline lies between these many nodes seaward of its centre. */
const WATERLINE_T: readonly [number, number] = [0.15, 1];
/** The blur's profile across a straight shore is a parabola, not a line: this puts the contour half a node from the shore nodes' centres there. */
const WATERLINE_K = 0.9;
/** A strand stamp trims land within this many nodes of its point. */
const STRAND_R = 1.1;
/** Concavity at which a bay counts as a bay head, and passes of averaging it, the sand's width and the dunes' along the shore. */
const BAY_FULL = 0.3;
const BAY_SMOOTH = 2;
const SAND_SMOOTH = 3;
/** A marsh reaches its full depth inland where this share of the shore round it is marsh; a noise of MARSH_CELLS (of the 6400 world) frays its inner edge by MARSH_FRAY. */
const MARSH_RUN = 0.65;
const MARSH_CELLS = 48;
const MARSH_FRAY = 0.25;
/** Sand needs this score; SAND_SPAN more gives the widest beach. */
const SAND_SCORE = 0.3;
const SAND_SPAN = 0.5;
/** Share of the way to a delta's front past which its fan is sand, on the seaward side only; the rest is marsh. A noise of FAN_CELLS (of the 6400 world) feathers the line by FAN_FRAY. */
const FAN_RIM = 0.8;
const FAN_CELLS = 28;
const FAN_FRAY = 0.12;
/** Longshore drift follows the prevailing wind, which blows from the south-west: a shore must run at least DRIFT_MIN along it to carry sand. */
const DRIFT: readonly [number, number] = [0.7071067811865476, -0.7071067811865476];
const DRIFT_MIN = 0.25;

/**
 * S6.0 The sea evens out a soft shore. The land mask is blurred at two radii; where the rock is
 * soft and the noise allows, the shore follows the blurred mask instead of its own, so shallow
 * nooks silt up and low points wear away, more of them the stronger the smoothing. Hard rock keeps
 * every headland. Only shallow water is filled and only low land is lost.
 */
function evenShore(h: Float64Array, n: number, ctx: CoastContext, p: WorldParams, noiseSeed: number): Float64Array {
  const nn = n * n;
  const cpn = p.n / n;
  const e = p.coast.even;
  const mask = new Float32Array(nn);
  for (let i = 0; i < nn; i++) if (h[i] > 0) mask[i] = 1;
  const near = boxBlur(mask, n, Math.max(1, Math.round(e.r[0] / cpn)), 2);
  const far = boxBlur(mask, n, Math.max(2, Math.round(e.r[1] / cpn)), 2);
  const period = Math.max(1, Math.round(p.n / e.noiseCells));
  const raw = new Float32Array(nn);
  for (let i = 0; i < nn; i++) {
    // Only nodes the blur can flip are worth the noise.
    if (far[i] <= 0.02 || far[i] >= 0.98) continue;
    const x = ((i % n) + 0.5) * cpn;
    const y = (Math.floor(i / n) + 0.5) * cpn;
    const v = 0.5 + 0.5 * Math.max(-1, Math.min(1, 1.6 * fbm((x * period) / p.n, (y * period) / p.n, period, 2, 0.5, noiseSeed)));
    // The home lowland keeps most of its bays, and the skerries stay ragged.
    let share = 1;
    if (ctx.regions !== null) {
      share = 0;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) share += ctx.regions[a * nn + i] * e.region[a];
    }
    raw[i] = 2 * Math.min(1, Math.max(0, (v - e.noise[0]) / (e.noise[1] - e.noise[0]))) * e.rock[ctx.rock[i]] * share;
  }
  // Rock comes in blocks; the strength must not.
  const strength = boxBlur(raw, n, 2, 1);
  const out = new Float64Array(h);
  for (let i = 0; i < nn; i++) {
    const t = strength[i];
    if (t <= 0) continue;
    const m = t <= 1 ? mask[i] * (1 - t) + near[i] * t : near[i] * (2 - t) + far[i] * (t - 1);
    if (h[i] <= 0) {
      if (m >= 0.5 && h[i] > -e.fill) out[i] = e.ground[0] + (e.ground[1] - e.ground[0]) * Math.min(1, 3 * (m - 0.5));
    } else if (m < 0.5 && h[i] < e.trim) out[i] = -e.bed;
  }
  return out;
}

export function coast(hIn: Float64Array, n: number, ctx: CoastContext, p: WorldParams, seed: number): CoastResult {
  const nn = n * n;
  const cpn = p.n / n;
  const scale = lengthScale(p.n);
  const c = p.coast;
  const rng = rngFor(seed, "coast");
  const noiseSeed = rng.next();
  const noiseAt = (x: number, y: number, cells: number, lane: number): number => {
    const period = Math.max(1, Math.round(p.n / cells));
    return Math.max(-1, Math.min(1, 1.6 * fbm((x * period) / p.n, (y * period) / p.n, period, 2, 0.5, noiseSeed ^ lane)));
  };

  const h = evenShore(hIn, n, ctx, p, noiseSeed ^ 0x61);
  const isSea0 = new Uint8Array(nn);
  const mask = new Float32Array(nn);
  let hMax = 0;
  for (let i = 0; i < nn; i++) {
    if (h[i] <= 0) isSea0[i] = 1;
    else {
      mask[i] = 1;
      if (h[i] > hMax) hMax = h[i];
    }
  }

  // 1. Exposure, facing, concavity and slope of every shore node, and its point on the waterline.
  const shore = shoreExposure(isSea0, n, cpn, c.maxFetch, c.swWeight, c.fetchRange);
  const count = shore.nodes.length;
  const fx = new Float64Array(count);
  const fy = new Float64Array(count);
  const convex = new Float64Array(count);
  const slope = new Float64Array(count);
  /**
   * Sea within r nodes of a shore node: its share of the disc, and the shore's concavity there.
   * A straight shore has the half-disc on one side of the node's own row under water: concavity 0.
   * A pocket ringed by land tends to 1, a point in open water to −1.
   */
  const share = { sea: 0, concave: 0 };
  const seaWithin = (x: number, y: number, r: number): void => {
    let sea = 0;
    let all = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        all++;
        if (isSea0[wrapIndex(x + dx, y + dy, n)]) sea++;
      }
    }
    share.sea = sea / all;
    share.concave = 1 - (2 * sea) / (all - (2 * r + 1));
  };
  /** Averages a per-shore-node value with its shore neighbours, `passes` times; held nodes keep their value. */
  const along = (a: Float64Array, passes: number, held: (s: number) => boolean): Float64Array => {
    let cur = a;
    for (let pass = 0; pass < passes; pass++) {
      const next = new Float64Array(count);
      for (let s = 0; s < count; s++) {
        if (held(s)) {
          next[s] = cur[s];
          continue;
        }
        const i = shore.nodes[s];
        const x = i % n;
        const y = (i - x) / n;
        let sum = cur[s];
        let near = 1;
        for (let k = 0; k < 8; k++) {
          const t = shore.slot[wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n)];
          if (t >= 0) {
            sum += cur[t];
            near++;
          }
        }
        next[s] = sum / near;
      }
      cur = next;
    }
    return cur;
  };
  const headR = Math.max(2, Math.round(c.headlandR / cpn));
  const bayR = Math.max(2, Math.round(c.bayR / cpn));
  // The waterline: the half-land contour of the blurred mask. It runs smoothly where the nodes step.
  const soft = boxBlur(mask, n, WATERLINE_R, 2);
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const nx = new Float64Array(count);
  const ny = new Float64Array(count);
  let bay: Float64Array = new Float64Array(count);
  const tip = new Uint8Array(count);
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    const x = i % n;
    const y = (i - x) / n;
    let sx = 0;
    let sy = 0;
    for (let dy = -FACING_R; dy <= FACING_R; dy++) {
      for (let dx = -FACING_R; dx <= FACING_R; dx++) {
        if (dx * dx + dy * dy > FACING_R * FACING_R) continue;
        if (isSea0[wrapIndex(x + dx, y + dy, n)]) {
          sx += dx;
          sy += dy;
        }
      }
    }
    const len = Math.sqrt(sx * sx + sy * sy);
    fx[s] = len > 0 ? sx / len : 0;
    fy[s] = len > 0 ? sy / len : 1;
    seaWithin(x, y, headR);
    convex[s] = share.sea;
    const large = share.concave;
    seaWithin(x, y, bayR);
    const small = share.concave;
    bay[s] = 0.6 * large + 0.4 * small;
    if (small < -2 * c.tip) tip[s] = 1;
    slope[s] = h[i] / (0.5 * cpn);
    for (let m = 3; m >= 1; m--) {
      const j = wrapIndex(Math.round(x - fx[s] * m), Math.round(y - fy[s] * m), n);
      if (!isSea0[j]) {
        slope[s] = h[j] / ((m + 0.5) * cpn);
        break;
      }
    }
    const gx = 0.5 * (soft[wrapIndex(x + 1, y, n)] - soft[wrapIndex(x - 1, y, n)]);
    const gy = 0.5 * (soft[wrapIndex(x, y + 1, n)] - soft[wrapIndex(x, y - 1, n)]);
    const gl = Math.sqrt(gx * gx + gy * gy);
    let t = 0.5;
    nx[s] = fx[s];
    ny[s] = fy[s];
    if (gl > 0.02) {
      nx[s] = -gx / gl;
      ny[s] = -gy / gl;
      t = Math.min(WATERLINE_T[1], Math.max(WATERLINE_T[0], (WATERLINE_K * (soft[i] - 0.5)) / gl));
    }
    px[s] = (x + 0.5 + nx[s] * t) * cpn;
    py[s] = (y + 0.5 + ny[s] * t) * cpn;
  }
  bay = along(bay, BAY_SMOOTH, () => false);
  for (let s = 0; s < count; s++) if (bay[s] < -c.tip) tip[s] = 1;

  // Channels that reach the sea. The larger ones bring sand to the shore beside them.
  const flow = drainage(h, n, isSea0, p.erode.eps);
  const channel = Math.max(c.channelArea / (cpn * cpn), CHANNEL_NODES);
  const mouthSlots: number[] = [];
  const mouthKeys: number[] = [];
  const fed = new Uint8Array(count);
  const fedR = c.beachMouth / cpn;
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    if (flow.area[i] < channel || !isSea0[flow.rcv[i]]) continue;
    mouthSlots.push(s);
    mouthKeys.push(-flow.area[i]);
    if (flow.area[i] * cpn * cpn < c.beachFeedArea) continue;
    const x = i % n;
    const y = (i - x) / n;
    const R = Math.ceil(fedR);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > fedR * fedR) continue;
        const t = shore.slot[wrapIndex(x + dx, y + dy, n)];
        if (t >= 0) fed[t] = 1;
      }
    }
  }

  // 2 and 3. Classes: cliffs retreat; the gate caps shores the camera sees edge-on.
  // Sand gathers in bays, in shelter, beside river mouths and wherever the sea has it to give: its
  // score is the sum of those, and its width follows the score. Points and convex shores hold none.
  // Some regions are sandier than others: the home lowland keeps beaches the highland sheds.
  const sandiness = (s: number): number => {
    if (ctx.regions === null) return 1;
    let sand = 0;
    for (let a = 0; a < ARCHETYPE_COUNT; a++) sand += ctx.regions[a * nn + shore.nodes[s]] * c.beachRegion[a];
    return sand;
  };
  const cls = new Uint8Array(count);
  let cap: Float64Array = new Float64Array(count);
  const south = new Uint8Array(count);
  const raw = new Float64Array(count);
  const marshy = new Uint8Array(count);
  let wear: Float64Array = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    const e = shore.e[i];
    const k = c.retreatK[ctx.rock[i]];
    south[s] = fy[s] > 0 && Math.abs(fx[s]) <= c.gateCos ? 1 : 0;
    // The cap eases down to the gate's as the shore turns edge-on, so two caps never meet in a crease.
    const turn = Math.min(1, Math.max(0, (c.gateCos - Math.abs(fx[s])) / CAP_RAMP));
    const lift = Math.max(-1, Math.min(1, -bay[s] / BAY_FULL));
    const high = ctx.plain ? c.cliffCap : c.cliffCap * Math.min(CAP_MAX, CAP_VARY[0] + (CAP_VARY[1] - CAP_VARY[0]) * (0.5 + 0.5 * noiseAt(px[s], py[s], CAP_VARY_CELLS * scale, 0x5d)) + CAP_HEAD * lift);
    cap[s] = south[s] && high > c.gateCap ? c.gateCap + (high - c.gateCap) * turn * turn * (3 - 2 * turn) : c.gateCap;
    if (e > c.cliffE && k > 0) {
      // Bluffs and low stretches: the squared noise keeps most of the shore modest and lets a few runs stand tall.
      const broad = 0.5 + 0.5 * noiseAt(px[s], py[s], BLUFF_CELLS * scale, 0x5b);
      const crag = noiseAt(px[s], py[s], CRAG_CELLS * scale, 0x5c);
      const vary = ctx.plain ? 1 : 0.45 + 1.55 * broad * broad + 0.22 * crag + BLUFF_HEAD * lift;
      wear[s] = c.retreat * (e - c.cliffE) * k * Math.min(BLUFF_MAX, Math.max(BLUFF_MIN, vary));
      cls[s] = SHORE.rocky;
      continue;
    }
    const head = Math.min(1, Math.max(0, bay[s] / BAY_FULL));
    const sand = sandiness(s);
    const quiet = e < c.marshE && slope[s] < c.marshSlope && !tip[s];
    if (!tip[s] && e < c.beachE + c.beachBay * head && slope[s] < (fed[s] ? c.beachFed : c.beachSlope) * sand * (1 + head)) {
      const supply = 0.5 + 0.5 * noiseAt(px[s], py[s], c.sandCells, 0x55);
      const shelter = Math.min(1, Math.max(0, 1 - e / c.beachE));
      const w = c.sandScore;
      // Mud settles where the water is stillest: there sand needs a true bay head.
      const score = w.bay * head + w.shelter * shelter + w.supply * (supply - 0.5) + (fed[s] ? w.fed : 0) + w.rock[ctx.rock[i]] + w.region * (sand - 1) - (quiet ? w.mud : 0);
      if (score > SAND_SCORE) raw[s] = c.beachWidth[0] + (c.beachWidth[1] - c.beachWidth[0]) * Math.min(1, (score - SAND_SCORE) / SAND_SPAN);
    }
    if (raw[s] > 0) cls[s] = SHORE.beach;
    else if (quiet) marshy[s] = 1;
    else if (slope[s] >= 2 * c.beachSlope) cls[s] = SHORE.rocky;
    else if (tip[s]) {
      // A low point is a rock ledge where the rock holds or the sea works at it; in soft rock and shelter, grass to the water.
      if (ctx.rock[i] < 2 || e > c.ledgeE) cls[s] = SHORE.rocky;
    } else if (e > c.shingleE && noiseAt(px[s], py[s], c.sandCells, 0x56) > c.shingle) cls[s] = SHORE.rocky;
  }
  // Caps are evened along the shore as well. Gated shores keep the gate's cap; their neighbours come down to meet it.
  cap = along(cap, CAP_SMOOTH, (s) => south[s] === 0);
  // The retreat is evened out along the shore, so a band of hard rock ends in
  // a taper and not in a bite the shape of one stamp. Beaches are never cut.
  wear = along(wear, RETREAT_SMOOTH, (s) => cls[s] === SHORE.beach);
  // Stream mouths too small to cut a cove: the cliff comes down to a low rocky shore on either side of each.
  if (!ctx.plain) {
    const coveCells = Math.max(c.coveArea, COVE_NODES * cpn * cpn);
    const least = Math.max(NOTCH_AREA * channel, 12);
    const depth = new Int32Array(count).fill(-1);
    let ring: number[] = [];
    for (let s = 0; s < count; s++) {
      const i = shore.nodes[s];
      if (wear[s] <= 0 || flow.area[i] < least || !isSea0[flow.rcv[i]] || flow.area[i] * cpn * cpn >= coveCells) continue;
      depth[s] = 0;
      ring.push(s);
    }
    for (let d = 1; ring.length > 0; d++) {
      const next: number[] = [];
      for (const s of ring) {
        const i = shore.nodes[s];
        const x = i % n;
        const y = (i - x) / n;
        for (let q = 0; q < 8; q++) {
          const t = shore.slot[wrapIndex(x + NB8_DX[q], y + NB8_DY[q], n)];
          // Only as far along the shore as the limit still bites.
          if (t >= 0 && depth[t] < 0 && wear[t] > NOTCH_SLOPE * d * cpn) {
            depth[t] = d;
            next.push(t);
          }
        }
      }
      ring = next;
    }
    for (let s = 0; s < count; s++) if (depth[s] >= 0) wear[s] = Math.min(wear[s], NOTCH_SLOPE * depth[s] * cpn);
  }
  const retreat = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    if (cls[s] === SHORE.beach || wear[s] < MIN_CUT * scale) continue;
    retreat[s] = wear[s];
    marshy[s] = 0;
    cls[s] = south[s] ? SHORE.cliff : SHORE.rocky;
  }
  // The sand's width is evened out too, so a beach tapers to nothing at its ends and never onto a point or a cut shore.
  const fixed = (s: number): boolean => retreat[s] > 0 || tip[s] === 1;
  const width = along(raw, SAND_SMOOTH, fixed);
  for (let s = 0; s < count; s++) {
    if (fixed(s) || width[s] < c.beachWidth[0]) width[s] = 0;
    if (width[s] > 0) {
      cls[s] = SHORE.beach;
      marshy[s] = 0;
    } else if (cls[s] === SHORE.beach) cls[s] = SHORE.none;
  }
  // Lone beach nodes are noise.
  const lone: number[] = [];
  for (let s = 0; s < count; s++) {
    if (cls[s] !== SHORE.beach) continue;
    const i = shore.nodes[s];
    const x = i % n;
    const y = (i - x) / n;
    let near = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = shore.slot[wrapIndex(x + dx, y + dy, n)];
        if (t >= 0 && cls[t] === SHORE.beach) near++;
      }
    }
    if (near < BEACH_RUN) lone.push(s);
  }
  for (const s of lone) {
    cls[s] = SHORE.none;
    width[s] = 0;
  }
  // Dunes pile up behind a beach wide enough to feed them and open enough for the wind to work.
  const duneRaw = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    const e = shore.e[shore.nodes[s]];
    if (width[s] < c.duneBeach || e < c.duneE) continue;
    const blow = Math.min(1, (e - c.duneE) / Math.max(1e-9, c.beachE - c.duneE));
    duneRaw[s] = c.duneWidth[0] + (c.duneWidth[1] - c.duneWidth[0]) * blow * Math.min(1, width[s] / c.beachWidth[1]);
  }
  const dune = along(duneRaw, BAY_SMOOTH, (s) => width[s] <= 0);
  // A marsh is as deep as its shore is long: a lone marshy node holds a patch, a long quiet shore the full reach.
  const marshRun = along(Float64Array.from(marshy), SAND_SMOOTH, () => false);

  /** The point on the waterline in front of shore node s, in cells. */
  const shoreX = (s: number): number => px[s];
  const shoreY = (s: number): number => py[s];
  /** Height the land stood at behind shore node s once its band is cut, capped. */
  const cliffTop = (s: number): number => {
    const back = retreat[s] + cpn;
    const j = nodeAt(shoreX(s) - fx[s] * back, shoreY(s) - fy[s] * back, cpn, n);
    return Math.min(cap[s], Math.max(0, h[j]));
  };

  // Coarse maxima bound how far a cap can reach.
  const nb = Math.ceil(n / BLOCK);
  const blockMax = new Float64Array(nb * nb);
  for (let i = 0; i < nn; i++) {
    const b = Math.floor(Math.floor(i / n) / BLOCK) * nb + Math.floor((i % n) / BLOCK);
    if (h[i] > blockMax[b]) blockMax[b] = h[i];
  }
  const localMax = (x: number, y: number, radius: number): number => {
    const R = Math.ceil(radius / (cpn * BLOCK)) + 1;
    const bx = Math.floor(x / (cpn * BLOCK));
    const by = Math.floor(y / (cpn * BLOCK));
    let m = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) m = Math.max(m, blockMax[wrapIndex(bx + dx, by + dy, nb)]);
    }
    return m;
  };

  const stamps: Stamp[] = [];
  for (let s = 0; s < count; s++) {
    if (retreat[s] <= 0) {
      // Land the nodes leave seaward of the waterline is trimmed, so the shore runs smooth at cell size.
      stamps.push({ kind: "strand", x: px[s], y: py[s], nx: nx[s], ny: ny[s], r: STRAND_R * cpn, slope: c.shelfSlope });
      continue;
    }
    const e = shore.e[shore.nodes[s]];
    const t = Math.max(0, (e - c.cliffE) / (1 - c.cliffE));
    const x = shoreX(s);
    const y = shoreY(s);
    // The land behind a cap rises at a slope that wanders along the shore, so the cliff's back is not one plane.
    const rise = c.capSlope[0] + (c.capSlope[1] - c.capSlope[0]) * (0.5 + 0.5 * noiseAt(x, y, CAP_CELLS * scale, 0x58));
    const far = (hMax - cap[s]) / rise;
    const top = far > 0 ? localMax(x, y, retreat[s] + far) : 0;
    const reach = top > cap[s] ? Math.min(far, (top - cap[s]) / rise) : 0;
    const fall = c.bathy.slope * (c.bathy.base + c.bathy.eGain * e);
    stamps.push({ kind: "cut", x, y, r: retreat[s], level: -(c.platform[0] + (c.platform[1] - c.platform[0]) * t), fall, cap: cap[s], slope: rise, reach });
  }

  // 5 and 7. Channels at the coast. Where one meets a cut shore it has worn a
  // cove along its own course; a river wide enough ends in an estuary, or in a
  // delta where the water is quiet. Every mouth is recorded.
  // On a small test world the scaled area is under a node or two: hold it to a real channel.
  const coveMin = Math.max(c.coveArea, COVE_NODES * cpn * cpn);
  const inCoveAt = new Uint8Array(nn);
  const coves: { x: number; y: number; r: number }[] = [];
  /** Unit vector from `steps` nodes up the channel (following the largest donor) to node i. */
  const flowAt = (i: number, steps: number, fallbackX: number, fallbackY: number): [number, number] => {
    let u = i;
    for (let step = 0; step < steps; step++) {
      const ux = u % n;
      const uy = (u - ux) / n;
      let best = -1;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(ux + NB8_DX[k], uy + NB8_DY[k], n);
        if (j !== u && !isSea0[j] && flow.rcv[j] === u && (best < 0 || flow.area[j] > flow.area[best])) best = j;
      }
      if (best < 0) break;
      u = best;
    }
    const dx = torusDelta(u % n, i % n, n);
    const dy = torusDelta(Math.floor(u / n), Math.floor(i / n), n);
    const dl = Math.sqrt(dx * dx + dy * dy);
    return dl > 0 ? [dx / dl, dy / dl] : [fallbackX, fallbackY];
  };
  const mark = (s: CoveStamp, value: number): void => {
    const R = Math.ceil((s.len + s.tail + 2 * s.width) / cpn) + 1;
    const ni = nodeAt(s.x, s.y, cpn, n);
    const mx = ni % n;
    const my = (ni - mx) / n;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        if (inCove(s, (mx + ox + 0.5) * cpn, (my + oy + 0.5) * cpn, p.n, 1.5)) inCoveAt[wrapIndex(mx + ox, my + oy, n)] = value;
      }
    }
  };
  for (const m of sortIndicesBy(mouthKeys)) {
    const s = mouthSlots[m];
    const i = shore.nodes[s];
    const [dx, dy] = flowAt(i, 3, fx[s], fy[s]);
    const cells = flow.area[i] * cpn * cpn;
    const e = shore.e[i];
    const mx = shoreX(s);
    const my = shoreY(s);
    const w = Math.min(6, Math.max(1, Math.round(Math.sqrt(flow.area[i] / p.rivers.qScale))));
    let form: "delta" | "estuary" | "plain" = "plain";
    if (retreat[s] > 0 && cells >= coveMin) {
      const grow = Math.min(1, Math.sqrt(cells / (COVE_FULL * coveMin)));
      const len = Math.min(c.coveLen[1], (c.coveLen[0] + (c.coveLen[1] - c.coveLen[0]) * grow) * rng.range(0.7, 1.3));
      const wide = len * rng.range(0.2, 0.36);
      const neck = rng.range(0.35, 0.6);
      const sand = rng.float() < c.coveBoulder ? 0 : rng.range(0.25, 0.42);
      const coveSeed = rng.next();
      // The cove lies along the stream's last reach, not along the shore's normal.
      const [ax, ay] = flowAt(i, Math.max(3, Math.round(len / cpn)), fx[s], fy[s]);
      const ox0 = mx - ax * retreat[s];
      const oy0 = my - ay * retreat[s];
      const cx = ox0 - ax * 0.5 * len;
      const cy = oy0 - ay * 0.5 * len;
      let clear = true;
      for (const o of coves) {
        const ox = torusDelta(o.x, cx, p.n);
        const oy = torusDelta(o.y, cy, p.n);
        const apart = Math.max(c.coveSpacing, 1.5 * (o.r + len));
        if (ox * ox + oy * oy < apart * apart) {
          clear = false;
          break;
        }
      }
      if (clear) {
        const t = Math.max(0, (e - c.cliffE) / (1 - c.cliffE));
        const stamp: CoveStamp = { kind: "cove", x: ox0, y: oy0, ax: -ax, ay: -ay, len, width: wide, neck, tail: retreat[s] + 3 * scale, sand, depth: c.platform[0] + (c.platform[1] - c.platform[0]) * t, seed: coveSeed, base: c.beachBase, rise: c.beachRise };
        coves.push({ x: cx, y: cy, r: 0.5 * len + wide });
        stamps.push(stamp);
        mark(stamp, sand > 0 ? 1 : 2);
      }
    } else if (w >= c.estuaryWidth && retreat[s] <= 0) {
      const formSeed = rng.next();
      if (e < c.deltaE && w >= c.deltaWidth) {
        form = "delta";
        const t = (w - c.deltaWidth) / Math.max(1, 6 - c.deltaWidth);
        // The flow splits in two or in three; each distributary is given where its mouth lies across the fan.
        const channels = rng.float() < 0.5 ? [rng.range(-0.75, -0.35), rng.range(0.3, 0.75)] : [rng.range(-0.85, -0.5), rng.range(-0.15, 0.15), rng.range(0.5, 0.85)];
        // Drift along the shore the fan is built from: its mouth bars lean that way.
        const along = -dy * DRIFT[0] + dx * DRIFT[1];
        stamps.push({ kind: "delta", x: mx, y: my, ax: dx, ay: dy, r: c.deltaR[0] + (c.deltaR[1] - c.deltaR[0]) * t, spread: rng.range(1, 1.4), top: c.deltaTop, channels, channel: 0.5 * w * scale + 0.6 * scale, drift: along > DRIFT_MIN ? 1 : along < -DRIFT_MIN ? -1 : 0, seed: formSeed });
      } else {
        form = "estuary";
        const len = c.estuaryLen * (0.6 + 0.2 * w);
        const [ax, ay] = flowAt(i, Math.max(3, Math.round(len / cpn)), fx[s], fy[s]);
        const head = (0.5 * w + 0.5) * scale;
        stamps.push({ kind: "estuary", x: mx, y: my, ax: -ax, ay: -ay, len, head, sea: 3 * head + 2 * scale, depth: 0.6 + 0.25 * w, seed: formSeed });
      }
    }
    stamps.push({ kind: "mouth", x: mx, y: my, dx, dy, area: cells, form });
  }

  // 4. Stacks: pieces the retreat leaves where the rock is hardest, and a group off each headland.
  const rMin = Math.sqrt(c.stackArea[0] / 3.141592653589793);
  const rMax = Math.sqrt(c.stackArea[1] / 3.141592653589793);
  const placed: { x: number; y: number; r: number }[] = [];
  const gap = 2 * scale;
  const fits = (x: number, y: number, r: number): boolean => {
    for (const o of placed) {
      const ox = torusDelta(o.x, x, p.n);
      const oy = torusDelta(o.y, y, p.n);
      const apart = o.r + r + gap;
      if (ox * ox + oy * oy < apart * apart) return false;
    }
    for (const o of coves) {
      const ox = torusDelta(o.x, x, p.n);
      const oy = torusDelta(o.y, y, p.n);
      const apart = o.r + r + gap;
      if (ox * ox + oy * oy < apart * apart) return false;
    }
    return true;
  };
  const stack = (x: number, y: number, r: number, top: number): void => {
    placed.push({ x, y, r });
    const k = rng.int(16);
    stamps.push({ kind: "stack", x, y, r, top: Math.min(c.stackTop[1], Math.max(c.stackTop[0], top)), ux: GRADIENTS[2 * k], uy: GRADIENTS[2 * k + 1], lobe: rng.range(0.08, 0.28), apron: c.stackApron });
  };
  const hardSlots: number[] = [];
  const hardKeys: number[] = [];
  const hardValue: number[] = [];
  for (let s = 0; s < count; s++) {
    if (retreat[s] < 2.5 * rMin) continue;
    const x = shoreX(s) - fx[s] * STACK_AT * retreat[s];
    const y = shoreY(s) - fy[s] * STACK_AT * retreat[s];
    const v = 0.5 + 0.5 * noiseAt(x, y, c.stackNoiseCells, 0);
    if (v > c.stackNoise) {
      hardSlots.push(s);
      hardKeys.push(-v);
      hardValue.push(v);
    }
  }
  for (const m of sortIndicesBy(hardKeys)) {
    const s = hardSlots[m];
    const x = shoreX(s) - fx[s] * STACK_AT * retreat[s];
    const y = shoreY(s) - fy[s] * STACK_AT * retreat[s];
    const r = Math.min(0.4 * retreat[s], rMin + ((rMax - rMin) * (hardValue[m] - c.stackNoise)) / (1 - c.stackNoise));
    if (r < rMin || !fits(x, y, r)) continue;
    stack(x, y, r, Math.max(h[nodeAt(x, y, cpn, n)], 0.6 * cliffTop(s)));
  }
  const headSlots: number[] = [];
  const headKeys: number[] = [];
  for (let s = 0; s < count; s++) {
    if (retreat[s] > 0 && convex[s] >= c.headlandSea) {
      headSlots.push(s);
      headKeys.push(-convex[s]);
    }
  }
  const heads: number[] = [];
  /** Shoals: patches of shallow, broken water off the headlands, under the stack groups. */
  const shoals: { x: number; y: number; r: number; top: number }[] = [];
  for (const m of sortIndicesBy(headKeys)) {
    const s = headSlots[m];
    const x = shoreX(s);
    const y = shoreY(s);
    let clear = true;
    for (const o of heads) {
      const ox = torusDelta(shoreX(o), x, p.n);
      const oy = torusDelta(shoreY(o), y, p.n);
      if (ox * ox + oy * oy < c.headlandSpacing * c.headlandSpacing) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    heads.push(s);
    const wanted = c.headlandStacks[0] + rng.int(c.headlandStacks[1] - c.headlandStacks[0] + 1);
    // The leader is the tallest thing on the headland; the rest step down seaward.
    const lead = Math.max(cliffTop(s), rng.range(c.stackLead[0], c.stackLead[1]));
    const drift = rng.range(-0.5, 0.5);
    let d = retreat[s];
    let side = 0;
    for (let k = 0; k < wanted; k++) {
      const r = Math.max(rMin, rMax * (0.95 - 0.2 * k) * rng.range(0.75, 1));
      d += r + rng.range(3, 9) * scale;
      side += (drift + rng.range(-0.5, 0.5)) * 2 * r;
      const sx = x + fx[s] * d - fy[s] * side;
      const sy = y + fy[s] * d + fx[s] * side;
      d += r;
      if (!isSea0[nodeAt(sx, sy, cpn, n)] || !fits(sx, sy, r)) continue;
      stack(sx, sy, r, lead * (1 - 0.22 * k) * rng.range(0.85, 1));
    }
    const reach = d - retreat[s];
    shoals.push({ x: x + fx[s] * (retreat[s] + 0.55 * reach), y: y + fy[s] * (retreat[s] + 0.55 * reach), r: 0.6 * reach + rng.range(c.shoalR[0], c.shoalR[1]), top: rng.range(1, 2.2) });
  }

  // 6. Beaches. Each stamp lays sand as wide as its shore holds, rising to beachTop at the back;
  // the shelf's width wanders along the shore and narrows with the sand.
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    if (width[s] <= 0 || inCoveAt[i]) continue;
    const x = shoreX(s);
    const y = shoreY(s);
    const shelf = c.shelf * (1 + 0.45 * noiseAt(x, y, SHELF_CELLS * scale, 0x51)) * Math.min(1, 0.35 + width[s] / c.beachWidth[1]);
    stamps.push({ kind: "beach", x, y, land: width[s], base: c.beachBase, rise: (c.beachTop - c.beachBase) / width[s], shelf, shelfSlope: c.shelfSlope });
    stamps.push({ kind: "berm", x, y, inner: width[s], outer: width[s] + c.berm[0], top: c.beachTop + c.berm[1] });
  }

  // A low rocky shore is a narrow strand of shingle with a storm bank behind it.
  for (let s = 0; s < count; s++) {
    if (retreat[s] > 0 || width[s] > 0 || cls[s] !== SHORE.rocky || inCoveAt[shore.nodes[s]]) continue;
    const g = c.ledge;
    stamps.push({ kind: "ledge", x: px[s], y: py[s], land: g.width, base: g.base, rise: (g.top - g.base) / g.width, shelf: g.shelf, shelfSlope: c.shelfSlope });
    stamps.push({ kind: "berm", x: px[s], y: py[s], inner: g.width, outer: g.width + c.berm[0], top: g.bank });
  }

  // Creeks: tidal channels that wind back through the saltmarsh from its shore.
  const creeks: { x: number; y: number }[] = [];
  for (let s = 0; s < count; s++) {
    if (!marshy[s] || marshRun[s] < MARSH_RUN || inCoveAt[shore.nodes[s]]) continue;
    let clear = true;
    for (const o of creeks) {
      const ox = torusDelta(o.x, px[s], p.n);
      const oy = torusDelta(o.y, py[s], p.n);
      if (ox * ox + oy * oy < c.creekSpacing * c.creekSpacing) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    creeks.push({ x: px[s], y: py[s] });
    stamps.push({ kind: "creek", x: px[s], y: py[s], ax: -nx[s], ay: -ny[s], len: rng.range(c.creekLen[0], c.creekLen[1]), width: c.creekWidth * rng.range(0.8, 1.2), top: c.marshTop + 0.4, seed: rng.next() });
  }

  // Spits. Where a beach's shore turns away from the drift, the sand carries on into open water:
  // a strand that bows, tapers, and hooks round at its tip toward the land. The widest beaches build them first.
  const sp = c.spit;
  const spitSlots: number[] = [];
  const spitKeys: number[] = [];
  for (let s = 0; s < count; s++) {
    const e = shore.e[shore.nodes[s]];
    if (width[s] < sp.beach || retreat[s] > 0 || inCoveAt[shore.nodes[s]] || e < sp.e[0] || e > sp.e[1]) continue;
    if (Math.abs(-ny[s] * DRIFT[0] + nx[s] * DRIFT[1]) < DRIFT_MIN) continue;
    spitSlots.push(s);
    spitKeys.push(-width[s] * (1 + e));
  }
  const spits: SpitStamp[] = [];
  for (const m of sortIndicesBy(spitKeys)) {
    const s = spitSlots[m];
    let clear = true;
    for (const o of spits) {
      const ox = torusDelta(o.x, px[s], p.n);
      const oy = torusDelta(o.y, py[s], p.n);
      if (ox * ox + oy * oy < sp.spacing * sp.spacing) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    const down = -ny[s] * DRIFT[0] + nx[s] * DRIFT[1] > 0 ? 1 : -1;
    const ax = -ny[s] * down;
    const ay = nx[s] * down;
    // The tip recurves to the land's side: the side of the heading the shore's inward normal lies on.
    const hook = -ny[s] * ax + nx[s] * ay > 0 ? 1 : -1;
    const lane = shore.nodes[s];
    const len = sp.len[0] + (sp.len[1] - sp.len[0]) * (0.5 + 0.5 * noiseAt(px[s], py[s], c.sandCells, 0x5a));
    const stamp: SpitStamp = { kind: "spit", x: px[s], y: py[s], ax, ay, hook, len, width: Math.max(1.2, sp.width * Math.min(1.3, 0.7 + width[s] / c.beachWidth[1])), top: sp.top, seed: (noiseSeed ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0 };
    // Open water along its whole length and to both sides of it: the shore has turned away, and a bay lies behind.
    const side = 1.5 * cpn;
    for (let u = side; u <= len && clear; u += cpn) {
      const v = spitCentre(stamp, u);
      for (let k = -1; k <= 1 && clear; k++) {
        if (k !== 0 && u < 3 * cpn) continue;
        const w = v + k * side;
        if (!isSea0[nodeAt(stamp.x + ax * u - ay * w, stamp.y + ay * u + ax * w, cpn, n)]) clear = false;
      }
    }
    if (!clear) continue;
    spits.push(stamp);
    stamps.push(stamp);
  }

  // 8. Bathymetry from the cut shoreline, then the stamps.
  // Stacks stand in deep water: they are left out of the distance to land.
  const cut = new Float64Array(h);
  applyStamps(cut, n, cpn, stamps.filter((s) => s.kind !== "stack"));
  const isLand = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) if (cut[i] > 0) isLand[i] = 1;
  const toLand = nearestSource(n, isLand);
  const isShore = new Uint8Array(nn);
  for (let s = 0; s < count; s++) isShore[shore.nodes[s]] = 1;
  const toShore = nearestSource(n, isShore);
  const exposure = new Float32Array(nn);
  const sandy = new Float32Array(nn);
  for (let i = 0; i < nn; i++) {
    const src = toShore.src[i];
    exposure[i] = src >= 0 ? shore.e[src] : 1;
    sandy[i] = src >= 0 ? c.shelfRock[ctx.rock[src]] : 0;
  }
  const blurR = Math.max(1, Math.round((BATHY_BLUR * scale) / cpn));
  const smooth = boxBlur(exposure, n, blurR, 2);
  const sand = boxBlur(sandy, n, blurR, 2);
  // The shelf: a gentle apron as wide as the shore is sheltered and soft, then
  // the fall to deep water. Two noises make its width and its edge irregular.
  const base = new Float64Array(h);
  const b = c.bathy;
  for (let i = 0; i < nn; i++) {
    if (!isSea0[i]) continue;
    const x = ((i % n) + 0.5) * cpn;
    const y = (Math.floor(i / n) + 0.5) * cpn;
    const wide = noiseAt(x, y, SHELF_CELLS * scale, 0x52);
    const edge = noiseAt(x, y, EDGE_CELLS * scale, 0x53);
    const e = smooth[i];
    const d = Math.max(0, toLand.dist[i] * cpn - 0.5 * cpn);
    const apron = c.shelfWide * (1 - e) * (1 - e) * sand[i] * (1 + 0.6 * wide);
    // On the shelf the bed never falls faster than shelfSlope; the edge noise only moves where the shelf ends.
    const past = Math.max(0, d * (1 + 0.3 * edge) - apron);
    const depth = c.shelfSlope * Math.min(d, apron) + b.slope * (b.base + b.eGain * e) * past;
    base[i] = -Math.max(SEA_MIN, Math.min(b.max, depth));
  }
  for (const o of shoals) {
    const R = Math.ceil((1.4 * o.r) / cpn);
    const ni = nodeAt(o.x, o.y, cpn, n);
    const ox0 = ni % n;
    const oy0 = (ni - ox0) / n;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const j = wrapIndex(ox0 + ox, oy0 + oy, n);
        if (!isSea0[j]) continue;
        const edge = noiseAt((ox0 + ox + 0.5) * cpn, (oy0 + oy + 0.5) * cpn, EDGE_CELLS * scale, 0x54);
        const q = (Math.sqrt(ox * ox + oy * oy) * cpn) / (o.r * (1 + 0.35 * edge));
        if (q >= 1) continue;
        // The crest blends into whatever bed lies round it: a shoal has no rim.
        const t = q * q * (3 - 2 * q);
        const bed = -o.top * (1 - t) + base[j] * t;
        if (bed > base[j]) base[j] = bed;
      }
    }
  }
  const out = new Float64Array(base);
  applyStamps(out, n, cpn, stamps);

  const isSea = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) if (out[i] <= 0) isSea[i] = 1;

  // Flats an estuary laid beside its water, and the fans of the deltas: marsh, with sand along a fan's front.
  const flats = new Float64Array(h);
  applyStamps(flats, n, cpn, stamps.filter((s) => s.kind === "estuary"));
  const fan = new Uint8Array(nn);
  for (const s of stamps) {
    if (s.kind !== "delta") continue;
    const R = Math.ceil(stampReach(s) / cpn);
    const ni = nodeAt(s.x, s.y, cpn, n);
    const ox0 = ni % n;
    const oy0 = (ni - ox0) / n;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const j = wrapIndex(ox0 + ox, oy0 + oy, n);
        if (!isSea0[j] || cut[j] <= 0) continue;
        const x = (ox0 + ox + 0.5) * cpn;
        const y = (oy0 + oy + 0.5) * cpn;
        const at = deltaAt(s, torusDelta(s.x, x, p.n), torusDelta(s.y, y, p.n));
        // Off the fan this is a mouth bar: sand, like any land the sea has given up.
        if (at.e >= 1) continue;
        // Sand lies along the front, where the waves work it; the rest of the fan is marsh, and the line between them wanders.
        const rim = FAN_RIM + FAN_FRAY * noiseAt(x, y, FAN_CELLS * scale, 0x59);
        fan[j] = at.e > rim && at.u > 0.35 * Math.sqrt(at.u * at.u + at.v * at.v) ? SHORE.beach : SHORE.marsh;
      }
    }
  }

  const shoreClass = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    if (isSea[i]) continue;
    if (isSea0[i] && cut[i] > 0) {
      shoreClass[i] = fan[i] !== 0 ? fan[i] : SHORE.beach;
      continue;
    }
    const x = i % n;
    const y = (i - x) / n;
    let wet = false;
    for (let k = 0; k < 8 && !wet; k++) wet = isSea[wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n)] !== 0;
    const s = toShore.src[i] >= 0 ? shore.slot[toShore.src[i]] : -1;
    if (inCoveAt[i] !== 0) {
      if (wet) shoreClass[i] = inCoveAt[i] === 1 ? SHORE.cove : SHORE.rocky;
      continue;
    }
    if (s >= 0) {
      const dx = torusDelta(px[s], (x + 0.5) * cpn, p.n);
      const dy = torusDelta(py[s], (y + 0.5) * cpn, p.n);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (width[s] > 0) {
        // Sand out to the beach's width, on ground the stamp laid or that lay as low; then the dunes, on low ground only.
        if (wet || (d <= width[s] + 0.5 * cpn && out[i] < c.beachTop + 0.5)) shoreClass[i] = SHORE.beach;
        else if (d <= width[s] + dune[s] && h[i] < c.duneTop) shoreClass[i] = SHORE.dune;
      } else if (marshy[s]) {
        const fray = 1 - MARSH_FRAY * (0.5 + 0.5 * noiseAt((x + 0.5) * cpn, (y + 0.5) * cpn, MARSH_CELLS * scale, 0x57));
        if (d <= c.marshReach * Math.min(1, marshRun[s] / MARSH_RUN) * fray && out[i] <= c.marshTop) shoreClass[i] = SHORE.marsh;
      } else if (wet) {
        if (cls[s] === SHORE.cliff) shoreClass[i] = out[i] >= c.minCliff ? SHORE.cliff : SHORE.rocky;
        else shoreClass[i] = cls[s];
      }
    }
    if (shoreClass[i] === SHORE.none && flats[i] < h[i] && out[i] <= c.marshTop) shoreClass[i] = SHORE.marsh;
  }

  // What the bake needs to draw these bands at cell size: the distance to the waterline and the widths, as smooth fields.
  const landOut = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) landOut[i] = isSea[i] ? 0 : 1;
  const toSea = nearestSource(n, isSea);
  const toDry = nearestSource(n, landOut);
  const shoreDist = new Float32Array(nn);
  const sandRaw = new Float32Array(nn);
  const duneRawG = new Float32Array(nn);
  const marshRaw = new Float32Array(nn);
  for (let i = 0; i < nn; i++) {
    const d = isSea[i] ? -(toDry.dist[i] - 0.5) * cpn : (toSea.dist[i] - 0.5) * cpn;
    shoreDist[i] = Math.max(-c.shoreReach, Math.min(c.shoreReach, d));
    const src = toShore.src[i];
    if (src < 0 || toShore.dist[i] * cpn > c.shoreReach) continue;
    const s = shore.slot[src];
    sandRaw[i] = inCoveAt[src] ? 0 : width[s];
    duneRawG[i] = inCoveAt[src] ? 0 : dune[s];
    if (shoreClass[i] === SHORE.marsh || (isSea[i] && marshy[s] && toShore.dist[i] <= 2)) marshRaw[i] = 1;
  }

  return { h: out, base, isSea, exposure, shoreClass, shoreDist, sandWidth: boxBlur(sandRaw, n, 1, 1), duneWidth: boxBlur(duneRawG, n, 1, 1), marsh: boxBlur(marshRaw, n, 1, 1), stamps };
}
