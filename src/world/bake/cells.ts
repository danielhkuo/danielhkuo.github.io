// Cell tiles: the land rebuilt per world cell from the generator's grids.
// Ground by cubic B-spline, water, cover, scatter stamped into height and
// material, light and cast shadows. Every output is a pure function of the
// wrapped cell position, so any window equals the same crop of any other.

import { hash2 } from "../core/hash.ts";
import { gradNoise } from "../core/noise.ts";
import { wrap } from "../core/torus.ts";
import type { CoverInput, Palette, Stamp } from "../look/contract.ts";
import { applyStampsTo, stampReach, type Stamp as CoastStamp } from "../gen/stamps.ts";
import { coverFields } from "./coverFields.ts";
import { boxBlur, shade, shadeSnow, shadowDepth, SHADOW_DROP, SHADOW_REACH, sweepShadow } from "./light.ts";
import { conformed, conformReach, conformsIn, conformWeight, imageOffset, structuresIn } from "../gen/built.ts";
import { forEachLinePoint, forEachRiverPoint } from "./lines.ts";
import { HMAX, type BakeWorld, type Patch } from "./world.ts";

export const TILE = 256;

/** What the cover and palette side hands the bake. */
export interface Look {
  cover(c: CoverInput, mask: Uint8Array): number;
  /** `riverDist`: cells to the nearest river due north and due south of this cell, Infinity beyond RIVER_SIGHT. */
  scatter(c: CoverInput, groundMat: number, mask: Uint8Array, riverDist?: { north: number; south: number }): Stamp | null;
  /** Per material id: 1 for water. */
  isWater: Uint8Array;
  /** Per material id: 1 for tree crowns. */
  isCanopy: Uint8Array;
  palette: Palette;
  /** Per material id: 1 for standing water (sea, lakes), whose shores take a coast line. Optional: isWater when absent. */
  isStill?: Uint8Array;
  /** Per material id: 1 where ink is never drawn (fields, roads, sand). Optional. */
  noInk?: Uint8Array;
  /** Per material id: 1 for snow, which is lit by its true normals. Optional. */
  isSnow?: Uint8Array;
  /** 1 for the light washes the paper shows through: meadow, hay and corn. Optional: none when absent. */
  isWash?: Uint8Array;
  /** The turf laid on the tops of sea stacks. Optional: the cover's own choice when absent. */
  turf?: number;
  /** The sand of a river's point bars. Optional: bars are not drawn when absent. */
  barSand?: number;
  /** Per material id: 1 for bare rock, whose walls are drawn as strata. Optional: none when absent. */
  isRock?: Uint8Array;
  /** The shingle and the boulders of the apron at a sea cliff's foot. Optional: cliffs stand in the water when absent. */
  apron?: number;
  apronRock?: number;
}

/**
 * Land cells' aux: bits 0–1 the hatch level (1 steep, 2 a cliff), bits 2–3 a crest (1 soft, 2 full, 3 one that
 * runs north–south), bit 4 bare rock, bit 5 a sharp crest on high ground (an arête or a summit). Stream cells' aux: 8 and the
 * shade of the ground they cross, 0–6.
 */
export const AUX_STEEP = 3;
export const AUX_CREST_SHIFT = 2;
export const AUX_ROCK = 0x10;
export const AUX_SHARP = 0x20;

/** Cell flags. */
export const F_SHADOW = 0x03;
export const F_CANOPY = 0x04;
/** Ground slope ≥ STEEP_SLOPE (aux 1) or ≥ CLIFF_SLOPE (aux 2: a cliff), the only ground that shows rock walls and hatching. */
export const F_CLIFF = 0x08;
/** Deep in shadow cast by terrain (never by trees). */
export const F_DEEP = 0x10;
/** Sedimentary rock: bedding lines; clear means hard rock and vertical strokes. */
export const F_BEDDED = 0x20;
/** Never inked: water, rivers, beaches, fields. */
export const F_QUIET = 0x40;
/** Land of a cliffed coast: inked where it meets the water. */
export const F_SEACLIFF = 0x80;

export interface Cells {
  w: number;
  h: number;
  /** Drawn height: ground, crown top or water surface, within [0, HMAX]. */
  surf: Float32Array;
  mat: Uint8Array;
  /** Tone 0–255 before dithering. */
  light: Uint8Array;
  flags: Uint8Array;
  /** Water cells: depth tone 0–15 (sea, lakes) or flow phase 0–15 (rivers). Land: the AUX_ bits. */
  aux: Uint8Array;
}

// Margins round the core, in cells.
/** A crest within this many cells of a lake that lies north, east or west of it is the bowl's lip. */
const TARN_LIP = 12;

/** Whether lake water lies within TARN_LIP cells of cell i to its north, east or west (never only to its south). */
function besideLake(water: Uint8Array, W: number, i: number): boolean {
  for (let d = 4; d <= TARN_LIP; d += 4) {
    if (water[i - d * W] === 2 || water[i - d] === 2 || water[i + d] === 2 || water[i - d * W - d] === 2 || water[i - d * W + d] === 2) return true;
  }
  return false;
}

/** Trees shade at most this many diagonal steps. */
const TREE_REACH = 4;
/** A stamp reaches at most this far from the cell that placed it. */
const STAMP_REACH = 6;
const BLUR_R = 8;
const SHORE_CAP = 15;
/** Shore classes apply this many cells inland. */
const SHORE_BAND = 9;
/** The cover is told the way to the nearest river within this many cells. */
const RIVER_OFFSET = 8;
/** Rivers are looked for this many cells due north and due south of a cell. */
export const RIVER_SIGHT = 12;
/** A 1 px stream on ground steeper than this is not drawn: it would read as a rain streak. */
export const STREAM_MAX_SLOPE = 0.9;
/** Ground from this slope is gullied, up to GULLY_DEPTH units deep. */
export const GULLY_SLOPE = 0.9;
export const GULLY_DEPTH = 2.2;
/** Ground at least this steep is a cliff: it shows rock and takes hatching (the cover table draws faces from 1.7). */
export const CLIFF_SLOPE = 1.4;
/** And its smoothed form (coverFields `steep`) must be this steep for the cell to be hatched and lipped as a cliff. */
export const FORM_CLIFF = 1.3;
/** Ground from this slope takes sparse hatching, so a long steep face never reads as a flat wall. */
export const STEEP_SLOPE = 1.15;
/** A crest stands at least this far over the ground CREST_REACH cells to either side of it; from CREST_FULL its line is full ink. */
export const CREST_REACH = 5;
/** The drop a crest needs: CREST_DROP on low ground, easing to CREST_DROP_HIGH from CREST_LOW to CREST_HIGH units up, where summits are broad. */
export const CREST_DROP = 1.8;
export const CREST_DROP_HIGH = 1.1;
export const CREST_LOW = 40;
export const CREST_HIGH = 80;
export const CREST_FULL = 5;
/** A sharp crest from this height is marked as a high one: among rock it is an arête, inked whether or not it hides anything. */
export const CREST_HIGH_LINE = 45;
/** The apron at a sea cliff's foot is this many cells wide at most, and one cell in APRON_BOULDER of it is a boulder. */
export const APRON_WIDTH = 3;
export const APRON_BOULDER = 5;
/** High ground also shows the crest of a broad ridge: this drop over this reach. */
export const CREST_WIDE = 12;
export const CREST_DROP_WIDE = 1.5;
/** Beaches, shingle and coves keep to a strip this many cells wide, give or take BEACH_WANDER. */
const BEACH_BAND = 5;
const BEACH_WANDER = 2.5;
/** Water this deep is half way down the depth ramp. */
const SEA_HALF = 5;
/** Cover is evaluated this far north-west and south-east of the core. */
const COVER_N = TREE_REACH + STAMP_REACH;
const COVER_S = 1 + STAMP_REACH;
/** Heights are needed this far out. */
const PAD_N = SHADOW_REACH + 1;
const PAD_S = RIVER_SIGHT + COVER_S + 1;

const WEIGHTS: Float64Array = (() => {
  const out = new Float64Array(16);
  for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4 - 0.5 - Math.floor((k + 0.5) / 4 - 0.5);
    const t2 = t * t, t3 = t2 * t, om = 1 - t;
    out[k * 4] = (om * om * om) / 6;
    out[k * 4 + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    out[k * 4 + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    out[k * 4 + 3] = t3 / 6;
  }
  return out;
})();

/** Ground heights of cells [x0, x0 + w) × [y0, y0 + h) by periodic cubic B-spline of G; matches core/bspline.ts. */
export function upsampleGround(src: Float32Array, gN: number, x0: number, y0: number, w: number, h: number, out: Float32Array): void {
  // Node rows needed: floor(v) − 1 … floor(v) + 2 for v = (y + 0.5)/4 − 0.5.
  const jMin = Math.floor((y0 + 0.5) / 4 - 0.5) - 1;
  const jMax = Math.floor((y0 + h - 0.5) / 4 - 0.5) + 2;
  const rows = jMax - jMin + 1;
  const tmp = new Float64Array(rows * w);
  const ix = new Int32Array(w * 4), wk = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const j = Math.floor((x0 + x + 0.5) / 4 - 0.5);
    wk[x] = wrap(x0 + x, 4);
    for (let q = 0; q < 4; q++) ix[x * 4 + q] = wrap(j - 1 + q, gN);
  }
  for (let r = 0; r < rows; r++) {
    const s = wrap(jMin + r, gN) * gN, d = r * w;
    for (let x = 0; x < w; x++) {
      const k = wk[x] * 4, q = x * 4;
      tmp[d + x] = WEIGHTS[k] * src[s + ix[q]] + WEIGHTS[k + 1] * src[s + ix[q + 1]] + WEIGHTS[k + 2] * src[s + ix[q + 2]] + WEIGHTS[k + 3] * src[s + ix[q + 3]];
    }
  }
  for (let y = 0; y < h; y++) {
    const j = Math.floor((y0 + y + 0.5) / 4 - 0.5);
    const k = wrap(y0 + y, 4) * 4;
    const r0 = (j - 1 - jMin) * w, d = y * w;
    const w0 = WEIGHTS[k], w1 = WEIGHTS[k + 1], w2 = WEIGHTS[k + 2], w3 = WEIGHTS[k + 3];
    for (let x = 0; x < w; x++) {
      out[d + x] = w0 * tmp[r0 + x] + w1 * tmp[r0 + w + x] + w2 * tmp[r0 + 2 * w + x] + w3 * tmp[r0 + 3 * w + x];
    }
  }
}

/** Ground height at one cell. */
export function groundAt(world: BakeWorld, x: number, y: number): number {
  const out = new Float32Array(1);
  upsampleGround(world.ground, world.gN, Math.floor(x), Math.floor(y), 1, 1, out);
  return out[0];
}

/** The coast stamps that can reach a window, in their original order. */
function stampsNear(world: BakeWorld, x0: number, y0: number, w: number, h: number): CoastStamp[] {
  const n = world.n, out: CoastStamp[] = [];
  for (const s of world.stamps as readonly CoastStamp[]) {
    const reach = stampReach(s) + 2;
    const dx = wrap(s.x - x0 + reach, n), dy = wrap(s.y - y0 + reach, n);
    if (dx <= w + 2 * reach && dy <= h + 2 * reach) out.push(s);
  }
  return out;
}

/**
 * Sea stacks, reshaped at cell size: each its own height, tapering from a small uneven top, never above the
 * stamp's own column. Returns the cells that stand on a stack, or null when the window holds none.
 */
function reshapeStacks(ground: Float32Array, W: number, H: number, wx0: number, wy0: number, n: number, stamps: readonly CoastStamp[]): Uint8Array | null {
  let on: Uint8Array | null = null, best: Float32Array | null = null;
  for (const s of stamps) {
    if (s.kind !== "stack") continue;
    const reach = s.r * (1 + 1.6 * s.lobe) + 1;
    const cx = s.x - wx0 - Math.floor((s.x - wx0 + reach) / n) * n, cy = s.y - wy0 - Math.floor((s.y - wy0 + reach) / n) * n;
    if (cx - reach >= W || cy - reach >= H) continue;
    const hs = hash2(Math.floor(s.x), Math.floor(s.y), 0x57ac);
    // Its own height, and how much of the top is level before the sides fall away.
    const tall = s.top * (0.62 + (0.38 * (hs & 255)) / 255);
    const flat = 0.2 + (0.3 * ((hs >>> 8) & 255)) / 255;
    const y1 = Math.min(H - 1, Math.ceil(cy + reach)), x1 = Math.min(W - 1, Math.ceil(cx + reach));
    for (let yy = Math.max(0, Math.floor(cy - reach)); yy <= y1; yy++) {
      for (let xx = Math.max(0, Math.floor(cx - reach)); xx <= x1; xx++) {
        const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const c = d > 0 ? (dx * s.ux + dy * s.uy) / d : 0;
        const r = s.r * (1 + s.lobe * c + 0.6 * s.lobe * (2 * c * c - 1));
        if (d >= r) continue;
        const q = d / r, i = yy * W + xx;
        const t0 = q <= 0.6 ? 0 : (q - 0.6) / 0.4;
        const stamp = s.top * (1 - 0.8 * t0 * t0);
        // Land that stands higher than the stamp is not the stack's.
        if (ground[i] > stamp + 0.05) continue;
        const t = q <= flat ? 0 : (q - flat) / (1 - flat);
        const X = wrap(wx0 + xx, n), Y = wrap(wy0 + yy, n);
        const rough = 0.5 + 0.5 * (gradNoise(X / 2, Y / 2, n / 2, 0x51c) + gradNoise(X / 4, Y / 4, n / 4, 0x51d));
        let v = tall * (1 - 0.72 * t * t) * (1 - 0.2 * (rough < 0 ? 0 : rough > 1 ? 1 : rough));
        if (v > stamp) v = stamp;
        if (v < 0.6) v = 0.6;
        if (!on || !best) { on = new Uint8Array(W * H); best = new Float32Array(W * H); }
        if (v > best[i]) best[i] = v;
        on[i] = 1;
      }
    }
  }
  if (on && best) for (let i = 0; i < W * H; i++) if (on[i] === 1) ground[i] = Math.floor(best[i] * 64 + 0.5) / 64;
  return on;
}

/** Calls `hit` with the window index of every cell whose centre lies inside the patch (even-odd), in the patch's own arithmetic. */
function forEachPatchCell(p: Patch, n: number, wx0: number, wy0: number, W: number, H: number, hit: (i: number) => void): void {
  const bw = p.x1 - p.x0, bh = p.y1 - p.y0;
  const ox = imageOffset(p.x0, bw, wx0, n), oy = imageOffset(p.y0, bh, wy0, n);
  if (ox >= W || oy >= H) return;
  const v = p.outline, m = v.length >> 1;
  for (let j = oy < 0 ? -oy : 0; j < bh && oy + j < H; j++) {
    const py = p.y0 + j + 0.5;
    for (let q = ox < 0 ? -ox : 0; q < bw && ox + q < W; q++) {
      const px = p.x0 + q + 0.5;
      let inside = false;
      for (let k = 0, l = m - 1; k < m; l = k++) {
        const ay = v[2 * k + 1], by = v[2 * l + 1];
        if ((ay <= py) === (by <= py)) continue;
        const ax = v[2 * k], bx = v[2 * l];
        if (px < ax + ((py - ay) * (bx - ax)) / (by - ay)) inside = !inside;
      }
      if (inside) hit((oy + j) * W + ox + q);
    }
  }
}

/** Chamfer 3–4 distance transform in place over the cells from (lo, lo) to the end of a w × h window; `d` holds 0 at sources and `big` elsewhere. */
function chamfer(d: Int16Array, w: number, h: number, lo: number): void {
  for (let y = lo; y < h; y++) {
    const row = y * w;
    for (let x = lo; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > lo && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > lo) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > lo && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x + 1 < w && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= lo; y--) {
    const row = y * w;
    for (let x = w - 1; x >= lo; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x + 1 < w && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y + 1 < h) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x + 1 < w && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > lo && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
      }
      d[i] = v;
    }
  }
}

/** Cells [x0, x0 + w) × [y0, y0 + h) of the world. Coordinates are unwrapped; any integers. */
export function buildCells(world: BakeWorld, look: Look, mask: Uint8Array, x0: number, y0: number, w: number, h: number): Cells {
  const { n, gN, cN } = world;
  const W = w + PAD_N + PAD_S, H = h + PAD_N + PAD_S;
  const wx0 = x0 - PAD_N, wy0 = y0 - PAD_N;
  const count = W * H;

  // 1. Ground.
  const ground = new Float32Array(count);
  upsampleGround(world.ground, gN, wx0, wy0, W, H, ground);
  // The cells that stand on a sea stack.
  let stackTop: Uint8Array | null = null;
  if (world.base && world.conform && world.stamps) {
    // Crisp coasts: the pre-stamp ground, the coast stamps at cell size, then the rivers' conforming.
    const crisp = new Float32Array(count), delta = new Float32Array(count);
    const near = stampsNear(world, wx0, wy0, W, H);
    upsampleGround(world.base, gN, wx0, wy0, W, H, crisp);
    applyStampsTo(crisp, { w: W, h: H, cellsPerNode: 1, x0: wx0, y0: wy0, period: n }, near);
    upsampleGround(world.conform, gN, wx0, wy0, W, H, delta);
    for (let i = 0; i < count; i++) {
      // Heights are kept to whole 64ths, so the last bits of a stamp's arithmetic cannot differ between windows.
      const v = Math.floor((crisp[i] + delta[i]) * 64 + 0.5) / 64;
      // Under the sea the generator's own bed (its bathymetry) stands, unless the stamp cut deeper.
      ground[i] = v > 0 ? v : ground[i] < v ? ground[i] : v < 0 ? v : ground[i] < 0 ? ground[i] : -0.02;
    }
    stackTop = reshapeStacks(ground, W, H, wx0, wy0, n, near);
  }
  // Crests: a cell that tops its row or its column and stands well over the ground a few cells to either side.
  // Found on the smooth ground, before gullies, so a face's ribs are not crests.
  const crest = new Uint8Array(count);
  {
    for (let y = PAD_N; y < PAD_N + h; y++) {
      for (let x = PAD_N; x < PAD_N + w; x++) {
        const i = y * W + x, e = ground[i];
        if (e < 6) continue;
        const col = e >= ground[i - W] && e > ground[i + W], row = e >= ground[i - 1] && e > ground[i + 1];
        if (!col && !row) continue;
        // Two scales: a sharp arête shows over CREST_REACH cells, a broad summit ridge only over CREST_WIDE.
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 1 && (crest[i] !== 0 || e < CREST_LOW)) break;
          const R = pass === 0 ? CREST_REACH : CREST_WIDE;
          let a = ground[i - R * W], b = ground[i + R * W];
          const dCol = e - (a > b ? a : b);
          a = ground[i - R];
          b = ground[i + R];
          const dRow = e - (a > b ? a : b);
          // The axis the ground bends across most owns the crest, so a slanting ridge is one line and not two.
          const across = col && dCol >= dRow;
          const k = across ? dCol : row && dRow > dCol ? dRow : 0;
          const need = pass === 1 ? CREST_DROP_WIDE : e <= CREST_LOW ? CREST_DROP : e >= CREST_HIGH ? CREST_DROP_HIGH : CREST_DROP + ((CREST_DROP_HIGH - CREST_DROP) * (e - CREST_LOW)) / (CREST_HIGH - CREST_LOW);
          // 1 and 2: a crest running across the view, soft and full. 3: one running away from the camera.
          if (k >= need) crest[i] = (!across ? 3 : pass === 0 && k >= CREST_FULL ? 2 : 1) | (pass === 0 && e >= CREST_HIGH_LINE ? 4 : 0);
        }
      }
    }
  }
  // Gullies: steep ground is incised along its fall line, a few units deep, so faces show ribs and
  // couloirs in their shading and their silhouettes. A pure function of the cell and the smooth ground.
  {
    const cut = new Float32Array(count), per = n / 4;
    for (let y = 1; y < H - 1; y++) {
      const v = wrap(wy0 + y, n) / 4;
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, e = ground[i];
        if (e <= 1.5) continue;
        const dx = (ground[i + 1] - ground[i - 1]) * 0.5, dy = (ground[i + W] - ground[i - W]) * 0.5;
        const s2 = dx * dx + dy * dy;
        if (s2 < GULLY_SLOPE * GULLY_SLOPE) continue;
        const u = wrap(wx0 + x, n) / 4;
        // Noise smeared four lattice steps along whichever axis the ground falls, so the grain runs downhill.
        let a: number;
        // (Every lattice coordinate is the cell over 4, so the noise wraps with the world, and ribs are broad.)
        if (dy * dy >= dx * dx) a = gradNoise(u, v, per, 0x61b) + gradNoise(u, v + 2, per, 0x61b);
        else a = gradNoise(u, v, per, 0x7c3) + gradNoise(u + 2, v, per, 0x7c3);
        const ridge = a < 0 ? -a : a;
        // A few narrow cuts between broad ribs: only where the noise crosses zero.
        const depth = ridge > 0.3 ? 0 : 1 - ridge / 0.3;
        const steep = Math.sqrt(s2) - GULLY_SLOPE;
        cut[i] = depth * depth * GULLY_DEPTH * (steep > 0.6 ? 1 : steep / 0.6) * (e > 16 ? 1 : (e - 1.5) / 14.5);
      }
    }
    for (let i = 0; i < count; i++) if (cut[i] > 0) ground[i] = Math.floor((ground[i] - cut[i]) * 64 + 0.5) / 64;
  }

  // Pads, street terraces and the harbour, cut at cell size.
  const bi = world.built;
  // Under street terraces the cover is chosen from the hillside as it was, so a riser is a wall and not a crag.
  let natural: Float32Array | null = null;
  // Pads: 255 at the heart of a levelled pad, fading over its skirt; nothing is planted there.
  let pad: Uint8Array | null = null;
  let band: Uint8Array | null = null;
  if (bi) {
    for (const id of conformsIn(bi, wx0, wy0, wx0 + W, wy0 + H)) {
      const cf = bi.built.conforms[id];
      if (cf.kind === "terrace" && !natural) { natural = Float32Array.from(ground); band = new Uint8Array(count); }
      if (cf.kind === "flat" && cf.rx >= 5 && !pad) pad = new Uint8Array(count);
      const [rx, ry] = conformReach(cf);
      const ex = Math.floor(cf.x - rx), ey = Math.floor(cf.y - ry), sw = Math.ceil(2 * rx) + 2, sh = Math.ceil(2 * ry) + 2;
      const ox = imageOffset(ex, sw, wx0, n), oy = imageOffset(ey, sh, wy0, n);
      const ccx = cf.x - ex + ox, ccy = cf.y - ey + oy;
      for (let yy = Math.max(0, oy); yy < Math.min(H, oy + sh); yy++) for (let xx = Math.max(0, ox); xx < Math.min(W, ox + sw); xx++) {
        const k = yy * W + xx;
        const before = ground[k];
        ground[k] = conformed(cf, before, xx + 0.5 - ccx, yy + 0.5 - ccy);
        // Street terraces: which step a cell stands on, 1…3, cycling up the hill.
        if (cf.kind === "terrace" && band && ground[k] !== before) {
          // The town's ground ends in a speckled edge over the terraces' skirt; 4 marks a terraced cell outside it.
          const inside = 255 * conformWeight(cf, xx + 0.5 - ccx, yy + 0.5 - ccy) > mask[((wrap(wy0 + yy, n) + 59) & 255) * 256 + ((wrap(wx0 + xx, n) + 173) & 255)];
          band[k] = inside ? 1 + (((Math.floor((ground[k] - cf.level) / cf.limit + 0.5) % 3) + 3) % 3) : 4;
        }
        if (pad && cf.kind === "flat" && cf.rx >= 5) {
          const v = Math.floor(255 * conformWeight(cf, xx + 0.5 - ccx, yy + 0.5 - ccy));
          if (v > pad[k]) pad[k] = v;
        }
      }
    }
  }

  // 2. Water: lakes where the ground lies under a neighbouring lake node's level, sea at or below 0.
  const water = new Uint8Array(count);
  const level = new Float32Array(count);
  const gxa = Math.floor((wx0 + 0.5) / 4 - 0.5), gya = Math.floor((wy0 + 0.5) / 4 - 0.5);
  const gW = Math.floor((wx0 + W - 0.5) / 4 - 0.5) + 2 - gxa, gH = Math.floor((wy0 + H - 0.5) / 4 - 0.5) + 2 - gya;
  const lakeLevel = new Float32Array(gW * gH);
  let lakes = false;
  for (let j = 0; j < gH; j++) {
    const row = wrap(gya + j, gN) * gN;
    for (let i = 0; i < gW; i++) {
      const g = row + wrap(gxa + i, gN);
      if (world.waterKind[g] === 2) {
        lakeLevel[j * gW + i] = world.waterLevel[g];
        lakes = true;
      } else lakeLevel[j * gW + i] = -Infinity;
    }
  }
  for (let y = 0; y < H; y++) {
    const gj = Math.floor((wy0 + y + 0.5) / 4 - 0.5) - gya;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = ground[i];
      if (lakes) {
        const gi = Math.floor((wx0 + x + 0.5) / 4 - 0.5) - gxa;
        const a = gj * gW + gi;
        let top = lakeLevel[a];
        if (lakeLevel[a + 1] > top) top = lakeLevel[a + 1];
        if (lakeLevel[a + gW] > top) top = lakeLevel[a + gW];
        if (lakeLevel[a + gW + 1] > top) top = lakeLevel[a + gW + 1];
        // A lake's edge follows the ground where the bed is cut; on a flattened floor it follows the lake nodes' bilinear outline.
        let inside = e < top;
        if (!inside && top > -Infinity && e < top + 0.6) {
          const fx = (wx0 + x + 0.5) / 4 - 0.5 - (gi + gxa), fy = (wy0 + y + 0.5) / 4 - 0.5 - (gj + gya);
          const m = (lakeLevel[a] > -Infinity ? (1 - fx) * (1 - fy) : 0) + (lakeLevel[a + 1] > -Infinity ? fx * (1 - fy) : 0) +
            (lakeLevel[a + gW] > -Infinity ? (1 - fx) * fy : 0) + (lakeLevel[a + gW + 1] > -Infinity ? fx * fy : 0);
          inside = m >= 0.5;
        }
        if (inside) {
          water[i] = 2;
          level[i] = top < 0 ? 0 : top;
          continue;
        }
      }
      if (e <= 0) water[i] = 1;
    }
  }

  // Oxbow ponds: still water a little below the bank, never above it.
  if (world.ponds) {
    for (const p of world.ponds) {
      forEachPatchCell(p, n, wx0, wy0, W, H, (i) => {
        if (water[i] !== 0) return;
        const g = ground[i];
        const s = p.level > g ? g : p.level < g - 1 ? g - 1 : p.level;
        water[i] = 2;
        level[i] = s < 0.05 ? 0.05 : s;
        ground[i] = level[i] - 1.5;
      });
    }
  }

  // The dry surface: ground, or the water standing on it, within the cap.
  const dry = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = water[i] ? level[i] : ground[i];
    dry[i] = v < 0 ? 0 : v > HMAX ? HMAX : v;
  }

  // 3. Terrain shadow ray and relief.
  const ray = new Float32Array(count);
  sweepShadow(dry, W, H, ray);
  const blur = new Float32Array(count), tmp = new Float64Array(count + W);
  boxBlur(dry, W, PAD_N, PAD_N + w, BLUR_R, blur, tmp);

  // 4. Shore distance on the water side, in cells, capped.
  const dist = new Int16Array(count);
  const big = 3 * 64;
  let anyWater = false, anySea = false;
  for (let i = 0; i < count; i++) {
    if (water[i]) { dist[i] = big; anyWater = true; if (water[i] === 1) anySea = true; }
  }
  // Distances are only read on water cells, so a dry window needs no transform.
  if (anyWater) chamfer(dist, W, H, PAD_N - SHORE_CAP - 1);

  // Cells from the sea on the land side, so shore bands follow the coast and not the G nodes.
  const inland = new Int16Array(count);
  inland.fill(big);
  if (anySea) {
    for (let i = 0; i < count; i++) if (water[i] === 1) inland[i] = 0;
    chamfer(inland, W, H, PAD_N - COVER_N - SHORE_BAND - 2);
  }

  // 5. Rivers: the cells under each curve, the flow phase there, and the distance to the nearest.
  const riv = new Int16Array(count).fill(big);
  const phase = new Uint8Array(count);
  /** River cells of a river at least 2 cells wide: the ones that carry riverside trees. */
  const wide = new Uint8Array(count);
  let rivers = false;
  forEachRiverPoint(world, wx0, wy0, wx0 + W, wy0 + H, (px, py, width, run, _first, exact) => {
    // A river two cells wide or more is the cells whose centres lie within half its own, unrounded width of the curve, so its banks
    // follow the curve; a stream is the cells the curve passes through.
    const r = width >= 2 ? (exact < 1.5 ? 0.75 : exact / 2) : 0.5, r2 = r * r;
    const cx = Math.floor(px) - wx0, cy = Math.floor(py) - wy0;
    // A rill that reaches the town's terraces goes under them in a culvert.
    if (width === 1 && band !== null && cx >= 0 && cy >= 0 && cx < W && cy < H && band[cy * W + cx] >= 1 && band[cy * W + cx] <= 3) return;
    if (width === 1 && run >= 0) {
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) return;
      const k = cy * W + cx;
      const sx = (ground[k + 1] - ground[k - 1]) * 0.5, sy = (ground[k + W] - ground[k - W]) * 0.5;
      if (sx * sx + sy * sy > STREAM_MAX_SLOPE * STREAM_MAX_SLOPE) return;
    }
    const reach = Math.ceil(r);
    for (let yy = cy - reach; yy <= cy + reach; yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = cx - reach; xx <= cx + reach; xx++) {
        if (xx < 0 || xx >= W) continue;
        const dx = xx + 0.5 + wx0 - px, dy = yy + 0.5 + wy0 - py;
        if ((width >= 2 || xx !== cx || yy !== cy) && dx * dx + dy * dy > r2) continue;
        const i = yy * W + xx;
        if (water[i]) continue;
        // Several curve points land on one cell; the lowest run wins so the phase never depends on their order.
        // Tones 0–7: flow phase of a river (4 on still water); 8: a 1 px stream; 15: foam (set at falls).
        const ph = run < 0 ? 4 : width === 1 ? 8 : Math.floor(run) & 7;
        if (riv[i] !== 0 || ph < phase[i]) phase[i] = ph;
        riv[i] = 0;
        if (width >= 2) wide[i] = 1;
        rivers = true;
      }
    }
  });
  // Waterfalls: foam on the river at the drop, and a plunge pool just south of it.
  const falls = world.falls;
  for (let f = 0; f < falls.length; f += 3) {
    let fx = falls[f] - wx0, fy = falls[f + 1] - wy0;
    fx -= Math.floor(fx / n) * n;
    fy -= Math.floor(fy / n) * n;
    for (let oy = fy > H + 8 ? fy - n : fy; oy < H + 8; oy += n) for (let ox = fx > W + 8 ? fx - n : fx; ox < W + 8; ox += n) {
      const cx = Math.floor(ox), cy = Math.floor(oy);
      for (let yy = cy - 3; yy <= cy + 6; yy++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = yy * W + xx;
        if (water[i]) continue;
        const dx = xx + 0.5 - ox, dy = yy + 0.5 - oy;
        if (riv[i] === 0 && dx * dx + dy * dy <= 6.5) phase[i] = 15;
        else if (dx * dx + (dy - 3.5) * (dy - 3.5) <= 5) { if (riv[i] !== 0) phase[i] = 0; riv[i] = 0; rivers = true; }
      }
    }
  }

  // Cells to the nearest river due north and due south, within sight.
  const rivN = new Uint8Array(count).fill(255), rivS = new Uint8Array(count).fill(255);
  if (rivers) {
    for (let x = 0; x < W; x++) {
      let d = 255;
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        d = riv[i] === 0 ? 0 : d < RIVER_SIGHT ? d + 1 : 255;
        rivN[i] = d;
      }
      d = 255;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * W + x;
        d = riv[i] === 0 ? 0 : d < RIVER_SIGHT ? d + 1 : 255;
        rivS[i] = d;
      }
    }
  }
  // Roads: the cells under each line (1 a path, 2 a road), and the cells within two of one, where nothing is planted.
  const road = new Uint8Array(count), roadNear = new Uint8Array(count);
  if (world.roads && world.roads.segments.length) {
    let any = false;
    forEachLinePoint(world.roads, wx0, wy0, wx0 + W, wy0 + H, (px, py, width) => {
      const cx = Math.floor(px) - wx0, cy = Math.floor(py) - wy0;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      const k = cy * W + cx;
      if (water[k] || riv[k] === 0) return;
      if (width > road[k]) road[k] = width > 2 ? 2 : width;
      any = true;
    });
    if (any) {
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const k = y * W + x;
        if (road[k] === 0) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) roadNear[k + dy * W + dx] = 1;
      }
    }
  }
  const sight = { north: Infinity, south: Infinity };
  // Distance to the nearest river in any direction, for the cover's field boundaries. River cells stay 0.
  if (rivers) chamfer(riv, W, H, PAD_N - COVER_N - RIVER_OFFSET - 1);

  // 6. Cover, then scatter stamped into a crown layer.
  const cw = w + COVER_N + COVER_S, ch = h + COVER_N + COVER_S;
  const cOff = PAD_N - COVER_N;
  const gmat = new Uint8Array(count);
  const crown = new Float32Array(count).fill(-Infinity);
  const crownMat = new Uint8Array(count);
  const slope = new Float32Array(count);
  const terr = new Uint8Array(count);
  const rockAt = new Uint8Array(count);
  const shoreAt = new Uint8Array(count);
  const region = new Float32Array(6);
  const c: CoverInput = { x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0, rock: 0, region, water: 0, shore: 0, westness: 0, riverDx: 0, riverDy: 0, riverWide: 0, cliffAbove: 0, relief: 0, steep: 0, form: 0, curve: 0, formNorth: 0 };
  const fields = coverFields(ground, W, H, cOff, cOff, cw, ch);
  const cc = cN * cN;
  const rockW = new Float64Array(3);
  // Stamps may only touch cells whose crowns matter: the core, TREE_REACH to the north-west and one cell round.
  const sLo = PAD_N - TREE_REACH, sHiX = PAD_N + w + 1, sHiY = PAD_N + h + 1;

  // Column lookups for the two grids.
  const gI0 = new Int32Array(cw), gI1 = new Int32Array(cw), gF = new Float32Array(cw), gL = new Int32Array(cw);
  const cI0 = new Int32Array(cw), cI1 = new Int32Array(cw), cF = new Float32Array(cw);
  for (let x = 0; x < cw; x++) {
    const wx = wx0 + cOff + x;
    const gu = (wx + 0.5) / 4 - 0.5, gj = Math.floor(gu);
    gI0[x] = wrap(gj, gN); gI1[x] = wrap(gj + 1, gN); gF[x] = gu - gj; gL[x] = gj - gxa;
    const cu = (wx + 0.5) / 8 - 0.5, cj = Math.floor(cu);
    cI0[x] = wrap(cj, cN); cI1[x] = wrap(cj + 1, cN); cF[x] = cu - cj;
  }
  const { hand, shore, moisture, wind, exposure, debris, rock, regions } = world;
  // Shore classes live on the one ring of nodes at the water. Spread two nodes inland and voted by the corners'
  // weights, they bound beaches by the coast's own curve and not by 4-cell blocks.
  let shoreD: Uint8Array | null = null;
  if (anySea) {
    shoreD = new Uint8Array(gW * gH);
    // The ring's classes over the node window and two nodes round it.
    const rw = gW + 4, rh = gH + 4, ring = new Uint8Array(rw * rh);
    for (let j = 0; j < rh; j++) {
      const row = wrap(gya + j - 2, gN) * gN;
      for (let q = 0; q < rw; q++) ring[j * rw + q] = shore[row + wrap(gxa + q - 2, gN)];
    }
    for (let j = 0; j < gH; j++) for (let q = 0; q < gW; q++) {
      const at = (j + 2) * rw + q + 2;
      let cls = ring[at];
      if (cls === 0) {
        let bd = 99;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const d = dx * dx + dy * dy;
          if (d >= bd) continue;
          const v = ring[at + dy * rw + dx];
          if (v !== 0) { bd = d; cls = v; }
        }
      }
      shoreD[j * gW + q] = cls;
    }
  }
  const shW = new Float64Array(8);

  for (let y = 0; y < ch; y++) {
    const wy = wy0 + cOff + y;
    const gv = (wy + 0.5) / 4 - 0.5, gj = Math.floor(gv), gfy = gv - gj;
    const gr0 = wrap(gj, gN) * gN, gr1 = wrap(gj + 1, gN) * gN;
    const cv = (wy + 0.5) / 8 - 0.5, cj = Math.floor(cv), cfy = cv - cj;
    const cr0 = wrap(cj, cN) * cN, cr1 = wrap(cj + 1, cN) * cN;
    c.y = wrap(wy, n);
    for (let x = 0; x < cw; x++) {
      const i = (y + cOff) * W + x + cOff;
      const terraced = band !== null && band[i] !== 0;
      const src = terraced ? (natural as Float32Array) : ground;
      const e = src[i];
      const dx = (src[i + 1] - src[i - 1]) * 0.5, dy = (src[i + W] - src[i - W]) * 0.5;
      const s = Math.sqrt(dx * dx + dy * dy);
      slope[i] = s;
      if (terraced) terr[i] = 1;

      const gfx = gF[x];
      const g00 = gr0 + gI0[x], g10 = gr0 + gI1[x], g01 = gr1 + gI0[x], g11 = gr1 + gI1[x];
      const ha = hand[g00] + (hand[g10] - hand[g00]) * gfx, hb = hand[g01] + (hand[g11] - hand[g01]) * gfx;
      let sh = 0;
      if (shoreD !== null && inland[i] <= 3 * SHORE_BAND) {
        const a = (gj - gya) * gW + gL[x];
        const s00 = shoreD[a], s10 = shoreD[a + 1], s01 = shoreD[a + gW], s11 = shoreD[a + gW + 1];
        if (s00 === s10 && s00 === s01 && s00 === s11) sh = s00;
        else {
          shW.fill(0);
          shW[s00] += (1 - gfx) * (1 - gfy); shW[s10] += gfx * (1 - gfy); shW[s01] += (1 - gfx) * gfy; shW[s11] += gfx * gfy;
          let most = 0;
          for (let k = 1; k < 8; k++) if (shW[k] > most) { most = shW[k]; sh = k; }
        }
        // Sand and shingle keep to a strip along the water whose width wanders; cliffs, dunes and saltmarsh take the whole band.
        if (sh !== 0 && sh !== 3 && sh < 5 && inland[i] > 3 * (BEACH_BAND + BEACH_WANDER * gradNoise(wrap(wx0 + cOff + x, n) / 32, c.y / 32, n / 32, 0xb3ac))) sh = 0;
      }
      shoreAt[i] = sh;

      const cfx = cF[x];
      const w00 = (1 - cfx) * (1 - cfy), w10 = cfx * (1 - cfy), w01 = (1 - cfx) * cfy, w11 = cfx * cfy;
      const c00 = cr0 + cI0[x], c10 = cr0 + cI1[x], c01 = cr1 + cI0[x], c11 = cr1 + cI1[x];
      // Rock is a class, so it takes the heaviest corner vote and its borders run smooth, not in 8-cell steps.
      rockW[0] = 0; rockW[1] = 0; rockW[2] = 0;
      rockW[rock[c00]] += w00; rockW[rock[c10]] += w10; rockW[rock[c01]] += w01; rockW[rock[c11]] += w11;
      const rk = rockW[0] >= rockW[1] ? (rockW[0] >= rockW[2] ? 0 : 2) : rockW[1] >= rockW[2] ? 1 : 2;
      rockAt[i] = rk;

      c.x = wrap(wx0 + cOff + x, n);
      c.e = e;
      c.slope = s;
      c.northness = s > 1e-6 ? dy / s : 0;
      c.westness = s > 1e-6 ? dx / s : 0;
      // The way from the nearest river to here: the gradient of the river distance, scaled to that distance.
      c.riverDx = 0;
      c.riverDy = 0;
      c.riverWide = 0;
      if (rivers) {
        if (rivS[i] !== 255 && wide[i + rivS[i] * W] === 1) c.riverWide = 1;
        else if (rivN[i] !== 255 && wide[i - rivN[i] * W] === 1) c.riverWide = 1;
      }
      if (rivers && riv[i] > 0 && riv[i] < 3 * RIVER_OFFSET) {
        const rx = riv[i + 1] - riv[i - 1], ry = riv[i + W] - riv[i - W];
        const rl = Math.sqrt(rx * rx + ry * ry);
        if (rl > 0) {
          c.riverDx = (rx / rl) * (riv[i] / 3);
          c.riverDy = (ry / rl) * (riv[i] / 3);
        }
      }
      c.hand = ha + (hb - ha) * gfy;
      c.moisture = w00 * moisture[c00] + w10 * moisture[c10] + w01 * moisture[c01] + w11 * moisture[c11];
      c.wind = w00 * wind[c00] + w10 * wind[c10] + w01 * wind[c01] + w11 * wind[c11];
      c.exposure = w00 * exposure[c00] + w10 * exposure[c10] + w01 * exposure[c01] + w11 * exposure[c11];
      c.debris = w00 * debris[c00] + w10 * debris[c10] + w01 * debris[c01] + w11 * debris[c11];
      // The cover blends rock kinds where they meet; the flags keep the voted class.
      c.rock = rockW[1] + 2 * rockW[2];
      c.cliffAbove = fields.cliffAbove[i];
      c.relief = fields.relief[i];
      c.steep = fields.steep[i];
      c.form = fields.form[i];
      c.curve = fields.curve[i];
      c.formNorth = fields.north[i];
      for (let a = 0; a < 6; a++) {
        const o = a * cc;
        region[a] = w00 * regions[o + c00] + w10 * regions[o + c10] + w01 * regions[o + c01] + w11 * regions[o + c11];
      }
      c.shore = sh;
      c.water = water[i] ? water[i] : riv[i] === 0 ? 3 : 0;
      const m = look.cover(c, mask);
      gmat[i] = m;
      if (c.water !== 0) continue;
      if (roadNear[i] !== 0) {
        if (road[i] !== 0 && bi) gmat[i] = road[i] === 2 ? bi.built.mats.road : bi.built.mats.path;
        continue;
      }
      if (band !== null && band[i] !== 0 && band[i] !== 4) {
        // The town's hillside is gardens and vines, a terrace of each in turn, with few trees.
        if (bi) gmat[i] = band[i] === 2 ? bi.built.mats.vine : bi.built.mats.yard;
        if ((mask[((c.y + 201) & 255) * 256 + ((c.x + 9) & 255)] & 31) !== 0) continue;
      }
      if (pad !== null && pad[i] > 40) {
        // A pad is a clearing: grass, speckled out over its skirt, and nothing planted.
        if (bi && pad[i] > mask[((c.y + 37) & 255) * 256 + ((c.x + 101) & 255)]) gmat[i] = bi.built.mats.yard;
        continue;
      }

      sight.north = rivN[i] === 255 ? Infinity : rivN[i];
      sight.south = rivS[i] === 255 ? Infinity : rivS[i];
      const st = look.scatter(c, m, mask, sight);
      if (!st) continue;
      if (st.h <= 0) {
        // A flat stamp (flowers) only recolours the ground it is rooted on.
        gmat[i] = st.mat;
        continue;
      }
      // The stamp's centre in window cells, and the ground it stands on.
      let ox = st.x - c.x, oy = st.y - c.y;
      if (ox > n / 2) ox -= n; else if (ox < -n / 2) ox += n;
      if (oy > n / 2) oy -= n; else if (oy < -n / 2) oy += n;
      const scx = ox + (x + cOff), scy = oy + (y + cOff);
      const r = st.r > STAMP_REACH - 1.5 ? STAMP_REACH - 1.5 : st.r;
      const bx = Math.floor(scx), by = Math.floor(scy);
      if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
      const base = ground[by * W + bx];
      const r2 = r * r;
      const lx = Math.max(sLo, Math.ceil(scx - r - 0.5)), hx = Math.min(sHiX - 1, Math.floor(scx + r - 0.5));
      const ly = Math.max(sLo, Math.ceil(scy - r - 0.5)), hy = Math.min(sHiY - 1, Math.floor(scy + r - 0.5));
      for (let yy = ly; yy <= hy; yy++) {
        for (let xx = lx; xx <= hx; xx++) {
          const ddx = xx + 0.5 - scx, ddy = yy + 0.5 - scy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > r2) continue;
          const k = yy * W + xx;
          if (water[k] || riv[k] === 0) continue;
          const f = st.shape === 1 ? 1 - (0.85 * Math.sqrt(d2)) / r : 0.35 + 0.65 * Math.sqrt(1 - d2 / r2);
          const top = base + st.h * f;
          if (top > crown[k] && top > ground[k]) {
            crown[k] = top;
            crownMat[k] = st.mat;
          }
        }
      }
    }
  }

  // Stack tops are turf; point bars are pale sand with nothing growing on them.
  if (stackTop !== null && look.turf !== undefined) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = (y + cOff) * W + x + cOff;
      if (stackTop[i] === 1 && water[i] === 0 && slope[i] < 1) gmat[i] = look.turf;
    }
  }
  if (world.bars && look.barSand !== undefined) {
    const sand = look.barSand;
    for (const p of world.bars) {
      forEachPatchCell(p, n, wx0, wy0, W, H, (i) => {
        if (water[i] !== 0 || riv[i] === 0 || road[i] !== 0) return;
        gmat[i] = sand;
        crown[i] = -Infinity;
      });
    }
  }

  // Structures: their tops go into the crown layer over whatever grew there; their yards repaint the ground.
  const fixed = new Uint8Array(count), made = new Uint8Array(count);
  if (bi) {
    for (const id of structuresIn(bi, wx0, wy0, wx0 + W, wy0 + H)) {
      const s = bi.built.structures[id];
      const ox = imageOffset(s.x, s.w, wx0, n), oy = imageOffset(s.y, s.h, wy0, n);
      for (let j = 0; j < s.h; j++) {
        const yy = oy + j;
        if (yy < 0 || yy >= H) continue;
        for (let q = 0; q < s.w; q++) {
          const xx = ox + q;
          if (xx < 0 || xx >= W) continue;
          const a = j * s.w + q, k = yy * W + xx;
          if (s.top[a] > 0) {
            crown[k] = (s.onGround ? ground[k] : s.base) + s.top[a];
            crownMat[k] = s.mat[a];
            fixed[k] = s.tone[a];
            made[k] = 2;
          } else if (s.paint[a] !== 0 && made[k] !== 2) {
            crown[k] = -Infinity;
            if (!water[k] && riv[k] !== 0) { gmat[k] = s.paint[a]; made[k] = 1; }
          }
        }
      }
    }
  }

  // 7. The drawn surface over the crown region.
  const surf = new Float32Array(count);
  for (let y = sLo - 1; y <= sHiY; y++) {
    for (let x = sLo - 1; x <= sHiX; x++) {
      const i = y * W + x;
      const v = crown[i] > dry[i] ? crown[i] : dry[i];
      surf[i] = v > HMAX ? HMAX : v;
    }
  }

  // Sea mottling, sampled on the world's 8-cell lattice and interpolated.
  const mBaseX = Math.floor(x0 / 8), mBaseY = Math.floor(y0 / 8);
  const mOffX = x0 - mBaseX * 8, mOffY = y0 - mBaseY * 8;
  const mW = Math.floor((w + mOffX) / 8) + 2, mH = Math.floor((h + mOffY) / 8) + 2;
  const mott = new Float32Array(mW * mH);
  for (let j = 0; j < mH; j++) for (let i = 0; i < mW; i++) {
    const lx = wrap(mBaseX + i, n / 8), ly = wrap(mBaseY + j, n / 8);
    mott[j * mW + i] = 1.1 * gradNoise(lx / 4, ly / 4, n / 32, 0x5ea) + 0.5 * gradNoise(lx, ly, n / 8, 0x5eb);
  }

  // The apron: shingle and fallen boulders in the water at a sea cliff's foot, a cell or two wide and broken by gaps,
  // so a cliff stands on something. 0 none, 1 shingle, 2 a boulder.
  const apronAt = (i: number, X: number, Y: number): number => {
    if (water[i] !== 1 || dist[i] > 4 * APRON_WIDTH) return 0;
    const ring = dist[i] <= 4 ? 1 : dist[i] <= 8 ? 2 : 3;
    const v = gradNoise(X / 8, Y / 8, n / 8, 0xa970);
    if (v < (ring === 1 ? -0.3 : ring === 2 ? -0.08 : 0.25)) return 0;
    let foot = false;
    for (let k = 1; k <= ring && !foot; k++) {
      for (let q = 0; q < 5 && !foot; q++) {
        const j = q === 0 ? i - k * W : q === 1 ? i - k * W - 1 : q === 2 ? i - k * W + 1 : q === 3 ? i - k : i + k;
        foot = water[j] === 0 && shoreAt[j] === 3 && (ground[j] >= 1.5 || slope[j] >= CLIFF_SLOPE);
      }
    }
    if (!foot) return 0;
    return hash2(X, Y, 0xb01d) % APRON_BOULDER === 0 ? 2 : 1;
  };

  // 8. Light, shadow and flags for the core.
  const out: Cells = { w, h, surf: new Float32Array(w * h), mat: new Uint8Array(w * h), light: new Uint8Array(w * h), flags: new Uint8Array(w * h), aux: new Uint8Array(w * h) };
  const noInk = look.noInk;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + PAD_N) * W + x + PAD_N;
      const o = y * w + x;
      const top = surf[i];
      const hasCrown = crown[i] > dry[i];
      let m = hasCrown ? crownMat[i] : gmat[i];
      const structure = hasCrown && made[i] === 2;
      // A street terrace's riser is a retaining wall.
      if ((made[i] === 1 || terr[i] === 1) && !hasCrown && bi && ground[i] - ground[i + W] > 1.2) m = bi.built.mats.retaining;
      let flags = 0;

      // Shadow: terrain by the exact sweep, crowns and rocks by a short march.
      let over = ray[i];
      const deep = over - top >= 9;
      for (let k = 1; k <= TREE_REACH; k++) {
        const v = surf[i - k * (W + 1)] - k * SHADOW_DROP;
        if (v > over) over = v;
      }
      flags |= shadowDepth(over, top);

      out.surf[o] = top;
      out.mat[o] = m;
      if (water[i] === 1 && !structure && look.apron !== undefined && anySea) {
        const X = wrap(x0 + x, n), Y = wrap(y0 + y, n);
        const ap = apronAt(i, X, Y);
        if (ap !== 0) {
          const hs = hash2(X, Y, 0x5a17);
          const boulder = ap === 2 && look.apronRock !== undefined;
          out.mat[o] = boulder ? (look.apronRock as number) : look.apron;
          if (boulder) out.surf[o] = top + 1 + ((hs >>> 8) & 1);
          // Pale stones under the dark wall, a tone darker where the water laps them. The cliff's own shadow is held to
          // its lightest, or the strip reads as a violet line round the coast.
          out.light[o] = boulder ? 96 + (hs & 31) : (dist[i] <= 4 ? 126 : 110) + (hs & 15);
          out.aux[o] = 0;
          out.flags[o] = ((flags & F_SHADOW) !== 0 ? 1 : 0) | F_QUIET;
          continue;
        }
      }
      if (water[i] !== 0 && !structure) {
        // Tone: cells from the shore across the shallows, then the depth of the water beyond them.
        // Blue noise per cell breaks the steps between tones into a wash.
        const dither = (mask[((wrap(y0 + y, n) + 91) & 255) * 256 + ((wrap(x0 + x, n) + 157) & 255)] + 0.5) / 256;
        const d = (dist[i] - 3) / 3;
        const depth = (water[i] === 2 ? level[i] : 0) - ground[i];
        // Low-frequency mottling: a wash, not a gradient.
        const mx = (x + mOffX) / 8, my = (y + mOffY) / 8, mi = Math.floor(mx), mj = Math.floor(my), mfx = mx - mi, mfy = my - mj;
        const ma = mj * mW + mi;
        const mottle = (1 - mfy) * (mott[ma] + (mott[ma + 1] - mott[ma]) * mfx) + mfy * (mott[ma + mW] + (mott[ma + mW + 1] - mott[ma + mW]) * mfx);
        // Tone follows the sea bed: a wide pale shelf in a shallow bay, dark water straight under a cliff.
        // Only the cell on the shore itself is foam.
        // The ramp is spent fastest over the shelf: turquoise shallows, mid blue by 5 units, deep blue offshore.
        const deep = 1 + (depth <= 0 ? 0 : (13.5 * depth) / (depth + SEA_HALF)) + mottle * (depth < 4 ? depth / 4 : 1);
        const far = deep > 14 ? 14 : deep;
        let v = Math.floor(d < 0.5 ? 0 : far < 1 ? 1 : far + dither - 0.5);
        // The sea breaks on the apron at a cliff's foot as it does on a shore.
        if (v > 0 && water[i] === 1 && look.apron !== undefined && dist[i] <= 4 * APRON_WIDTH + 4) {
          const X = wrap(x0 + x, n), Y = wrap(y0 + y, n);
          if (apronAt(i - W, X, wrap(Y - 1, n)) !== 0 || apronAt(i - 1, wrap(X - 1, n), Y) !== 0 || apronAt(i + 1, wrap(X + 1, n), Y) !== 0) v = 0;
        }
        out.aux[o] = v < 0 ? 0 : v > 15 ? 15 : v;
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }
      if (riv[i] === 0 && !structure) {
        let ph = phase[i];
        if (ph === 8) {
          // A stream is a line of water a little darker than the ground it crosses: it takes that ground's shade.
          const t = shade((ground[i + 1] - ground[i - 1]) * 0.5, (ground[i + W] - ground[i - W]) * 0.5, dry[i] - blur[i], ground[i]);
          const k = Math.floor((t - 0.2) * 14);
          ph = 8 + (k < 0 ? 0 : k > 6 ? 6 : k);
        }
        out.aux[o] = ph;
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }

      const gx = (surf[i + 1] - surf[i - 1]) * 0.5, gy = (surf[i + W] - surf[i - W]) * 0.5;
      const snow = !hasCrown && look.isSnow !== undefined && look.isSnow[m] === 1;
      let tone = snow ? shadeSnow(gx, gy, dry[i] - blur[i]) : shade(gx, gy, dry[i] - blur[i], ground[i]);
      if (hasCrown) {
        // A crown is modelled by its own dome, but keeps the light of the hillside it stands on, so woods show the land's form.
        const under = shade((ground[i + 1] - ground[i - 1]) * 0.5, (ground[i + W] - ground[i - W]) * 0.5, dry[i] - blur[i], ground[i]);
        tone = under + 0.55 * (shade(gx, gy, 0, 0) - 0.5);
        tone = tone < 0 ? 0 : tone > 1 ? 1 : tone;
      }
      if (!hasCrown) {
        // Ground just south of a wood sits in its shade: darker for a few cells, fading.
        for (let k = 1; k <= 4; k++) {
          const j = i - k * W;
          if (crown[j] > dry[j]) {
            tone -= 0.1 * (5 - k) / 4;
            if (k <= 2 && (flags & F_SHADOW) === 0) flags |= 1;
            break;
          }
        }
        if (tone < 0.06) tone = 0.06;
      }
      out.light[o] = structure && fixed[i] !== 0 ? fixed[i] : Math.floor(tone * 255 + 0.5);

      const canopy = hasCrown && look.isCanopy[m] === 1;
      if (canopy) flags |= F_CANOPY;
      else {
        let ax = 0;
        if (!hasCrown && made[i] === 0 && terr[i] === 0) {
          if (slope[i] >= STEEP_SLOPE) {
            // Steep ground is hatched: sparsely from STEEP_SLOPE, densely on true cliffs. The level rides in aux.
            flags |= F_CLIFF;
            // A cliff by the land's form, not by the cell's own slope: a gully's wall on a moderate slope takes no lip and no strokes.
            ax = fields.steep[i] >= FORM_CLIFF ? 2 : 1;
          }
          // The lip of a tarn's bowl is no crest line: only the headwall behind the water keeps one, so no tarn is ringed.
          if (crest[i] !== 0 && !(lakes && besideLake(water, W, i))) ax |= ((crest[i] & 3) << AUX_CREST_SHIFT) | ((crest[i] & 4) !== 0 ? AUX_SHARP : 0);
          if (look.isRock !== undefined && look.isRock[m] === 1) ax |= AUX_ROCK;
        }
        out.aux[o] = ax;
        if (deep) flags |= F_DEEP;
      }
      if (rockAt[i] !== 0) flags |= F_BEDDED;
      const sh = shoreAt[i];
      if ((noInk && noInk[m] === 1) || (sh === 1 && slope[i] < 0.5 && ground[i] < 3)) flags |= F_QUIET;
      if (sh === 3) flags |= F_SEACLIFF;
      out.flags[o] = flags;
    }
  }
  return out;
}

/** The 256² cell tile (tx, ty). */
export function buildTile(world: BakeWorld, look: Look, mask: Uint8Array, tx: number, ty: number): Cells {
  return buildCells(world, look, mask, tx * TILE, ty * TILE, TILE, TILE);
}
