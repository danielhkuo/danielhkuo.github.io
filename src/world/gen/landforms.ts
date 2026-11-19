// S8b: landforms by climate (design 2026-11-18, 6.6). The land is grown by one temperate rule; this stage lets the
// climate reshape it where the climate is not temperate: benches and mesas and long dune ridges in the desert, an
// ice sheet's smoothing over the pole, karst towers in the jungle, rock domes on the savanna.
//
// It runs after the climate, on G, and returns the final ground and the height above drainage. Two guards keep what
// the earlier stages made: a river keeps its bed (nothing moves at a channel, and nothing is lowered to its
// drainage), and the coast keeps its line (nothing moves near the shore). On the temperate plateau every landform's
// weight is 0, so the home island's ground is the same to the bit.

import { bumpAt, DOME, ergAt, heatOf, softNoise, TEMPERATE, TOWER, COLD_SPAN } from "../biome.ts";
import { blurTorus } from "./climate.ts";

/** Nothing moves within BANK_NEAR units above the nearest drainage; the change is whole from BANK_FAR. */
export const BANK_NEAR = 1;
export const BANK_FAR = 7;
/** Nor within SHORE_NEAR cells of the shore; whole from SHORE_FAR. */
export const SHORE_NEAR = 12;
export const SHORE_FAR = 48;
/** No landform lowers a node by more than this share of its height above drainage. */
export const LOWER_SHARE = 0.5;

/** Benches: units of height from one tread to the next; the share of that range a tread takes, and of the step it rises. */
export const BENCH_STEP = 11;
const BENCH_TREAD = 0.94;
const BENCH_RISE = 0.14;
/** Dune ridges: the greatest height in units, and cells from crest to crest along the wind. */
export const RIDGE_HEIGHT = 6.5;
const RIDGE_CELLS = 40;
/** The ice sheet fills hollows toward the land's surface smoothed over this many G nodes, by this share. */
const ICE_RADIUS = 10;
const ICE_FILL = 0.75;

const SEED = 0x1a4df0;
const LANDFORM_SEED = SEED;

function ramp(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/**
 * The height of the dune ridges at a cell of a sand sea, 0–1: long linear dunes running with the south-west wind,
 * as in the great ergs, a long rise on one side and a shorter fall on the other, each dying out along its length.
 * Running south-west to north-east, they face the north-west light on one flank and turn the other from it.
 */
export function ridgeAt(x: number, y: number, n: number): number {
  // Crests are lines of constant x + y, a whole number of them round the world, so the ridges wrap on it.
  const crests = Math.max(1, Math.round(n / (RIDGE_CELLS * 1.4142)));
  const t = ((x + y + 0.5) * crests) / n + 0.6 * softNoise(x, y, n, 260, SEED + 11) + 0.3 * softNoise(x, y, n, 90, SEED + 12);
  const f = t - Math.floor(t);
  const ridge = f < 0.68 ? f / 0.68 : (1 - f) / 0.32;
  const along = 0.5 + 0.9 * softNoise(x, y, n, 150, SEED + 13);
  return ridge * ridge * (3 - 2 * ridge) * (along < 0.15 ? 0.15 : along > 1 ? 1 : along);
}

export interface LandformInput {
  /** Cells a side, and G nodes a side. */
  n: number;
  gN: number;
  /** G grid. */
  ground: Float64Array;
  hand: Float64Array;
  isSea: Uint8Array;
  lakeId: Int32Array;
  /** Cells from the shore, positive inland (gen/coast.ts). */
  shoreDist: Float32Array;
  /** C grid (gN / 2): the climate (gen/climate.ts). Without a temperature there are no landforms. */
  temp?: Float32Array;
  arid?: Float32Array;
  moisture: Float32Array;
}

export interface Landforms {
  /** The final ground on G, and the height above drainage that goes with it. The inputs when nothing moved. */
  ground: Float64Array;
  hand: Float64Array;
  /** G nodes moved by each landform, for the build's log. */
  moved: { bench: number; ridge: number; ice: number; tower: number; dome: number };
}

/** The climate's own landforms over the grown land. Pure, and periodic on the world. */
export function shapeByClimate(c: LandformInput): Landforms {
  const moved = { bench: 0, ridge: 0, ice: 0, tower: 0, dome: 0 };
  const { n, gN, ground, hand, isSea, lakeId, shoreDist, temp, arid, moisture } = c;
  if (!temp) return { ground, hand, moved };
  const cN = gN / 2, cell = n / gN;
  const out = Float64Array.from(ground), handOut = Float64Array.from(hand);
  // The land's surface smoothed, for the ice sheet: worked out only if the world has an ice sheet.
  let smooth: Float32Array | null = null;
  const smoothed = (): Float32Array => {
    if (!smooth) {
      const src = new Float32Array(gN * gN);
      for (let i = 0; i < src.length; i++) src[i] = ground[i] > 0 ? ground[i] : 0;
      smooth = blurTorus(src, gN, ICE_RADIUS, 2);
    }
    return smooth;
  };
  const wrapG = (v: number): number => ((v % gN) + gN) % gN;
  for (let gy = 0; gy < gN; gy++) {
    const cRow = (gy >> 1) * cN;
    for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx;
      if (isSea[i] || lakeId[i] >= 0) continue;
      const ci = cRow + (gx >> 1), t = temp[ci];
      if (t === TEMPERATE) continue;
      const bank = ramp((hand[i] - BANK_NEAR) / (BANK_FAR - BANK_NEAR));
      if (bank <= 0) continue;
      const guard = bank * ramp((shoreDist[i] - SHORE_NEAR) / (SHORE_FAR - SHORE_NEAR));
      if (guard <= 0) continue;
      const x = (gx + 0.5) * cell, y = (gy + 0.5) * cell, e = ground[i];
      const dry = arid ? arid[ci] : 0, rain = moisture[ci];
      let d = 0;
      if (t > TEMPERATE) {
        const heat = heatOf(t);
        // The slope of the land as grown, for the landforms that want level ground.
        const sx = (ground[gy * gN + wrapG(gx + 1)] - ground[gy * gN + wrapG(gx - 1)]) / (2 * cell);
        const sy = (ground[wrapG(gy + 1) * gN + gx] - ground[wrapG(gy - 1) * gN + gx]) / (2 * cell);
        const slope = Math.sqrt(sx * sx + sy * sy);
        const desert = dry * ramp((heat - 0.4) / 0.14) * ramp((0.3 - rain) / 0.1);
        if (desert > 0) {
          // Benches: the height is stepped, each tread nearly level and each riser steep, the beds wandering a
          // little as strata do. Bolder in some country than in other.
          const wob = 0.5 * softNoise(x, y, n, 330, SEED + 1) + 0.2 * softNoise(x, y, n, 110, SEED + 2);
          const u = e / BENCH_STEP + wob, f = u - Math.floor(u);
          const g = f < BENCH_TREAD ? (f * BENCH_RISE) / BENCH_TREAD : BENCH_RISE + ((f - BENCH_TREAD) * (1 - BENCH_RISE)) / (1 - BENCH_TREAD);
          const bold = 0.65 + 0.7 * softNoise(x, y, n, 260, SEED + 3);
          const b = (g - f + 0.42) * BENCH_STEP * desert * (bold < 0.25 ? 0.25 : bold > 1 ? 1 : bold);
          if (b !== 0) { d += b; moved.bench++; }
          // Dune ridges, on the level ground of a sand sea.
          const erg = ergAt(x, y, n);
          if (erg > 0) {
            const r = RIDGE_HEIGHT * erg * desert * ramp((0.3 - slope) / 0.15) * ridgeAt(x, y, n);
            if (r > 0) { d += r; moved.ridge++; }
          }
        }
        // Karst towers: in patches of the jungle, on its low and gentle ground.
        const jungle = ramp((heat - 0.62) / 0.12) * ramp((rain - 0.62) / 0.12);
        if (jungle > 0) {
          // In clusters: a field of towers here, open plain there.
          const patch = ramp((softNoise(x, y, n, 600, SEED + 21) + 0.6 * softNoise(x, y, n, 150, SEED + 22) + 0.15) / 0.15);
          const where = jungle * patch * ramp((0.28 - slope) / 0.12) * ramp((55 - e) / 15);
          if (where > 0) {
            const v = TOWER.h1 * where * bumpAt(x, y, n, TOWER, LANDFORM_SEED + 23, true);
            if (v > 0) { d += v; moved.tower++; }
          }
        }
        // Rock domes: alone on the savanna's plain.
        const savanna = dry * ramp((heat - 0.6) / 0.1) * ramp((rain - 0.3) / 0.08) * ramp((0.7 - rain) / 0.08);
        if (savanna > 0) {
          const v = DOME.h1 * savanna * ramp((0.3 - slope) / 0.12) * bumpAt(x, y, n, DOME, LANDFORM_SEED + 31, false);
          if (v > 0) { d += v; moved.dome++; }
        }
      } else {
        // The ice sheet: hollows fill toward the land's own smoothed surface.
        const ice = ramp(((TEMPERATE - t) * COLD_SPAN - 88) / 14);
        if (ice > 0) {
          const lift = smoothed()[i] - e;
          if (lift > 0) { d += ICE_FILL * ice * lift; moved.ice++; }
        }
      }
      if (d === 0) continue;
      d *= guard;
      // No node is lowered to its drainage, nor to the sea.
      const floor = -LOWER_SHARE * (hand[i] - BANK_NEAR);
      if (d < floor) d = floor;
      if (e + d < 0.5) d = e < 0.5 ? 0 : 0.5 - e;
      out[i] = e + d;
      handOut[i] = hand[i] + d;
    }
  }
  return { ground: out, hand: handOut, moved };
}
