// The visitor's clock: where the sun is, and the time of year, from the hour and the date on their own clock. The
// page reads the clock and hands the numbers in; nothing here reads it, so the same numbers give the same light.
//
// The light is told in sun phase, the palette's `time`: 0.25 at sunrise, 0.5 at noon, 0.75 at sunset, 0 and 1 in the
// middle of the night. Days are longer in summer, as at a middle latitude, so a summer evening stays light.

/** Days in a year, on average. */
const YEAR = 365.25;
/** Day of the year with the longest day (21 June). */
const MIDSUMMER = 172;
/** Hours of daylight at midsummer and at midwinter. */
export const LONGEST_DAY = 15.5;
export const SHORTEST_DAY = 8.5;
/** Clock hour of noon, a middle way between standard and summer time. */
export const SOLAR_NOON = 12.5;
/** Day of the year (15 April) where spring is at its height: the palette's season 0. */
const SPRING = 105;

/** Named moments for `?time=`, as sun phase. */
export const PHASES = {
  midnight: 0,
  night: 0.92,
  dawn: 0.25,
  morning: 0.32,
  day: 0.5,
  noon: 0.5,
  afternoon: 0.6,
  golden: 0.71,
  dusk: 0.76,
} as const;

/** Named seasons for `?season=`, as the palette's season. */
export const SEASONS = { spring: 0, summer: 0.25, autumn: 0.5, winter: 0.75 } as const;

function wrap01(v: number): number {
  return v - Math.floor(v);
}

/** Day of the year, 1 on 1 January. */
export function dayOfYear(year: number, month: number, day: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return before[month - 1] + day + (leap && month > 2 ? 1 : 0);
}

/** Hours of daylight on day `doy`: LONGEST_DAY at midsummer, SHORTEST_DAY at midwinter. */
export function daylight(doy: number): number {
  const mid = (LONGEST_DAY + SHORTEST_DAY) / 2, swing = (LONGEST_DAY - SHORTEST_DAY) / 2;
  return mid + swing * Math.cos((2 * Math.PI * (doy - MIDSUMMER)) / YEAR);
}

/**
 * Sun phase at clock hour `hour` (0–24) on day `doy`: sunrise to sunset spans 0.25 to 0.75 evenly, and the night the
 * rest, so dawn, golden hour and dusk come at the right hour in every season.
 */
export function sunPhase(hour: number, doy: number): number {
  const day = daylight(doy);
  const rise = SOLAR_NOON - day / 2, set = SOLAR_NOON + day / 2;
  const h = ((hour % 24) + 24) % 24;
  if (h >= rise && h <= set) return 0.25 + (0.5 * (h - rise)) / day;
  const since = (((h - set) % 24) + 24) % 24;
  return wrap01(0.75 + (0.5 * since) / (24 - day));
}

/** The palette's season on day `doy`: 0 in mid-April, 0.25 mid-July, 0.5 mid-October, 0.75 mid-January. */
export function seasonOf(doy: number): number {
  return wrap01((doy - SPRING) / YEAR);
}

/**
 * A `?time=` value as sun phase on day `doy`, or null when it names nothing: a name from PHASES, a clock time `HH:MM`
 * (or `HH`), or a phase from 0 to 1 (`0.75`).
 */
export function parseTime(query: string | null, doy: number): number | null {
  if (query === null) return null;
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  if (Object.hasOwn(PHASES, q)) return PHASES[q as keyof typeof PHASES];
  const clock = /^(\d{1,2})(?::(\d{2}))?$/.exec(q);
  if (clock && (q.includes(":") || Number(clock[1]) > 1)) {
    const h = Number(clock[1]), m = Number(clock[2] ?? 0);
    if (h > 24 || m > 59) return null;
    return sunPhase(h + m / 60, doy);
  }
  const v = Number(q);
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return null;
}

/** A `?season=` value as the palette's season, or null: a name from SEASONS or a number from 0 to 1. */
export function parseSeason(query: string | null): number | null {
  if (query === null) return null;
  const q = query.trim().toLowerCase();
  if (q === "") return null;
  if (Object.hasOwn(SEASONS, q)) return SEASONS[q as keyof typeof SEASONS];
  const v = Number(q);
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return null;
}
