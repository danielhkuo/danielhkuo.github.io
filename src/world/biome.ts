// Climate at a cell: what the cover and the scatter read off the world's sea-level temperature (gen/climate.ts).
//
// The cover's rules already read height as cold: woods give way to conifers, the tree line, alpine ground, late
// snow and snow as the land rises. So a climate enters them as an offset of height. A cell far to the north is
// read as if it stood that much higher, and one in the tropics that much lower; the same rules then lay taiga,
// tundra and ice across the cold latitudes as they lay them up a mountain. On the temperate plateau the offset is
// nothing, and the cover is the temperate one, bit for bit.

import { gradNoise } from "./core/noise.ts";

/** The temperature of the temperate plateau. Exactly this, or none at all, is the temperate climate. */
export const TEMPERATE = 0.5;
/** Units of height the cold half of the world spans, pole to plateau: the snowline (93) reaches the sea at temp 0.142. */
export const COLD_SPAN = 260;
/** And the hot half, plateau to equator: there woods climb to 120 and no snow lies. */
export const HOT_SPAN = 120;

/** The shift at which each cold line reaches the sea. */
export const SHIFT_TAIGA = 22;
export const SHIFT_TREELINE = 60;
export const SHIFT_SNOW = 93;

const SHIFT_SEED = 0xc01d5;

/** Smooth periodic noise, about ±0.6, with features `cells` cells across. */
export function softNoise(x: number, y: number, n: number, cells: number, seed: number): number {
  const p = Math.max(1, Math.round(n / cells));
  return gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, seed);
}

/** Whether a cell with this temperature has the temperate climate: none given, the plateau's own, or no number at all. */
export function isTemperate(temp: number | undefined): boolean {
  return temp === undefined || temp === TEMPERATE || temp !== temp;
}

/**
 * The climate's offset of height at a cell, in units: positive in the cold (the land reads as higher), negative in
 * the heat, 0 on the temperate plateau. It wanders by some ten units over a few hundred cells, the more the further
 * from the plateau, so no line it draws across flat ground follows a latitude.
 */
export function climateShift(temp: number, x: number, y: number, n: number): number {
  const base = temp < TEMPERATE ? (TEMPERATE - temp) * COLD_SPAN : (TEMPERATE - temp) * HOT_SPAN;
  const far = base < 0 ? -base : base;
  const k = far >= 14 ? 1 : far / 14;
  const wander = 9 * softNoise(x, y, n, 170, SHIFT_SEED) + 5 * softNoise(x, y, n, 60, SHIFT_SEED + 1) + 2.5 * softNoise(x, y, n, 22, SHIFT_SEED + 2);
  return base + k * wander;
}

/** Heat, 0 on the temperate plateau … 1 at the equator; 0 in the cold. */
export function heatOf(temp: number): number {
  return temp <= TEMPERATE ? 0 : (temp - TEMPERATE) / (1 - TEMPERATE);
}
