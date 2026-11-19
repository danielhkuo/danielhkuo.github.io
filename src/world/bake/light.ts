// Light for the bake: one sun from the north-west, 63° up. Tone is
// 0.6·Lambert + 0.4·relief with contrast that grows with height; cast shadows
// come from one exact sweep along the grid diagonal the sun lies on.

/** Unit vector towards the sun: x east, y south, z up. */
export const SUN_X = -0.3210197;
export const SUN_Y = -0.3210197;
export const SUN_Z = 0.8910065;
/** The sun's vector across the ground: how much of it lies in the horizontal. */
export const SUN_H = Math.sqrt(SUN_X * SUN_X + SUN_Y * SUN_Y);

/** The shadow ray drops this much per diagonal step (tan 63° · √2 = 2√2 to within the angle's rounding). */
export const SHADOW_DROP = 2 * Math.SQRT2;
/** A caster further than this many diagonal steps cannot shade anything: 64 · 2√2 > HMAX. */
export const SHADOW_REACH = 64;

/** Heights are multiplied by this for the Lambert term only. */
export const EXAGGERATE = 2.5;
/** And by this much more on the lowest ground, easing off by LOWLAND_TOP: rolling lowland is gentler still, and must read in light too. */
export const EXAGGERATE_LOW = 2;
export const LOWLAND_TOP = 60;

/** Snow is lit by its true normal: its slope is leaned only this much. */
export const SNOW_LEAN = 1.1;
/** A snow slope's aspect counts in full from this slope; a gentler one is lit more evenly, towards the flat tone. */
export const SNOW_ASPECT = 0.32;
/** Snow this far under the mean of the ground round it (light.ts relief) takes the full lilac of a hollow. */
export const SNOW_HOLLOW = 7;
/** A steep snow face is in light only when it faces the sun's bearing by more than this cosine; short of it, in shade. */
export const SNOW_TURN = 0.3;
/** The least shade a steep face out of the light takes, so the whole face reads as one shaded face. */
export const SNOW_SHADE_FLOOR = 0.1;
/** Gentle snow's undulations are lit through its normal leaned this much. */
export const SNOW_SOFT_LEAN = 1.8;

/** Upland tones part round the terminator by up to this much, easing in between these heights. */
export const UPLAND_PART = 0.22;
export const UPLAND_LOW = 22;
export const UPLAND_HIGH = 60;

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
  let x = (lit - 0.5) * contrast;
  x = x < -0.5 ? -0.5 : x > 0.5 ? 0.5 : x;
  // On the uplands the tones are drawn apart round the terminator, so a face is in light or in shade and the hills
  // do not sit in one middle value: an S-curve that leaves flat ground and the two ends where they were.
  const up = e <= UPLAND_LOW ? 0 : e >= UPLAND_HIGH ? 1 : (e - UPLAND_LOW) / (UPLAND_HIGH - UPLAND_LOW);
  const tone = BASE_TONE + x * (1 + UPLAND_PART * up * (1 - 4 * x * x));
  // Keep clear of the ramp's two ends.
  return tone < 0.06 ? 0.06 : tone > 0.94 ? 0.94 : tone;
}

/**
 * Tone 0–1 of snow, from its true normal: the way a slope faces decides its side of the light, and its steepness how
 * far it goes. Flat snow sits at the base tone, with soft undulations of light and lilac. A slope turned towards the
 * sun runs up to a clean white. A steep one turned less than SNOW_TURN towards it is in shade, the deeper the further
 * it turns away: so each arête parts at its crest into a broad bright face and a broad lilac one, and a face turned to
 * the camera is one face in shade, its ribs modelled inside the shade and not striped white down it. Couloirs and lee
 * hollows sit a little deeper.
 */
export function shadeSnow(dhdx: number, dhdy: number, relief: number): number {
  const ex = dhdx * SNOW_LEAN, ey = dhdy * SNOW_LEAN;
  const g = Math.sqrt(ex * ex + ey * ey);
  let tone = BASE_TONE;
  if (g > 1e-6) {
    // The cosine of the turn between the way the slope faces and the sun's bearing: 1 facing it, 0 side-on, −1 away.
    const facing = -(ex * SUN_X + ey * SUN_Y) / (SUN_H * g);
    const steep = g >= SNOW_ASPECT ? 1 : g / SNOW_ASPECT;
    if (facing >= SNOW_TURN) tone += 0.4 * steep * ((facing - SNOW_TURN) / (1 - SNOW_TURN));
    else {
      const t = (SNOW_TURN - facing) / (1 + SNOW_TURN);
      // A floor of shade once the face has turned from the sun, eased in over the first quarter of the turn so the
      // terminator is soft and not a seam.
      const floor = t >= 0.25 ? 1 : (t / 0.25) * (t / 0.25) * (3 - 2 * (t / 0.25));
      tone -= steep * (SNOW_SHADE_FLOOR * floor + 0.26 * t * t * (3 - 2 * t));
      // The shade is deepest just under the crest and lifts down the face, where the snow below throws light back.
      if (relief > 0) tone -= steep * 0.05 * (relief > 5 ? 1 : relief / 5);
    }
    // Gentle snow keeps the soft light and lilac of its undulations, as a plain Lambert term would give it.
    if (steep < 1) {
      const lx = dhdx * SNOW_SOFT_LEAN, ly = dhdy * SNOW_SOFT_LEAN;
      const ndotl = (-lx * SUN_X - ly * SUN_Y + SUN_Z) / Math.sqrt(lx * lx + ly * ly + 1);
      tone += (1 - steep) * 0.6 * (ndotl - SUN_Z);
    }
  }
  // Hollows, couloirs and the lee of a ridge hold a lilac shade; crests and knolls stand a little brighter. So even flat,
  // sunlit snow is modelled and does not lie like a sheet of paper.
  if (relief < 0) tone += relief < -SNOW_HOLLOW ? -0.14 : (0.14 * relief) / SNOW_HOLLOW;
  else tone += relief > 6 ? 0.05 : (0.05 * relief) / 6;
  return tone < 0.08 ? 0.08 : tone > 0.94 ? 0.94 : tone;
}
