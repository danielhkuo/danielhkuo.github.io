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
  /** Share by which each loop's amplitude and length vary. */
  wobble: number;
  /** One loop in this many is cut off and left as an oxbow pond … */
  oxbowEvery: number;
  /** … on rivers at least this wide. */
  oxbowMinWidth: number;
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
  width: number;
  level: number;
  /** x, y per vertex, in the reach's unwrapped frame. */
  vertices: Float32Array;
}

export interface RiversResult {
  reaches: Reach[];
  falls: Fall[];
  oxbows: Oxbow[];
  /** hydro.ground with valley floors flattened and beds cut; no land node is a pit. */
  ground: Float64Array;
}

const VERTEX = 4;
const MAX_OMEGA = 1.5;
/** tan² 60°: a step faces south when dy > 0 and dx² ≤ 3·dy². */
const SOUTH_TAN2 = 3;
const TRUNK_WINDOW = 16;

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
}

export interface MeanderOptions {
  /** ω, λ and river width at valley distance u. */
  spec: (u: number) => MeanderSpec;
  /** Share by which loops vary; 0 gives the pure sine-generated curve. */
  wobble: number;
  /** Grow from and return to the axis, so the ends join what is up- and downstream. */
  taper: boolean;
  /** Multiplies every amplitude. */
  scale: number;
  /** Step along the river, in cells. */
  step: number;
  rng: Rng | null;
  /** 0 for no oxbows. */
  oxbowEvery: number;
  oxbowMinWidth: number;
}

export interface Meander {
  x: number[];
  y: number[];
  /** Valley distance of each point. */
  u: number[];
  /** Loop amplitude around each point. */
  amp: number[];
  oxbows: { x: number[]; y: number[]; u: number; width: number }[];
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

/**
 * A sine-generated curve laid along a valley axis: the heading is the axis
 * direction turned by ±ω·cos φ, with φ running half a turn per loop. Loops are
 * planned by amplitude so the river crosses the axis every half wave and
 * cannot drift off it. Null when the axis is too short for a loop.
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
  const at: number[] = [0];
  const first = o.spec(0);
  amp.push((first.lambda * meanderMeans(first.omega)[0] * (1 + o.wobble * rnd())) / 4);
  wid.push(first.width);
  let ue = 0;
  while (ue < U && len.length < 4096) {
    const sp = o.spec(ue);
    const [sm, cm] = meanderMeans(sp.omega);
    const l = 0.5 * sp.lambda * (1 + 0.6 * o.wobble * rnd());
    len.push(l);
    ue += l * cm;
    amp.push((sp.lambda * sm * (1 + o.wobble * rnd())) / 4);
    wid.push(sp.width);
    at.push(ue);
  }
  const K = len.length;
  if (K < (o.taper ? 3 : 1)) return null;

  const cut: { j: number; full: number }[] = [];
  for (let j = 0; j <= K; j++) {
    let a = amp[j] * o.scale;
    if (o.taper) a *= Math.min(1, j / 2, (K - j) / 2);
    // Keep each loop inside the bend of the axis so the offset curve cannot fold.
    const uj = (at[j] * U) / ue;
    const half = len[Math.min(j, K - 1)];
    let kmax = 0;
    for (let i = segmentAt(ua, uj - half); i < m && ua[i] <= uj + half; i++) if (kappa[i] > kmax) kmax = kappa[i];
    if (kmax > 0) a = Math.min(a, 0.5 / kmax);
    if (rng && o.oxbowEvery > 0 && o.taper && j >= 2 && j <= K - 2 && wid[j] >= o.oxbowMinWidth && rng.int(o.oxbowEvery) === 0) {
      cut.push({ j, full: a });
      a *= 0.35;
    }
    amp[j] = a;
  }

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
      const a = sg * om[k] * pcos(-PI / 2 + (PI * (i + 0.5)) / steps);
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

  const out: Meander = { x: [], y: [], u: [], amp: pa, oxbows: [] };
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

  // The cut-off loop: a horseshoe standing outside the shortened bend.
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
    const r = Math.max(3.5, 0.6 * cut[c].full * fit);
    const vc = pv[i] + side * (r / 2 + w / 2 + 2);
    const n = Math.max(8, Math.ceil(4.2 * r));
    const ox: number[] = [];
    const oy: number[] = [];
    for (let k = 0; k <= n; k++) {
      const alpha = (-2 * PI) / 3 + (4 * PI * k) / (3 * n);
      const du = r * psin(alpha);
      const dv = vc + side * r * pcos(alpha);
      ox.push(cx + du * txs - dv * tys);
      oy.push(cy + du * tys + dv * txs);
    }
    out.oxbows.push({ x: ox, y: oy, u: uu, width: w });
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
    paths.push({ nodes, terminal, end, px, py, line: { x: [], y: [], t: [], a: [] }, parent: -1, joinPos: 0, joins: [], cutPos: [], cutReach: [] });
  }

  // Trunks before their tributaries: a parent always carries more water at its foot.
  const footQ = new Float64Array(paths.length);
  for (let i = 0; i < paths.length; i++) footQ[i] = -q[paths[i].nodes[paths[i].nodes.length - 1]];
  const pathOrder = sortIndicesBy(footQ);

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

  const pending: { path: number; t: number; x: number[]; y: number[]; width: number }[] = [];

  // --- Geometry, trunks first.
  for (let oi = 0; oi < pathOrder.length; oi++) {
    const pid = pathOrder[oi];
    const path = paths[pid];
    const m = path.nodes.length;
    const rx = Array.from(path.px);
    const ry = Array.from(path.py);

    // A tributary ends on its trunk's finished line, not on the node.
    let parent: Path | null = null;
    let shiftX = 0;
    let shiftY = 0;
    let joinPos = 0;
    if (path.end === END_REACH) {
      const parentId = pathOf[path.terminal];
      parent = paths[parentId];
      path.parent = parentId;
      const pl = parent.line;
      const tc = idxOf[path.terminal];
      const last = pl.t.length - 1;
      if (tc >= pl.t[last]) {
        joinPos = last;
      } else {
        const s = segmentAt(pl.t, tc);
        const span = pl.t[s + 1] - pl.t[s];
        joinPos = s + (span > 0 ? (tc - pl.t[s]) / span : 0);
      }
      joinPos = snapJoin(parent, joinPos);
      const [jx, jy] = pointOn(pl, joinPos);
      shiftX = n * Math.round((rx[m] - jx) / n);
      shiftY = n * Math.round((ry[m] - jy) / n);
      const dx = jx + shiftX - rx[m];
      const dy = jy + shiftY - ry[m];
      const reach = Math.max(12, 3 * Math.sqrt(dx * dx + dy * dy));
      let back = 0;
      for (let k = m; k >= 0; k--) {
        if (k < m) {
          const sx = path.px[k + 1] - path.px[k];
          const sy = path.py[k + 1] - path.py[k];
          back += Math.sqrt(sx * sx + sy * sy);
        }
        const f = 1 - back / reach;
        if (f <= 0) break;
        rx[k] += dx * f;
        ry[k] += dy * f;
      }
    }

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
        const made = tEnd > k0 ? meanderRun(sub, path, flat, key) : null;
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

    // Join the trunk where the tributary first meets it.
    if (parent) {
      line = resample(line, 1.5);
      const pl = parent.line;
      const tc = idxOf[path.terminal];
      let ia = segmentAt(pl.t, tc - TRUNK_WINDOW);
      let ib = Math.min(pl.t.length - 1, segmentAt(pl.t, tc + TRUNK_WINDOW) + 1);
      if (pl.t[ia] > tc - TRUNK_WINDOW) ia = 0;
      if (ib < ia + 1) ib = ia + 1;
      let s0 = 0;
      const lastT = line.t[line.t.length - 1];
      while (s0 + 2 < line.t.length && line.t[s0 + 1] < lastT - TRUNK_WINDOW) s0++;
      let hitSeg = -1;
      let hitA = 0;
      let hitPos = 0;
      for (let s = s0; s + 1 < line.x.length && hitSeg < 0; s++) {
        const a0x = line.x[s] - shiftX;
        const a0y = line.y[s] - shiftY;
        const a1x = line.x[s + 1] - shiftX;
        const a1y = line.y[s + 1] - shiftY;
        for (let r = ia; r < ib; r++) {
          const hit = segmentHit(a0x, a0y, a1x, a1y, pl.x[r], pl.y[r], pl.x[r + 1], pl.y[r + 1]);
          if (hit && (hitSeg < 0 || hit[0] < hitA)) {
            hitSeg = s;
            hitA = hit[0];
            hitPos = r + hit[1];
          }
        }
        if (hitSeg >= 0 || s + 2 >= line.x.length) continue;
        // Or runs so close beside it that the two would touch: join at the nearest point.
        let near = Infinity;
        let nearPos = 0;
        for (let r = ia; r < ib; r++) {
          const sx = pl.x[r + 1] - pl.x[r];
          const sy = pl.y[r + 1] - pl.y[r];
          const len2 = sx * sx + sy * sy;
          const f = len2 > 0 ? Math.max(0, Math.min(1, ((a1x - pl.x[r]) * sx + (a1y - pl.y[r]) * sy) / len2)) : 0;
          const dx = a1x - pl.x[r] - sx * f;
          const dy = a1y - pl.y[r] - sy * f;
          const reachOf = widthAt(parent, pl.t[r]) / 2 + 3;
          const d2 = dx * dx + dy * dy;
          if (d2 < reachOf * reachOf && d2 < near) {
            near = d2;
            nearPos = r + f;
          }
        }
        if (near < Infinity) {
          hitSeg = s;
          hitA = 1;
          hitPos = nearPos;
        }
      }
      if (hitSeg >= 0) {
        joinPos = snapJoin(parent, hitPos);
        const tHit = line.t[hitSeg] + (line.t[hitSeg + 1] - line.t[hitSeg]) * hitA;
        line.x.length = hitSeg + 1;
        line.y.length = hitSeg + 1;
        line.t.length = hitSeg + 1;
        line.a.length = hitSeg + 1;
        line.x.push(0);
        line.y.push(0);
        line.t.push(tHit);
        line.a.push(0);
      }
      const [jx, jy] = pointOn(pl, joinPos);
      const e = line.x.length - 1;
      line.x[e] = jx + shiftX;
      line.y[e] = jy + shiftY;
      path.joinPos = joinPos;
      parent.joins.push(joinPos);
    }
    path.line = line;
  }

  /** Tributaries that meet a trunk within a cell of each other share one confluence. */
  function snapJoin(parent: Path, pos: number): number {
    for (let i = 0; i < parent.joins.length; i++) if (Math.abs(parent.joins[i] - pos) < 0.75) return parent.joins[i];
    return pos;
  }

  /** A meander along the smoothed axis of a stretch of line, ending where the stretch ends. */
  function meanderRun(sub: Line, path: Path, flat: Float32Array, key: number): { line: Line; oxbows: { t: number; x: number[]; y: number[]; width: number }[] } | null {
    const axis = resample(sub, 1);
    const count = axis.x.length;
    if (count < 8) return null;
    const specAt = (t: number): MeanderSpec => {
      const w = widthAt(path, t);
      const share = Math.max(0, Math.min(1, (w - 2) / (p.omegaFullWidth - 2)));
      // Flatness between the two nodes around t, so loops grow and die away smoothly.
      const k = Math.max(0, Math.min(flat.length - 1, Math.floor(t)));
      const k2 = Math.min(flat.length - 1, k + 1);
      const strength = flat[k] + (flat[k2] - flat[k]) * Math.max(0, Math.min(1, t - k));
      return { width: w, lambda: Math.max(p.lambdaMin, p.lambdaPerWidth * w), omega: (p.omega[0] + (p.omega[1] - p.omega[0]) * share) * strength };
    };
    // The valley axis: the channel with bends shorter than a loop smoothed away.
    const lambda = specAt(axis.t[count >> 1]).lambda;
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
    const scales = [1, 0.6, 0.35];
    for (let attempt = 0; attempt < scales.length; attempt++) {
      const made = meanderAlong(axis.x, axis.y, {
        spec: (u) => specAt(tAt(u)),
        wobble: p.wobble,
        taper: true,
        scale: scales[attempt],
        step: 0.75,
        rng: rngFor(key, "meander"),
        oxbowEvery: p.oxbowEvery,
        oxbowMinWidth: p.oxbowMinWidth,
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
      const oxbows: { t: number; x: number[]; y: number[]; width: number }[] = [];
      for (let i = 0; i < made.oxbows.length; i++) {
        const ox = made.oxbows[i];
        let dry = true;
        for (let k = 0; k < ox.x.length && dry; k++) if (wet(ox.x[k], ox.y[k])) dry = false;
        if (dry) oxbows.push({ t: tAt(ox.u), x: ox.x, y: ox.y, width: ox.width });
      }
      return { line: out, oxbows };
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
        ls.push(profile(path, fine.t[i]));
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

  // --- Oxbow ponds take the level of the river beside them.
  const oxbows: Oxbow[] = [];
  for (let i = 0; i < pending.length; i++) {
    const ox = pending[i];
    const path = paths[ox.path];
    let r = -1;
    let at = 0;
    for (let c = 0; c < path.cutReach.length && r < 0; c++) {
      const fine = reachLine[path.cutReach[c]];
      if (fine.t[fine.t.length - 1] < ox.t) continue;
      r = path.cutReach[c];
      while (at + 1 < fine.t.length && fine.t[at] < ox.t) at++;
    }
    if (r < 0) continue;
    const v = new Float32Array(ox.x.length * 2);
    for (let k = 0; k < ox.x.length; k++) {
      v[k * 2] = quarter(ox.x[k]);
      v[k * 2 + 1] = quarter(ox.y[k]);
    }
    oxbows.push({ reach: r, width: Math.max(1, ox.width - 1), level: reachLevel[r][at], vertices: v });
  }

  const ground = conform(hydro, isSea, gN, reaches, reachAmp, oxbows, p);
  return { reaches, falls, oxbows, ground };
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
    if (weight[i] > 0 && !isSea[i] && lakeId[i] < 0) ground[i] += weight[i] * (target[i] - ground[i]);
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
