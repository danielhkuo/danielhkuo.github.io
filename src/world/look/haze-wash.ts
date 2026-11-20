// The haze's wash by climate. The haze stands in for land that is not baked yet, and is coloured by height alone:
// low is green, high is moor, higher is snow. That is the temperate land. In a world with climates the core carries
// this plane beside the overview: for each overview sample, the material whose wash the haze should take there, or 0
// to leave it to the height. It is a rough reading of the climate, not the cover: the haze is seen for a moment,
// through mist, and only has to be the right country.

import { COLD_SPAN, DESERT_RAIN, HEAT_LAPSE, heatOf, HOT_EDGE, SHIFT_SNOW, SHIFT_TREELINE, STEPPE_RAIN, TEMPERATE } from "../biome.ts";
import { MATERIAL as M } from "./materials.ts";

/**
 * The wash for one overview sample: `h` its ground in units (0 or less is sea), `temp` and `rain` the climate at
 * the C node it lies on, `arid` the dry side's share there (0 on the wet side). 0 where the height's own wash is right.
 */
export function hazeWashAt(h: number, temp: number, rain: number, arid: number = 0): number {
  const dryside = arid > 0.5;
  if (!dryside && !(temp < TEMPERATE) && !(temp > TEMPERATE)) return 0;
  if (temp < TEMPERATE) {
    const shift = (TEMPERATE - temp) * COLD_SPAN;
    if (h <= 0) return shift > SHIFT_SNOW - 4 ? M.packIce : 0;
    if (h + shift > SHIFT_SNOW) return M.snow;
    if (h + shift > SHIFT_TREELINE + 4) return M.tundraMid;
    // To the tree line the wet side is taiga and the dry side steppe.
    if (dryside) return M.steppeMid;
    return shift > 30 ? M.spruceMid : 0;
  }
  const heat = heatOf(temp);
  if (h <= 0) return heat > 0.55 ? M.seaClear : 0;
  const hl = heat - h / HEAT_LAPSE;
  if (!dryside) return hl > 0.5 ? M.jungleMid : 0;
  if (hl <= HOT_EDGE) return hl > 0.3 ? M.steppeMid : M.sageMid;
  if (rain < DESERT_RAIN) return M.desertSand;
  if (rain < STEPPE_RAIN) return M.steppeMid;
  const belt = hl >= 0.9 ? 0 : hl < 0.68 ? (hl - 0.5) / 0.18 : (0.9 - hl) / 0.22;
  if (rain < 0.57 + 0.3 * (belt < 0 ? 0 : belt)) return M.savannaMid;
  return hl > 0.56 ? M.jungleMid : 0;
}

/**
 * The plane for a world: one byte per overview sample, which is one per C node, the ground read at the G node the
 * overview reads (pack/regions.ts overviewOf). `ground` is on G (gN a side), `temp` and `rain` on C (gN / 2).
 */
export function hazeWash(ground: ArrayLike<number>, gN: number, temp: ArrayLike<number>, rain: ArrayLike<number>, arid?: ArrayLike<number>): Uint8Array {
  const cN = gN / 2;
  const out = new Uint8Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) {
    const ci = cy * cN + cx;
    out[ci] = hazeWashAt(ground[2 * cy * gN + 2 * cx], temp[ci], rain[ci], arid ? arid[ci] : 0);
  }
  return out;
}
