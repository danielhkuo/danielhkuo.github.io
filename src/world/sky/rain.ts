// Rain: streaks falling aslant over the whole frame, drawn last, over the clouds and the flier; and the splashes it
// makes on water and ground, drawn by a live layer under the flier. Thin and sparse, so nothing is hidden for long.
// Every streak is a function of its index and the time: the same t draws the same rain.

import { hash2, mix32 } from "../core/hash.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { gradeRgb } from "../render/palette.ts";
import type { ViewRect } from "../render/compose.ts";
import type { LiveLayer } from "../live/live.ts";
import { matOf } from "../live/pixel.ts";
import { paletteOptions, type Air } from "./air.ts";

/** Streaks on the frame in full rain. */
export const STREAKS = 240;
/** Pixels a second a streak falls, at the least and the most. */
const FALL = [170, 250] as const;
/** Pixels across for each pixel down: the rain leans with the wind. */
const SLANT = 0.3;
/** A streak's length in pixels, at the least; up to three more. */
const LENGTH = 3;
/** Of 255: the strongest a streak's foot shows, in full rain. */
const STREAK_ALPHA = 120;
/** The rain's colour in daylight: a pale blue-grey; it takes the light like everything else. */
const RAIN = 0xffe8ddd2;
/** Splashes on the frame at once in full rain, and how long each lasts (seconds). */
const SPLASHES = 70;
const SPLASH_LASTS = 0.18;
/** Of 255: a splash at its brightest. */
const SPLASH_ALPHA = 150;

const isWet = new Uint8Array(256);
for (const m of [M.sea, M.seaClear, M.lake, M.river]) isWet[m] = 1;

function blendPx(out: Uint32Array, i: number, rgb: number, a: number): void {
  const dst = out[i], inv = 255 - a;
  const r = ((dst & 255) * inv + (rgb & 255) * a) / 255 | 0;
  const g = (((dst >>> 8) & 255) * inv + ((rgb >>> 8) & 255) * a) / 255 | 0;
  const b = (((dst >>> 16) & 255) * inv + ((rgb >>> 16) & 255) * a) / 255 | 0;
  out[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** The rain's colour in this air, kept until the light moves. */
function rainColour(): (air: Air) => number {
  let key = "", colour = RAIN;
  return (air) => {
    const k = `${Math.round(air.time * 96)} ${Math.round(air.overcast * 16)} ${Math.round(air.mist * 16)}`;
    if (k !== key) {
      key = k;
      colour = gradeRgb(RAIN, paletteOptions(air));
    }
    return colour;
  };
}

/** The falling rain, over everything on the frame. Draws nothing when no rain falls. */
export function createRain(seed: number): (out: Uint32Array, rect: ViewRect, t: number, air: Air) => void {
  const colourOf = rainColour();
  return (out, rect, t, air) => {
    const amount = air.rain;
    if (amount <= 0) return;
    const w = rect.w, h = rect.h;
    const colour = colourOf(air);
    const count = Math.round(STREAKS * amount);
    const span = h + 24;
    for (let k = 0; k < count; k++) {
      const hsh = hash2(k, 0x4a1d, seed);
      const len = LENGTH + (hsh & 3);
      const speed = FALL[0] + ((hsh >>> 2) & 255) / 255 * (FALL[1] - FALL[0]);
      const fall = ((((hsh >>> 10) & 1023) / 1023) * span + t * speed) % span;
      const y = Math.floor(fall) - 12;
      // Columns spread over the frame and the slant's reach, so the streaks enter from the side as they fall.
      const x0 = Math.floor((mix32(hsh) / 4294967296) * (w + span * SLANT)) - Math.floor(span * SLANT);
      const x = x0 + Math.floor(SLANT * (y + 12));
      const strong = STREAK_ALPHA * amount * (0.55 + 0.45 * (((hsh >>> 20) & 255) / 255));
      for (let j = 0; j < len; j++) {
        const px = x + Math.floor(j * SLANT), py = y + j;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        // Faint where it starts, strongest at the drop.
        blendPx(out, py * w + px, colour, Math.round((strong * (j + 1)) / len));
      }
    }
  };
}

/** Splashes where the rain lands: a ring on water, a fleck on the ground. A live layer, under the flier. */
export function splashLayer(seed: number): LiveLayer {
  const colourOf = rainColour();
  return {
    name: "splashes",
    draw(f) {
      const air = f.air;
      if (!air || air.rain <= 0) return;
      const { out, bake, t } = f;
      const w = f.rect.w, h = f.rect.h;
      const colour = colourOf(air);
      const count = Math.round(SPLASHES * air.rain);
      // Each splash slot is filled anew every SPLASH_LASTS seconds, the slots out of step with one another.
      for (let k = 0; k < count; k++) {
        const offset = (hash2(k, 0x5b1a, seed) & 1023) / 1024;
        const age = (t / SPLASH_LASTS + offset) % 1;
        const round = Math.floor(t / SPLASH_LASTS + offset);
        const hsh = hash2(k, round, seed ^ 0x5b1a);
        const x = hsh % w, y = (hsh >>> 12) % h;
        const i = y * w + x;
        const v = bake[i];
        if (matOf(v) === 0) continue;
        const a = Math.round(SPLASH_ALPHA * air.rain * (1 - age));
        if (a < 4) continue;
        if (isWet[matOf(v)] === 1) {
          // A ring that opens as it fades.
          const r = age < 0.5 ? 1 : 2;
          if (x - r >= 0) blendPx(out, i - r, colour, a);
          if (x + r < w) blendPx(out, i + r, colour, a);
          if (y - 1 >= 0) blendPx(out, i - w, colour, a >> 1);
          if (y + 1 < h) blendPx(out, i + w, colour, a >> 1);
        } else if (age < 0.5) {
          blendPx(out, i, colour, a >> 1);
        }
      }
    },
  };
}
