// Ink by occlusion, cliff lips, cliffed coasts and hatching, on a painted
// window of bake pixels. Ink marks where the land really breaks: a pixel is
// inked when ground is hidden behind it, never because a slope is steep or a
// height steps by a pixel.

import { hash2 } from "../core/hash.ts";
import { AUX_CREST_SHIFT, AUX_ROCK, AUX_SHARP, AUX_STEEP, F_BEDDED, F_CANOPY, F_CLIFF, F_DEEP, F_QUIET, F_SEACLIFF } from "./cells.ts";

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
/** Of 256: the share of columns that carry hatching at all. */
export const HATCH_PICK = 44;
/** A cliff lip is inked above a rock wall at least this tall. */
export const LIP_RUN = 5;
/** From a wall this tall the lip's ink is full; a shorter crag's is soft. */
export const LIP_FULL = 12;
/** A break with more wall within this many rows above it is a ledge in a face, not a lip. */
export const LIP_LEDGE = 4;
/** A lip is evened against its neighbours' lips up to this many rows off. */
export const LIP_SEEK = 4;
/** Ground with no crest and no steep face near it inks only where the hollow hidden behind it is this deep: a slight swell takes no line. */
export const SWELL_DROP = 5;
/** A crest that stands in front of higher ground is a silhouette from this many hidden rows, over a hollow this deep. */
export const SILHOUETTE_HIDDEN = 8;
export const SILHOUETTE_DROP = 4;
/** Cell spans are counted to this many pixels (the painter's bottom margin must be at least as tall). */
export const SPAN_CAP = 12;
/** A rock cell drawn over this many pixels or more is a wall. */
export const WALL_SPAN = 5;
/** Beds of sedimentary rock are about this thick, in height units; hard rock breaks into blocks about this tall. */
export const BED_SOFT = 4;
export const BED_HARD = 8;
/** A sea cliff is wet and dark this far up from the water, and darkens towards it from WET_FADE. */
export const WET_FOOT = 2.2;
export const WET_FADE = 7;

/**
 * Whether the land breaks behind a pixel that hides `hid` world rows: `drop` is how far the ground seen over it lies
 * below it, `hollow` how deep the hidden ground falls, `firm` whether a crest or a steep face stands there.
 */
export function landBreaks(hid: number, drop: number, hollow: number, firm: boolean): boolean {
  if (!firm && hollow < SWELL_DROP) return false;
  if (drop >= INK_MIN_DROP) return true;
  return hid >= SILHOUETTE_HIDDEN && hollow >= SILHOUETTE_DROP;
}

/** Standing water above this height is a tarn: its shore is inked only under a steep bank. */
export const TARN_LEVEL = 40;

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
  /** World rows hidden between this pixel and the one above it, where the land really breaks there; else 0. */
  hidden: Uint8Array;
  /** Pixels below the top of the cell this pixel shows: 0 on its top, 1 and more down its south wall. */
  wall: Uint8Array;
  /** Pixels the whole of that cell is drawn over, up to SPAN_CAP: 5 and more is a wall. */
  span: Uint8Array;
  ink: Uint8Array;
}

export function newPainted(x0: number, r0: number, w: number, h: number): Painted {
  const c = w * h;
  return {
    w, h, x0, r0,
    mat: new Uint8Array(c), light: new Uint8Array(c), flags: new Uint8Array(c), aux: new Uint8Array(c),
    y: new Int32Array(c), height: new Float32Array(c), hidden: new Uint8Array(c), wall: new Uint8Array(c), span: new Uint8Array(c), ink: new Uint8Array(c),
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

/**
 * Ink on the lip above a rock wall of LIP_RUN pixels or more (full from LIP_FULL), one unbroken line: where the lip
 * steps between columns the step is inked too. And ink on cliffed coasts at the waterline.
 */
export function inkCliffs(p: Painted, isStill: Uint8Array): void {
  const { w, h, x0, r0, flags, ink, mat, y, aux, height, span } = p;
  // A wall: steep cliff ground, or a rock cell that is drawn as one.
  const face = (i: number): boolean => {
    const f = flags[i];
    if ((f & (F_QUIET | F_CANOPY)) !== 0) return false;
    return ((f & F_CLIFF) !== 0 && (aux[i] & AUX_STEEP) >= 2) || ((aux[i] & AUX_ROCK) !== 0 && span[i] >= WALL_SPAN);
  };
  // The lip of each wall: the weight its height earns, on the first pixel above it.
  const lip = new Uint8Array(w * h);
  for (let c = 0; c < w; c++) {
    for (let r = 0; r + 1 < h; r++) {
      const i = r * w + c;
      if (face(i) || !face(i + w)) continue;
      if ((flags[i] & (F_QUIET | F_CANOPY)) !== 0 || y[i + w] - y[i] > 3) continue;
      // A lip is where the ground above breaks into the wall: steep rock, or a ledge with more wall close above it,
      // is inside a face and takes none.
      if ((flags[i] & F_CLIFF) !== 0 && (aux[i] & AUX_ROCK) !== 0) continue;
      if (r < LIP_LEDGE) continue;
      let ledge = false;
      for (let q = 1; q <= LIP_LEDGE && !ledge; q++) ledge = face(i - q * w);
      if (ledge) continue;
      let run = 1;
      while (run < LIP_FULL && r + 1 + run < h && face(i + w + run * w)) run++;
      if (run >= LIP_RUN) lip[i] = run >= LIP_FULL ? INK_FULL : INK_SOFT;
    }
  }
  // The line is drawn on the middle of the lip rows of five columns, so a lip that jumps a row or two from column
  // to column is one even line and not a row of teeth; a step of more than a pixel is inked down the wall.
  const line = new Uint8Array(w * h);
  const rows = [0, 0, 0, 0, 0];
  for (let r = LIP_SEEK; r + LIP_SEEK < h; r++) {
    for (let c = 2; c + 2 < w; c++) {
      const i = r * w + c;
      if (lip[i] === 0) continue;
      let v = lip[i], m = 0;
      for (let dc = -2; dc <= 2; dc++) {
        if (dc === 0) { rows[m++] = 0; continue; }
        // The neighbouring column's lip nearest this one.
        for (let q = 0; q <= LIP_SEEK; q++) {
          const up = lip[i + dc - q * w], down = lip[i + dc + q * w];
          if (up === 0 && down === 0) continue;
          rows[m++] = up !== 0 ? -q : q;
          if ((up > down ? up : down) > v) v = up > down ? up : down;
          break;
        }
      }
      // The median offset (insertion sort of at most five).
      for (let a = 1; a < m; a++) {
        const t = rows[a];
        let b = a - 1;
        for (; b >= 0 && rows[b] > t; b--) rows[b + 1] = rows[b];
        rows[b + 1] = t;
      }
      const j = i + rows[m >> 1] * w;
      if ((flags[j] & (F_QUIET | F_CANOPY)) === 0 && line[j] < v) line[j] = v;
    }
  }
  for (let r = 4; r + 4 < h; r++) {
    for (let c = 1; c + 1 < w; c++) {
      const i = r * w + c;
      const v = line[i];
      if (v === 0) continue;
      if (ink[i] < v) ink[i] = v;
      for (let side = -1; side <= 1; side += 2) {
        if (line[i + side] !== 0 || line[i + side + w] !== 0 || line[i + side - w] !== 0) continue;
        for (let dr = 2; dr <= 4; dr++) {
          if (line[i + side + dr * w] === 0) continue;
          for (let q = 1; q < dr; q++) if ((flags[i + q * w] & (F_QUIET | F_CANOPY)) === 0 && ink[i + q * w] < v) ink[i + q * w] = v;
          break;
        }
      }
    }
  }
  for (let c = 0; c < w; c++) {
    // The coastline: a thin line where land meets standing water, full at a cliff's foot. Beaches take foam, not ink.
    for (let r = 0; r + 1 < h; r++) {
      const i = r * w + c;
      const f = flags[i];
      if ((f & (F_QUIET | F_CANOPY)) !== 0 || isStill[mat[i]] === 1 || ink[i] !== 0) continue;
      const j = isStill[mat[i + w]] === 1 ? i + w : c > 0 && isStill[mat[i - 1]] === 1 ? i - 1 : c + 1 < w && isStill[mat[i + 1]] === 1 ? i + 1 : -1;
      if (j < 0) continue;
      if (height[j] > 0.5) {
        // A lake or tarn takes a light line along the far shore only, never a ring: under a steep bank (a cirque's
        // headwall) the line is whole; a lowland lake's gentle far shore keeps a broken one; a tarn's gentle shore none.
        if (j !== i + w) continue;
        if ((f & F_CLIFF) !== 0) ink[i] = INK_SOFT;
        else if (height[j] < TARN_LEVEL && (((x0 + c + 2 * (r0 + r)) % 5) + 5) % 5 < 3) ink[i] = INK_SOFT;
      } else ink[i] = (f & F_SEACLIFF) !== 0 ? INK_FULL : INK_SOFT;
    }
  }
}

/**
 * Crest lines. A cell that stands on a ridge (cells.ts marks them) takes ink where the land really breaks there,
 * even by less than occlusion ink asks for: a crest across the view where at least one row is hidden behind it, a
 * crest running away from the camera where the pixel beside it shows ground well behind and below. A crest over
 * open ground that hides nothing, such as the top of a broad snow dome, is left to the light.
 */
export function inkCrests(p: Painted): void {
  const { w, h, flags, ink, aux, y, hidden, height, wall } = p;
  const rocky = (i: number): boolean => (flags[i] & (F_QUIET | F_CANOPY)) === 0 && (aux[i] & AUX_ROCK) !== 0;
  for (let r = 1; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (ink[i] !== 0 || (flags[i] & (F_QUIET | F_CANOPY)) !== 0) continue;
      const v = (aux[i] >> AUX_CREST_SHIFT) & 3;
      if (v === 0) continue;
      // An arête or a summit among rock is a silhouette whatever it hides; a grassy crest is drawn only by what it hides.
      if ((aux[i] & AUX_SHARP) !== 0 && wall[i] <= 2 && c >= 2 && c + 2 < w && r >= 2 && r + 2 < h && (
        rocky(i) || rocky(i - 1) || rocky(i + 1) || rocky(i - 2) || rocky(i + 2) || rocky(i - w) || rocky(i + w) || rocky(i - 2 * w) || rocky(i + 2 * w)
      )) ink[i] = INK_SOFT;
      else if (v === 3) {
        const lim = y[i] - INK_MIN_HIDDEN, top = height[i] - 2;
        if ((c > 0 && y[i - 1] <= lim && height[i - 1] <= top) || (c + 1 < w && y[i + 1] <= lim && height[i + 1] <= top)) ink[i] = INK_SOFT;
      } else if (hidden[i] !== 0 && y[i - w] !== y[i]) ink[i] = INK_SOFT;
    }
  }
}

/**
 * Evens the lines occlusion and crests have laid, so a ridge is one line of one weight and not a run of dashes:
 * gaps of a pixel or two along a real break are closed, each pixel takes the weight of the line around it, and
 * the last two pixels of a line step down to soft, so it tapers out. Reads 7 columns and 4 rows around a pixel.
 */
export function evenLines(p: Painted): void {
  const { w, h, flags, ink, hidden } = p;
  const src = Uint8Array.from(ink);
  // Close gaps: a pixel on a break, with ink within two columns on both sides (a row up or down at most).
  for (let r = 1; r + 1 < h; r++) {
    for (let c = 2; c + 2 < w; c++) {
      const i = r * w + c;
      if (src[i] !== 0 || hidden[i] === 0 || (flags[i] & (F_QUIET | F_CANOPY)) !== 0) continue;
      let left = 0, right = 0;
      for (let dr = -w; dr <= w; dr += w) {
        left = Math.max(left, src[i + dr - 1], src[i + dr - 2]);
        right = Math.max(right, src[i + dr + 1], src[i + dr + 2]);
      }
      // The gap takes the lighter of the two weights it joins.
      if (left !== 0 && right !== 0) ink[i] = left < right ? left : right;
    }
  }
  // One weight along a line: the mean of the ink within three columns and two rows, the line's hidden rows deciding.
  const filled = Uint8Array.from(ink);
  const level = new Uint8Array(w * h);
  for (let r = 2; r + 2 < h; r++) {
    for (let c = 3; c + 3 < w; c++) {
      const i = r * w + c;
      if (filled[i] === 0) continue;
      let sum = 0, count = 0;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -3; dc <= 3; dc++) {
        const v = filled[i + dr * w + dc];
        if (v !== 0) { sum += v; count++; }
      }
      const mean = sum / count;
      level[i] = mean >= 2.5 ? INK_SOLID : mean >= 1.5 ? INK_FULL : INK_SOFT;
    }
  }
  // Taper: a line's end pixel has at most two inked pixels in the 5 × 5 round it, the next at most three.
  for (let r = 2; r + 2 < h; r++) {
    for (let c = 3; c + 3 < w; c++) {
      const i = r * w + c;
      const v = level[i];
      if (v === 0) continue;
      let near = -1;
      if (v > INK_SOFT) for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (level[i + dr * w + dc] !== 0) near++;
      ink[i] = v > INK_SOFT && near <= 2 ? INK_SOFT : v > INK_SOFT && near === 3 ? v - 1 : v;
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
    // About one column in six carries strokes at all.
    const pick = hx & 255;
    const period = 11 + ((hx >>> 8) & 7), phase = (hx >>> 12) & 31;
    // Rows since the cliff began in this column: hatching hangs from the lip and stops a little way down.
    let below = LIP_HATCH;
    for (let r = 0; r < h; r++) {
      const i = r * w + c;
      const f = flags[i];
      // A wall is drawn by its strata (rockFaces); strokes are for steep ground and for headwalls that are not walls.
      const cliff = (f & F_CLIFF) !== 0 && (aux[i] & AUX_STEEP) >= 2 && ((aux[i] & AUX_ROCK) === 0 || p.span[i] < WALL_SPAN) && (f & (F_QUIET | F_CANOPY)) === 0;
      if (!cliff) { below = 0; continue; }
      below++;
      // Only at the slope break: nothing over the open face below it.
      if (below > LIP_HATCH || ink[i] !== 0) continue;
      if ((f & F_DEEP) === 0 && light[i] > 100) continue;
      if (pick > HATCH_PICK) continue;
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

/** Value noise along the columns, 0–1, on a lattice of 1 << shift columns. */
function drift(X: number, shift: number, seed: number): number {
  const l = X >> shift, f = (X - (l << shift)) / (1 << shift);
  const a = hash2(l, 0, seed) & 255, b = hash2(l + 1, 0, seed) & 255;
  return (a + (b - a) * f * f * (3 - 2 * f)) / 255;
}

/**
 * Rock faces. A cliff is one cell drawn many pixels tall, so its face is painted here, per pixel, from the height each
 * pixel stands at: beds that run level across the face (thin and many in sedimentary rock, thick blocks in hard rock),
 * each its own tone, parted by a dark bedding line over a lit ledge; a few jagged fissures at uneven spacing; light
 * that follows the face and not each column; and on a sea cliff a dark, wet foot. Steep rock that is not a wall takes
 * the beds' tones and a faint bedding line, so strata run across a mountain face as contours.
 */
export function rockFaces(p: Painted): void {
  const { w, h, x0, flags, aux, wall, span, light, ink, height, hidden } = p;
  // 2: a pixel of a wall. 1: steep rock that is not one.
  const rock = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if ((flags[i] & (F_QUIET | F_CANOPY)) !== 0 || (aux[i] & AUX_ROCK) === 0) continue;
    rock[i] = span[i] >= WALL_SPAN && wall[i] >= 1 ? 2 : (flags[i] & F_CLIFF) !== 0 || wall[i] >= 1 ? 1 : 0;
  }
  const src = Uint8Array.from(light);
  for (let r = 0; r < h; r++) {
    for (let c = 3; c + 3 < w; c++) {
      const i = r * w + c;
      const kind = rock[i];
      if (kind === 0) continue;
      const X = x0 + c;
      const sea = (flags[i] & F_SEACLIFF) !== 0;
      let l = src[i];
      if (kind === 2) {
        // The face's light, not the column's: the mean over the wall three columns to either side.
        let sum = 0, count = 0;
        for (let dc = -3; dc <= 3; dc++) if (rock[i + dc] === 2) { sum += src[i + dc]; count++; }
        l = sum / count;
        // Ink traced down a column inside the face is a picket; the face's own lines replace it.
        if (ink[i] !== 0 && hidden[i] === 0 && rock[i - 1] === 2 && rock[i + 1] === 2) ink[i] = 0;
      } else if ((aux[i] & AUX_STEEP) >= 2) {
        // A headwall's gullies light every other column: most of that goes, so the face is modelled and not striped.
        let sum = 0, count = 0;
        for (let dc = -3; dc <= 3; dc++) if (rock[i + dc] !== 0) { sum += src[i + dc]; count++; }
        l += 0.75 * (sum / count - l);
      }
      // Lines are drawn only where the wall runs on to both sides: a lone tall cell in a broken face takes none.
      const whole = kind === 2 && rock[i - 1] === 2 && rock[i + 1] === 2;
      const bedded = (flags[i] & F_BEDDED) !== 0;
      const T = bedded ? BED_SOFT : BED_HARD;
      const z = height[i] - wall[i];
      // Beds wander a little along the face, and sedimentary beds dip gently to the east.
      const zz = z + (bedded ? 5 : 3) * drift(X, 4, 0x3be1) + 1.2 * drift(X, 2, 0x3be2) + (bedded ? X * 0.05 : 0);
      const k = Math.floor(zz / T), off = zz - k * T;
      const j = ((hash2(k, 1, 0x3be3) & 255) / 255) * T * 0.5;
      const band = off >= j ? k : k - 1;
      const hb = hash2(band, 2, 0x3be4);
      let d = bedded ? ((band & 1) !== 0 ? 13 : -11) + ((hb & 7) - 3) * 2 : ((hb & 7) - 3) * 5;
      const edge = off >= j && off < j + 1;
      if (kind === 2) {
        if (edge) d -= whole ? 30 : 14;
        else if (off < j && off >= j - 1 && l > 96) d += 14;
        // Fissures: one to a slot of uneven width, running through a few beds, jogging a column as it goes.
        const P = bedded ? 23 : 15;
        const slot = Math.floor(X / P);
        const hs = hash2(slot, bedded ? Math.floor(zz / (3 * T)) : band, 0x3be5);
        if (whole && (hs & 7) < (bedded ? 4 : 5)) {
          const cx = slot * P + 1 + ((hs >>> 4) % (P - 2)) + ((hash2(slot, Math.floor(z / 2), 0x3be6) & 3) === 0 ? 1 : 0);
          // A dark cleft, and its sunward lip a touch lighter.
          if (X === cx) d -= 42;
          else if (X === cx + 1 && l > 96) d += 8;
        }
        // A bedding line is inked in stretches, so the face is drawn and not ruled.
        if (whole && edge && ink[i] === 0 && (hash2(X >> 2, k, 0x3be7) & 7) < (bedded ? 3 : 2)) ink[i] = INK_SOFT;
        if (sea) {
          const wet = WET_FOOT + (hash2(X >> 1, 0, 0x3be8) & 1);
          if (z < wet) d -= 44;
          else if (z < WET_FADE) d -= 5 * (WET_FADE - z);
        }
      } else d = d * 0.8 - (edge ? 12 : 0);
      const v = Math.floor(l + d + 0.5);
      light[i] = v < 10 ? 10 : v > 240 ? 240 : v;
    }
  }
}
