// S6 Coasts on G: exposure from open-water fetch, cliff retreat to a wave-cut
// platform with the orientation gate, stacks, coves, beaches, river mouths
// and bathymetry. Sharp features are written as stamps and cut into the
// returned heights with the same code the bake runs on cells.

import { sortIndicesBy } from "../core/heap.ts";
import { fbm, GRADIENTS } from "../core/noise.ts";
import { rngFor } from "../core/rng.ts";
import { NB8_DX, NB8_DY, torusDelta, wrapIndex } from "../core/torus.ts";
import { boxBlur, drainage, nearestSource, nodeAt, regionsOn, rockOn } from "./field.ts";
import { ARCHETYPE_COUNT, type WorldParams } from "./params.ts";
import type { Plan } from "./plan.ts";
import { applyStamps, type CoveStamp, inCove, type Stamp } from "./stamps.ts";

export interface CoastContext {
  /** Rock class per node (0 hard, 1 medium, 2 soft) on the same grid as the heights. */
  rock: Uint8Array;
  /** Six planes of region weights on the same grid, archetype-major; without them every shore is treated alike. */
  regions: Float32Array | null;
}

export const SHORE = { none: 0, beach: 1, rocky: 2, cliff: 3, cove: 4 } as const;

export interface CoastResult {
  /** Heights with every stamp applied: what hydrology runs on. */
  h: Float64Array;
  /** Heights before the stamps (bathymetry in, cliffs uncut): what the bake upsamples and stamps at cell size. */
  base: Float64Array;
  isSea: Uint8Array;
  /** Exposure of the nearest shore, for every node. */
  exposure: Float32Array;
  /** SHORE class of each shore node of `h`; 0 elsewhere. */
  shoreClass: Uint8Array;
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
/** Block size, in nodes, of the coarse height maxima used to bound a cap's reach. */
const BLOCK = 8;

export function coast(h: Float64Array, n: number, ctx: CoastContext, p: WorldParams, seed: number): CoastResult {
  const nn = n * n;
  const cpn = p.n / n;
  const scale = p.n / 6400;
  const c = p.coast;
  const rng = rngFor(seed, "coast");
  const noiseSeed = rng.next();

  const isSea0 = new Uint8Array(nn);
  let hMax = 0;
  for (let i = 0; i < nn; i++) {
    if (h[i] <= 0) isSea0[i] = 1;
    else if (h[i] > hMax) hMax = h[i];
  }

  // 1. Exposure, facing, convexity and slope of every shore node.
  const shore = shoreExposure(isSea0, n, cpn, c.maxFetch, c.swWeight, c.fetchRange);
  const count = shore.nodes.length;
  const fx = new Float64Array(count);
  const fy = new Float64Array(count);
  const convex = new Float64Array(count);
  const slope = new Float64Array(count);
  const headR = Math.max(2, Math.round(c.headlandR / cpn));
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
    let sea = 0;
    let all = 0;
    for (let dy = -headR; dy <= headR; dy++) {
      for (let dx = -headR; dx <= headR; dx++) {
        if (dx * dx + dy * dy > headR * headR) continue;
        all++;
        if (isSea0[wrapIndex(x + dx, y + dy, n)]) sea++;
      }
    }
    convex[s] = sea / all;
    slope[s] = h[i] / (0.5 * cpn);
    for (let m = 3; m >= 1; m--) {
      const j = wrapIndex(Math.round(x - fx[s] * m), Math.round(y - fy[s] * m), n);
      if (!isSea0[j]) {
        slope[s] = h[j] / ((m + 0.5) * cpn);
        break;
      }
    }
  }

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
  // Sand gathers beside river mouths: a fed shore may be steeper and still hold a beach.
  // Some regions are sandier than others: the home lowland keeps beaches the highland sheds.
  const beachLimit = (s: number): number => {
    let sand = 1;
    if (ctx.regions !== null) {
      sand = 0;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) sand += ctx.regions[a * nn + shore.nodes[s]] * c.beachRegion[a];
    }
    return (fed[s] ? c.beachFed : c.beachSlope) * sand;
  };
  const cls = new Uint8Array(count);
  const cap = new Float64Array(count);
  const south = new Uint8Array(count);
  let wear = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    const e = shore.e[i];
    const k = c.retreatK[ctx.rock[i]];
    south[s] = fy[s] > 0 && Math.abs(fx[s]) <= c.gateCos ? 1 : 0;
    cap[s] = south[s] ? c.cliffCap : c.gateCap;
    if (e > c.cliffE && k > 0) {
      wear[s] = c.retreat * (e - c.cliffE) * k;
      cls[s] = SHORE.rocky;
    } else if (e < c.beachE && slope[s] < beachLimit(s)) {
      cls[s] = SHORE.beach;
    } else if (slope[s] >= 2 * c.beachSlope) {
      cls[s] = SHORE.rocky;
    }
  }
  // The retreat is evened out along the shore, so a band of hard rock ends in
  // a taper and not in a bite the shape of one stamp. Beaches are never cut.
  for (let pass = 0; pass < RETREAT_SMOOTH; pass++) {
    const next = new Float64Array(count);
    for (let s = 0; s < count; s++) {
      if (cls[s] === SHORE.beach) continue;
      const i = shore.nodes[s];
      const x = i % n;
      const y = (i - x) / n;
      let sum = wear[s];
      let near = 1;
      for (let k = 0; k < 8; k++) {
        const t = shore.slot[wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n)];
        if (t >= 0) {
          sum += wear[t];
          near++;
        }
      }
      next[s] = sum / near;
    }
    wear = next;
  }
  const retreat = new Float64Array(count);
  for (let s = 0; s < count; s++) {
    if (wear[s] < MIN_CUT * scale) continue;
    retreat[s] = wear[s];
    cls[s] = south[s] ? SHORE.cliff : SHORE.rocky;
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
  for (const s of lone) cls[s] = SHORE.none;

  /** The point on the waterline in front of shore node s, in cells. */
  const shoreX = (s: number): number => ((shore.nodes[s] % n) + 0.5 + 0.5 * fx[s]) * cpn;
  const shoreY = (s: number): number => (Math.floor(shore.nodes[s] / n) + 0.5 + 0.5 * fy[s]) * cpn;
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
    if (retreat[s] <= 0) continue;
    const e = shore.e[shore.nodes[s]];
    const t = Math.max(0, (e - c.cliffE) / (1 - c.cliffE));
    const x = shoreX(s);
    const y = shoreY(s);
    const far = (hMax - cap[s]) / c.capSlope;
    const top = far > 0 ? localMax(x, y, retreat[s] + far) : 0;
    const reach = top > cap[s] ? Math.min(far, (top - cap[s]) / c.capSlope) : 0;
    const fall = c.bathy.slope * (c.bathy.base + c.bathy.eGain * e);
    stamps.push({ kind: "cut", x, y, r: retreat[s], level: -(c.platform[0] + (c.platform[1] - c.platform[0]) * t), fall, cap: cap[s], slope: c.capSlope, reach });
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
    const nx = ni % n;
    const ny = (ni - nx) / n;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        if (inCove(s, (nx + ox + 0.5) * cpn, (ny + oy + 0.5) * cpn, p.n, 1.5)) inCoveAt[wrapIndex(nx + ox, ny + oy, n)] = value;
      }
    }
  };
  for (const m of sortIndicesBy(mouthKeys)) {
    const s = mouthSlots[m];
    const i = shore.nodes[s];
    const [dx, dy] = flowAt(i, 3, fx[s], fy[s]);
    const cells = flow.area[i] * cpn * cpn;
    const e = shore.e[i];
    const px = shoreX(s);
    const py = shoreY(s);
    const w = Math.min(6, Math.max(1, Math.round(Math.sqrt(flow.area[i] / p.rivers.qScale))));
    let form: "delta" | "estuary" | "plain" = "plain";
    if (retreat[s] > 0 && cells >= coveMin) {
      const grow = Math.min(1, Math.sqrt(cells / (COVE_FULL * coveMin)));
      const len = Math.min(c.coveLen[1], (c.coveLen[0] + (c.coveLen[1] - c.coveLen[0]) * grow) * rng.range(0.7, 1.3));
      const width = len * rng.range(0.2, 0.36);
      const neck = rng.range(0.35, 0.6);
      const sand = rng.float() < c.coveBoulder ? 0 : rng.range(0.25, 0.42);
      const seed = rng.next();
      // The cove lies along the stream's last reach, not along the shore's normal.
      const [ax, ay] = flowAt(i, Math.max(3, Math.round(len / cpn)), fx[s], fy[s]);
      const ox0 = px - ax * retreat[s];
      const oy0 = py - ay * retreat[s];
      const mx = ox0 - ax * 0.5 * len;
      const my = oy0 - ay * 0.5 * len;
      let clear = true;
      for (const o of coves) {
        const ox = torusDelta(o.x, mx, p.n);
        const oy = torusDelta(o.y, my, p.n);
        const apart = Math.max(c.coveSpacing, 1.5 * (o.r + len));
        if (ox * ox + oy * oy < apart * apart) {
          clear = false;
          break;
        }
      }
      if (clear) {
        const t = Math.max(0, (e - c.cliffE) / (1 - c.cliffE));
        const stamp: CoveStamp = { kind: "cove", x: ox0, y: oy0, ax: -ax, ay: -ay, len, width, neck, tail: retreat[s] + 3 * scale, sand, depth: c.platform[0] + (c.platform[1] - c.platform[0]) * t, seed, base: c.beachBase, rise: c.beachRise };
        coves.push({ x: mx, y: my, r: 0.5 * len + width });
        stamps.push(stamp);
        mark(stamp, sand > 0 ? 1 : 2);
      }
    } else if (w >= c.estuaryWidth && retreat[s] <= 0) {
      const seed = rng.next();
      if (e < c.deltaE && w >= c.deltaWidth) {
        form = "delta";
        const t = (w - c.deltaWidth) / Math.max(1, 6 - c.deltaWidth);
        const channels = rng.float() < 0.5 ? [rng.range(-0.75, -0.35), rng.range(0.3, 0.75)] : [rng.range(-0.85, -0.5), rng.range(-0.15, 0.15), rng.range(0.5, 0.85)];
        stamps.push({ kind: "delta", x: px, y: py, ax: dx, ay: dy, r: c.deltaR[0] + (c.deltaR[1] - c.deltaR[0]) * t, spread: rng.range(1, 1.4), top: c.deltaTop, channels, channel: 0.5 * w * scale + 0.6 * scale, seed });
      } else {
        form = "estuary";
        const len = c.estuaryLen * (0.6 + 0.2 * w);
        const [ax, ay] = flowAt(i, Math.max(3, Math.round(len / cpn)), fx[s], fy[s]);
        const head = (0.5 * w + 0.5) * scale;
        stamps.push({ kind: "estuary", x: px, y: py, ax: -ax, ay: -ay, len, head, sea: 3 * head + 2 * scale, depth: 0.6 + 0.25 * w, seed });
      }
    }
    stamps.push({ kind: "mouth", x: px, y: py, dx, dy, area: cells, form });
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
  const period = Math.max(1, Math.round(p.n / c.stackNoiseCells));
  const hardSlots: number[] = [];
  const hardKeys: number[] = [];
  const hardValue: number[] = [];
  for (let s = 0; s < count; s++) {
    if (retreat[s] < 2.5 * rMin) continue;
    const x = shoreX(s) - fx[s] * STACK_AT * retreat[s];
    const y = shoreY(s) - fy[s] * STACK_AT * retreat[s];
    const v = 0.5 + 0.5 * Math.max(-1, Math.min(1, 1.6 * fbm((x * period) / p.n, (y * period) / p.n, period, 2, 0.5, noiseSeed)));
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

  // 6. Beaches. The shelf's width wanders along the shore and tapers at the ends of a beach.
  const shelfPeriod = Math.max(1, Math.round(6400 / SHELF_CELLS));
  for (let s = 0; s < count; s++) {
    const i = shore.nodes[s];
    if (cls[s] !== SHORE.beach || inCoveAt[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    let run = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const t = shore.slot[wrapIndex(x + dx, y + dy, n)];
        if (t >= 0 && cls[t] === SHORE.beach) run++;
      }
    }
    const px = shoreX(s);
    const py = shoreY(s);
    const wander = Math.max(-1, Math.min(1, 1.6 * fbm((px * shelfPeriod) / p.n, (py * shelfPeriod) / p.n, shelfPeriod, 2, 0.5, noiseSeed ^ 0x51)));
    const shelf = c.shelf * (1 + 0.45 * wander) * Math.min(1, 0.35 + run / 9);
    stamps.push({ kind: "beach", x: px, y: py, land: c.beachLand, base: c.beachBase, rise: c.beachRise, shelf, shelfSlope: c.shelfSlope });
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
  const edgePeriod = Math.max(1, Math.round(6400 / EDGE_CELLS));
  for (let i = 0; i < nn; i++) {
    if (!isSea0[i]) continue;
    const x = ((i % n) + 0.5) * cpn;
    const y = (Math.floor(i / n) + 0.5) * cpn;
    const wide = Math.max(-1, Math.min(1, 1.6 * fbm((x * shelfPeriod) / p.n, (y * shelfPeriod) / p.n, shelfPeriod, 2, 0.5, noiseSeed ^ 0x52)));
    const edge = Math.max(-1, Math.min(1, 1.6 * fbm((x * edgePeriod) / p.n, (y * edgePeriod) / p.n, edgePeriod, 2, 0.5, noiseSeed ^ 0x53)));
    const e = smooth[i];
    const d = Math.max(0, toLand.dist[i] * cpn - 0.5 * cpn);
    const width = c.shelfWide * (1 - e) * (1 - e) * sand[i] * (1 + 0.6 * wide);
    // On the shelf the bed never falls faster than shelfSlope; the edge noise only moves where the shelf ends.
    const past = Math.max(0, d * (1 + 0.3 * edge) - width);
    const depth = c.shelfSlope * Math.min(d, width) + b.slope * (b.base + b.eGain * e) * past;
    base[i] = -Math.max(SEA_MIN, Math.min(b.max, depth));
  }
  for (const o of shoals) {
    const R = Math.ceil((1.4 * o.r) / cpn);
    const ni = nodeAt(o.x, o.y, cpn, n);
    const nx = ni % n;
    const ny = (ni - nx) / n;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const j = wrapIndex(nx + ox, ny + oy, n);
        if (!isSea0[j]) continue;
        const x = (nx + ox + 0.5) * cpn;
        const y = (ny + oy + 0.5) * cpn;
        const edge = Math.max(-1, Math.min(1, 1.6 * fbm((x * edgePeriod) / p.n, (y * edgePeriod) / p.n, edgePeriod, 2, 0.5, noiseSeed ^ 0x54)));
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
  const shoreClass = new Uint8Array(nn);
  for (let i = 0; i < nn; i++) {
    if (isSea[i]) continue;
    // A delta's fan is sand all over, not only at its edge.
    if (isSea0[i] && cut[i] > 0) {
      shoreClass[i] = SHORE.beach;
      continue;
    }
    const x = i % n;
    const y = (i - x) / n;
    let wet = false;
    for (let k = 0; k < 8 && !wet; k++) wet = isSea[wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n)] !== 0;
    if (!wet) continue;
    const s = toShore.src[i] >= 0 ? shore.slot[toShore.src[i]] : -1;
    if (inCoveAt[i] === 1) shoreClass[i] = SHORE.cove;
    else if (inCoveAt[i] === 2) shoreClass[i] = SHORE.rocky;
    else if (s < 0) shoreClass[i] = SHORE.none;
    else if (cls[s] === SHORE.cliff) shoreClass[i] = out[i] >= c.minCliff ? SHORE.cliff : SHORE.rocky;
    else shoreClass[i] = cls[s];
  }

  return { h: out, base, isSea, exposure, shoreClass, stamps };
}
