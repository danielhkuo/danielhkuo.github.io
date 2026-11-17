// Light for the bake: one sun from the north-west, 63° up. Tone is
// 0.6·Lambert + 0.4·relief with contrast that grows with height; cast shadows
// come from one exact sweep along the grid diagonal the sun lies on.

/** Unit vector towards the sun: x east, y south, z up. */
export const SUN_X = -0.3210197;
export const SUN_Y = -0.3210197;
export const SUN_Z = 0.8910065;

/** The shadow ray drops this much per diagonal step (tan 63° · √2 = 2√2 to within the angle's rounding). */
export const SHADOW_DROP = 2 * Math.SQRT2;
/** A caster further than this many diagonal steps cannot shade anything: 64 · 2√2 > HMAX. */
export const SHADOW_REACH = 64;

/** Heights are multiplied by this for the Lambert term only. */
export const EXAGGERATE = 2.5;
/** And by this much more on the lowest ground, easing off by LOWLAND_TOP: rolling lowland is gentler still, and must read in light too. */
export const EXAGGERATE_LOW = 2;
export const LOWLAND_TOP = 60;

/** And by this on snow. */
export const SNOW_LEAN = 1.8;

/** The tone flat, unshadowed ground takes, 0–1. */
export const BASE_TONE = 0.5;

/**
 * Height of the shadow ray over every cell of a w × h window:
 * out[x, y] = max over k ≥ 1 of height[x − k, y − k] − k·SHADOW_DROP,
 * or −Infinity on the window's north and west edges. A cell is in shadow
 * where this exceeds its own surface.
 *
 * The step is monotone, so the value at a cell is the best caster's height
 * lowered step by step, whichever cell the sweep started from: two windows
 * agree wherever the winning caster lies inside both.
 */
export function sweepShadow(height: Float32Array, w: number, h: number, out: Float32Array): void {
  for (let x = 0; x < w; x++) out[x] = -Infinity;
  for (let y = 1; y < h; y++) {
    const row = y * w, up = row - w;
    out[row] = -Infinity;
    for (let x = 1; x < w; x++) {
      const carried = out[up + x - 1];
      const caster = height[up + x - 1];
      out[row + x] = (carried > caster ? carried : caster) - SHADOW_DROP;
    }
  }
}

/** Shadow depth in 2 bits from how far the ray passes over the surface. */
export function shadowDepth(ray: number, surface: number): number {
  const over = ray - surface;
  return over <= 0 ? 0 : over < 2.5 ? 1 : over < 9 ? 2 : 3;
}

/**
 * Box blur of radius r, written for the cells [lo, hi) × [lo, hi) of a window
 * w wide; the window must reach r cells beyond them on every side. Heights
 * are summed as whole 64ths, so the sliding sums are exact and the result
 * does not depend on where the window starts.
 */
export function boxBlur(src: Float32Array, w: number, lo: number, hi: number, r: number, dst: Float32Array, tmp: Float64Array): void {
  const win = 2 * r + 1;
  for (let y = lo - r; y < hi + r; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = lo - r; x <= lo + r; x++) sum += Math.floor(src[row + x] * 64 + 0.5);
    for (let x = lo; x < hi; x++) {
      tmp[row + x] = sum;
      sum += Math.floor(src[row + x + r + 1] * 64 + 0.5) - Math.floor(src[row + x - r] * 64 + 0.5);
    }
  }
  const inv = 1 / (64 * win * win);
  for (let x = lo; x < hi; x++) {
    let sum = 0;
    for (let y = lo - r; y <= lo + r; y++) sum += tmp[y * w + x];
    for (let y = lo; y < hi; y++) {
      dst[y * w + x] = sum * inv;
      sum += tmp[(y + r + 1) * w + x] - tmp[(y - r) * w + x];
    }
  }
}

/**
 * Tone 0–1 of a surface with gradient (dhdx, dhdy) in height per cell.
 * `relief` is the ground's height minus its 16-cell blur; `e` its height.
 */
export function shade(dhdx: number, dhdy: number, relief: number, e: number): number {
  // Lambert on exaggerated normals: the land is low and wide, and true normals barely turn.
  const low = e >= LOWLAND_TOP ? 0 : e <= 0 ? 1 : 1 - e / LOWLAND_TOP;
  const k = EXAGGERATE + EXAGGERATE_LOW * low * low;
  const ex = dhdx * k, ey = dhdy * k;
  const ndotl = (-ex * SUN_X - ey * SUN_Y + SUN_Z) / Math.sqrt(ex * ex + ey * ey + 1);
  // Rescaled so flat ground sits at one half; the dark side keeps a little sky light.
  // How far the slope leans towards the sun. A lean past the sun's own angle stays fully lit:
  // exaggerated normals would otherwise darken the steep sunward faces again.
  const toward = -(ex * SUN_X + ey * SUN_Y);
  let lam: number;
  if (toward >= 0) {
    // Full light from a lean of 0.45 towards the sun; on a steep face, from about 20° past side-on, so its terminator is not a knife edge.
    const full = Math.max(0.45, 0.16 * Math.sqrt(ex * ex + ey * ey));
    lam = 0.5 + 0.42 * (toward > full ? 1 : toward / full);
    if (ndotl < SUN_Z) lam = Math.max(0.5, lam - 0.25 * (SUN_Z - ndotl));
  } else {
    // A face side-on to the sun sits at the flat tone, and darkens steadily as it turns away, to full shade at about 70° past it:
    // the two sides of the terminator meet, so a slope that strikes along the sun's bearing shows no seam.
    const turn = -toward / (0.42 * Math.sqrt(ex * ex + ey * ey));
    const ease = turn >= 1 ? 1 : turn * turn * (3 - 2 * turn);
    lam = 0.5 + (0.5 * (0.12 + (0.88 * ndotl) / SUN_Z) - 0.5) * ease;
    if (lam < 0.03) lam = 0.03;
  }
  // Relief: hollows and valley floors darken (ambient occlusion); crests lighten only a little, so they grow no rim.
  let rel = relief < 0 ? 0.5 + 0.065 * relief : 0.5 + 0.004 * relief;
  if (rel < 0.02) rel = 0.02;
  else if (rel > 0.53) rel = 0.53;
  const lit = 0.5 + 0.68 * (lam - 0.5) + 0.32 * (rel - 0.5);
  // Contrast grows with height (after Imhof): lowland hills still read in light, summits are crisp.
  const contrast = 1.02 + (e < 0 ? 0 : e > 130 ? 130 : e) / 340;
  const tone = BASE_TONE + (lit - 0.5) * contrast;
  // Keep clear of the ramp's two ends.
  return tone < 0.06 ? 0.06 : tone > 0.94 ? 0.94 : tone;
}

/**
 * Tone 0–1 of snow, from its own normal alone: flat snow sits at the base tone, a
 * slope turned to the sun runs up to a clean blue-white, one turned away falls
 * steadily into blue-violet shade, so ridges, couloirs and cirque walls model.
 * Couloirs and lee hollows sit a little deeper.
 */
export function shadeSnow(dhdx: number, dhdy: number, relief: number): number {
  // Snowfields are broad and low: the normal is leaned a little, less than the land's, so no face saturates.
  const ex = dhdx * SNOW_LEAN, ey = dhdy * SNOW_LEAN;
  const ndotl = (-ex * SUN_X - ey * SUN_Y + SUN_Z) / Math.sqrt(ex * ex + ey * ey + 1);
  let tone = ndotl >= SUN_Z ? BASE_TONE + (0.36 * (ndotl - SUN_Z)) / (1 - SUN_Z) : BASE_TONE - 0.66 * (SUN_Z - ndotl);
  if (relief < 0) tone += relief < -10 ? -0.09 : 0.009 * relief;
  return tone < 0.08 ? 0.08 : tone > 0.94 ? 0.94 : tone;
}
