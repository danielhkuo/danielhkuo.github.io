// Stamps: small records of sharp coastal features. Positions and sizes are in
// cells, so the same code cuts them into G here and into cells in the bake.
// Every stamp is a clamp (a min or a max against a shape that depends only on
// position), so applying a list twice, or to an upsampled copy of an already
// stamped surface, changes nothing.

import { hash2 } from "../core/hash.ts";
import { torusDelta, wrap } from "../core/torus.ts";

/** Cliff foot: ground within r is cut to the platform; behind it the land is capped. */
export interface CutStamp {
  kind: "cut";
  x: number;
  y: number;
  r: number;
  /** Platform height at the cliff foot (d = r), below 0. */
  level: number;
  /** Sea-bed slope: at the old shore (d = 0) the bed is fall·r deep, as the open bathymetry is there. */
  fall: number;
  /** Greatest height at the cliff top; behind it the land may rise at `slope`. */
  cap: number;
  slope: number;
  /** How far past r the cap can matter; 0 when the land never reaches it. */
  reach: number;
}

/** Sea stack: a flat-topped, steep-sided column, lobed so no two are the same round, with a ring of shoal where surf breaks. */
export interface StackStamp {
  kind: "stack";
  x: number;
  y: number;
  /** Mean radius: the footprint is about π·r² cells. */
  r: number;
  top: number;
  /** Unit axis of the lobes, and how far they push the outline in and out (0 = a disc). */
  ux: number;
  uy: number;
  lobe: number;
  /** Width of the shoal ring round the foot, in cells. */
  apron: number;
}

/**
 * Cove: an inlet cut along the stream that made it. (x, y) is its mouth on
 * the cliff line and (ax, ay) points inland. It is narrow at the mouth,
 * widest past the middle and rounded at the back, with a wandering axis and
 * ragged walls. The back holds a crescent of sand, or bare rock when `sand` is 0.
 */
export interface CoveStamp {
  kind: "cove";
  x: number;
  y: number;
  ax: number;
  ay: number;
  len: number;
  /** Greatest half-width. */
  width: number;
  /** Half-width at the mouth as a share of `width`. */
  neck: number;
  /** How far the channel runs seaward of the mouth, through the wave-cut platform. */
  tail: number;
  /** Share of the length, from the back, that is beach; 0 for a boulder cove. */
  sand: number;
  /** Water depth at the mouth. */
  depth: number;
  seed: number;
  base: number;
  rise: number;
}

/** Beach: land within `land` of the shore point is lowered to sand; the sea bed is raised to a pale shelf. */
export interface BeachStamp {
  kind: "beach";
  x: number;
  y: number;
  land: number;
  base: number;
  rise: number;
  shelf: number;
  shelfSlope: number;
}

/**
 * Estuary: a funnel of tidal water along a river's last reach. (x, y) is the
 * mouth on the shore and (ax, ay) points upstream. The half-width opens from
 * `head` at `len` upstream to `sea` at the mouth; the banks beside it are flats.
 */
export interface EstuaryStamp {
  kind: "estuary";
  x: number;
  y: number;
  ax: number;
  ay: number;
  len: number;
  head: number;
  sea: number;
  depth: number;
  seed: number;
}

/**
 * Delta: a low, lobed fan of silt built seaward from a river's mouth at (x, y) along (ax, ay).
 * Two or three distributaries leave one trunk, each where the flow splits, and curve their own
 * way to the front; a crescent bar of sand lies off each one's mouth. Nothing in it is straight:
 * the fan's own axes are warped by noise before any edge is drawn.
 */
export interface DeltaStamp {
  kind: "delta";
  x: number;
  y: number;
  ax: number;
  ay: number;
  /** Reach of the fan seaward of the mouth; its lobes run a little past it. */
  r: number;
  /** How far the fan spreads along the shore to either side, against its reach (about 1 to 1.4). */
  spread: number;
  top: number;
  /** One number per distributary: where its mouth lies across the fan, as a share of r to either side of the axis. */
  channels: readonly number[];
  /** Half-width of the largest distributary, cells. */
  channel: number;
  /** The side (the sign of v, across the fan) longshore drift carries sand to: the mouth bars lean that way. 0 for none. */
  drift: number;
  seed: number;
}

/**
 * Spit: a strand of sand that longshore drift has built out from the shore at (x, y), heading
 * along (ax, ay). It bows, tapers to a point, and its tip recurves to the side `hook` (+1 or −1,
 * the sign of v = dy·ax − dx·ay): the land's side, where the waves bend round the end.
 */
export interface SpitStamp {
  kind: "spit";
  x: number;
  y: number;
  ax: number;
  ay: number;
  hook: number;
  /** Length along the heading; the recurved tip ends about 0.4 of it to the side. */
  len: number;
  /** Half-width at the root. */
  width: number;
  top: number;
  seed: number;
}

/**
 * Cirque: an armchair hollow cut into a slope, holding a tarn. (x, y) is the middle of the lake
 * and (ax, ay) points downslope, to the open side. The lake is `len` long, widest (`width` to
 * either side) near its back under the headwall, and narrows to its outlet at the lip. Ground
 * behind and beside the lake is cut to a wall that climbs at `wall` until it meets the slope;
 * ground in front is banked to a low lip that falls away at `fall`, lowest on the axis, where
 * the water spills. Where the slope behind or beside the lake lies too low (a gully), it is
 * banked to a shoulder a little higher than the lip. Nothing rings the lake: the headwall is
 * the back and the sides only.
 */
export interface CirqueStamp {
  kind: "cirque";
  x: number;
  y: number;
  ax: number;
  ay: number;
  len: number;
  width: number;
  /** Height of the water. */
  level: number;
  depth: number;
  wall: number;
  fall: number;
  /** How far from the lake's edge the wall or the lip can matter. */
  reach: number;
  seed: number;
}

/** Ledge: a strand of shingle on a low rocky shore. Cut like a beach, but narrow, and kept apart so sand can be told from stone. */
export interface LedgeStamp extends Omit<BeachStamp, "kind"> {
  kind: "ledge";
}

/**
 * Berm: the low ridge the sea throws up at the back of a beach or a shingle strand. Ground
 * between `inner` and `outer` of (x, y) is raised to `top`, so the sand ends on a line at cell
 * size even where the land behind lies as low as the beach. Beach and ledge stamps are applied
 * after it and win where they overlap. Only the bake's cells see it: on the generator's grid it would dam every stream.
 */
export interface BermStamp {
  kind: "berm";
  x: number;
  y: number;
  inner: number;
  outer: number;
  top: number;
}

/**
 * Strand: the waterline at one shore node. Land within r of (x, y) on the seaward side of the
 * line through it (normal (nx, ny), pointing to sea) is cut to shallow water, so the shore
 * follows a smooth line at cell size and not the outline of the nodes.
 */
export interface StrandStamp {
  kind: "strand";
  x: number;
  y: number;
  nx: number;
  ny: number;
  r: number;
  /** The bed falls away from the line at this slope. */
  slope: number;
}

/**
 * Creek: a tidal channel through saltmarsh. (x, y) is its mouth on the shore and (ax, ay) points
 * inland. A winding stem `len` long with three branches, cut only into ground under `top`, so it
 * ends where the marsh does. It is narrower than a node: only the bake's cells see it.
 */
export interface CreekStamp {
  kind: "creek";
  x: number;
  y: number;
  ax: number;
  ay: number;
  len: number;
  /** Half-width at the mouth, cells. */
  width: number;
  top: number;
  seed: number;
}

/** River mouth, recorded for the river stage; it does not change heights. */
export interface MouthStamp {
  kind: "mouth";
  x: number;
  y: number;
  /** Unit vector of the flow at the mouth. */
  dx: number;
  dy: number;
  /** Drainage in cells². */
  area: number;
  form: "delta" | "estuary" | "plain";
}

export type Stamp = CutStamp | StackStamp | CoveStamp | BeachStamp | EstuaryStamp | DeltaStamp | SpitStamp | CirqueStamp | StrandStamp | LedgeStamp | BermStamp | CreekStamp | MouthStamp;

/** Past the shelf the beach's sea bed falls away this many times faster, down to the open bathymetry. */
const SHELF_DROP = 4;
/** Past its shelf a beach's bed is followed down to this depth; the open bathymetry is deeper by then. */
const DEEP = 6;
/** A stack's top is flat out to this share of its radius. */
const STACK_FLAT = 0.6;
/** Depth of the shoal ring at a stack's foot and at its outer edge. */
const SURF: readonly [number, number] = [0.25, 1.1];
/** Cove water is at least this deep. */
const COVE_MIN = 0.3;
/** A cove is widest this share of the way in. */
const COVE_BELLY = 0.55;
/** The sand's front edge bows this share of the length towards the mouth along the walls: a crescent. */
const COVE_BOW = 0.3;
/** A boulder cove's back, the last share of its length, is a rock ramp this steep. */
const COVE_ROCK: readonly [number, number] = [0.15, 0.6];
/** Tidal flats beside an estuary reach this many half-widths from its axis and climb at this slope. */
const FLATS = 1.8;
const FLATS_RISE = 0.08;
/** A delta's silt apron: its centre along the axis and its radius, in fan radii, and its depth at the rim. */
const PRODELTA: readonly [number, number, number] = [0.5, 1.2, 3.5];
/** A delta's outline closes this far round from its axis, as a pseudo-angle: 1 is square to it, so the fan tucks a little behind the shore. */
const DELTA_ARC = 1.25;
/** The trunk splits between these shares of the fan's reach. */
const DELTA_SPLIT: readonly [number, number] = [0.08, 0.24];
/** A lobe pushes the front out where a distributary reaches it: its height as a share of r, and its half-width as a pseudo-angle. */
const DELTA_LOBE: readonly [number, number] = [0.16, 0.17];
/** Backwaters: still pools between the distributaries, where a noise of this many fan radii passes the threshold. */
const DELTA_POOL: readonly [number, number] = [0.2, 0.52];
/** A mouth bar: its half-length and its gap from the front, as shares of r, and how far its horns sweep back. */
const BAR: readonly [number, number, number] = [0.15, 0.08, 0.28];
/** Sand of a bar or a spit climbs from the water at this slope, so its top is flat and its edge is not a wall. */
const SAND_RISE = 0.13;
/** A spit bows this share of its length to the hook's side, and its tip turns in that hard past HOOK_AT of the way. */
const SPIT_BOW = 0.16;
const SPIT_HOOK = 2;
const HOOK_AT = 0.6;
/** Shoal water round a spit: its width, and its depth at the sand and at its outer edge. */
const SPIT_SHOAL: readonly [number, number, number] = [6, 0.2, 1.6];
/** A cirque lake is widest this share of the way from its back, and this share of its width at the outlet. */
const CIRQUE_BELLY = 0.35;
const CIRQUE_NECK = 0.22;
/** The lake's bed drops to its full depth over this share of the width from the shore. */
const CIRQUE_SHELF = 0.6;
/** The headwall starts this far above the water, past a bench this wide; the lip stands LIP[0] above the water at the outlet and LIP[1] elsewhere, on a crest this wide. */
const CIRQUE_FOOT = 0.5;
const CIRQUE_BENCH = 2;
const LIP: readonly [number, number] = [0.15, 0.45];
const LIP_CREST = 9;
/** Behind and beside the lake the rim climbs this far over the lip within one crest's width, and holds it for another. */
const SHOULDER = 2.5;
/** Water at a strand's line and in a creek is this deep. */
const STRAND_DEPTH = 0.03;
const CREEK_DEPTH = 0.12;
/** A creek's stem wanders this share of its length to either side; a branch leaves it at about 55°. */
const CREEK_WANDER = 0.16;
const CREEK_TURN: readonly [number, number] = [0.574, 0.819];
/** A creek is never narrower than this half-width, so it does not break between cells. */
const CREEK_MIN = 0.55;

export interface StampGrid {
  /** Grid size in nodes. */
  w: number;
  h: number;
  cellsPerNode: number;
  /** World position, in cells, of the grid's north-west corner. Node (i, j) is centred at x0 + (i + 0.5)·cellsPerNode. */
  x0: number;
  y0: number;
  /** World size in cells. */
  period: number;
}

/** Smooth 1-D value noise in [−1, 1]: fixed per (seed, lane), so a shape is the same at every resolution. */
function wobble(t: number, lane: number, seed: number): number {
  const k = Math.floor(t);
  const f = t - k;
  const a = hash2(k, lane, seed) / 2147483648 - 1;
  const b = hash2(k + 1, lane, seed) / 2147483648 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Smooth 2-D value noise in [−1, 1], fixed per (seed, lane). */
function wobble2(x: number, y: number, lane: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const k = (seed ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0;
  const a = hash2(i, j, k) / 2147483648 - 1;
  const b = hash2(i + 1, j, k) / 2147483648 - 1;
  const c = hash2(i, j + 1, k) / 2147483648 - 1;
  const d = hash2(i + 1, j + 1, k) / 2147483648 - 1;
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

function smooth(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** Farthest a stamp reaches from its centre, in cells. */
export function stampReach(s: Stamp): number {
  switch (s.kind) {
    case "cut":
      return s.r + s.reach;
    case "stack":
      return s.r * (1 + 1.6 * s.lobe) + s.apron;
    case "cove":
      return Math.max(s.len, s.tail) + 2 * s.width;
    case "beach":
    case "ledge":
      return Math.max(s.land, (DEEP / s.shelfSlope + SHELF_DROP * s.shelf) / (1 + SHELF_DROP));
    case "estuary":
      return s.len + FLATS * 1.3 * s.sea;
    case "delta":
      return s.r * (PRODELTA[0] + PRODELTA[1] + 0.1) + 8;
    case "spit":
      return 1.3 * s.len + s.width + SPIT_SHOAL[0] + 2;
    case "cirque":
      return 0.5 * s.len + 1.5 * s.width + s.reach + 6;
    case "strand":
      return s.r;
    case "berm":
      return s.outer;
    case "creek":
      return 1.2 * s.len + s.width + 1;
    default:
      return 0;
  }
}

/**
 * Where a point (dx, dy from the cove's mouth) lies in the cove: `u` cells
 * inland along the axis and `q`, its distance from the wandering centre line
 * as a share of the half-width there (under 1 is inside). q is Infinity
 * beyond either end.
 */
export function coveAt(s: CoveStamp, dx: number, dy: number): { u: number; q: number } {
  const u = dx * s.ax + dy * s.ay;
  if (u < -s.tail || u > s.len) return { u, q: Infinity };
  const v = dy * s.ax - dx * s.ay;
  const t = u / s.len;
  // The axis wanders inland of the mouth; each wall is ragged on its own.
  const centre = t > 0 ? 0.4 * s.width * wobble(2.2 * t, 0, s.seed) * smooth(2 * t) : 0;
  let half: number;
  if (t < 0) half = s.width * s.neck * (1 - (0.5 * u) / s.tail);
  else if (t < COVE_BELLY) half = s.width * (s.neck + (1 - s.neck) * smooth(t / COVE_BELLY));
  else {
    const e = (t - COVE_BELLY) / (1 - COVE_BELLY);
    half = s.width * Math.sqrt(1 - e * e);
  }
  const side = v > centre ? 1 : 2;
  half *= 1 + 0.3 * wobble(4.5 * t + 3, side, s.seed);
  return { u, q: half > 0 ? Math.abs(v - centre) / half : Infinity };
}

/** True when world point (px, py) lies within `grow` half-widths of a cove's water or sand. */
export function inCove(s: CoveStamp, px: number, py: number, period: number, grow: number): boolean {
  const c = coveAt(s, torusDelta(s.x, px, period), torusDelta(s.y, py, period));
  return c.q < grow && c.u > -0.5 * s.tail;
}

/** True when a point (dx, dy from the creek's mouth) lies in its stem or in one of its branches. */
export function inCreek(s: CreekStamp, dx: number, dy: number): boolean {
  const u = dx * s.ax + dy * s.ay;
  if (u < -s.width || u > s.len) return false;
  const v = dy * s.ax - dx * s.ay;
  const centre = (w: number): number => CREEK_WANDER * s.len * wobble((3 * w) / s.len, 0, s.seed) * smooth((3 * w) / s.len);
  const t = Math.max(0, u) / s.len;
  if (Math.abs(v - centre(Math.max(0, u))) < Math.max(CREEK_MIN, s.width * (1 - 0.6 * t))) return true;
  for (let k = 0; k < 3; k++) {
    const u0 = s.len * (0.2 + 0.22 * k);
    const side = (hash2(k, 7, s.seed) & 1) === 0 ? 1 : -1;
    const len = s.len * (0.45 - 0.08 * k);
    const ru = u - u0;
    const rv = v - centre(u0);
    const bu = ru * CREEK_TURN[0] + side * rv * CREEK_TURN[1];
    if (bu <= 0 || bu >= len) continue;
    const bv = side * rv * CREEK_TURN[0] - ru * CREEK_TURN[1];
    const q = bu / len;
    if (Math.abs(bv - 0.2 * len * wobble(3 * q, k + 1, s.seed) * smooth(3 * q)) < Math.max(CREEK_MIN, 0.8 * s.width * (1 - 0.7 * q))) return true;
  }
  return false;
}

/** Where distributary i's centre line lies across a delta's fan, u cells seaward of the mouth. All of them share the trunk until each one's split. */
export function deltaChannel(s: DeltaStamp, i: number, u: number): number {
  const t = u / s.r;
  const trunk = 0.05 * s.r * wobble(2.5 * t, 0, s.seed) * smooth(t / 0.15);
  const u0 = DELTA_SPLIT[0] + (DELTA_SPLIT[1] - DELTA_SPLIT[0]) * (hash2(i, 3, s.seed) / 4294967296);
  const q = (t - u0) / (1 - u0);
  if (q <= 0) return trunk;
  // It leaves the trunk at a low angle and bends away as it goes, wandering on the way.
  return trunk + s.channels[i] * s.r * q * (0.3 + 0.7 * q) + 0.1 * s.r * wobble(3.6 * t, i + 1, s.seed) * smooth(3 * q);
}

/** A direction as a number: 0 along the axis, ±1 square to it, ±2 straight back. Atan without the arc. */
function bearing(u: number, v: number): number {
  const av = v < 0 ? -v : v;
  if (u > 0) return v / (av + u);
  const au = -u;
  if (av + au === 0) return 0;
  return (v < 0 ? -1 : 1) * (2 - av / (av + au));
}

/** What a delta's shape needs per distributary; worked out once per stamp. */
interface DeltaForm {
  of: DeltaStamp | null;
  /** Bearing at which each distributary reaches the front. */
  exit: number[];
  /** Its share of the largest one's width. */
  share: number[];
  /** Its mouth bar: centre in the fan's axes, the unit direction of the flow there, and its half-length. */
  barU: number[];
  barV: number[];
  barCu: number[];
  barCv: number[];
  barLen: number[];
}
const FORM: DeltaForm = { of: null, exit: [], share: [], barU: [], barV: [], barCu: [], barCv: [], barLen: [] };

/** Distance of the fan's front from the mouth along bearing a: an arc that closes behind the shore, lobed where the distributaries reach it. */
function deltaFront(s: DeltaStamp, f: DeltaForm, a: number): number {
  const q = (a < 0 ? -a : a) / DELTA_ARC;
  if (q >= 1) return 0;
  const q2 = q * q;
  let front = Math.sqrt(1 - q2 * q2) * (1 - (1 - 0.46 * s.spread) * q2);
  front *= 1 + 0.2 * wobble(2.3 * a + 5, 16, s.seed) + 0.08 * wobble(6.1 * a, 17, s.seed);
  for (let i = 0; i < f.exit.length; i++) {
    const z = (a - f.exit[i]) / DELTA_LOBE[1];
    if (z > -1 && z < 1) front += DELTA_LOBE[0] * (1 - z * z) * (1 - z * z);
  }
  return s.r * front;
}

function deltaForm(s: DeltaStamp): DeltaForm {
  const f = FORM;
  if (f.of === s) return f;
  f.of = s;
  const count = s.channels.length;
  f.exit.length = 0;
  const main = hash2(9, 3, s.seed) % count;
  const step = 0.02 * s.r;
  for (let i = 0; i < count; i++) {
    f.share[i] = i === main ? 1 : 0.6 + 0.25 * (hash2(i, 5, s.seed) / 4294967296);
    let u = 0.4 * s.r;
    let v = deltaChannel(s, i, u);
    while (u * u + v * v < s.r * s.r && u < 2 * s.r) {
      u += step;
      v = deltaChannel(s, i, u);
    }
    f.exit[i] = bearing(u, v);
  }
  for (let i = 0; i < count; i++) {
    const far = deltaFront(s, f, f.exit[i]) + BAR[1] * s.r + 2;
    let u = 0.4 * s.r;
    let v = deltaChannel(s, i, u);
    while (u * u + v * v < far * far && u < 2 * s.r) {
      u += step;
      v = deltaChannel(s, i, u);
    }
    const m = (deltaChannel(s, i, u + 1) - deltaChannel(s, i, u - 1)) / 2;
    const ml = Math.sqrt(1 + m * m);
    f.barU[i] = u;
    f.barV[i] = v;
    f.barCu[i] = 1 / ml;
    f.barCv[i] = m / ml;
    f.barLen[i] = BAR[0] * s.r * f.share[i] * (0.85 + 0.3 * (hash2(i, 6, s.seed) / 4294967296));
  }
  return f;
}

const DELTA_AT = { e: 0, wet: 0, bar: 0, u: 0, v: 0 };

/**
 * Where a point (dx, dy from the mouth) lies in a delta. `e` is its distance from the mouth as a
 * share of the front's (under 1 is on the fan); `wet` is 1 in a distributary and 2 in a backwater
 * pool; `bar` is the height of a mouth bar's sand there, 0 off the bars. (u, v) are the fan's own
 * warped axes. The object returned is reused by the next call.
 */
export function deltaAt(s: DeltaStamp, dx: number, dy: number): { e: number; wet: number; bar: number; u: number; v: number } {
  const o = DELTA_AT;
  const f = deltaForm(s);
  // The warp: broad away from the mouth, so the river still meets its own trunk, and a fine fray everywhere.
  const big = 0.07 * s.r * smooth(Math.sqrt(dx * dx + dy * dy) / (0.3 * s.r));
  const lam = 0.22 * s.r;
  const wx = dx + big * wobble2(dx / lam, dy / lam, 20, s.seed) + 1.2 * wobble2(dx / 5, dy / 5, 22, s.seed);
  const wy = dy + big * wobble2(dx / lam, dy / lam, 21, s.seed) + 1.2 * wobble2(dx / 5, dy / 5, 23, s.seed);
  const u = wx * s.ax + wy * s.ay;
  const v = wy * s.ax - wx * s.ay;
  o.u = u;
  o.v = v;
  o.wet = 0;
  o.bar = 0;
  const front = deltaFront(s, f, bearing(u, v));
  const d = Math.sqrt(u * u + v * v);
  o.e = front > 0 ? d / front : Infinity;
  if (o.e < 1) {
    if (u > 0) {
      const t = u / s.r;
      for (let i = 0; i < s.channels.length; i++) {
        const c = deltaChannel(s, i, u);
        const m = (deltaChannel(s, i, u + 1) - deltaChannel(s, i, u - 1)) / 2;
        const half = Math.max(0.9, s.channel * f.share[i] * (0.75 + 0.6 * t));
        if (Math.abs(v - c) < half * Math.sqrt(1 + m * m)) {
          o.wet = 1;
          return o;
        }
      }
    }
    const pool = DELTA_POOL[0] * s.r;
    if (o.e > 0.3 && o.e < 0.7 && wobble2(dx / pool, dy / pool, 24, s.seed) > DELTA_POOL[1]) o.wet = 2;
    return o;
  }
  // Mouth bars: crescents off the front, horns swept back toward the shore, the longer horn downdrift.
  for (let i = 0; i < s.channels.length; i++) {
    const du = u - f.barU[i];
    const dv = v - f.barV[i];
    const along = du * f.barCu[i] + dv * f.barCv[i];
    const across = dv * f.barCu[i] - du * f.barCv[i] - 0.3 * s.drift * f.barLen[i];
    const len = f.barLen[i] * (1 + 0.35 * s.drift * (across < 0 ? -1 : 1));
    const w = across / len;
    if (w <= -1 || w >= 1) continue;
    const thick = (1.6 + 0.02 * s.r) * (1 - w * w);
    const off = Math.abs(along + BAR[2] * len * w * w) - thick;
    if (off < 0) o.bar = Math.max(o.bar, Math.min(0.45, 0.06 + SAND_RISE * -off));
  }
  return o;
}

/** Where a spit's centre line lies to the side of its heading, u cells along it from the root. */
export function spitCentre(s: SpitStamp, u: number): number {
  const t = u / s.len;
  const k = t > HOOK_AT ? t - HOOK_AT : 0;
  return s.hook * s.len * (SPIT_BOW * t * t + SPIT_HOOK * k * k) + 0.03 * s.len * wobble(3 * t, 0, s.seed) * smooth(2 * t);
}

/** Distance of a point (dx, dy from the root) past the edge of a spit's sand, in cells: negative on the sand, Infinity beyond either end. */
export function spitAt(s: SpitStamp, dx: number, dy: number): number {
  const u = dx * s.ax + dy * s.ay;
  if (u < -0.2 * s.len || u > s.len) return Infinity;
  const v = dy * s.ax - dx * s.ay;
  const w = u > 0 ? u : 0;
  const t = w / s.len;
  const c = spitCentre(s, w);
  const m = u > 0 ? (spitCentre(s, w + 1) - spitCentre(s, w - 1)) / 2 : 0;
  // It tapers all the way, and the last of it comes to a point.
  const half = s.width * (1 - 0.78 * t) * (1 + 0.18 * wobble(4 * t + 2, v > c ? 1 : 2, s.seed)) * Math.sqrt(Math.min(1, (s.len - w) / s.width));
  return Math.abs(v - c) / Math.sqrt(1 + m * m) - half;
}

const CIRQUE_AT = { t: 0, d: 0, off: 0 };

/**
 * Where a point (dx, dy from the lake's middle) lies in a cirque. `t` runs along the lake from 0
 * at its back, under the headwall, to 1 at the outlet; `d` is the distance outside the lake's
 * edge in cells, negative in the water; `off` is the distance from the lake's centre line as a
 * share of its width. The object returned is reused by the next call.
 */
export function cirqueAt(s: CirqueStamp, dx: number, dy: number): { t: number; d: number; off: number } {
  const o = CIRQUE_AT;
  // Warped, so the shore is no curve a compass could draw.
  const wx = dx + 2.6 * wobble2(dx / 13, dy / 13, 30, s.seed) + 1.5 * wobble2(dx / 5.5, dy / 5.5, 32, s.seed);
  const wy = dy + 2.6 * wobble2(dx / 13, dy / 13, 31, s.seed) + 1.5 * wobble2(dx / 5.5, dy / 5.5, 33, s.seed);
  const u = wx * s.ax + wy * s.ay + 0.5 * s.len;
  const v = wy * s.ax - wx * s.ay;
  const t = u / s.len;
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  const centre = 0.18 * s.width * wobble(2.2 * tc, 0, s.seed);
  let half: number;
  if (tc < CIRQUE_BELLY) {
    const k = (CIRQUE_BELLY - tc) / CIRQUE_BELLY;
    half = s.width * Math.sqrt(1 - k * k);
  } else half = s.width * (1 - (1 - CIRQUE_NECK) * smooth((tc - CIRQUE_BELLY) / (1 - CIRQUE_BELLY)));
  half *= 1 + 0.2 * wobble(3 * tc + 1, v > centre ? 1 : 2, s.seed);
  const side = Math.abs(v - centre);
  const lat = side - half;
  o.t = t;
  o.off = side / s.width;
  if (t < 0) o.d = Math.sqrt(u * u + (lat > 0 ? lat * lat : 0));
  else if (t > 1) o.d = Math.sqrt((u - s.len) * (u - s.len) + (lat > 0 ? lat * lat : 0));
  else o.d = lat;
  return o;
}

/** New height of ground at height h, offset (dx, dy) cells from the stamp. */
export function stamped(s: Stamp, h: number, dx: number, dy: number): number {
  switch (s.kind) {
    case "cut": {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= s.r) return Math.min(h, (s.level * d) / s.r - s.fall * (s.r - d));
      if (s.reach > 0) return Math.min(h, s.cap + s.slope * (d - s.r));
      return h;
    }
    case "stack": {
      const d = Math.sqrt(dx * dx + dy * dy);
      const c = d > 0 ? (dx * s.ux + dy * s.uy) / d : 0;
      const r = s.r * (1 + s.lobe * c + 0.6 * s.lobe * (2 * c * c - 1));
      if (d >= r) {
        if (h > 0 || d >= r + s.apron) return h;
        return Math.max(h, -(SURF[0] + ((SURF[1] - SURF[0]) * (d - r)) / s.apron));
      }
      const q = d / r;
      if (q <= STACK_FLAT) return Math.max(h, s.top);
      const t = (q - STACK_FLAT) / (1 - STACK_FLAT);
      // The side falls to just above the water, so the foot is a wall and not a beach.
      return Math.max(h, s.top * (1 - 0.8 * t * t));
    }
    case "cove": {
      const { u, q } = coveAt(s, dx, dy);
      if (q >= 1) return h;
      if (s.sand > 0) {
        const front = s.len * (1 - s.sand) - COVE_BOW * s.len * q * q;
        if (u > front) return h > 0 ? Math.min(h, s.base + s.rise * (u - front)) : h;
        return Math.min(h, -(COVE_MIN + (s.depth - COVE_MIN) * (1 - Math.max(0, u) / Math.max(front, 1e-9))));
      }
      const front = s.len * (1 - COVE_ROCK[0]);
      if (u > front) return h > 0 ? Math.min(h, 0.4 + COVE_ROCK[1] * (u - front)) : h;
      return Math.min(h, -(COVE_MIN + (s.depth - COVE_MIN) * (1 - Math.max(0, u) / front)));
    }
    case "beach":
    case "ledge": {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (h > 0) return d <= s.land ? Math.min(h, s.base + s.rise * d) : h;
      return Math.max(h, -s.shelfSlope * (d + SHELF_DROP * Math.max(0, d - s.shelf)));
    }
    case "estuary": {
      const u = dx * s.ax + dy * s.ay;
      if (u > s.len || u < -s.sea) return h;
      const t = Math.max(0, u) / s.len;
      const v = dy * s.ax - dx * s.ay;
      const open = (1 - t) * Math.sqrt(1 - t);
      const half = (s.head + (s.sea - s.head) * open) * (1 + 0.25 * wobble(5 * t, v > 0 ? 1 : 2, s.seed));
      const off = Math.abs(v - 0.5 * s.head * wobble(3 * t, 0, s.seed) * smooth(3 * t));
      if (off < half) return Math.min(h, -(COVE_MIN + s.depth * (1 - t)));
      if (h > 0 && off < FLATS * half) return Math.min(h, 0.3 + FLATS_RISE * (off - half));
      return h;
    }
    case "delta": {
      const at = deltaAt(s, dx, dy);
      if (at.e < 1) {
        if (at.wet === 1) return Math.min(h, -COVE_MIN);
        // A backwater is cut only into the fan's own silt, never into the land the fan lies against.
        if (at.wet === 2) return h < s.top + 0.3 ? Math.min(h, -0.12) : h;
        return Math.max(h, s.top * (1 - at.e * at.e) + 0.05);
      }
      if (at.bar > 0) return Math.max(h, at.bar);
      // The prodelta: silt shoals the sea round the fan.
      if (h > 0) return h;
      const mu = at.u - PRODELTA[0] * s.r;
      const dc = Math.sqrt(mu * mu + at.v * at.v);
      if (dc >= PRODELTA[1] * s.r) return h;
      return Math.max(h, -(COVE_MIN + PRODELTA[2] * smooth((dc - 0.45 * s.r) / ((PRODELTA[1] - 0.45) * s.r))));
    }
    case "spit": {
      const d = spitAt(s, dx, dy);
      if (d >= SPIT_SHOAL[0]) return h;
      if (d < 0) return Math.max(h, Math.min(s.top, 0.06 + SAND_RISE * -d));
      return h > 0 ? h : Math.max(h, -(SPIT_SHOAL[1] + ((SPIT_SHOAL[2] - SPIT_SHOAL[1]) * d) / SPIT_SHOAL[0]));
    }
    case "cirque": {
      const at = cirqueAt(s, dx, dy);
      if (at.d >= s.reach) return h;
      const t = at.t < 0 ? 0 : at.t > 1 ? 1 : at.t;
      if (at.d < 0) {
        // The bed shelves from the shore and is deepest at the back, under the headwall.
        const k = Math.min(1, -at.d / (CIRQUE_SHELF * s.width));
        return s.level - 0.15 - s.depth * k * (2 - k) * (1 - 0.4 * t);
      }
      const outlet = smooth((at.t - 0.5) / 0.4) * (1 - smooth(at.off / 0.8));
      // Behind and beside the water the rim is a shoulder: where a gully has notched the slope, the hollow still holds.
      const back = 1 - smooth((at.t - 0.45) / 0.3);
      const lip = s.level + LIP[1] - (LIP[1] - LIP[0]) * outlet + SHOULDER * back * Math.min(1, at.d / LIP_CREST) - s.fall * Math.max(0, at.d - LIP_CREST * (1 + back));
      const wall = s.level + CIRQUE_FOOT + s.wall * Math.max(0, at.d - CIRQUE_BENCH) + 0.04 * at.d;
      const banked = h > lip ? h : lip;
      return banked < wall ? banked : wall;
    }
    case "strand": {
      if (h <= 0 || dx * dx + dy * dy > s.r * s.r) return h;
      const u = dx * s.nx + dy * s.ny;
      return u > 0 ? -(STRAND_DEPTH + s.slope * u) : h;
    }
    case "berm": {
      if (h <= 0 || h >= s.top) return h;
      const d2 = dx * dx + dy * dy;
      return d2 > s.inner * s.inner && d2 <= s.outer * s.outer ? s.top : h;
    }
    case "creek":
      return h > 0 && h < s.top && inCreek(s, dx, dy) ? -CREEK_DEPTH : h;
    default:
      return h;
  }
}

/** Kinds are applied in this order whatever the order of the list. */
const ORDER: readonly Stamp["kind"][] = ["cirque", "strand", "cut", "estuary", "cove", "berm", "ledge", "beach", "delta", "spit", "creek", "stack"];

function applyOne(h: Float64Array | Float32Array, g: StampGrid, s: Stamp, sx: number, sy: number, wrapX: boolean, wrapY: boolean): void {
  const c = g.cellsPerNode;
  const reach = stampReach(s);
  // Node i is centred at (i + 0.5)·c in grid-local cells.
  let i0 = Math.ceil((sx - reach) / c - 0.5);
  let i1 = Math.floor((sx + reach) / c - 0.5);
  let j0 = Math.ceil((sy - reach) / c - 0.5);
  let j1 = Math.floor((sy + reach) / c - 0.5);
  if (!wrapX) {
    i0 = Math.max(i0, 0);
    i1 = Math.min(i1, g.w - 1);
  }
  if (!wrapY) {
    j0 = Math.max(j0, 0);
    j1 = Math.min(j1, g.h - 1);
  }
  const reach2 = reach * reach;
  for (let j = j0; j <= j1; j++) {
    const dy = (j + 0.5) * c - sy;
    const row = (wrapY ? wrap(j, g.h) : j) * g.w;
    for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * c - sx;
      if (dx * dx + dy * dy > reach2) continue;
      const k = row + (wrapX ? wrap(i, g.w) : i);
      h[k] = stamped(s, h[k], dx, dy);
    }
  }
}

/** Applies stamps to any window of the world: a whole torus grid or a crop of it. */
export function applyStampsTo(h: Float64Array | Float32Array, g: StampGrid, stamps: readonly Stamp[]): void {
  const spanX = g.w * g.cellsPerNode;
  const spanY = g.h * g.cellsPerNode;
  const wrapX = spanX === g.period;
  const wrapY = spanY === g.period;
  for (const kind of ORDER) {
    // Creeks and berms are narrower than a node: a coarse grid would only catch them here and there.
    if ((kind === "creek" || kind === "berm") && g.cellsPerNode > 1) continue;
    for (const s of stamps) {
      if (s.kind !== kind) continue;
      const reach = stampReach(s);
      // The stamp's image nearest the grid, then its neighbours one world away.
      const sx = wrap(s.x - g.x0, g.period);
      const sy = wrap(s.y - g.y0, g.period);
      if (wrapX && wrapY) {
        applyOne(h, g, s, sx, sy, true, true);
        continue;
      }
      for (let ky = -1; ky <= 0; ky++) {
        const py = wrapY ? sy : sy + ky * g.period;
        if (!wrapY && (py + reach < 0 || py - reach > spanY)) continue;
        for (let kx = -1; kx <= 0; kx++) {
          const px = wrapX ? sx : sx + kx * g.period;
          if (!wrapX && (px + reach < 0 || px - reach > spanX)) continue;
          applyOne(h, g, s, px, py, wrapX, wrapY);
          if (wrapX) break;
        }
        if (wrapY) break;
      }
    }
  }
}

/** Applies stamps to a whole n × n torus grid of `cellsPerNode` cells a node. */
export function applyStamps(h: Float64Array | Float32Array, n: number, cellsPerNode: number, stamps: readonly Stamp[]): void {
  applyStampsTo(h, { w: n, h: n, cellsPerNode, x0: 0, y0: 0, period: n * cellsPerNode }, stamps);
}
