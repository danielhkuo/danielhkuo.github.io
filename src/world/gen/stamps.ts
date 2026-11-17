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
 * Delta: a low fan of sand built seaward from a river's mouth at (x, y) along
 * (ax, ay), split by distributaries. Each channel is the line v = k·u in the
 * fan's own axes.
 */
export interface DeltaStamp {
  kind: "delta";
  x: number;
  y: number;
  ax: number;
  ay: number;
  r: number;
  /** Half-spread as a slope: the fan covers |v| ≤ spread·u. */
  spread: number;
  top: number;
  channels: readonly number[];
  /** Half-width of a distributary, cells. */
  channel: number;
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

export type Stamp = CutStamp | StackStamp | CoveStamp | BeachStamp | EstuaryStamp | DeltaStamp | MouthStamp;

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
      return Math.max(s.land, (DEEP / s.shelfSlope + SHELF_DROP * s.shelf) / (1 + SHELF_DROP));
    case "estuary":
      return s.len + FLATS * 1.3 * s.sea;
    case "delta":
      return s.r * (PRODELTA[0] + PRODELTA[1]);
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

/** New height of ground at height h, offset (dx, dy) cells from the stamp. */
function stamped(s: Stamp, h: number, dx: number, dy: number): number {
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
    case "beach": {
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
      const u = dx * s.ax + dy * s.ay;
      const v = dy * s.ax - dx * s.ay;
      if (u > 0 && Math.abs(v) <= s.spread * u) {
        const k = v / u;
        const d = Math.sqrt(dx * dx + dy * dy);
        // A lobed front, and distributaries that wander and widen a little towards the sea.
        const r = s.r * (1 + 0.3 * wobble(2.5 * k + 9, 0, s.seed));
        if (d < r) {
          for (let i = 0; i < s.channels.length; i++) {
            const c = s.channels[i];
            const line = c * u + 0.1 * u * wobble((6 * u) / s.r, i + 1, s.seed);
            if (Math.abs(v - line) < s.channel * (1 + u / s.r) * Math.sqrt(1 + c * c)) return Math.min(h, -COVE_MIN);
          }
          const e = d / r;
          return Math.max(h, s.top * (1 - e * e) + 0.05);
        }
      }
      // The prodelta: silt shoals the sea round the fan.
      if (h > 0) return h;
      const mx = dx - PRODELTA[0] * s.r * s.ax;
      const my = dy - PRODELTA[0] * s.r * s.ay;
      const dc = Math.sqrt(mx * mx + my * my);
      if (dc >= PRODELTA[1] * s.r) return h;
      return Math.max(h, -(COVE_MIN + PRODELTA[2] * smooth((dc - 0.45 * s.r) / ((PRODELTA[1] - 0.45) * s.r))));
    }
    default:
      return h;
  }
}

/** Kinds are applied in this order whatever the order of the list. */
const ORDER: readonly Stamp["kind"][] = ["cut", "estuary", "cove", "beach", "delta", "stack"];

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
