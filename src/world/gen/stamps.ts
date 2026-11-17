// Stamps: small records of sharp coastal features. Positions and sizes are in
// cells, so the same code cuts them into G here and into cells in the bake.
// Every stamp is a clamp (a min or a max against a shape), so applying a list
// twice, or to an upsampled copy of an already stamped surface, changes nothing.

import { wrap } from "../core/torus.ts";

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

/** Sea stack: a flat-topped, steep-sided column of radius r. */
export interface StackStamp {
  kind: "stack";
  x: number;
  y: number;
  r: number;
  top: number;
}

/** Pocket beach: shallow water within `water` of the centre, sand rising from there to r. */
export interface CoveStamp {
  kind: "cove";
  x: number;
  y: number;
  r: number;
  water: number;
  base: number;
  rise: number;
  shelfSlope: number;
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

export type Stamp = CutStamp | StackStamp | CoveStamp | BeachStamp | MouthStamp;

/** Past the shelf the beach's sea bed falls away this many times faster, down to the open bathymetry. */
const SHELF_DROP = 8;
/** The deepest the sea bed goes; a beach's bed stops mattering there. */
const DEEP = 24;
/** A stack's top is flat out to this share of its radius. */
const STACK_FLAT = 0.6;
/** Cove water is at least this deep. */
const COVE_MIN = 0.3;

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

/** Farthest a stamp reaches from its centre, in cells. */
export function stampReach(s: Stamp): number {
  switch (s.kind) {
    case "cut":
      return s.r + s.reach;
    case "stack":
      return s.r;
    case "cove":
      return s.r;
    case "beach":
      return Math.max(s.land, (DEEP / s.shelfSlope + SHELF_DROP * s.shelf) / (1 + SHELF_DROP));
    default:
      return 0;
  }
}

/** New height of ground at height h, a distance d (cells) from the stamp. */
function stamped(s: Stamp, h: number, d: number): number {
  switch (s.kind) {
    case "cut": {
      if (d <= s.r) return Math.min(h, (s.level * d) / s.r - s.fall * (s.r - d));
      if (s.reach > 0) return Math.min(h, s.cap + s.slope * (d - s.r));
      return h;
    }
    case "stack": {
      if (d >= s.r) return h;
      const q = d / s.r;
      if (q <= STACK_FLAT) return Math.max(h, s.top);
      const t = (q - STACK_FLAT) / (1 - STACK_FLAT);
      return Math.max(h, s.top * (1 - t * t));
    }
    case "cove": {
      if (d >= s.r) return h;
      if (d <= s.water) return Math.min(h, -COVE_MIN - s.shelfSlope * (s.water - d));
      return h > 0 ? Math.min(h, s.base + s.rise * (d - s.water)) : h;
    }
    case "beach": {
      if (h > 0) return d <= s.land ? Math.min(h, s.base + s.rise * d) : h;
      const bed = -s.shelfSlope * (d + SHELF_DROP * Math.max(0, d - s.shelf));
      return Math.max(h, bed);
    }
    default:
      return h;
  }
}

/** Kinds are applied in this order whatever the order of the list: cuts, coves, beaches, then stacks. */
const ORDER: readonly Stamp["kind"][] = ["cut", "cove", "beach", "stack"];

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
      const d2 = dx * dx + dy * dy;
      if (d2 > reach2) continue;
      const k = row + (wrapX ? wrap(i, g.w) : i);
      h[k] = stamped(s, h[k], Math.sqrt(d2));
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
