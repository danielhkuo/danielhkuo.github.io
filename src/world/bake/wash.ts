// Watercolour. The land's light is laid as three washes (shade, mid, light): inside a wash the tone barely moves, and
// between two it turns over a narrow band the dither breaks up. Where a darker wash ends crisply against a lighter
// one its last pixel is a tone darker, as pigment pools at the edge of a wash.

import { F_CANOPY } from "./cells.ts";
import type { Look } from "./cells.ts";
import type { Painted } from "./ink.ts";

/** Tones (0–1) below WASH_LOW are the shade wash, above WASH_HIGH the light wash; flat ground (0.5) lies in the mid one. */
export const WASH_LOW = 0.405;
export const WASH_HIGH = 0.6;
/** The tone each wash gathers round. */
export const WASH_TONES: readonly number[] = [0.25, 0.5, 0.77];
/** How much of the modelling inside a wash is kept. */
export const WASH_KEEP = 0.32;
/** Crowns keep more: a tree is small, and is modelled by its own dome. */
export const WASH_KEEP_CANOPY = 0.6;
/** Half the width of the band, in tone, over which one wash turns into the next. */
export const WASH_BAND = 0.028;
/** A wash's edge is crisp, and pools, where the tone steps by at least this much (of 255) to the lighter wash beside it. */
export const POOL_STEP = 16;

/** A pixel that takes no wash: water and built things. */
export const STEP_NONE = 255;

/** The wash a tone belongs to: 0 shade, 1 mid, 2 light. */
export function washOf(l: number): number {
  return l < WASH_LOW ? 0 : l < WASH_HIGH ? 1 : 2;
}

/** A tone 0–1 drawn towards its wash; `keep` is the share of the modelling inside a wash that stays. */
export function washTone(l: number, keep: number): number {
  const s = washOf(l);
  const own = WASH_TONES[s] + keep * (l - WASH_TONES[s]);
  // Near a threshold the two washes blend, evenly across the band.
  const edge = s === 0 ? WASH_LOW : s === 2 ? WASH_HIGH : l - WASH_LOW < WASH_HIGH - l ? WASH_LOW : WASH_HIGH;
  const d = l - edge;
  if (d >= WASH_BAND || d < -WASH_BAND) return own;
  const other = d < 0 ? s + 1 : s - 1;
  const theirs = WASH_TONES[other] + keep * (l - WASH_TONES[other]);
  // 0 at the band's near edge, a half on the threshold.
  const t = 0.5 - (d < 0 ? -d : d) / (2 * WASH_BAND);
  const e = t * t * (3 - 2 * t);
  return own + (theirs - own) * e;
}

const TABLE: Uint8Array = (() => {
  const out = new Uint8Array(512);
  for (let v = 0; v < 256; v++) {
    out[v] = Math.floor(washTone(v / 255, WASH_KEEP) * 255 + 0.5);
    out[256 + v] = Math.floor(washTone(v / 255, WASH_KEEP_CANOPY) * 255 + 0.5);
  }
  return out;
})();

/** Lays the washes over a painted window: rewrites the light of every land pixel and records its wash in `step`. */
export function layWashes(p: Painted, look: Look): void {
  const { w, h, mat, light, flags, step } = p;
  const built = look.isBuilt;
  for (let i = 0; i < w * h; i++) {
    const m = mat[i];
    if (look.isWater[m] === 1 || (built !== undefined && built[m] === 1)) { step[i] = STEP_NONE; continue; }
    const l = light[i];
    step[i] = washOf(l / 255);
    light[i] = TABLE[(flags[i] & F_CANOPY) !== 0 ? 256 + l : l];
  }
}

/** Whether pigment pools on pixel i: it lies in a wash that ends, crisply, against a lighter one beside it. */
export function pools(p: Painted, i: number): boolean {
  const { w, step, light, flags } = p;
  const s = step[i];
  if (s >= 2 || (flags[i] & F_CANOPY) !== 0) return false;
  const l = light[i] + POOL_STEP;
  for (let q = 0; q < 4; q++) {
    const j = q === 0 ? i - w : q === 1 ? i + w : q === 2 ? i - 1 : i + 1;
    const t = step[j];
    if (t !== STEP_NONE && t > s && light[j] >= l && (flags[j] & F_CANOPY) === 0) return true;
  }
  return false;
}
