// The weather: now and then a shower or a mist passes over the world. It is told from the clock on the wall (seconds
// since 1970, the same everywhere) and the world's seed, so every visitor flying at the same moment shares it.
//
// Time is cut into slots. Most slots are fair; some hold one pass. Before rain the clouds build and the light greys,
// the rain falls for a few minutes and eases, and the sky clears. Mist rises, lies a while and thins.

import { hash2 } from "../core/hash.ts";

/** Seconds a slot lasts: one pass at most in each. */
export const SLOT = 1800;
/** Of 65536: the share of slots that hold a shower, and that hold a mist. */
const RAIN_SHARE = 0.24 * 65536;
const MIST_SHARE = 0.14 * 65536;
/** A shower: the clouds build for BUILD seconds, the rain holds 180–360 s, and the sky clears over CLEAR. */
export const BUILD = 150;
export const CLEAR = 150;
/** Seconds before the clouds have closed that the first rain falls, and how long the rain takes to come in and to ease. */
const EARLY = 25;
const RAIN_IN = 40;
const RAIN_OUT = 45;
/** Mist: rises over MIST_IN seconds, lies 240–480 s, thins over MIST_OUT. */
const MIST_IN = 120;
const MIST_OUT = 150;
/** The most overcast a shower makes the light, and a mist. */
const RAIN_GREY = 0.72;
const MIST_GREY = 0.3;

export type WeatherKind = "clear" | "clouds" | "rain" | "mist";

/** The weather at one moment: each 0–1. */
export interface Weather {
  kind: WeatherKind;
  /** How far the clouds have built: more of them, and greyer. */
  cloud: number;
  /** Rain falling. */
  rain: number;
  /** Mist lying. */
  mist: number;
  /** The light: 0 clear … 1 overcast (the palette's overcast). */
  overcast: number;
}

export const CLEAR_WEATHER: Weather = { kind: "clear", cloud: 0, rain: 0, mist: 0, overcast: 0 };

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** 0 before `start`, rising to 1 over `rise`, holding, and falling to 0 over `fall` so that it is 0 again at `end`. */
function hump(at: number, start: number, rise: number, end: number, fall: number): number {
  if (at <= start || at >= end) return 0;
  return Math.min(smooth((at - start) / rise), smooth((end - at) / fall));
}

/** What the slot holding `epoch` (seconds) holds: its kind, when its pass starts after the slot opens, and how long it holds. */
export function slotOf(epoch: number, seed: number): { kind: "clear" | "rain" | "mist"; start: number; hold: number; total: number } {
  const slot = Math.floor(epoch / SLOT);
  const h = hash2(slot, 0x5eed, seed ^ 0x77ea);
  const roll = h & 0xffff;
  const kind = roll < RAIN_SHARE ? "rain" : roll < RAIN_SHARE + MIST_SHARE ? "mist" : "clear";
  const g = hash2(slot, 0x7a11, seed ^ 0x77ea);
  const hold = kind === "rain" ? 180 + (g & 0xff) / 255 * 180 : 240 + (g & 0xff) / 255 * 240;
  const total = kind === "rain" ? BUILD + hold + CLEAR : MIST_IN + hold + MIST_OUT;
  // The pass starts at least a minute into the slot and ends at least a minute before it closes.
  const room = SLOT - total - 120;
  const start = 60 + ((g >>> 8) & 0xffff) / 65535 * room;
  return { kind, start, hold, total };
}

/** The weather at `epoch` seconds since 1970, the same for everyone at that moment. */
export function weatherAt(epoch: number, seed: number): Weather {
  const s = slotOf(epoch, seed);
  if (s.kind === "clear") return CLEAR_WEATHER;
  const at = epoch - Math.floor(epoch / SLOT) * SLOT - s.start;
  if (at <= 0 || at >= s.total) return CLEAR_WEATHER;
  if (s.kind === "rain") {
    const cloud = hump(at, 0, BUILD, s.total, CLEAR);
    const rainEnd = BUILD + s.hold + RAIN_OUT * 0.5;
    const rain = hump(at, BUILD - EARLY, RAIN_IN, rainEnd, RAIN_OUT);
    if (cloud <= 0) return CLEAR_WEATHER;
    return { kind: rain > 0 ? "rain" : "clouds", cloud, rain, mist: 0, overcast: RAIN_GREY * cloud };
  }
  const mist = hump(at, 0, MIST_IN, s.total, MIST_OUT);
  if (mist <= 0) return CLEAR_WEATHER;
  return { kind: "mist", cloud: 0, rain: 0, mist, overcast: MIST_GREY * mist };
}

/**
 * A `?weather=` value: `clear`, `clouds` (built, before the rain), `rain` or `mist`, at full strength or, after a colon,
 * at a share from 0 to 1 (`rain:0.5`). Null when it names none.
 */
export function parseWeather(query: string | null): Weather | null {
  if (query === null) return null;
  const [name, amount] = query.trim().toLowerCase().split(":");
  const k = amount === undefined ? 1 : Number(amount);
  if (!Number.isFinite(k) || k < 0 || k > 1) return null;
  switch (name) {
    case "clear":
      return CLEAR_WEATHER;
    case "clouds":
      return { kind: "clouds", cloud: k, rain: 0, mist: 0, overcast: RAIN_GREY * k };
    case "rain":
      return { kind: "rain", cloud: 1, rain: k, mist: 0, overcast: RAIN_GREY };
    case "mist":
      return { kind: "mist", cloud: 0, rain: 0, mist: k, overcast: MIST_GREY * k };
    default:
      return null;
  }
}
