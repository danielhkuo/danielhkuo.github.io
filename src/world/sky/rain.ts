// Rain: streaks falling aslant over the whole frame, drawn last, over the clouds and the flier; and the splashes it
// makes on water and ground, drawn by a live layer under the flier.
//
// The streaks are inked strokes, one pixel wide, in three depths: many short faint ones far off, fewer longer ones
// nearer, and a handful of long bright ones close to the eye. They lean with the wind, fall through a space fixed to
// the land (so the flier flies through them), and come in gusts that sweep across the frame, so the rain is never an
// even hatch. Every streak is a function of its index and the time: the same t draws the same rain.

import { hash2, mix32 } from "../core/hash.ts";
import { psin } from "../core/psin.ts";
import { rngFor } from "../core/rng.ts";
import { isWater } from "../look/materials.ts";
import { gradeRgb } from "../render/palette.ts";
import type { ViewRect } from "../render/compose.ts";
import type { LiveLayer } from "../live/live.ts";
import { matOf } from "../live/pixel.ts";
import { lightKey, paletteOptions, type Air } from "./air.ts";

/** Streaks in the rain's space in full rain; about two thirds of them are on the frame at once. */
export const STREAKS = 520;
/** The rain's space, in pixels: streaks and splashes wrap round it. Wider and taller than the frame; powers of two. */
const SPACE_W = 512;
const SPACE_H = 256;
/** How far above the frame the space starts and how far left: room for the longest streak and for the lean. */
const OVER = 16;
const ASIDE = 56;
/** Pixels across for each pixel down, before the wind gives it a side: one step aside every three rows. */
const SLANT = 1 / 3;

/** One depth of rain: its share of the streaks (of 256), length and fall speed (least, most), and strength of 255. */
interface Depth {
  share: number;
  len: readonly [number, number];
  fall: readonly [number, number];
  alpha: readonly [number, number];
}
/** Far, middle and near. The near ones are few, long and quick. */
const DEPTHS: readonly Depth[] = [
  { share: 150, len: [3, 5], fall: [150, 190], alpha: [120, 165] },
  { share: 88, len: [5, 8], fall: [200, 250], alpha: [175, 225] },
  { share: 18, len: [10, 16], fall: [300, 360], alpha: [230, 255] },
];

/** The rain's colour in daylight: a pale blue-grey; it takes the light like everything else. */
const RAIN = 0xfffff6ee;
/**
 * Over light ground (meadows, whitewash, ripe fields, the clouds' crowns) a pale streak would vanish, so there the
 * stroke is inked instead: this slate, at INK_SHARE of the streak's strength. A pixel is light when its red and green
 * together are over LIGHT_FROM of the rain's own (the sea, low in red, stays on the dark side).
 */
const INK = 0xff58463a;
const INK_SHARE = 0.85;
const LIGHT_FROM = 0.8;
/** At night the rain keeps this share of its daylight colour, so it still shows against the dark land. */
const NIGHT_SPARE = 0.4;
/** A gust: the frame is cut into columns this many pixels wide (a power of two), each with its own strength. */
const GUST_SHIFT = 5;
/** The least of the rain's strength a lull between gusts leaves. */
const LULL = 0.5;

/** Splash slots in the rain's space in full rain, and how long each splash lasts (seconds). */
const SPLASHES = 200;
const SPLASH_LASTS = 0.32;
/** Of 255: a splash at its brightest, on water and on the ground. */
const RING_ALPHA = 170;
const FLECK_ALPHA = 110;

/** Mixes `rgb` into out[i] at `a` of 256. */
function blendPx(out: Uint32Array, i: number, rgb: number, a: number): void {
  const dst = out[i];
  const dr = dst & 255, dg = (dst >>> 8) & 255, db = (dst >>> 16) & 255;
  const r = dr + ((((rgb & 255) - dr) * a) >> 8);
  const g = dg + (((((rgb >>> 8) & 255) - dg) * a) >> 8);
  const b = db + (((((rgb >>> 16) & 255) - db) * a) >> 8);
  out[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function mixRgb(a: number, b: number, t: number): number {
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
  const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
  return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** The rain's colour and its ink in this air, kept until the light moves. */
function rainColours(): (air: Air) => { pale: number; ink: number } {
  let key = -1;
  const colours = { pale: RAIN, ink: INK };
  return (air) => {
    const k = lightKey(air, 96, 16);
    if (k !== key) {
      key = k;
      colours.pale = mixRgb(gradeRgb(RAIN, paletteOptions(air)), RAIN, NIGHT_SPARE * air.night);
      colours.ink = gradeRgb(INK, paletteOptions(air));
    }
    return colours;
  };
}

/**
 * Which way the rain leans: −1 when the wind blows west, 1 when it blows east. The wind is the sky field's (field.ts
 * makeField draws its speed and then its direction from the same stream), so the rain leans the way the clouds drift.
 */
export function rainLean(seed: number): -1 | 1 {
  const rng = rngFor(seed, "sky-field");
  rng.range(2.5, 3.5);
  return Math.cos(rng.range(0, Math.PI * 2)) < 0 ? -1 : 1;
}

/** The falling rain, over everything on the frame. Draws nothing when no rain falls. */
export function createRain(seed: number): (out: Uint32Array, rect: ViewRect, t: number, air: Air) => void {
  const coloursOf = rainColours();
  const lean = rainLean(seed) * SLANT;
  // Each streak's own numbers, drawn once: where it starts in the space, how fast it falls, how long and how strong.
  const startX = new Float32Array(STREAKS), startY = new Float32Array(STREAKS), fall = new Float32Array(STREAKS);
  const length = new Uint8Array(STREAKS), alpha = new Uint8Array(STREAKS);
  for (let k = 0; k < STREAKS; k++) {
    const h = hash2(k, 0x4a1d, seed), g = mix32(h ^ 0x9e3779b9);
    let depth = 0, roll = h & 255;
    while (roll >= DEPTHS[depth].share) roll -= DEPTHS[depth++].share;
    const d = DEPTHS[depth];
    startX[k] = ((h >>> 8) & 0xfff) / 4096 * SPACE_W;
    startY[k] = ((h >>> 20) & 0xfff) / 4096 * SPACE_H;
    fall[k] = d.fall[0] + (g & 255) / 255 * (d.fall[1] - d.fall[0]);
    length[k] = d.len[0] + ((g >>> 8) & 255) % (d.len[1] - d.len[0] + 1);
    alpha[k] = d.alpha[0] + ((g >>> 16) & 255) / 255 * (d.alpha[1] - d.alpha[0]);
  }
  const gusts = new Float32Array(SPACE_W >> GUST_SHIFT);
  return (out, rect, t, air) => {
    const amount = air.rain;
    if (amount <= 0) return;
    const w = rect.w, h = rect.h;
    const { pale, ink } = coloursOf(air);
    // Ground brighter than this takes the ink.
    const lightFrom = ((pale & 255) + ((pale >>> 8) & 255)) * LIGHT_FROM;
    const count = Math.round(STREAKS * amount);
    // Light rain is fainter as well as thinner.
    const strength = 0.55 + 0.45 * amount;
    // Gusts: two slow waves crossing the frame against one another, so thick rain and lulls sweep over the view.
    for (let c = 0; c < gusts.length; c++) {
      const wave = 0.5 + 0.3 * psin(c * 0.52 - lean * 2.1 * t) + 0.2 * psin(c * 1.37 + 0.83 * t + 1.9);
      gusts[c] = (LULL + (1 - LULL) * (wave < 0 ? 0 : wave > 1 ? 1 : wave)) * strength;
    }
    // The space is fixed to the land: it slides back as the camera moves on.
    const camX = Math.floor(rect.x), camY = Math.floor(rect.y);
    for (let k = 0; k < count; k++) {
      const fallen = t * fall[k];
      // The streak's foot, the drop itself, wrapped round the space.
      const y = (Math.floor(startY[k] + fallen - camY) & (SPACE_H - 1)) - OVER;
      const x = (Math.floor(startX[k] + lean * fallen - camX) & (SPACE_W - 1)) - ASIDE;
      const len = length[k];
      if (y < 0 || y - len >= h || x < -5 || x >= w + 5) continue;
      const strong = alpha[k] * gusts[(x + ASIDE) >> GUST_SHIFT];
      // Three flat steps up the streak: whole at the drop, fainter behind it.
      const a0 = strong | 0, a1 = (strong * 0.68) | 0, a2 = (strong * 0.4) | 0;
      for (let j = 0; j < len; j++) {
        const py = y - j, px = x - Math.round(j * lean);
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const i = py * w + px, a = j * 3 < len ? a0 : j * 3 < len * 2 ? a1 : a2;
        const dst = out[i];
        if ((dst & 255) + ((dst >>> 8) & 255) > lightFrom) blendPx(out, i, ink, (a * INK_SHARE) | 0);
        else blendPx(out, i, pale, a);
      }
    }
  };
}

/**
 * Splashes where the rain lands: on water a drop that opens into a ring and fades; on the ground a fleck that
 * jumps into two. A live layer, under the flier. Each splash keeps its place on the land while it lasts.
 */
export function splashLayer(seed: number): LiveLayer {
  const coloursOf = rainColours();
  // Each slot's step out of time with the others, and the splash it holds now: which turn it is on, and where.
  const offset = new Float32Array(SPLASHES);
  for (let k = 0; k < SPLASHES; k++) offset[k] = (hash2(k, 0x5b1a, seed) & 1023) / 1024;
  const turnOf = new Float64Array(SPLASHES).fill(-1), placeOf = new Uint32Array(SPLASHES);
  return {
    name: "splashes",
    draw(f) {
      const air = f.air;
      if (!air || air.rain <= 0) return;
      const { out, bake, t } = f;
      const w = f.rect.w, h = f.rect.h;
      const colour = coloursOf(air).pale;
      const count = Math.round(SPLASHES * air.rain);
      const camX = Math.floor(f.rect.x), camY = Math.floor(f.rect.y);
      // Each splash slot is filled anew every SPLASH_LASTS seconds, the slots out of step with one another.
      for (let k = 0; k < count; k++) {
        const turn = t / SPLASH_LASTS + offset[k];
        const round = Math.floor(turn);
        const age = turn - round;
        if (turnOf[k] !== round) {
          turnOf[k] = round;
          placeOf[k] = hash2(k, round, seed ^ 0x5b1a);
        }
        const hsh = placeOf[k];
        const x = (((hsh & 0xfff) - camX) & (SPACE_W - 1)) - ASIDE, y = ((((hsh >>> 12) & 0xfff) - camY) & (SPACE_H - 1)) - OVER;
        if (x < 2 || x >= w - 2 || y < 1 || y >= h - 1) continue;
        const i = y * w + x;
        const m = matOf(bake[i]);
        if (m === 0) continue;
        if (isWater[m] === 1) {
          const a = Math.round(RING_ALPHA * (0.5 + 0.5 * air.rain) * (1 - 0.75 * age));
          if (age < 0.28) {
            // The drop.
            blendPx(out, i, colour, a);
          } else if (age < 0.62) {
            // A small ring.
            blendPx(out, i - 1, colour, a);
            blendPx(out, i + 1, colour, a);
            blendPx(out, i - w, colour, a >> 1);
            blendPx(out, i + w, colour, a >> 1);
          } else {
            // The ring opened wide and flat, as the ground is seen from above and aslant.
            blendPx(out, i - 2, colour, a);
            blendPx(out, i + 2, colour, a);
            blendPx(out, i - w - 1, colour, a >> 1);
            blendPx(out, i - w, colour, a >> 1);
            blendPx(out, i - w + 1, colour, a >> 1);
            blendPx(out, i + w - 1, colour, a >> 1);
            blendPx(out, i + w, colour, a >> 1);
            blendPx(out, i + w + 1, colour, a >> 1);
          }
        } else if (age < 0.6) {
          const a = Math.round(FLECK_ALPHA * (0.5 + 0.5 * air.rain));
          if (age < 0.3) {
            blendPx(out, i, colour, a);
          } else {
            // The fleck jumps apart.
            blendPx(out, i - w - 1, colour, a >> 1);
            blendPx(out, i - w + 1, colour, a >> 1);
          }
        }
      }
    },
  };
}
