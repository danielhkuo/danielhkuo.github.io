// What people built, in the form the bake reads: structures (small rasters of
// heights and materials on an absolute base), conforms (pads, terraces and the
// harbour, applied to the ground at cell size) and roads (polylines).
//
// All positions are in cells. Everything here is a pure function of the cell,
// so any bake window agrees with any other.

import { wrap } from "../core/torus.ts";

/** A building, wall, quay or other made thing. */
export interface Structure {
  /** North-west corner cell and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The height its tops are measured from: the pad it stands on. */
  base: number;
  /** Per cell: height of the top above `base`; 0 where nothing stands. */
  top: Float32Array;
  /** Per cell: material of what stands there. */
  mat: Uint8Array;
  /** Per cell: the light byte (128 is flat ground) the builder fixed, or 0 to shade it like the land. */
  tone: Uint8Array;
  /** Per cell: a material painted on the ground where nothing stands (yards, streets); 0 leaves the cover. */
  paint: Uint8Array;
  /**
   * Marks on faces, five numbers each: dx, dy (the cell whose south face carries it), z (height above `base`),
   * material, light byte. Drawn in bake-pixel space: windows, doors, arches, clock faces, cross arms, sails.
   */
  marks: number[];
}

/** A change to the ground, applied to G here and at cell size in the bake. */
export interface Conform {
  /**
   * flat: a pad levelled to `level`, moving the ground by at most `limit`, with a smoothstep skirt.
   * terrace: heights inside are stepped every `step` units (street terraces).
   * dredge: ground inside is cut down to `level` (a harbour basin; below sea level).
   * raise: ground inside is built up to `level` (a quay or causeway head), never cut.
   */
  kind: "flat" | "terrace" | "dredge" | "raise";
  /** Centre and half-sizes, cells. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** An ellipse, else a rectangle. */
  round: boolean;
  level: number;
  /** Cells over which the change fades out beyond the half-sizes. */
  skirt: number;
  /** flat: the most the ground moves. terrace: the step. */
  limit: number;
}

/** A road or path: x, y pairs in cells, unwrapped, at most ROAD_PIECE cells apart. */
export interface RoadLine {
  /** 2 a road, 1 a path or farm track. */
  width: number;
  vertices: number[];
}

/** Road vertices are at most this far apart, so the bake can bucket them like rivers. */
export const ROAD_PIECE = 6;

export interface Built {
  structures: Structure[];
  conforms: Conform[];
  roads: RoadLine[];
  /** Materials the bake paints: path and road cells, the retaining wall of a street terrace, and the grass of a cleared pad. */
  mats: { path: number; road: number; retaining: number; yard: number; vine: number };
}

export function emptyBuilt(): Built {
  return { structures: [], conforms: [], roads: [], mats: { path: 0, road: 0, retaining: 0, yard: 0, vine: 0 } };
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** How far a conform reaches from its centre along x and y. */
export function conformReach(c: Conform): [number, number] {
  return [c.rx + c.skirt, c.ry + c.skirt];
}

/** Weight 0–1 of a conform at offset (dx, dy) from its centre: 1 inside, fading over the skirt. */
export function conformWeight(c: Conform, dx: number, dy: number): number {
  let out: number;
  if (c.round) {
    // Distance beyond the ellipse, measured along the ray from the centre.
    const q = Math.sqrt((dx * dx) / (c.rx * c.rx) + (dy * dy) / (c.ry * c.ry));
    if (q <= 1) return 1;
    out = (q - 1) * Math.min(c.rx, c.ry);
  } else {
    const ox = Math.abs(dx) - c.rx, oy = Math.abs(dy) - c.ry;
    if (ox <= 0 && oy <= 0) return 1;
    out = Math.sqrt((ox > 0 ? ox * ox : 0) + (oy > 0 ? oy * oy : 0));
  }
  if (c.skirt <= 0 || out >= c.skirt) return 0;
  return 1 - smooth(out / c.skirt);
}

/** The ground at offset (dx, dy) from the conform's centre, given the ground `h` there before it. */
export function conformed(c: Conform, h: number, dx: number, dy: number): number {
  const w = conformWeight(c, dx, dy);
  if (w <= 0) return h;
  switch (c.kind) {
    case "flat": {
      const d = c.level - h;
      return h + w * (d > c.limit ? c.limit : d < -c.limit ? -c.limit : d);
    }
    case "terrace": {
      // Sea-level ground and beaches are left alone.
      if (h < 1.2) return h;
      const q = c.level + c.limit * Math.floor((h - c.level) / c.limit + 0.5);
      return h + w * ((q < 1.2 ? 1.2 : q) - h);
    }
    case "dredge":
      return h > c.level ? h + w * (c.level - h) : h;
    default:
      return h < c.level ? h + w * (c.level - h) : h;
  }
}

/** Applies conforms, in list order, to a whole torus grid of `cellsPerNode` cells a node. */
export function conformGrid(h: Float64Array | Float32Array, gN: number, cellsPerNode: number, conforms: readonly Conform[]): void {
  for (const c of conforms) {
    const [reachX, reachY] = conformReach(c);
    const j0 = Math.ceil((c.y - reachY) / cellsPerNode - 0.5), j1 = Math.floor((c.y + reachY) / cellsPerNode - 0.5);
    const i0 = Math.ceil((c.x - reachX) / cellsPerNode - 0.5), i1 = Math.floor((c.x + reachX) / cellsPerNode - 0.5);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = wrap(j, gN) * gN + wrap(i, gN);
      h[k] = conformed(c, h[k], (i + 0.5) * cellsPerNode - c.x, (j + 0.5) * cellsPerNode - c.y);
    }
  }
}

/** Side of an index bucket, cells. */
export const BUILT_BUCKET = 64;

/** Structures and conforms filed by the 64-cell buckets they touch. */
export interface BuiltIndex {
  built: Built;
  n: number;
  bN: number;
  sStart: Uint32Array;
  sList: Uint32Array;
  cStart: Uint32Array;
  cList: Uint32Array;
}

function fileBoxes(n: number, count: number, box: (k: number) => [number, number, number, number]): { start: Uint32Array; list: Uint32Array } {
  const bN = Math.ceil(n / BUILT_BUCKET);
  const start = new Uint32Array(bN * bN + 1);
  const each = (k: number, fn: (b: number) => void): void => {
    const [x0, y0, x1, y1] = box(k);
    const bx0 = Math.floor(x0 / BUILT_BUCKET), bx1 = Math.floor(x1 / BUILT_BUCKET), by0 = Math.floor(y0 / BUILT_BUCKET), by1 = Math.floor(y1 / BUILT_BUCKET);
    for (let by = by0; by <= by1 && by < by0 + bN; by++) for (let bx = bx0; bx <= bx1 && bx < bx0 + bN; bx++) fn(wrap(by, bN) * bN + wrap(bx, bN));
  };
  for (let k = 0; k < count; k++) each(k, (b) => { start[b + 1]++; });
  for (let b = 0; b < bN * bN; b++) start[b + 1] += start[b];
  const list = new Uint32Array(start[bN * bN]);
  const fill = new Uint32Array(start.subarray(0, bN * bN));
  for (let k = 0; k < count; k++) each(k, (b) => { list[fill[b]++] = k; });
  return { start, list };
}

/** Files a world's built things for the bake. The world must be a whole number of buckets a side. */
export function indexBuilt(built: Built, n: number): BuiltIndex {
  const s = fileBoxes(n, built.structures.length, (k) => {
    const q = built.structures[k];
    return [q.x, q.y, q.x + q.w - 1, q.y + q.h - 1];
  });
  const c = fileBoxes(n, built.conforms.length, (k) => {
    const q = built.conforms[k];
    const [rx, ry] = conformReach(q);
    return [q.x - rx, q.y - ry, q.x + rx, q.y + ry];
  });
  return { built, n, bN: Math.ceil(n / BUILT_BUCKET), sStart: s.start, sList: s.list, cStart: c.start, cList: c.list };
}

/** Ids filed under any bucket the cell rectangle [x0, x1) × [y0, y1) touches, ascending and without repeats. */
function idsIn(start: Uint32Array, list: Uint32Array, bN: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const seen = new Set<number>();
  const bx0 = Math.floor(x0 / BUILT_BUCKET), bx1 = Math.floor((x1 - 1) / BUILT_BUCKET), by0 = Math.floor(y0 / BUILT_BUCKET), by1 = Math.floor((y1 - 1) / BUILT_BUCKET);
  for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
    const b = wrap(by, bN) * bN + wrap(bx, bN);
    for (let k = start[b]; k < start[b + 1]; k++) seen.add(list[k]);
  }
  const out = [...seen];
  // Insertion sort: lists are short, and list order is the order conforms apply in.
  for (let a = 1; a < out.length; a++) {
    const v = out[a];
    let b = a - 1;
    while (b >= 0 && out[b] > v) { out[b + 1] = out[b]; b--; }
    out[b + 1] = v;
  }
  return out;
}

export function structuresIn(ix: BuiltIndex, x0: number, y0: number, x1: number, y1: number): number[] {
  return idsIn(ix.sStart, ix.sList, ix.bN, x0, y0, x1, y1);
}

export function conformsIn(ix: BuiltIndex, x0: number, y0: number, x1: number, y1: number): number[] {
  return idsIn(ix.cStart, ix.cList, ix.bN, x0, y0, x1, y1);
}

/**
 * The offset that carries world coordinate `v` (a west or north edge of something `size` long) into the frame
 * of a window starting at `w0`: the image whose far edge lies at or past the window's start.
 */
export function imageOffset(v: number, size: number, w0: number, n: number): number {
  return wrap(v - w0 + size - 1, n) - (size - 1);
}
