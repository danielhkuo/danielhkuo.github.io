// S7 steps 5–8: channels on G become river vectors. Reaches are traced
// between heads, confluences, lakes and mouths, smoothed, meandered where the
// land is flat, given a water level that never rises downstream, and the
// ground is conformed to them (valley floors, beds, no new pits).
//
// Coordinates are continuous cells: cell i spans [i, i + 1) and G node j sits
// at 4j + 2. Vertices are unwrapped, so a reach may run past 0 or n.

import { sortIndicesBy } from "../core/heap.ts";
import { PI, pcos, psin } from "../core/psin.ts";
import { type Rng, rngFor } from "../core/rng.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import { priorityFlood } from "./flood.ts";
import type { HydroResult } from "./hydro.ts";

export interface RiverParams {
  /** Width in px is clamp(round(√(Q / qScale)), 1, 6). */
  qScale: number;
  /** Passes of (¼, ½, ¼) along the node path before simplifying: turns grid stairs into diagonals. */
  smoothPasses: number;
  /** Douglas–Peucker tolerance, in cells. */
  simplify: number;
  /** Chaikin corner-cutting passes. */
  chaikin: number;
  /** Vertex spacing of the reaches returned, in cells. */
  spacing: number;
  /** Meanders grow where the channel slope is under this … */
  meanderSlope: number;
  /** … fading out by meanderFade times that slope (1 for a hard edge) … */
  meanderFade: number;
  /** … and the river is at least this wide. */
  meanderMinWidth: number;
  /** Peak heading swing ω, radians, at width 2 and at omegaFullWidth. */
  omega: readonly [number, number];
  omegaFullWidth: number;
  /** Wavelength is max(lambdaMin, lambdaPerWidth · w), in cells. */
  lambdaMin: number;
  lambdaPerWidth: number;
  /** Share by which each bend's amplitude and length vary. */
  wobble: number;
  /** Peak lean of a bend's heading at its apex, radians. */
  skew: number;
  /** At most one bend in this many is cut off and left as an oxbow … */
  oxbowEvery: number;
  /** … at most this many on one river … */
  oxbowMax: number;
  /** … on rivers at least this wide. */
  oxbowMinWidth: number;
  /** Point bars form inside large bends of rivers at least this wide. */
  barMinWidth: number;
  /** Sideways wander of streams that do not meander: cells at width 1 … */
  wiggle: number;
  /** … with a wavelength drifting within this range, in cells. */
  wiggleLambda: readonly [number, number];
  /** A stream running within half a width plus this of a larger one joins it there. */
  mergeGap: number;
  /** A first-order runnel is dropped when, for combShare of its length, a parallel stream runs within this many cells (0 keeps all). */
  combSpacing: number;
  combShare: number;
  /** Valley floor is level + floorLift + floorRise · d at d cells from the river. */
  floorLift: number;
  floorRise: number;
  /** Water runs bankBase + bankPerWidth · w below the routed surface. */
  bankBase: number;
  bankPerWidth: number;
  /** A drop of at least this over one node step is a waterfall if it faces south … */
  fallDrop: number;
  /** … and is this many times the steps above and below it: a ledge, not a steep hillside. */
  fallStandout: number;
  /** Other drops are graded upstream to at most this per node step. */
  rapidsDrop: number;
  /** … cutting the bed by no more than this. */
  rapidsMaxCut: number;
}

export interface RiversInput {
  /** Eroded heights on G. Kept for callers; the rivers conform hydro.ground. */
  g: Float64Array;
  gN: number;
  isSea: Uint8Array;
  hydro: HydroResult;
}

export interface Reach {
  id: number;
  /** The reach this one flows into; −1 at the sea or a lake. */
  downstream: number;
  endsIn: "sea" | "lake" | "reach";
  /** The lake it ends in, else −1. */
  lake: number;
  /** The lake whose outlet it starts at, else −1. */
  fromLake: number;
  /** Strahler order. */
  order: number;
  /** x, y, width, level per vertex. x and y in cells at quarter-cell precision, unwrapped. */
  vertices: Float32Array;
}

export interface Fall {
  x: number;
  y: number;
  drop: number;
  reach: number;
}

export interface Oxbow {
  /** The reach it was cut from. */
  reach: number;
  /** Width of the river that left it. */
  width: number;
  /** Height of its still water. */
  level: number;
  /** Centreline of the crescent: x, y per vertex, in the reach's unwrapped frame. */
  vertices: Float32Array;
  /** The crescent itself: a closed polygon, x, y per vertex in cells (the last joins the first), same frame. */
  outline: Float32Array;
}

/** Sand on the inside bank of a large bend. */
export interface PointBar {
  reach: number;
  /** A closed polygon, x, y per vertex in cells (the last joins the first), in the reach's unwrapped frame. */
  outline: Float32Array;
}

export interface RiversResult {
  reaches: Reach[];
  falls: Fall[];
  oxbows: Oxbow[];
  bars: PointBar[];
  /** hydro.ground with valley floors flattened and beds cut; no land node is a pit. */
  ground: Float64Array;
}

const VERTEX = 4;
const FLOOR_MAX_CUT = 5;
const MAX_OMEGA = 1.5;
/** tan² 60°: a step faces south when dy > 0 and dx² ≤ 3·dy². */
const SOUTH_TAN2 = 3;
/** Vertex spacing of finished lines, in cells; joins are kept JOIN_GAP vertices apart. */
const LINE_STEP = 1.5;
const JOIN_GAP = 4;
/** Bucket size of the vertex index, in cells. */
const BUCKET = 8;

export function riverWidth(q: number, qScale: number): number {
  return Math.max(1, Math.min(6, Math.round(Math.sqrt(q / qScale))));
}

// ---------------------------------------------------------------- meanders

const MEAN_STEPS = 32;

/**
 * Means of sin and cos of the heading ω·cos φ over half a wave: the share of
 * path length that becomes sideways travel and travel along the valley.
 * 1 / cos-mean is the sinuosity.
 */
export function meanderMeans(omega: number): [number, number] {
  let s = 0;
  let c = 0;
  for (let i = 0; i < MEAN_STEPS; i++) {
    const a = omega * pcos(-PI / 2 + (PI * (i + 0.5)) / MEAN_STEPS);
    s += psin(a);
    c += pcos(a);
  }
  return [s / MEAN_STEPS, c / MEAN_STEPS];
}

/** The ω whose sideways share is `ratio`, by bisection; clamped to [0, MAX_OMEGA]. */
function solveOmega(ratio: number): number {
  if (ratio <= 0) return 0;
  if (ratio >= meanderMeans(MAX_OMEGA)[0]) return MAX_OMEGA;
  let lo = 0;
  let hi = MAX_OMEGA;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (meanderMeans(mid)[0] < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface MeanderSpec {
  omega: number;
  lambda: number;
  width: number;
  /** Half the width of flat valley floor here, in cells; loops stay inside it. Omit for open ground. */
  room?: number;
}

export interface MeanderOptions {
  /** ω, λ and river width at valley distance u. */
  spec: (u: number) => MeanderSpec;
  /** Share by which each bend's amplitude and length vary; 0 gives the pure sine-generated curve. */
  wobble: number;
  /** Peak heading skew, radians: bends lean by up to this. Needs rng. */
  skew?: number;
  /** Grow from and return to the axis, so the ends join what is up- and downstream. */
  taper: boolean;
  /** Multiplies every amplitude. */
  scale: number;
  /** Step along the river, in cells. */
  step: number;
  rng: Rng | null;
  /** One oxbow at most per this many bends (0 for none) … */
  oxbowEvery: number;
  /** … and never more than this many on the stretch … */
  oxbowMax?: number;
  /** … on rivers at least this wide. */
  oxbowMinWidth: number;
  /** Point bars form inside bends of rivers at least this wide; 0 or omitted for none. */
  barMinWidth?: number;
}

export interface Meander {
  x: number[];
  y: number[];
  /** Valley distance of each point. */
  u: number[];
  /** Loop amplitude around each point. */
  amp: number[];
  /** Cut-off loops: a centreline and the closed outline of the crescent of still water. */
  oxbows: { x: number[]; y: number[]; ox: number[]; oy: number[]; u: number; width: number }[];
  /** Sand inside the larger bends: closed outlines. */
  bars: { ox: number[]; oy: number[]; u: number }[];
}

/** Largest index i with a[i] ≤ v, clamped to [0, a.length − 2]. */
function segmentAt(a: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Half-angle of an oxbow's arc: 100°. */
const OXBOW_ARC = (100 * PI) / 180;

/**
 * A sine-generated curve laid along a valley axis: the heading is the axis
 * direction turned by ±ω·cos φ, with φ running half a turn per bend. Bends are
 * planned by amplitude so the river crosses the axis every half wave and
 * cannot drift off it; each has its own length, amplitude and lean. Null when
 * the axis is too short for a loop.
 */
export function meanderAlong(ax: ArrayLike<number>, ay: ArrayLike<number>, o: MeanderOptions): Meander | null {
  const m = ax.length;
  if (m < 3) return null;
  const ua = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    const dx = ax[i] - ax[i - 1];
    const dy = ay[i] - ay[i - 1];
    ua[i] = ua[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const U = ua[m - 1];
  if (!(U > 0)) return null;
  const tx = new Float64Array(m);
  const ty = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    const dx = ax[b] - ax[a];
    const dy = ay[b] - ay[a];
    const len = Math.sqrt(dx * dx + dy * dy);
    tx[i] = len > 0 ? dx / len : 1;
    ty[i] = len > 0 ? dy / len : 0;
  }
  const kappa = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) {
    const dx = tx[i + 1] - tx[i - 1];
    const dy = ty[i + 1] - ty[i - 1];
    const du = ua[i + 1] - ua[i - 1];
    kappa[i] = du > 0 ? Math.sqrt(dx * dx + dy * dy) / du : 0;
  }

  // Plan half waves: a length and the amplitude of the apex that ends each.
  const rng = o.rng;
  const rnd = (): number => (rng ? rng.float() * 2 - 1 : 0);
  const sign0 = rng && rng.float() < 0.5 ? -1 : 1;
  const len: number[] = [];
  const amp: number[] = [];
  const wid: number[] = [];
  const room: number[] = [];
  const at: number[] = [0];
  // Neighbouring bends share a slow swell, and now and then the river runs nearly straight for a few.
  let swell = 0;
  let calm = 0;
  const vary = (): number => {
    if (!rng) return 1;
    swell = 0.6 * swell + 0.4 * rnd();
    if (calm > 0) calm--;
    else if (rng.float() < 0.07) calm = 2 + rng.int(3);
    return Math.max(0.15, 1 + o.wobble * (0.75 * rnd() + 0.75 * swell)) * (calm > 0 ? 0.2 : 1);
  };
  const first = o.spec(0);
  amp.push((first.lambda * meanderMeans(first.omega)[0] * vary()) / 4);
  wid.push(first.width);
  room.push(first.room === undefined ? Infinity : first.room);
  let ue = 0;
  while (ue < U && len.length < 4096) {
    const sp = o.spec(ue);
    const [sm, cm] = meanderMeans(sp.omega);
    const l = 0.5 * sp.lambda * Math.max(0.4, 1 + 0.8 * o.wobble * rnd());
    len.push(l);
    ue += l * cm;
    amp.push((sp.lambda * sm * vary()) / 4);
    wid.push(sp.width);
    room.push(sp.room === undefined ? Infinity : sp.room);
    at.push(ue);
  }
  const K = len.length;
  if (K < (o.taper ? 3 : 1)) return null;

  for (let j = 0; j <= K; j++) {
    let a = amp[j] * o.scale;
    if (o.taper) a *= Math.min(1, j / 2, (K - j) / 2);
    // Keep each loop inside the bend of the axis so the offset curve cannot fold, and inside the valley.
    const uj = (at[j] * U) / ue;
    const half = len[Math.min(j, K - 1)];
    let kmax = 0;
    for (let i = segmentAt(ua, uj - half); i < m && ua[i] <= uj + half; i++) if (kappa[i] > kmax) kmax = kappa[i];
    if (kmax > 0) a = Math.min(a, 0.5 / kmax);
    amp[j] = Math.min(a, room[j]);
  }

  // Oxbows: rare, on the largest free bends of a wide river, where the floor has room for one.
  const cut: { j: number; full: number }[] = [];
  const cutAt = new Uint8Array(K + 1);
  if (rng && o.oxbowEvery > 0 && o.taper) {
    const want = Math.min(o.oxbowMax === undefined ? 2 : o.oxbowMax, Math.floor(K / o.oxbowEvery));
    for (let tries = 0; tries < want * 4 && cut.length < want && K > 4; tries++) {
      const j = 2 + rng.int(K - 3);
      const w = wid[j];
      const r = Math.max(4.5, Math.min(14, 0.75 * amp[j]));
      const spread = amp[j] * 0.35 + w / 2 + 3 + 2 * Math.max(1.25, 0.4 * w) + 1.17 * r;
      if (w < o.oxbowMinWidth || amp[j] < Math.max(5, 1.5 * w) || room[j] < spread) continue;
      let clear = true;
      for (let c = 0; c < cut.length; c++) if (Math.abs(cut[c].j - j) < 4) clear = false;
      if (!clear) continue;
      cut.push({ j, full: amp[j] });
      cutAt[j] = 1;
      amp[j] *= 0.35;
    }
  }

  // Each apex leans: the heading there is off the axis by this much.
  const lean = new Float64Array(K + 1);
  const skew = o.skew === undefined ? 0 : o.skew;
  if (rng && skew > 0) for (let j = 1; j < K; j++) lean[j] = skew * (0.3 + 0.7 * rng.float()) * Math.min(1, amp[j] / 3);

  const om = new Float64Array(K);
  let advance = 0;
  for (let k = 0; k < K; k++) {
    om[k] = solveOmega((amp[k] + amp[k + 1]) / len[k]);
    advance += len[k] * meanderMeans(om[k])[1];
  }
  const fit = U / advance;

  // Integrate in valley coordinates: u along the axis, v across it.
  const pu: number[] = [0];
  const pv: number[] = [0];
  const pa: number[] = [amp[0] * fit];
  const apex = new Int32Array(K + 1);
  let u = 0;
  let v = 0;
  for (let k = 0; k < K; k++) {
    const l = len[k] * fit;
    const steps = Math.max(4, Math.ceil(l / o.step));
    const h = l / steps;
    const sg = k % 2 === 0 ? sign0 : -sign0;
    for (let i = 0; i < steps; i++) {
      const f0 = (i + 0.5) / steps;
      const phi = -PI / 2 + PI * f0;
      // The third harmonic skews the bend (Kinoshita); it is continuous across apexes.
      const a = sg * (om[k] * pcos(phi) + (lean[k] + (lean[k + 1] - lean[k]) * f0) * psin(3 * phi));
      u += h * pcos(a);
      v += h * psin(a);
      pu.push(u);
      pv.push(v);
      const f = (i + 1) / steps;
      pa.push((amp[k] + (amp[k + 1] - amp[k]) * f) * fit);
    }
    apex[k + 1] = pu.length - 1;
  }
  const uEnd = u;
  const vEnd = o.taper ? v : 0;

  const out: Meander = { x: [], y: [], u: [], amp: pa, oxbows: [], bars: [] };
  const count = pu.length;
  for (let i = 0; i < count; i++) {
    const uu = Math.max(0, Math.min(U, (pu[i] * U) / uEnd));
    const vv = pv[i] - (vEnd * uu) / U;
    const s = segmentAt(ua, uu);
    const span = ua[s + 1] - ua[s];
    const f = span > 0 ? (uu - ua[s]) / span : 0;
    let nx = tx[s] + (tx[s + 1] - tx[s]) * f;
    let ny = ty[s] + (ty[s + 1] - ty[s]) * f;
    const nl = Math.sqrt(nx * nx + ny * ny);
    nx = nl > 0 ? nx / nl : 1;
    ny = nl > 0 ? ny / nl : 0;
    out.x.push(ax[s] + (ax[s + 1] - ax[s]) * f - vv * ny);
    out.y.push(ay[s] + (ay[s + 1] - ay[s]) * f + vv * nx);
    out.u.push(uu);
    pv[i] = vv;
    pu[i] = uu;
  }
  out.x[0] = ax[0];
  out.y[0] = ay[0];
  if (o.taper) {
    out.x[count - 1] = ax[m - 1];
    out.y[count - 1] = ay[m - 1];
  }

  // The cut-off loop: a crescent of still water standing clear of the shortened bend.
  for (let c = 0; c < cut.length; c++) {
    const i = apex[cut[c].j];
    const uu = pu[i];
    const s = segmentAt(ua, uu);
    const span = ua[s + 1] - ua[s];
    const f = span > 0 ? (uu - ua[s]) / span : 0;
    const cx = ax[s] + (ax[s + 1] - ax[s]) * f;
    const cy = ay[s] + (ay[s + 1] - ay[s]) * f;
    const txs = tx[s];
    const tys = ty[s];
    const side = pv[i] < 0 ? -1 : 1;
    const w = wid[cut[c].j];
    const r = Math.max(4.5, Math.min(14, 0.75 * cut[c].full * fit));
    const h0 = Math.max(1.25, 0.4 * w);
    const vc = pv[i] + side * (w / 2 + 3 + h0 + 0.17 * r);
    const n = Math.max(10, Math.ceil(2 * OXBOW_ARC * r));
    const mid: number[][] = [[], []];
    const outer: number[][] = [[], []];
    const inner: number[][] = [[], []];
    for (let k = 0; k <= n; k++) {
      const e = (2 * k) / n - 1;
      const alpha = OXBOW_ARC * e;
      const hw = h0 * (0.25 + 0.75 * (1 - e * e));
      const sa = psin(alpha);
      const ca = pcos(alpha);
      const put = (dst: number[][], rho: number): void => {
        const du = rho * sa;
        const dv = vc + side * rho * ca;
        dst[0].push(cx + du * txs - dv * tys);
        dst[1].push(cy + du * tys + dv * txs);
      };
      put(mid, r);
      put(outer, r + hw);
      if (k > 0 && k < n) put(inner, r - hw);
    }
    const ox = outer[0].concat(inner[0].reverse());
    const oy = outer[1].concat(inner[1].reverse());
    out.oxbows.push({ x: mid[0], y: mid[1], ox, oy, u: uu, width: w });
  }

  // Point bars: a sliver of sand on the inside bank around each large apex.
  const barMin = o.barMinWidth === undefined ? 0 : o.barMinWidth;
  for (let j = 1; barMin > 0 && j < K; j++) {
    const w = wid[j];
    if (w < barMin || cutAt[j] || amp[j] * fit < w + 2) continue;
    const i = apex[j];
    const from = i - Math.round(0.3 * (apex[j] - apex[j - 1]));
    const to = i + Math.round(0.3 * (apex[j + 1] - apex[j]));
    if (to - from < 4) continue;
    // The inside of the bend is the side the axis lies on.
    const s = segmentAt(ua, pu[i]);
    const side = pv[i] < 0 ? -1 : 1;
    const inX = side * ty[s];
    const inY = -side * tx[s];
    const reach = Math.max(2, 0.7 * w) + 0.5;
    const ex: number[] = [];
    const ey: number[] = [];
    const fx: number[] = [];
    const fy: number[] = [];
    for (let k = from; k <= to; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(count - 1, k + 1);
      let nx = -(out.y[b] - out.y[a]);
      let ny = out.x[b] - out.x[a];
      const nl = Math.sqrt(nx * nx + ny * ny);
      if (!(nl > 0)) continue;
      if (nx * inX + ny * inY < 0) {
        nx = -nx;
        ny = -ny;
      }
      nx /= nl;
      ny /= nl;
      const e = (2 * (k - from)) / (to - from) - 1;
      const near = w / 2 + 0.25;
      ex.push(out.x[k] + nx * near);
      ey.push(out.y[k] + ny * near);
      if (k > from && k < to) {
        const far = near + reach * (0.2 + 0.8 * (1 - e * e));
        fx.push(out.x[k] + nx * far);
        fy.push(out.y[k] + ny * far);
      }
    }
    out.bars.push({ ox: ex.concat(fx.reverse()), oy: ey.concat(fy.reverse()), u: pu[i] });
  }
  return out;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/**
 * Where segment a0→a1 meets b0→b1: the share of the way along each, or null.
 * Touching at an end counts.
 */
function segmentHit(a0x: number, a0y: number, a1x: number, a1y: number, b0x: number, b0y: number, b1x: number, b1y: number): [number, number] | null {
  const rx = a1x - a0x;
  const ry = a1y - a0y;
  const sx = b1x - b0x;
  const sy = b1y - b0y;
  const den = cross(rx, ry, sx, sy);
  if (den === 0) return null;
  const qx = b0x - a0x;
  const qy = b0y - a0y;
  const t = cross(qx, qy, sx, sy) / den;
  const s = cross(qx, qy, rx, ry) / den;
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;
  return [t, s];
}

/** True when no two edges of the closed polygon touch, other than neighbours at their shared vertex. */
export function polygonIsSimple(x: ArrayLike<number>, y: ArrayLike<number>): boolean {
  const m = x.length;
  if (m < 3) return false;
  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % m;
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const j1 = (j + 1) % m;
      if (segmentHit(x[i], y[i], x[i1], y[i1], x[j], y[j], x[j1], y[j1])) return false;
    }
  }
  return true;
}

/** True when two segments of the polyline that do not share a vertex cross. */
export function selfIntersects(x: ArrayLike<number>, y: ArrayLike<number>): boolean {
  const m = x.length;
  for (let i = 0; i + 1 < m; i++) {
    const ax0 = Math.min(x[i], x[i + 1]);
    const ax1 = Math.max(x[i], x[i + 1]);
    const ay0 = Math.min(y[i], y[i + 1]);
    const ay1 = Math.max(y[i], y[i + 1]);
    for (let j = i + 2; j + 1 < m; j++) {
      if (x[j] > ax1 && x[j + 1] > ax1) continue;
      if (x[j] < ax0 && x[j + 1] < ax0) continue;
      if (y[j] > ay1 && y[j + 1] > ay1) continue;
      if (y[j] < ay0 && y[j + 1] < ay0) continue;
      if (segmentHit(x[i], y[i], x[i + 1], y[i + 1], x[j], y[j], x[j + 1], y[j + 1])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- polylines

interface Line {
  x: number[];
  y: number[];
  /** Position along the path's node chain: node k is at t = k. */
  t: number[];
  /** Meander amplitude around the vertex, 0 where the river runs straight. */
  a: number[];
}

/** Keep flags for Douglas–Peucker at tolerance `tol`. */
function simplifyKeep(x: ArrayLike<number>, y: ArrayLike<number>, tol: number): Uint8Array {
  const m = x.length;
  const keep = new Uint8Array(m);
  keep[0] = 1;
  keep[m - 1] = 1;
  const stack: number[] = [0, m - 1];
  const tol2 = tol * tol;
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    if (b - a < 2) continue;
    const dx = x[b] - x[a];
    const dy = y[b] - y[a];
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = x[i] - x[a];
      const py = y[i] - y[a];
      let d2: number;
      if (len2 > 0) {
        const c = cross(dx, dy, px, py);
        d2 = (c * c) / len2;
      } else {
        d2 = px * px + py * py;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  return keep;
}

/** One corner-cutting pass that keeps both ends. */
function chaikin(l: Line): Line {
  const m = l.x.length;
  if (m < 3) return l;
  const out: Line = { x: [l.x[0]], y: [l.y[0]], t: [l.t[0]], a: [0] };
  for (let i = 0; i + 1 < m; i++) {
    for (let k = 0; k < 2; k++) {
      const f = k === 0 ? 0.25 : 0.75;
      out.x.push(l.x[i] + (l.x[i + 1] - l.x[i]) * f);
      out.y.push(l.y[i] + (l.y[i + 1] - l.y[i]) * f);
      out.t.push(l.t[i] + (l.t[i + 1] - l.t[i]) * f);
      out.a.push(0);
    }
  }
  out.x.push(l.x[m - 1]);
  out.y.push(l.y[m - 1]);
  out.t.push(l.t[m - 1]);
  out.a.push(0);
  return out;
}

/** Points every ≤ `spacing` along the line, ends kept. */
function resample(l: Line, spacing: number): Line {
  const m = l.x.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    const dx = l.x[i] - l.x[i - 1];
    const dy = l.y[i] - l.y[i - 1];
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const total = cum[m - 1];
  const parts = Math.max(1, Math.ceil(total / spacing));
  const out: Line = { x: [l.x[0]], y: [l.y[0]], t: [l.t[0]], a: [l.a[0]] };
  let s = 0;
  for (let j = 1; j < parts; j++) {
    const d = (total * j) / parts;
    while (s + 2 < m && cum[s + 1] < d) s++;
    const span = cum[s + 1] - cum[s];
    const f = span > 0 ? (d - cum[s]) / span : 0;
    out.x.push(l.x[s] + (l.x[s + 1] - l.x[s]) * f);
    out.y.push(l.y[s] + (l.y[s + 1] - l.y[s]) * f);
    out.t.push(l.t[s] + (l.t[s + 1] - l.t[s]) * f);
    out.a.push(l.a[s] + (l.a[s + 1] - l.a[s]) * f);
  }
  out.x.push(l.x[m - 1]);
  out.y.push(l.y[m - 1]);
  out.t.push(l.t[m - 1]);
  out.a.push(l.a[m - 1]);
  return out;
}

function quarter(v: number): number {
  return Math.round(v * 4) / 4;
}

// ---------------------------------------------------------------- rivers

const END_SEA = 0;
const END_LAKE = 1;
const END_REACH = 2;

interface Path {
  /** Channel nodes from the head down; the terminal is not among them. */
  nodes: number[];
  /** The sea node, lake node or confluence node the path runs into. */
  terminal: number;
  end: number;
  /** Raw unwrapped node positions, the terminal last. */
  px: Float64Array;
  py: Float64Array;
  line: Line;
  /** The path it joins, and where along that path's line (vertex index + share). */
  parent: number;
  joinPos: number;
  /** Water level of the river it joins, at the confluence: this path's water is never below it. */
  floor: number;
  /** Positions along this line where other paths join. */
  joins: number[];
  /** Start position and id of each reach cut from the line. */
  cutPos: number[];
  cutReach: number[];
}

export function rivers(input: RiversInput, p: RiverParams, seed: number): RiversResult {
  const { gN, isSea, hydro } = input;
  const n = gN * 4;
  const nn = gN * gN;
  const { rcv, q, channel, lakeId, lakes, surface, order } = hydro;
  const rng = rngFor(seed, "rivers");

  const wNode = new Uint8Array(nn);
  const donorCount = new Uint8Array(nn);
  const mainDonor = new Int32Array(nn).fill(-1);
  for (let i = 0; i < nn; i++) {
    if (!channel[i]) continue;
    wNode[i] = riverWidth(q[i], p.qScale);
    const j = rcv[i];
    if (!channel[j]) continue;
    if (donorCount[j] < 255) donorCount[j]++;
    const m = mainDonor[j];
    if (m < 0 || q[i] > q[m]) mainDonor[j] = i;
  }

  // --- Trace: one path per head, following the larger stream through each confluence.
  const paths: Path[] = [];
  const pathOf = new Int32Array(nn).fill(-1);
  const idxOf = new Int32Array(nn);
  for (let head = 0; head < nn; head++) {
    if (!channel[head] || donorCount[head] !== 0) continue;
    const nodes: number[] = [];
    let cur = head;
    let terminal = -1;
    let end = END_SEA;
    for (let guard = 0; guard <= nn; guard++) {
      pathOf[cur] = paths.length;
      idxOf[cur] = nodes.length;
      nodes.push(cur);
      const j = rcv[cur];
      if (!channel[j]) {
        terminal = j;
        end = lakeId[j] >= 0 ? END_LAKE : END_SEA;
        break;
      }
      if (mainDonor[j] !== cur) {
        terminal = j;
        end = END_REACH;
        break;
      }
      cur = j;
    }
    const m = nodes.length;
    const px = new Float64Array(m + 1);
    const py = new Float64Array(m + 1);
    let gx = head % gN;
    let gy = (head - gx) / gN;
    px[0] = gx * 4 + 2;
    py[0] = gy * 4 + 2;
    for (let k = 1; k <= m; k++) {
      const node = k < m ? nodes[k] : terminal;
      const x = node % gN;
      const y = (node - x) / gN;
      px[k] = px[k - 1] + 4 * torusDelta(gx, x, gN);
      py[k] = py[k - 1] + 4 * torusDelta(gy, y, gN);
      gx = x;
      gy = y;
    }
    paths.push({ nodes, terminal, end, px, py, line: { x: [], y: [], t: [], a: [] }, parent: -1, joinPos: 0, floor: 0, joins: [], cutPos: [], cutReach: [] });
  }

  // Trunks before their tributaries: a parent always carries more water at its foot.
  const footQ = new Float64Array(paths.length);
  for (let i = 0; i < paths.length; i++) footQ[i] = -q[paths[i].nodes[paths[i].nodes.length - 1]];
  const pathOrder = sortIndicesBy(footQ);

  // --- Combs: on a planar slope every runnel is a channel. Drop first-order
  // runnels that have a larger parallel stream close beside them. Largest
  // first, so what is kept is spaced between one and two combSpacings.
  const dropped = new Uint8Array(paths.length);
  if (p.combSpacing > 0) {
    const hasTributary = new Uint8Array(paths.length);
    const dirX = new Float32Array(nn);
    const dirY = new Float32Array(nn);
    for (let i = 0; i < paths.length; i++) {
      const { nodes, px, py, end, terminal } = paths[i];
      if (end === END_REACH) hasTributary[pathOf[terminal]] = 1;
      const m = nodes.length;
      for (let k = 0; k < m; k++) {
        const a = Math.max(0, k - 3);
        const b = Math.min(m, k + 3);
        const dx = px[b] - px[a];
        const dy = py[b] - py[a];
        const len = Math.sqrt(dx * dx + dy * dy);
        dirX[nodes[k]] = len > 0 ? dx / len : 0;
        dirY[nodes[k]] = len > 0 ? dy / len : 0;
      }
    }
    const R = Math.round(p.combSpacing / 4);
    // 1 once a path is settled as kept; everything that is not a bare runnel is kept from the start.
    const kept = new Uint8Array(paths.length);
    for (let i = 0; i < paths.length; i++) {
      const nodes = paths[i].nodes;
      if (hasTributary[i] || wNode[nodes[nodes.length - 1]] > 1) kept[i] = 1;
    }
    for (let oi = 0; oi < pathOrder.length; oi++) {
      const pid = pathOrder[oi];
      const path = paths[pid];
      const m = path.nodes.length;
      if (kept[pid]) continue;
      const parentId = path.end === END_REACH ? pathOf[path.terminal] : -1;
      let beside = 0;
      for (let k = 0; k < m; k++) {
        const node = path.nodes[k];
        const x = node % gN;
        const y = (node - x) / gN;
        const ux = dirX[node];
        const uy = dirY[node];
        let found = false;
        for (let dy = -R; dy <= R && !found; dy++) {
          for (let dx = -R; dx <= R && !found; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 === 0 || d2 > R * R) continue;
            const j = wrap(y + dy, gN) * gN + wrap(x + dx, gN);
            if (!channel[j]) continue;
            const other = pathOf[j];
            if (other === pid || other === parentId || !kept[other]) continue;
            if (dirX[j] * ux + dirY[j] * uy < 0.8) continue;
            // Beside it, not ahead of it or behind.
            const along = dx * ux + dy * uy;
            if (along * along <= 0.5 * d2) found = true;
          }
        }
        if (found) beside++;
      }
      if (beside >= p.combShare * m) dropped[pid] = 1;
      else kept[pid] = 1;
    }
  }

  // --- Levels on the node chain. Receivers come first in `order`.
  const south = new Uint8Array(nn);
  for (let i = 0; i < paths.length; i++) {
    const { nodes, px, py } = paths[i];
    const m = nodes.length;
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(m, k + 2);
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      if (dy > 0 && dx * dx <= SOUTH_TAN2 * dy * dy) south[nodes[k]] = 1;
    }
  }
  const level = new Float64Array(nn);
  const fallStep = new Uint8Array(nn);
  const graded = new Uint8Array(nn);
  const levelOf = (j: number): number => (channel[j] ? level[j] : lakeId[j] >= 0 ? lakes[lakeId[j]].level : 0);
  for (let k = 0; k < nn; k++) {
    const i = order[k];
    if (!channel[i]) continue;
    const j = rcv[i];
    const lj = levelOf(j);
    let li = Math.max(surface[i] - (p.bankBase + p.bankPerWidth * wNode[i]), lj);
    const drop = li - lj;
    const up = mainDonor[i] >= 0 ? surface[mainDonor[i]] - surface[i] : 0;
    const down = channel[j] ? surface[j] - surface[rcv[j]] : 0;
    const ledge = drop >= p.fallDrop && drop >= p.fallStandout * Math.max(up, down);
    if (south[i]) {
      if (ledge) fallStep[i] = 1;
    } else if (ledge) {
      // The camera cannot see this drop: cut the bed upstream into rapids.
      li = Math.max(lj + p.rapidsDrop, li - p.rapidsMaxCut);
      graded[i] = 1;
    } else if (graded[j]) {
      // Carry the cut upstream, easing out wherever the bed is gentler than rapids.
      const eased = Math.max(lj + Math.max(p.rapidsDrop, surface[i] - surface[j]), li - p.rapidsMaxCut);
      if (eased < li) {
        li = eased;
        graded[i] = 1;
      }
    }
    level[i] = li;
  }

  /** Water level at position t along a path's node chain; kept falls are steps. */
  const profile = (path: Path, t: number): number => {
    const m = path.nodes.length;
    const k = Math.max(0, Math.min(m - 1, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - k));
    const node = path.nodes[k];
    const la = level[node];
    const lb = k + 1 < m ? level[path.nodes[k + 1]] : levelOf(path.terminal);
    if (fallStep[node]) return f < 0.5 ? la : lb;
    return la + (lb - la) * f;
  };
  const widthAt = (path: Path, t: number): number => {
    const m = path.nodes.length;
    return wNode[path.nodes[Math.max(0, Math.min(m - 1, Math.floor(t + 0.5)))]];
  };
  const routed = (path: Path, k: number): number => {
    if (k < path.nodes.length) return surface[path.nodes[k]];
    const j = path.terminal;
    return path.end === END_REACH ? surface[j] : lakeId[j] >= 0 ? lakes[lakeId[j]].level : 0;
  };
  /** The point at share f of segment i of a line, snapped to quarter cells. */
  const pointOn = (l: Line, pos: number): [number, number, number, number] => {
    const last = l.x.length - 1;
    const i = Math.max(0, Math.min(last - 1, Math.floor(pos)));
    const f = Math.max(0, Math.min(1, pos - i));
    return [
      quarter(l.x[i] + (l.x[i + 1] - l.x[i]) * f),
      quarter(l.y[i] + (l.y[i + 1] - l.y[i]) * f),
      l.t[i] + (l.t[i + 1] - l.t[i]) * f,
      l.a[i] + (l.a[i + 1] - l.a[i]) * f,
    ];
  };
  const wet = (x: number, y: number): boolean => {
    const i = wrap(Math.floor(y / 4), gN) * gN + wrap(Math.floor(x / 4), gN);
    return isSea[i] === 1 || lakeId[i] >= 0;
  };

  const pending: { path: number; t: number; x: number[]; y: number[]; ox: number[]; oy: number[]; width: number }[] = [];
  const pendingBars: { path: number; t: number; ox: number[]; oy: number[] }[] = [];

  // Every vertex of every finished line, in buckets, so a later stream can find the rivers near it.
  const nb = n / BUCKET;
  const bucket = new Int32Array(nb * nb).fill(-1);
  const ixNext: number[] = [];
  const ixX: number[] = [];
  const ixY: number[] = [];
  const ixPath: number[] = [];
  const ixPos: number[] = [];
  const addToIndex = (pid: number, line: Line): void => {
    for (let i = 0; i < line.x.length; i++) {
      const x = wrap(line.x[i], n);
      const y = wrap(line.y[i], n);
      const b = Math.min(nb - 1, Math.floor(y / BUCKET)) * nb + Math.min(nb - 1, Math.floor(x / BUCKET));
      ixNext.push(bucket[b]);
      bucket[b] = ixX.length;
      ixX.push(x);
      ixY.push(y);
      ixPath.push(pid);
      ixPos.push(i);
    }
  };
  /** Calls f(entry, distance²) for indexed vertices in the buckets around (x, y); covers any radius up to BUCKET. */
  const nearby = (x: number, y: number, f: (e: number, d2: number) => void): void => {
    const wx = wrap(x, n);
    const wy = wrap(y, n);
    const bx = Math.min(nb - 1, Math.floor(wx / BUCKET));
    const by = Math.min(nb - 1, Math.floor(wy / BUCKET));
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let e = bucket[wrap(by + oy, nb) * nb + wrap(bx + ox, nb)]; e >= 0; e = ixNext[e]) {
          const dx = torusDelta(wx, ixX[e], n);
          const dy = torusDelta(wy, ixY[e], n);
          f(e, dx * dx + dy * dy);
        }
      }
    }
  };

  // --- Geometry, trunks first.
  for (let oi = 0; oi < pathOrder.length; oi++) {
    const pid = pathOrder[oi];
    if (dropped[pid]) continue;
    const path = paths[pid];
    const m = path.nodes.length;
    const rx = Array.from(path.px);
    const ry = Array.from(path.py);
    let oxbowsLeft = p.oxbowMax;

    rx[0] = quarter(rx[0]);
    ry[0] = quarter(ry[0]);
    for (let pass = 0; pass < p.smoothPasses; pass++) {
      let prevX = rx[0];
      let prevY = ry[0];
      for (let k = 1; k < m; k++) {
        const cx = rx[k];
        const cy = ry[k];
        rx[k] = 0.25 * prevX + 0.5 * cx + 0.25 * rx[k + 1];
        ry[k] = 0.25 * prevY + 0.5 * cy + 0.25 * ry[k + 1];
        prevX = cx;
        prevY = cy;
      }
    }

    const keep = simplifyKeep(rx, ry, p.simplify);
    let line: Line = { x: [], y: [], t: [], a: [] };
    for (let k = 0; k <= m; k++) {
      if (!keep[k]) continue;
      line.x.push(rx[k]);
      line.y.push(ry[k]);
      line.t.push(k);
      line.a.push(0);
    }
    for (let pass = 0; pass < p.chaikin; pass++) line = chaikin(line);

    // Meanders on runs of wide, flat channel.
    const flat = new Float32Array(m);
    const cum = new Float64Array(m + 1);
    for (let k = 1; k <= m; k++) {
      const dx = path.px[k] - path.px[k - 1];
      const dy = path.py[k] - path.py[k - 1];
      cum[k] = cum[k - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    let any = false;
    for (let k = 0; k < m; k++) {
      if (wNode[path.nodes[k]] < p.meanderMinWidth) continue;
      const a = Math.max(0, k - 3);
      const b = Math.min(m, k + 3);
      const slope = (routed(path, a) - routed(path, b)) / (cum[b] - cum[a]);
      if (slope < p.meanderSlope * p.meanderFade) {
        flat[k] = p.meanderFade > 1 ? Math.max(0.05, Math.min(1, (p.meanderFade * p.meanderSlope - slope) / ((p.meanderFade - 1) * p.meanderSlope))) : 1;
        any = true;
      }
    }
    if (any) {
      // Bridge gaps of one or two nodes.
      for (let k = 1; k < m; k++) {
        if (flat[k] || !flat[k - 1]) continue;
        let e = k;
        while (e < m && !flat[e]) e++;
        if (e < m && e - k <= 2) for (let i = k; i < e; i++) flat[i] = wNode[path.nodes[i]] >= p.meanderMinWidth ? 0.05 : 0;
      }
      const next: Line = { x: [], y: [], t: [], a: [] };
      let from = 0;
      let k0 = 0;
      while (k0 < m) {
        if (!flat[k0]) {
          k0++;
          continue;
        }
        let k1 = k0;
        while (k1 + 1 < m && flat[k1 + 1]) k1++;
        const tEnd = k1 + 1 === m && path.end !== END_REACH ? k1 : k1 + 1;
        const key = rng.next();
        // The run's stretch of the line, cut at its ends.
        let ia = from;
        while (ia < line.t.length && line.t[ia] <= k0) ia++;
        let ib = ia;
        while (ib < line.t.length && line.t[ib] < tEnd) ib++;
        const sub: Line = { x: [], y: [], t: [], a: [] };
        const addAt = (t: number): void => {
          const sg = segmentAt(line.t, t);
          const span = line.t[sg + 1] - line.t[sg];
          const f = span > 0 ? Math.max(0, Math.min(1, (t - line.t[sg]) / span)) : 0;
          sub.x.push(line.x[sg] + (line.x[sg + 1] - line.x[sg]) * f);
          sub.y.push(line.y[sg] + (line.y[sg + 1] - line.y[sg]) * f);
          sub.t.push(t);
          sub.a.push(0);
        };
        addAt(k0);
        for (let i = ia; i < ib; i++) {
          sub.x.push(line.x[i]);
          sub.y.push(line.y[i]);
          sub.t.push(line.t[i]);
          sub.a.push(0);
        }
        addAt(tEnd);
        const made = tEnd > k0 ? meanderRun(sub, path, flat, key, oxbowsLeft) : null;
        if (made) {
          for (let i = from; i < ia; i++) {
            if (line.t[i] >= k0) break;
            next.x.push(line.x[i]);
            next.y.push(line.y[i]);
            next.t.push(line.t[i]);
            next.a.push(0);
          }
          for (let i = 0; i < made.line.x.length; i++) {
            next.x.push(made.line.x[i]);
            next.y.push(made.line.y[i]);
            next.t.push(made.line.t[i]);
            next.a.push(made.line.a[i]);
          }
          for (let i = 0; i < made.oxbows.length; i++) pending.push({ path: pid, ...made.oxbows[i] });
          for (let i = 0; i < made.bars.length; i++) pendingBars.push({ path: pid, ...made.bars[i] });
          oxbowsLeft -= made.oxbows.length;
          from = ib;
          while (from < line.t.length && line.t[from] <= tEnd) from++;
        }
        k0 = k1 + 1;
      }
      for (let i = from; i < line.t.length; i++) {
        next.x.push(line.x[i]);
        next.y.push(line.y[i]);
        next.t.push(line.t[i]);
        next.a.push(0);
      }
      line = next;
    }

    line = wiggle(line, path);

    // Join the first larger river this one comes up beside, else the one the hydrology sends it to.
    let target = -1;
    let targetPos = 0;
    let cutAt = line.x.length - 1;
    let run = 0;
    for (let i = 1; i < line.x.length && target < 0; i++) {
      const sx = line.x[i] - line.x[i - 1];
      const sy = line.y[i] - line.y[i - 1];
      run += Math.sqrt(sx * sx + sy * sy);
      if (run < 8) continue;
      let best = Infinity;
      const own = profile(path, line.t[i]);
      nearby(line.x[i], line.y[i], (e, d2) => {
        if (d2 >= best) return;
        const other = paths[ixPath[e]];
        const tOther = other.line.t[ixPos[e]];
        const reachOf = widthAt(other, tOther) / 2 + p.mergeGap;
        // Only a river at about this one's level: water does not climb, and one far below is across a drop.
        const theirs = profile(other, tOther);
        if (d2 >= reachOf * reachOf || theirs > own + 1 || theirs < own - 4) return;
        best = d2;
        target = ixPath[e];
        targetPos = ixPos[e];
        cutAt = i;
      });
    }
    if (target < 0 && path.end === END_REACH) {
      target = pathOf[path.terminal];
      const pl = paths[target].line;
      const tc = idxOf[path.terminal];
      const last = pl.t.length - 1;
      if (tc >= pl.t[last]) {
        targetPos = last;
      } else {
        const s = segmentAt(pl.t, tc);
        const span = pl.t[s + 1] - pl.t[s];
        targetPos = s + (span > 0 ? (tc - pl.t[s]) / span : 0);
      }
    }
    if (target >= 0) {
      const par = paths[target];
      const pos = staggerJoin(par, targetPos);
      const [jx, jy] = pointOn(par.line, pos);
      line.x.length = cutAt + 1;
      line.y.length = cutAt + 1;
      line.t.length = cutAt + 1;
      line.a.length = cutAt + 1;
      // Bend the tail over to the confluence, which is in the other river's frame.
      const ex = line.x[cutAt];
      const ey = line.y[cutAt];
      const endX = jx + n * Math.round((ex - jx) / n);
      const endY = jy + n * Math.round((ey - jy) / n);
      const dx = endX - ex;
      const dy = endY - ey;
      const reach = Math.max(10, 3 * Math.sqrt(dx * dx + dy * dy));
      const back = new Float64Array(cutAt + 1);
      for (let i = cutAt - 1; i >= 0; i--) {
        const sx = line.x[i + 1] - line.x[i];
        const sy = line.y[i + 1] - line.y[i];
        back[i] = back[i + 1] + Math.sqrt(sx * sx + sy * sy);
      }
      for (let i = 0; i < cutAt; i++) {
        const f = 1 - back[i] / reach;
        if (f <= 0) continue;
        line.x[i] += dx * f;
        line.y[i] += dy * f;
      }
      line.x[cutAt] = endX;
      line.y[cutAt] = endY;
      line.x[0] = quarter(line.x[0]);
      line.y[0] = quarter(line.y[0]);
      path.parent = target;
      path.joinPos = pos;
      path.floor = Math.max(par.floor, profile(par, pointOn(par.line, pos)[2]));
      par.joins.push(pos);
    }
    path.line = line;
    addToIndex(pid, line);
  }

  /** Sideways wander for streams too small or too steep to meander, so none runs ruler-straight. */
  function wiggle(src: Line, path: Path): Line {
    const l = resample(src, LINE_STEP);
    const count = l.x.length;
    if (count < 6 || !(p.wiggle > 0)) return l;
    const step = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      const dx = l.x[i] - l.x[i - 1];
      const dy = l.y[i] - l.y[i - 1];
      step[i] = Math.sqrt(dx * dx + dy * dy);
    }
    // Arc distance to the nearest point that must not move: an end, or a meander.
    const free = new Float64Array(count);
    for (let i = 1; i < count - 1; i++) free[i] = l.a[i] > 0 ? 0 : free[i - 1] + step[i];
    for (let i = count - 2; i > 0; i--) free[i] = Math.min(free[i], free[i + 1] + step[i + 1]);
    const KNOT = 24;
    let lamA = rng.range(p.wiggleLambda[0], p.wiggleLambda[1]);
    let lamB = rng.range(p.wiggleLambda[0], p.wiggleLambda[1]);
    let ampA = rng.range(0.7, 1.3);
    let ampB = rng.range(0.7, 1.3);
    const phase0 = rng.float() * 2 * PI;
    const phase1 = rng.float() * 2 * PI;
    let since = 0;
    let phase = 0;
    const ox = new Float64Array(count);
    const oy = new Float64Array(count);
    for (let i = 1; i < count - 1; i++) {
      since += step[i];
      if (since >= KNOT) {
        since -= KNOT;
        lamA = lamB;
        ampA = ampB;
        lamB = rng.range(p.wiggleLambda[0], p.wiggleLambda[1]);
        ampB = rng.range(0.7, 1.3);
      }
      const f = since / KNOT;
      phase += (step[i] * 2 * PI) / (lamA + (lamB - lamA) * f);
      const weight = Math.min(1, free[i] / 5);
      if (weight <= 0) continue;
      const nx = -(l.y[i + 1] - l.y[i - 1]);
      const ny = l.x[i + 1] - l.x[i - 1];
      const nl = Math.sqrt(nx * nx + ny * ny);
      if (!(nl > 0)) continue;
      const size = p.wiggle * (0.75 + 0.25 * widthAt(path, l.t[i])) * (ampA + (ampB - ampA) * f) * weight;
      const d = size * (psin(phase + phase0) + 0.25 * psin(2.3 * phase + phase1));
      ox[i] = (nx / nl) * d;
      oy[i] = (ny / nl) * d;
    }
    for (let i = 0; i < count; i++) {
      l.x[i] += ox[i];
      l.y[i] += oy[i];
    }
    return l;
  }

  /** A free place for a confluence near `pos` on a line: no two within JOIN_GAP vertices, none at either end. */
  function staggerJoin(par: Path, pos: number): number {
    const last = par.line.x.length - 1;
    const lo = last < 2 * JOIN_GAP ? last / 2 : JOIN_GAP;
    const hi = last < 2 * JOIN_GAP ? last / 2 : last - JOIN_GAP;
    const free = (c: number): boolean => {
      for (let i = 0; i < par.joins.length; i++) if (Math.abs(par.joins[i] - c) < JOIN_GAP - 1e-9) return false;
      return true;
    };
    const base = Math.max(lo, Math.min(hi, pos));
    for (let k = 0; k <= 60; k++) {
      const down = Math.max(lo, Math.min(hi, base + k * JOIN_GAP));
      if (free(down)) return down;
      const up = Math.max(lo, Math.min(hi, base - k * JOIN_GAP));
      if (free(up)) return up;
    }
    return base;
  }

  type RunOxbow = { t: number; x: number[]; y: number[]; ox: number[]; oy: number[]; width: number };
  type RunBar = { t: number; ox: number[]; oy: number[] };

  /** A meander along the smoothed axis of a stretch of line, ending where the stretch ends. */
  function meanderRun(sub: Line, path: Path, flat: Float32Array, key: number, oxbowMax: number): { line: Line; oxbows: RunOxbow[]; bars: RunBar[] } | null {
    const axis = resample(sub, 1);
    const count = axis.x.length;
    if (count < 8) return null;
    const room = new Float64Array(count).fill(Infinity);
    const specAt = (t: number, i: number): MeanderSpec => {
      const w = widthAt(path, t);
      const share = Math.max(0, Math.min(1, (w - 2) / (p.omegaFullWidth - 2)));
      // Flatness between the two nodes around t, so loops grow and die away smoothly.
      const k = Math.max(0, Math.min(flat.length - 1, Math.floor(t)));
      const k2 = Math.min(flat.length - 1, k + 1);
      const f = Math.max(0, Math.min(1, t - k));
      const strength = flat[k] + (flat[k2] - flat[k]) * f;
      // Wavelength follows the discharge itself, not the rounded width, and widens with the valley floor.
      const qa = q[path.nodes[k]];
      const fluid = Math.max(1, Math.min(6, Math.sqrt((qa + (q[path.nodes[k2]] - qa) * f) / p.qScale)));
      const base = Math.max(p.lambdaMin, p.lambdaPerWidth * fluid);
      const lambda = base * Math.max(0.7, Math.min(1.35, 0.7 + (0.6 * room[i]) / base));
      return { width: w, lambda, omega: (p.omega[0] + (p.omega[1] - p.omega[0]) * share) * strength, room: 0.9 * room[i] };
    };
    // The valley axis: the channel with bends shorter than a loop smoothed away.
    const lambda = specAt(axis.t[count >> 1], count >> 1).lambda;
    const passes = Math.min(120, Math.round((lambda * lambda) / 40));
    for (let pass = 0; pass < passes; pass++) {
      let prevX = axis.x[0];
      let prevY = axis.y[0];
      for (let i = 1; i < count - 1; i++) {
        const cx = axis.x[i];
        const cy = axis.y[i];
        axis.x[i] = 0.25 * prevX + 0.5 * cx + 0.25 * axis.x[i + 1];
        axis.y[i] = 0.25 * prevY + 0.5 * cy + 0.25 * axis.y[i + 1];
        prevX = cx;
        prevY = cy;
      }
    }
    const ua = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      const dx = axis.x[i] - axis.x[i - 1];
      const dy = axis.y[i] - axis.y[i - 1];
      ua[i] = ua[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    const U = ua[count - 1];
    const tAt = (u: number): number => {
      const s = segmentAt(ua, u);
      const span = ua[s + 1] - ua[s];
      return axis.t[s] + (axis.t[s + 1] - axis.t[s]) * (span > 0 ? Math.max(0, Math.min(1, (u - ua[s]) / span)) : 0);
    };
    // Room: how far the flat floor runs to either side of the axis before it meets a wall or water.
    const probe = (x: number, y: number, dx: number, dy: number, top: number): number => {
      for (let d = 4; d < 48; d += 4) {
        const i = wrap(Math.floor((y + dy * d) / 4), gN) * gN + wrap(Math.floor((x + dx * d) / 4), gN);
        if (isSea[i] || lakeId[i] >= 0 || hydro.ground[i] > top) return d - 2;
      }
      return 48;
    };
    const raw = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      const dx = axis.x[b] - axis.x[a];
      const dy = axis.y[b] - axis.y[a];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (!(len > 0)) continue;
      const top = routed(path, Math.min(path.nodes.length, Math.floor(axis.t[i] + 0.5))) + 3;
      raw[i] = 0.5 * (probe(axis.x[i], axis.y[i], -dy / len, dx / len, top) + probe(axis.x[i], axis.y[i], dy / len, -dx / len, top));
    }
    for (let i = 0; i < count; i++) {
      let sum = 0;
      let cnt = 0;
      for (let j = Math.max(0, i - 6); j <= Math.min(count - 1, i + 6); j++) {
        sum += raw[j];
        cnt++;
      }
      room[i] = Math.max(1, sum / cnt);
    }
    const scales = [1, 0.6, 0.35];
    for (let attempt = 0; attempt < scales.length; attempt++) {
      const made = meanderAlong(axis.x, axis.y, {
        spec: (u) => {
          const i = segmentAt(ua, u);
          return specAt(tAt(u), ua[i + 1] - u < u - ua[i] ? i + 1 : i);
        },
        wobble: p.wobble,
        skew: p.skew,
        taper: true,
        scale: scales[attempt],
        step: 0.75,
        rng: rngFor(key, "meander"),
        oxbowEvery: p.oxbowEvery,
        oxbowMax: Math.max(0, oxbowMax),
        oxbowMinWidth: p.oxbowMinWidth,
        barMinWidth: p.barMinWidth,
      });
      if (!made) return null;
      let ok = true;
      for (let i = 0; i < made.x.length && ok; i++) {
        if (made.u[i] < U - 8 && wet(made.x[i], made.y[i])) ok = false;
      }
      if (!ok || selfIntersects(made.x, made.y)) continue;
      const out: Line = { x: made.x, y: made.y, t: [], a: made.amp };
      for (let i = 0; i < made.x.length; i++) out.t.push(tAt(made.u[i]));
      out.t[0] = sub.t[0];
      out.t[out.t.length - 1] = sub.t[sub.t.length - 1];
      const oxbows: RunOxbow[] = [];
      for (let i = 0; i < made.oxbows.length; i++) {
        const ox = made.oxbows[i];
        let dry = true;
        for (let k = 0; k < ox.ox.length && dry; k++) if (wet(ox.ox[k], ox.oy[k])) dry = false;
        if (dry) oxbows.push({ t: tAt(ox.u), x: ox.x, y: ox.y, ox: ox.ox, oy: ox.oy, width: ox.width });
      }
      const bars: RunBar[] = [];
      for (let i = 0; i < made.bars.length; i++) {
        const bar = made.bars[i];
        let dry = true;
        for (let k = 0; k < bar.ox.length && dry; k++) if (wet(bar.ox[k], bar.oy[k])) dry = false;
        if (dry) bars.push({ t: tAt(bar.u), ox: bar.ox, oy: bar.oy });
      }
      return { line: out, oxbows, bars };
    }
    return null;
  }

  // --- Cut each path into reaches at its joins, trunks first.
  const outletLake = new Int32Array(nn).fill(-1);
  for (let L = lakes.length - 1; L >= 0; L--) if (lakes[L].outlet >= 0) outletLake[lakes[L].outlet] = L;

  const reaches: Reach[] = [];
  const reachPath: number[] = [];
  const reachLine: Line[] = [];
  const reachW: number[][] = [];
  const reachLevel: number[][] = [];
  const reachAmp: number[][] = [];
  for (let oi = 0; oi < pathOrder.length; oi++) {
    const pid = pathOrder[oi];
    if (dropped[pid]) continue;
    const path = paths[pid];
    const line = path.line;
    const last = line.x.length - 1;

    const cuts: number[] = [0];
    if (path.joins.length > 0) {
      const sorted = sortIndicesBy(path.joins);
      for (let i = 0; i < sorted.length; i++) {
        const pos = path.joins[sorted[i]];
        if (pos > cuts[cuts.length - 1] && pos < last) cuts.push(pos);
      }
    }

    // Where this path ends, in reach terms.
    let endsIn: Reach["endsIn"] = path.end === END_LAKE ? "lake" : "sea";
    let downstream = -1;
    let lake = path.end === END_LAKE ? lakeId[path.terminal] : -1;
    if (path.parent >= 0) {
      const par = paths[path.parent];
      let found = -1;
      for (let i = 0; i < par.cutPos.length && found < 0; i++) if (par.cutPos[i] === path.joinPos) found = i;
      if (found < 0) {
        // The trunk ends here too: both run on into whatever it runs into.
        const tail = reaches[par.cutReach[par.cutReach.length - 1]];
        endsIn = tail.endsIn;
        downstream = tail.downstream;
        lake = tail.lake;
      } else {
        endsIn = "reach";
        downstream = par.cutReach[found];
      }
    }

    for (let c = 0; c < cuts.length; c++) {
      const from = cuts[c];
      const to = c + 1 < cuts.length ? cuts[c + 1] : last;
      const piece: Line = { x: [], y: [], t: [], a: [] };
      const add = (v: [number, number, number, number]): void => {
        piece.x.push(v[0]);
        piece.y.push(v[1]);
        piece.t.push(v[2]);
        piece.a.push(v[3]);
      };
      add(pointOn(line, from));
      for (let i = Math.floor(from) + 1; i < to; i++) add([line.x[i], line.y[i], line.t[i], line.a[i]]);
      add(pointOn(line, to));
      if (c === 0) {
        piece.x[0] = line.x[0];
        piece.y[0] = line.y[0];
      }
      if (c + 1 === cuts.length) {
        piece.x[piece.x.length - 1] = line.x[last];
        piece.y[piece.y.length - 1] = line.y[last];
      }
      const fine = resample(piece, p.spacing);
      const count = fine.x.length;
      const ws: number[] = [];
      const ls: number[] = [];
      for (let i = 0; i < count; i++) {
        if (i > 0 && i < count - 1) {
          fine.x[i] = quarter(fine.x[i]);
          fine.y[i] = quarter(fine.y[i]);
        }
        ws.push(widthAt(path, fine.t[i]));
        ls.push(Math.max(path.floor, profile(path, fine.t[i])));
      }
      const id = reaches.length;
      const isLast = c + 1 === cuts.length;
      reaches.push({
        id,
        downstream: isLast ? downstream : id + 1,
        endsIn: isLast ? endsIn : "reach",
        lake: isLast ? lake : -1,
        fromLake: c === 0 ? outletLake[path.nodes[0]] : -1,
        order: 1,
        vertices: new Float32Array(0),
      });
      reachPath.push(pid);
      reachLine.push(fine);
      reachW.push(ws);
      reachLevel.push(ls);
      reachAmp.push(fine.a);
      path.cutPos.push(from);
      path.cutReach.push(id);
    }
  }

  // --- Levels and Strahler order, upstream first.
  const R = reaches.length;
  const outletReach = new Int32Array(lakes.length).fill(-1);
  for (let r = 0; r < R; r++) if (reaches[r].fromLake >= 0) outletReach[reaches[r].fromLake] = r;
  const feeds = (r: number): number => {
    const reach = reaches[r];
    if (reach.downstream >= 0) return reach.downstream;
    return reach.lake >= 0 ? outletReach[reach.lake] : -1;
  };
  const waiting = new Int32Array(R);
  for (let r = 0; r < R; r++) {
    const d = feeds(r);
    if (d >= 0) waiting[d]++;
  }
  const cap = new Float64Array(R).fill(Infinity);
  const topOrder = new Int32Array(R);
  const topCount = new Int32Array(R);
  const queue = new Int32Array(R);
  let qh = 0;
  let qt = 0;
  for (let r = 0; r < R; r++) if (waiting[r] === 0) queue[qt++] = r;
  while (qh < qt) {
    const r = queue[qh++];
    const reach = reaches[r];
    reach.order = Math.max(1, topCount[r] >= 2 ? topOrder[r] + 1 : topOrder[r]);
    const ls = reachLevel[r];
    let run = Math.min(ls[0], cap[r]);
    for (let i = 0; i < ls.length; i++) {
      if (ls[i] < run) run = ls[i];
      ls[i] = Math.fround(run);
      run = ls[i];
    }
    if (reach.downstream >= 0 && run < cap[reach.downstream]) cap[reach.downstream] = run;
    const d = feeds(r);
    if (d < 0) continue;
    if (reach.order > topOrder[d]) {
      topOrder[d] = reach.order;
      topCount[d] = 1;
    } else if (reach.order === topOrder[d]) {
      topCount[d]++;
    }
    if (--waiting[d] === 0) queue[qt++] = d;
  }

  // --- Falls, plunge pools and the packed vertices.
  const falls: Fall[] = [];
  for (let r = 0; r < R; r++) {
    const path = paths[reachPath[r]];
    const fine = reachLine[r];
    const ws = reachW[r];
    const ls = reachLevel[r];
    const count = fine.x.length;
    for (let i = 0; i + 1 < count; i++) {
      const k = Math.floor(fine.t[i + 1] - 0.5);
      if (k < 0 || k >= path.nodes.length || !fallStep[path.nodes[k]] || !(fine.t[i] < k + 0.5)) continue;
      const drop = ls[i] - ls[i + 1];
      if (drop < 1) continue;
      falls.push({ x: fine.x[i + 1], y: fine.y[i + 1], drop, reach: r });
      for (let j = i + 1; j < count && j <= i + 3; j++) ws[j] = Math.min(6, ws[j] + 1);
    }
    const v = new Float32Array(count * VERTEX);
    for (let i = 0; i < count; i++) {
      v[i * VERTEX] = fine.x[i];
      v[i * VERTEX + 1] = fine.y[i];
      v[i * VERTEX + 2] = ws[i];
      v[i * VERTEX + 3] = ls[i];
    }
    reaches[r].vertices = v;
  }

  // --- Oxbows and point bars: placed on their reach, and kept only where no river runs through them.
  /** The reach of a path that holds position t on its node chain, and the vertex there. */
  const locate = (path: Path, t: number): [number, number] | null => {
    for (let c = 0; c < path.cutReach.length; c++) {
      const fine = reachLine[path.cutReach[c]];
      if (fine.t[fine.t.length - 1] < t) continue;
      let at = 0;
      while (at + 1 < fine.t.length && fine.t[at] < t) at++;
      return [path.cutReach[c], at];
    }
    return null;
  };
  /** A closed outline, quarter-snapped; null if it crosses itself or comes within `margin` of any river's bank. */
  const outlineOf = (ox: number[], oy: number[], margin: number): Float32Array | null => {
    const v = new Float32Array(ox.length * 2);
    const cx: number[] = [];
    const cy: number[] = [];
    let clear = true;
    for (let k = 0; k < ox.length && clear; k++) {
      v[k * 2] = quarter(ox[k]);
      v[k * 2 + 1] = quarter(oy[k]);
      cx.push(v[k * 2]);
      cy.push(v[k * 2 + 1]);
      nearby(ox[k], oy[k], (e, d2) => {
        const other = paths[ixPath[e]];
        const reachOf = widthAt(other, other.line.t[ixPos[e]]) / 2 + margin;
        if (d2 < reachOf * reachOf) clear = false;
      });
    }
    if (!clear || ox.length < 4) return null;
    return polygonIsSimple(cx, cy) ? v : null;
  };
  const oxbows: Oxbow[] = [];
  for (let i = 0; i < pending.length; i++) {
    const ox = pending[i];
    const where = locate(paths[ox.path], ox.t);
    if (!where) continue;
    const outline = outlineOf(ox.ox, ox.oy, 2);
    if (!outline) continue;
    const v = new Float32Array(ox.x.length * 2);
    for (let k = 0; k < ox.x.length; k++) {
      v[k * 2] = quarter(ox.x[k]);
      v[k * 2 + 1] = quarter(ox.y[k]);
    }
    oxbows.push({ reach: where[0], width: ox.width, level: reachLevel[where[0]][where[1]], vertices: v, outline });
  }
  const bars: PointBar[] = [];
  for (let i = 0; i < pendingBars.length; i++) {
    const bar = pendingBars[i];
    const where = locate(paths[bar.path], bar.t);
    if (!where) continue;
    const outline = outlineOf(bar.ox, bar.oy, -0.2);
    if (outline) bars.push({ reach: where[0], outline });
  }

  const ground = conform(hydro, isSea, gN, reaches, reachAmp, oxbows, p);
  return { reaches, falls, oxbows, bars, ground };
}

/** Valley floors, then beds, then any pit the edits left is filled. */
function conform(hydro: HydroResult, isSea: Uint8Array, gN: number, reaches: Reach[], amps: number[][], oxbows: Oxbow[], p: RiverParams): Float64Array {
  const nn = gN * gN;
  const { lakeId, lakes } = hydro;
  const ground = new Float64Array(hydro.ground);
  const nearest = new Float32Array(nn).fill(Infinity);
  const target = new Float32Array(nn);
  const weight = new Float32Array(nn);

  /** Calls f(node, distance) for every node centre within r cells of (x, y). */
  const around = (x: number, y: number, r: number, f: (i: number, d: number) => void): void => {
    const x0 = Math.ceil((x - r - 2) / 4);
    const x1 = Math.floor((x + r - 2) / 4);
    const y0 = Math.ceil((y - r - 2) / 4);
    const y1 = Math.floor((y + r - 2) / 4);
    for (let gy = y0; gy <= y1; gy++) {
      const dy = gy * 4 + 2 - y;
      const row = wrap(gy, gN) * gN;
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx * 4 + 2 - x;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r) f(row + wrap(gx, gN), Math.sqrt(d2));
      }
    }
  };

  // Floors: each node takes the nearest wide river's level, rising gently away from it.
  for (let r = 0; r < reaches.length; r++) {
    const v = reaches[r].vertices;
    const amp = amps[r];
    for (let i = 0; i < v.length; i += VERTEX) {
      const w = v[i + 2];
      if (w < 2) continue;
      const lvl = v[i + 3];
      const reachOut = 0.75 * (2 * amp[i / VERTEX] + w) + 2;
      const inner = 0.6 * reachOut;
      around(v[i], v[i + 1], reachOut, (node, d) => {
        if (d >= nearest[node]) return;
        nearest[node] = d;
        target[node] = lvl + p.floorLift + p.floorRise * d;
        const s = d <= inner ? 0 : (d - inner) / (reachOut - inner);
        weight[node] = 1 - s * s * (3 - 2 * s);
      });
    }
  }
  for (let i = 0; i < nn; i++) {
    // A floor is flattened; a wall standing well above it is left as the valley side.
    if (weight[i] > 0 && !isSea[i] && lakeId[i] < 0 && ground[i] - target[i] <= FLOOR_MAX_CUT) ground[i] += weight[i] * (target[i] - ground[i]);
  }

  // Beds: the ground under the water is never above it.
  const cutTo = (x: number, y: number, r: number, lvl: number): void => {
    // Always the node the point stands in, so the bed is an unbroken chain of nodes.
    const own = wrap(Math.floor(y / 4), gN) * gN + wrap(Math.floor(x / 4), gN);
    if (!isSea[own] && lakeId[own] < 0 && ground[own] > lvl) ground[own] = lvl;
    around(x, y, r, (node) => {
      if (!isSea[node] && lakeId[node] < 0 && ground[node] > lvl) ground[node] = lvl;
    });
  };
  for (let r = 0; r < reaches.length; r++) {
    const v = reaches[r].vertices;
    for (let i = 0; i < v.length; i += VERTEX) cutTo(v[i], v[i + 1], v[i + 2] / 2 + 1, v[i + 3]);
  }
  for (let o = 0; o < oxbows.length; o++) {
    const v = oxbows[o].vertices;
    for (let i = 0; i < v.length; i += 2) cutTo(v[i], v[i + 1], 1.5, oxbows[o].level);
  }

  // No new pits: flood with the lakes standing at their level, and keep lake beds.
  const stand = new Float64Array(ground);
  for (let i = 0; i < nn; i++) if (lakeId[i] >= 0) stand[i] = Math.max(stand[i], lakes[lakeId[i]].level);
  const filled = priorityFlood(stand, gN, isSea, 0).filled;
  for (let i = 0; i < nn; i++) if (!isSea[i] && lakeId[i] < 0) ground[i] = filled[i];
  return ground;
}

// ---------------------------------------------------------------- raster

export interface RasterWindow {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Brush offsets for a river w px wide: a disc of diameter w. */
function brush(w: number): Int8Array {
  const out: number[] = [];
  const c = (w - 1) / 2;
  const lim = (w * w) / 4 - 0.3;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - c;
      const dy = y - c;
      if (w <= 2 || dx * dx + dy * dy <= lim) out.push(x - (w >> 1), y - (w >> 1));
    }
  }
  return new Int8Array(out);
}

/**
 * River width per cell (0 where dry) on the n × n torus, or in a window of it.
 * Each reach is an 8-connected run of cells.
 */
export function rasterizeRivers(reaches: readonly Reach[], n: number, win?: RasterWindow): Uint8Array {
  const x0 = win ? win.x0 : 0;
  const y0 = win ? win.y0 : 0;
  const w = win ? win.w : n;
  const h = win ? win.h : n;
  const mask = new Uint8Array(w * h);
  const brushes: Int8Array[] = [];
  for (let k = 0; k <= 6; k++) brushes.push(brush(Math.max(1, k)));
  const stamp = (cx: number, cy: number, width: number): void => {
    const b = brushes[width];
    for (let k = 0; k < b.length; k += 2) {
      const x = wrap(cx + b[k] - x0, n);
      const y = wrap(cy + b[k + 1] - y0, n);
      if (x < w && y < h && mask[y * w + x] < width) mask[y * w + x] = width;
    }
  };
  for (let r = 0; r < reaches.length; r++) {
    const v = reaches[r].vertices;
    for (let i = 0; i + VERTEX < v.length; i += VERTEX) {
      const ax = Math.floor(v[i]);
      const ay = Math.floor(v[i + 1]);
      const bx = Math.floor(v[i + VERTEX]);
      const by = Math.floor(v[i + VERTEX + 1]);
      const width = Math.max(1, Math.min(6, Math.round(v[i + 2])));
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      if (steps === 0) {
        stamp(ax, ay, width);
        continue;
      }
      // Stepping one cell at a time along the longer axis keeps the run 8-connected.
      for (let s = 0; s <= steps; s++) {
        stamp(ax + Math.round(((bx - ax) * s) / steps), ay + Math.round(((by - ay) * s) / steps), width);
      }
    }
  }
  return mask;
}
