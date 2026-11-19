// The air of one moment: the light from the visitor's clock, the time of year, and the shared weather, in the one
// form the palette, the live layers, the sky and the dragon all read. The page makes one a frame; the palette is
// rebuilt only when the light has moved far enough to see.

import type { Palette, PaletteOptions } from "../look/contract.ts";
import { CREAM } from "../render/compose.ts";
import { buildPalette, darkness, gradeRgb } from "../render/palette.ts";
import { CLEAR_WEATHER, type Weather } from "./weather.ts";

export interface Air {
  /** Sun phase (the palette's time): 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  time: number;
  /** The palette's season: 0 spring, 0.25 summer, 0.5 autumn, 0.75 winter. */
  season: number;
  /** 0 clear … 1 overcast. */
  overcast: number;
  /** 0–1: mist lying. */
  mist: number;
  /** 0–1: how dark it is, 0 by day and 1 at night (render/palette.ts darkness). */
  night: number;
  /** 0–1: rain falling. */
  rain: number;
  /** 0–1: how far the clouds have built before rain. */
  cloud: number;
}

/** The air the world was tuned in: a clear midsummer noon. */
export const NOON_AIR: Air = { time: 0.5, season: 0.25, overcast: 0, mist: 0, night: 0, rain: 0, cloud: 0 };

/** The air at sun phase `time` in season `season`, under `weather`. */
export function airOf(time: number, season: number, weather: Weather = CLEAR_WEATHER): Air {
  return {
    time, season, overcast: weather.overcast, mist: weather.mist, night: darkness(time), rain: weather.rain, cloud: weather.cloud,
  };
}

/** The palette's options for this air. */
export function paletteOptions(air: Air): PaletteOptions {
  return air.mist > 0 ? { time: air.time, season: air.season, overcast: air.overcast, mist: air.mist } : { time: air.time, season: air.season, overcast: air.overcast };
}

/** The palette for this air, and the paper's cream in the same light (for the grain and the haze). */
export function lightFor(air: Air): { palette: Palette; cream: number } {
  const o = paletteOptions(air);
  return { palette: buildPalette(o), cream: gradeRgb(CREAM, o) };
}

/** The palette is rebuilt once the sun has moved this far (about two minutes at an equinox), or the year this far. */
const TIME_STEP = 0.0015;
const SEASON_STEP = 0.002;
/** Or once the overcast or the mist has moved this far. */
const WEATHER_STEP = 0.025;

function ringGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/** Whether `next` needs a new palette after one built for `built`: its light has moved by a step you could see. */
export function lightMoved(built: Air, next: Air): boolean {
  return ringGap(built.time, next.time) >= TIME_STEP || ringGap(built.season, next.season) >= SEASON_STEP
    || Math.abs(built.overcast - next.overcast) >= WEATHER_STEP || Math.abs(built.mist - next.mist) >= WEATHER_STEP
    // Reaching clear weather again is worth a palette of its own, however small the last step.
    || (built.overcast !== next.overcast && next.overcast === 0) || (built.mist !== next.mist && next.mist === 0);
}
