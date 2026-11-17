// Ink by occlusion, cliff lips, cliffed coasts and hatching, on a painted
// window of bake pixels. Ink marks where the land really breaks: a pixel is
// inked when ground is hidden behind it, never because a slope is steep or a
// height steps by a pixel.

import { hash2 } from "../core/hash.ts";
import { AUX_CREST_SHIFT, AUX_STEEP, F_CANOPY, F_CLIFF, F_DEEP, F_QUIET, F_SEACLIFF } from "./cells.ts";

export const INK_NONE = 0;
export const INK_SOFT = 1;
export const INK_FULL = 2;
/** Solid ink: the crest lines that hide the most. */
export const INK_SOLID = 3;

/** Ink needs at least this many world rows hidden behind the nearer pixel, and this much drop. */
export const INK_MIN_HIDDEN = 3;
export const INK_MIN_DROP = 3;
/** A crown inks against the ground from this many hidden rows and this much drop. */
export const CANOPY_MIN_HIDDEN = 2;
export const CANOPY_MIN_DROP = 2;
/** From this many hidden rows the ink is full. */
export const INK_FULL_HIDDEN = 10;
/** And from this many it is solid. */
export const INK_SOLID_HIDDEN = 24;
/** A side silhouette is traced at most this many pixels below its crest. */
export const CREST_REACH = 24;
/** Hatching reaches this many pixels down from a cliff's lip. */
export const LIP_HATCH = 7;
/** A cliff lip is inked above a rock wall at least this tall. */
export const LIP_RUN = 9;
/** From a wall this tall the lip's ink is full; a shorter crag's is soft. */
export const LIP_FULL = 16;

/** A painted window: one entry per bake pixel, row-major, w × h. */
export interface Painted {
  w: number;
  h: number;
  /** Absolute bake coordinates of the window's first pixel. */
  x0: number;
  r0: number;
  mat: Uint8Array;
  light: Uint8Array;
  flags: Uint8Array;
  aux: Uint8Array;
  /** World row of the cell each pixel shows. */
  y: Int32Array;
  /** Drawn height of that cell. */
  height: Float32Array;
  /** World rows hidden between this pixel and the one above it, where the drop is enough for ink; else 0. */
  hidden: Uint8Array;
  ink: Uint8Array;
}

export function newPainted(x0: number, r0: number, w: number, h: number): Painted {
  const c = w * h;
  return {
    w, h, x0, r0,
    mat: new Uint8Array(c), light: new Uint8Array(c), flags: new Uint8Array(c), aux: new Uint8Array(c),
    y: new Int32Array(c), height: new Float32Array(c), hidden: new Uint8Array(c), ink: new Uint8Array(c),
  };
}

/**
 * Occlusion ink. The painter has recorded, on the nearer pixel of each
 * vertical pair, how many world rows lie hidden behind it. That inks crests.
 * Where a silhouette runs steeper than 45° the crest pixels of neighbouring
 * columns do not touch, so each column carries its crest down a little way and
 * inks the pixels whose sideways neighbour lies behind that crest.
 */
export function inkOcclusion(p: Painted): void {
  const { w, h, flags, hidden, ink, y, height } = p;
  const crestY = new Int32Array(w * h);
  const crestInk = new Uint8Array(w * h);
  for (let c = 0; c < w; c++) {
    let cy = 0, ci = 0, age = CREST_REACH + 1;
    for (let r = 0; r < h; r++) {
      const i = r * w + c;
      age++;
      const hid = hidden[i];
      const f = flags[i];
      const canopy = (f & F_CANOPY) !== 0;
      // Crowns take no ink: a wood's edge is drawn by its shade, and an inked edge reads as an outline round every copse.
      // Inside a rock face a short hide is a ledge among ledges: only a real break is inked there.
      if (!canopy && hid >= ((f & F_CLIFF) !== 0 ? INK_FULL_HIDDEN : INK_MIN_HIDDEN)) {
        const quiet = (f & F_QUIET) !== 0 || (canopy && (flags[i - w] & F_CANOPY) !== 0);
        if (!quiet) {
          // A crown is small: its edge takes soft ink only, and no side tracing.
          const v = canopy ? INK_SOFT : hid >= INK_SOLID_HIDDEN ? INK_SOLID : hid >= INK_FULL_HIDDEN ? INK_FULL : INK_SOFT;
          ink[i] = v;
          if (!canopy) { cy = y[i]; ci = v; age = 0; }
        }
      }
      if (age <= CREST_REACH) { crestY[i] = cy; crestInk[i] = ci; }
    }
  }
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const v = crestInk[i];
      if (v === 0 || ink[i] !== 0) continue;
      const f = flags[i];
      if ((f & (F_QUIET | F_CANOPY)) !== 0) continue;
      const lim = (y[i] < crestY[i] ? y[i] : crestY[i]) - INK_MIN_HIDDEN - 1;
      const top = height[i] - INK_MIN_DROP;
      if ((c > 0 && y[i - 1] <= lim && height[i - 1] <= top) || (c + 1 < w && y[i + 1] <= lim && height[i + 1] <= top)) ink[i] = v;
    }
  }
}

/** Ink on the lip above a rock wall of LIP_RUN pixels or more (full from LIP_FULL), and on cliffed coasts at the waterline. */
export function inkCliffs(p: Painted, isStill: Uint8Array): void {
  const { w, h, x0, r0, flags, ink, mat, y, aux, height } = p;
  for (let c = 0; c < w; c++) {
    let run = 0;
    for (let r = h - 1; r >= 0; r--) {
      const i = r * w + c;
      const f = flags[i];
      if ((f & F_CLIFF) !== 0 && (aux[i] & AUX_STEEP) >= 2) { run++; continue; }
      // The first pixel above a tall enough wall, if it is the ground the wall drops from.
      if (run >= LIP_RUN && (f & (F_QUIET | F_CANOPY)) === 0 && y[i + w] - y[i] <= 3) ink[i] = run >= LIP_FULL ? INK_FULL : INK_SOFT;
      run = 0;
    }
    // The coastline: a thin line where land meets standing water, full at a cliff's foot. Beaches take foam, not ink.
    for (let r = 0; r + 1 < h; r++) {
      const i = r * w + c;
      const f = flags[i];
      if ((f & (F_QUIET | F_CANOPY)) !== 0 || isStill[mat[i]] === 1 || ink[i] !== 0) continue;
      const j = isStill[mat[i + w]] === 1 ? i + w : c > 0 && isStill[mat[i - 1]] === 1 ? i - 1 : c + 1 < w && isStill[mat[i + 1]] === 1 ? i + 1 : -1;
      if (j < 0) continue;
      if (height[j] > 0.5) {
        // A lake or tarn: a light, broken line along the far shore only, never a ring.
        if (j === i + w && (((x0 + c + 2 * (r0 + r)) % 5) + 5) % 5 < 3) ink[i] = INK_SOFT;
      } else ink[i] = (f & F_SEACLIFF) !== 0 ? INK_FULL : INK_SOFT;
    }
  }
}

/**
 * Crest lines: the topmost pixel of a cell that stands on a ridge (cells.ts marks them) takes ink even where
 * nothing is hidden behind it, so a range keeps its skeleton under snow and on slopes too gentle to occlude.
 */
export function inkCrests(p: Painted): void {
  const { w, h, flags, ink, aux, y } = p;
  for (let r = 1; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (ink[i] !== 0 || (flags[i] & (F_QUIET | F_CANOPY)) !== 0) continue;
      const v = (aux[i] >> AUX_CREST_SHIFT) & 3;
      if (v === 0) continue;
      // A crest that runs away from the camera is a column of cells, each a pixel or two tall: both are inked, so the line is whole.
      if (y[i - w] === y[i] && (v !== 3 || r < 2 || y[i - 2 * w] === y[i])) continue;
      ink[i] = v === 2 ? INK_FULL : INK_SOFT;
    }
  }
}

/**
 * Hatching, as soft ink: only on steep faces that are in shade, and in deep
 * terrain shadow. Strokes run down the fall line (down the screen on the
 * faces the camera sees). Which columns carry a stroke, where each stroke
 * starts and how long it runs all come from a hash of the position, so there
 * is no grid; cliffs carry more and longer strokes than merely steep ground.
 */
export function hatch(p: Painted, mask: Uint8Array): void {
  const { w, h, x0, r0, flags, ink, aux, light } = p;
  for (let c = 0; c < w; c++) {
    const X = x0 + c;
    const hx = hash2(X, 17, 0x4a7c);
    // About one column in four carries strokes at all.
    const pick = hx & 255;
    const period = 11 + ((hx >>> 8) & 7), phase = (hx >>> 12) & 31;
    // Rows since the cliff began in this column: hatching hangs from the lip and stops a little way down.
    let below = LIP_HATCH;
    for (let r = 0; r < h; r++) {
      const i = r * w + c;
      const f = flags[i];
      const cliff = (f & F_CLIFF) !== 0 && (aux[i] & AUX_STEEP) >= 2 && (f & (F_QUIET | F_CANOPY)) === 0;
      if (!cliff) { below = 0; continue; }
      below++;
      // Only at the slope break: nothing over the open face below it.
      if (below > LIP_HATCH || ink[i] !== 0) continue;
      if ((f & F_DEEP) === 0 && light[i] > 100) continue;
      if (pick > 64) continue;
      const R = r0 + r;
      // Strokes of 3–8 px with gaps, each band of the column offset by a second hash; blue noise frays their ends.
      const band = Math.floor((R + phase) / period);
      const hb = hash2(X, band, 0x91e3);
      const start = hb & 3, len = (cliff ? 4 : 3) + ((hb >>> 2) & 3) + (cliff ? (hb >>> 4) & 1 : 0);
      const q = R + phase - band * period;
      if (q >= start && q < start + len && (hb >>> 8 & 3) !== 0 && mask[(R & 255) * 256 + (X & 255)] < 235) ink[i] = INK_SOFT;
    }
  }
}
