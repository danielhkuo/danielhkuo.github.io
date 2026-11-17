// Ink by occlusion, cliff lips, cliffed coasts and hatching, on a painted
// window of bake pixels. Ink marks where the land really breaks: a pixel is
// inked when ground is hidden behind it, never because a slope is steep or a
// height steps by a pixel.

import { F_CANOPY, F_CLIFF, F_DEEP, F_BEDDED, F_QUIET, F_SEACLIFF } from "./cells.ts";

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
/** A cliff lip is inked above a rock wall at least this tall. */
export const LIP_RUN = 4;

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
      if (hid >= (canopy ? CANOPY_MIN_HIDDEN : INK_MIN_HIDDEN)) {
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

/** Full ink on the lip above a rock wall of LIP_RUN pixels or more, and on cliffed coasts at the waterline. */
export function inkCliffs(p: Painted, isWater: Uint8Array): void {
  const { w, h, flags, ink, mat, y, aux } = p;
  for (let c = 0; c < w; c++) {
    let run = 0;
    for (let r = h - 1; r >= 0; r--) {
      const i = r * w + c;
      const f = flags[i];
      if ((f & F_CLIFF) !== 0 && aux[i] >= 2) { run++; continue; }
      // The first pixel above a tall enough wall, if it is the ground the wall drops from.
      if (run >= LIP_RUN && (f & (F_QUIET | F_CANOPY)) === 0 && y[i + w] - y[i] <= 3) ink[i] = INK_FULL;
      run = 0;
    }
    for (let r = 0; r + 1 < h; r++) {
      const i = r * w + c;
      if ((flags[i] & F_SEACLIFF) !== 0 && (flags[i] & (F_QUIET | F_CANOPY)) === 0 && isWater[mat[i + w]] === 1 && isWater[mat[i]] === 0) ink[i] = INK_FULL;
    }
  }
}

/**
 * Hatching, as soft ink, on cliffs and in deep terrain shadow only. The
 * stroke masks are nested: the dense level contains the sparse one. Hard rock
 * takes vertical strokes; sedimentary rock takes bedding lines that follow
 * the strata's height; shadow takes strokes along the light. Blue noise
 * breaks every stroke into dashes.
 */
export function hatch(p: Painted, mask: Uint8Array): void {
  const { w, h, x0, r0, flags, ink, y, aux } = p;
  for (let r = 0; r < h; r++) {
    const R = r0 + r;
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const f = flags[i];
      if ((f & (F_CLIFF | F_DEEP)) === 0 || ink[i] !== 0 || (f & (F_QUIET | F_CANOPY)) !== 0) continue;
      const X = x0 + c;
      let on = false;
      if ((f & F_CLIFF) !== 0) {
        if ((f & F_BEDDED) !== 0) {
          // The pixel's own elevation: strata sit at fixed heights.
          const elev = Math.floor((4 * y[i]) / 5) - R;
          on = aux[i] >= 2
            ? (elev & 1) === 0 && mask[(R & 255) * 256 + ((X >> 2) & 255)] < ((elev & 3) === 0 ? 120 : 40)
            : (elev & 3) === 0 && mask[(R & 255) * 256 + ((X >> 2) & 255)] < 60;
        } else {
          on = aux[i] >= 2
            ? (X & 1) === 0 && mask[((R / 3) & 255) * 256 + (X & 255)] < ((X & 3) === 0 ? 110 : 36)
            : (X & 3) === 0 && mask[((R / 3) & 255) * 256 + (X & 255)] < 55;
        }
      } else {
        const d = X - R;
        on = (d & 3) === 0 && mask[(((R + X) >> 3) & 255) * 256 + (d & 255)] < 90;
      }
      if (on) ink[i] = INK_SOFT;
    }
  }
}
