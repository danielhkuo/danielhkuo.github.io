// S10 parcels: the field a cell of enclosed land lies in. A pure function of
// the cell, evaluated in the bake like cover, so fields need no shipped data.
//
// Fields are the cells of a Voronoi diagram over jittered sites 28–56 cells
// apart, bent three ways so they read as land that was walked and ploughed:
//   - the lookup position is warped by slow noise, so boundaries wander;
//   - distance is measured in the cell's own frame, short across the slope
//     and long along the contour, so fields lie along the hill;
//   - beside a river the lookup is pushed away from the water, which tears
//     the diagram along the river, and the strip along each bank belongs to
//     that bank alone: the two banks are always different fields.
// On flat ground most sites join the others of their block into one large
// field; on slopes few do, so fields are smaller and more irregular there.

import { hash2 } from "./core/hash.ts";
import { gradNoise } from "./core/noise.ts";
import type { CoverInput } from "./look/contract.ts";

/** Site lattice pitch, cells: offset rows, so neighbours stand about 28–56 cells apart after jitter. */
export const SITE_W = 38;
export const SITE_H = 34;
/** Sites move up to this share of the pitch from their lattice point. */
const SITE_JITTER = 0.78;
/** Boundaries wander by up to about this many cells, over features this long. */
const WARP = 9;
const WARP_CELLS = 130;
/** Fields on a full slope are this many times longer along the contour than across it. */
export const ELONGATION = 2.1;
/** Slope at which fields start to stretch, and at which they are fully stretched and least merged. */
const SLOPE_FLAT = 0.025;
const SLOPE_FULL = 0.11;
/** Above this slope the fall line is plain and furrows follow the contour; on flatter ground the field picks its own way. */
const SLOPE_CONTOUR = 0.06;
/** Share of sites that join their 2 × 2 block: on the flat, on a full slope. */
const MERGE_FLAT = 0.72;
const MERGE_SLOPE = 0.2;
/** At the bank the lookup is pushed this many cells from the water, fading to nothing at the river reach. */
export const RIVER_SHOVE = 14;
export const RIVER_REACH = 8;
/** Cells within this of a river belong to their own bank's strip of the field. */
export const RIVER_BANK = 3.2;

const SITE_SEED = 0x9a7ce1;
const BLOCK_SEED = 0x9a7ce2;
const FIELD_SEED = 0x9a7ce3;
const WARP_SEED_X = 0x3a11;
const WARP_SEED_Y = 0x3a12;

/** Furrow directions, all clean on a pixel grid: along x, along y, and the two diagonals. */
export const AXIS = { east: 0, south: 1, southEast: 2, northEast: 3 } as const;

export interface Parcel {
  /** u32 hash of the field. */
  id: number;
  /** Cells to the nearest other field's edge; a boundary is drawn where this is small. */
  edge: number;
  /** 1 when the field is one site on its own (small), 0 when it is a merged block. */
  single: number;
  /** One of AXIS: the way the furrows run, along the contour where there is one. */
  axis: number;
  /**
   * 0, or 1–4 on a river bank: which way the water lies (west, east, north,
   * south of the cell). Opposite banks never share a value, and the id of a
   * bank strip is the field's id mixed with it.
   */
  bank: number;
}

export function newParcel(): Parcel {
  return { id: 0, edge: 0, single: 0, axis: 0, bank: 0 };
}

function wrapInt(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

function smooth(lo: number, hi: number, v: number): number {
  const t = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

const MAX_SITES = 25;
const candD: Float64Array = new Float64Array(MAX_SITES);
const candField: Int32Array = new Int32Array(MAX_SITES);
const candSingle: Uint8Array = new Uint8Array(MAX_SITES);

/**
 * The field of one cell, written into `out`. Tiles on a world of n cells.
 * `bankWidth` is how far from a river the bank strip reaches.
 */
export function parcelAt(c: CoverInput, n: number, out: Parcel, bankWidth: number = RIVER_BANK): Parcel {
  const nx = Math.max(2, 2 * Math.round(n / (2 * SITE_W)));
  const ny = Math.max(2, 2 * Math.round(n / (2 * SITE_H)));
  const pw = n / nx;
  const ph = n / ny;
  let px = Math.floor(c.x) + 0.5;
  let py = Math.floor(c.y) + 0.5;

  // The uphill unit vector (gx, gy); the contour runs along (−gy, gx).
  const s = c.slope;
  const known = c.westness !== undefined;
  const gy = c.northness;
  // Without the x-part only its size is known, so there is no stretch then.
  const gx = known ? (c.westness as number) : 0;
  const lean = known ? smooth(SLOPE_FLAT, SLOPE_FULL, s) : 0;

  // Rivers tear the diagram: push the lookup away from the water.
  const rdx = c.riverDx === undefined ? 0 : c.riverDx;
  const rdy = c.riverDy === undefined ? 0 : c.riverDy;
  let bank = 0;
  if (rdx !== 0 || rdy !== 0) {
    const d = Math.sqrt(rdx * rdx + rdy * rdy);
    if (d < bankWidth) {
      const ax = rdx < 0 ? -rdx : rdx;
      const ay = rdy < 0 ? -rdy : rdy;
      bank = ax >= ay ? (rdx > 0 ? 1 : 2) : rdy > 0 ? 3 : 4;
    }
    if (d < RIVER_REACH) {
      const f = 1 - d / RIVER_REACH;
      const push = (RIVER_SHOVE * f * f) / d;
      px += rdx * push;
      py += rdy * push;
    }
  }

  // Slow warp, periodic on the world.
  const wp = Math.max(1, Math.round(n / WARP_CELLS));
  const wu = (px * wp) / n;
  const wv = (py * wp) / n;
  px += WARP * gradNoise(wu, wv, wp, WARP_SEED_X);
  py += WARP * gradNoise(wu + 0.5, wv + 0.5, wp, WARP_SEED_Y);

  // Area-preserving stretch along the contour.
  const k = 1 + (ELONGATION - 1) * lean;
  const merge = MERGE_FLAT + (MERGE_SLOPE - MERGE_FLAT) * smooth(SLOPE_FLAT, SLOPE_FULL, s);
  const reach = k > 1.2 ? 2 : 1;

  const fy = py / ph;
  const iy = Math.floor(fy);
  let count = 0;
  let best = 0;
  for (let dj = -reach; dj <= reach; dj++) {
    const j = iy + dj;
    const off = 0.5 * (j & 1);
    const ix = Math.floor(px / pw - off);
    const wj = wrapInt(j, ny);
    for (let di = -reach; di <= reach; di++) {
      const i = ix + di;
      const wi = wrapInt(i, nx);
      const h = hash2(wi, wj, SITE_SEED);
      const sx = (i + 0.5 + off + ((h & 0x3ff) / 1024 - 0.5) * SITE_JITTER) * pw;
      const sy = (j + 0.5 + (((h >>> 10) & 0x3ff) / 1024 - 0.5) * SITE_JITTER) * ph;
      const dx = px - sx;
      const dy = py - sy;
      const along = dy * gx - dx * gy;
      const across = dx * gx + dy * gy;
      // On flat ground there is no fall line, and (gx, gy) may be zero: plain distance.
      const d2 = lean > 0 ? (along * along) / k + across * across * k : dx * dx + dy * dy;
      const single = ((h >>> 20) & 0xff) / 256 >= merge ? 1 : 0;
      candD[count] = d2;
      candSingle[count] = single;
      candField[count] = single === 1 ? h | 0 : hash2(wi >> 1, wj >> 1, BLOCK_SEED) | 0;
      if (d2 < candD[best]) best = count;
      count++;
    }
  }
  const field = candField[best];
  let other = 1e30;
  for (let q = 0; q < count; q++) if (candField[q] !== field && candD[q] < other) other = candD[q];

  out.id = hash2(field, 11 + bank, FIELD_SEED);
  out.bank = bank;
  out.edge = other >= 1e30 ? 99 : (Math.sqrt(other) - Math.sqrt(candD[best])) * 0.5;
  out.single = candSingle[best];

  // Furrows follow the contour where there is one, else a direction the field picks for itself.
  if (known && s > SLOPE_CONTOUR) {
    // The contour runs along (−gy, gx): along x where the ground rises north or south.
    const ax = gy < 0 ? -gy : gy;
    const ay = gx < 0 ? -gx : gx;
    if (ax > 2.4 * ay) out.axis = AXIS.east;
    else if (ay > 2.4 * ax) out.axis = AXIS.south;
    else out.axis = gx * gy < 0 ? AXIS.southEast : AXIS.northEast;
  } else {
    const pick = (out.id >>> 5) & 7;
    out.axis = pick < 4 ? AXIS.east : pick < 6 ? AXIS.south : pick === 6 ? AXIS.southEast : AXIS.northEast;
  }
  return out;
}

/**
 * Furrow spacings must divide this. The world is 6400 cells and 5120 screen
 * rows round, neither of which a spacing of 3 or 6 divides, so spacings are
 * 2, 4, 5 and 8: furrows meet themselves across the world's seam.
 */
export const FURROW_PERIOD = 40;

/**
 * The furrow coordinate of a cell: which furrow line of its axis it lies on,
 * 0 … FURROW_PERIOD − 1. It is counted in screen pixels, not world cells: the
 * camera squeezes world rows to four fifths, so a line counted in world rows
 * would vanish wherever its row is the one in five that owns no screen row.
 * Two world rows that share a screen row share a furrow.
 */
export function furrowAt(x: number, y: number, axis: number): number {
  const row = Math.floor((4 * y) / 5);
  const u = axis === AXIS.east ? row : axis === AXIS.south ? x : axis === AXIS.southEast ? x - row : x + row;
  const m = u % FURROW_PERIOD;
  return m < 0 ? m + FURROW_PERIOD : m;
}
