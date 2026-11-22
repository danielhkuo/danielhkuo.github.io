// Climate at a cell: what the cover and the scatter read off the world's sea-level temperature (gen/climate.ts).
//
// The cover's rules already read height as cold: woods give way to conifers, the tree line, alpine ground, late
// snow and snow as the land rises. So a climate enters them as an offset of height. A cell far to the north is
// read as if it stood that much higher, and one in the tropics that much lower; the same rules then lay taiga,
// tundra and ice across the cold latitudes as they lay them up a mountain. On the temperate plateau the offset is
// nothing, and the cover is the temperate one, bit for bit.

import { hash2 } from "./core/hash.ts";
import { gradNoise } from "./core/noise.ts";
import { torusDelta } from "./core/torus.ts";

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
  // The finer wanderings are what mix two climates where they meet: patches of each in the other, a few dozen cells across.
  const wander = 8 * softNoise(x, y, n, 170, SHIFT_SEED) + 7 * softNoise(x, y, n, 60, SHIFT_SEED + 1) + 4.5 * softNoise(x, y, n, 22, SHIFT_SEED + 2);
  return base + k * wander;
}

/** Heat, 0 on the temperate plateau … 1 at the equator; 0 in the cold. */
export function heatOf(temp: number): number {
  return temp <= TEMPERATE ? 0 : (temp - TEMPERATE) / (1 - TEMPERATE);
}

/** Units of height to one point of heat: a tropical mountain is out of the hot country some 70 units up. */
export const HEAT_LAPSE = 150;
/** The local heat from which hot country's own cover replaces the temperate table's: the near edge of the dry belt. */
export const HOT_EDGE = 0.4;
/** Rain under which hot ground is desert, and under which it is thin steppe and thorn. */
export const DESERT_RAIN = 0.2;
export const STEPPE_RAIN = 0.34;

const ERG_SEED = 0xe46;

/**
 * 0–1: how far a cell lies inside a sand sea. Ergs are lobes a few hundred cells across, with the gravel plain
 * between them: the desert's sand is in seas, never spread evenly. The cover lays sand where this is above 0, and the
 * bake raises its dunes by it, so the dunes die away at a sand sea's edge.
 */
export function ergAt(x: number, y: number, n: number): number {
  const v = softNoise(x, y, n, 520, ERG_SEED) + 0.5 * softNoise(x, y, n, 170, ERG_SEED + 1) + 0.2 * softNoise(x, y, n, 50, ERG_SEED + 2) + 0.06;
  return v <= 0 ? 0 : v >= 0.2 ? 1 : v / 0.2;
}

/** The greatest height of a dune, in units. */
export const DUNE_HEIGHT = 5;

/**
 * The height of the dunes at a cell of a sand sea, 0–1 of DUNE_HEIGHT: crests some 20 cells apart running with the
 * south-west wind, as the great ridges do (gen/landforms.ts), gentle on one flank and steep on the other, that branch
 * and die out along their length. So they face the north-west light on one flank and turn the other from it.
 */
export function duneAt(x: number, y: number, n: number): number {
  const p = Math.max(1, Math.round(n / 80));
  // Across the crests they come four to a lattice step; along them they run long.
  const u = ((x + y + 0.5) * p) / n, v = ((x - y + 0.5) * p) / n;
  const bend = 0.35 * softNoise(x, y, n, 90, ERG_SEED + 3);
  const t = 3 * u + bend + 0.6 * gradNoise(u, 2 * v, p, ERG_SEED + 4);
  const f = t - Math.floor(t);
  // A sawtooth: a long rise from the south-west, a short slip face to the north-east.
  const ridge = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
  const size = 0.55 + 0.45 * gradNoise(u * 2 + 7, v * 3, p, ERG_SEED + 5);
  // A dune is a body, not a blade: most of its length stands near its crest's height.
  return ridge * (0.45 + 0.55 * ridge) * (size < 0.2 ? 0.2 : size);
}

/** A lattice of bumps (gen/landforms.ts): one to a square of `cells` cells with `chance`; radius in cells and height in units. */
export interface Bump { cells: number; chance: number; r0: number; r1: number; h0: number; h1: number }
/** Karst towers. */
export const TOWER: Bump = { cells: 34, chance: 0.6, r0: 7, r1: 11, h0: 14, h1: 25 };
/** Rock domes of the savanna. */
export const DOME: Bump = { cells: 240, chance: 0.42, r0: 20, r1: 36, h0: 12, h1: 24 };
/** The seed the landforms raise the domes with, so the cover can find them: 0x1a4df0 + 31. */
export const DOME_SEED = 0x1a4df0 + 31;

/**
 * The height of the bump field at a cell, 0–1 of its own greatest: one bump to a square of a lattice that wraps on
 * the world, set anywhere in the square, with its own radius and height. `tower` bumps are flat-topped and
 * steep-sided; the others are domes.
 */
export function bumpAt(x: number, y: number, n: number, k: Bump, seed: number, tower: boolean): number {
  const per = Math.max(1, Math.round(n / k.cells)), size = n / per;
  const ix = Math.floor(x / size), iy = Math.floor(y / size);
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const jx = ix + dx, jy = iy + dy;
    const h = hash2(((jx % per) + per) % per, ((jy % per) + per) % per, seed);
    if ((h & 1023) / 1024 >= k.chance) continue;
    const cx = (jx + 0.2 + 0.6 * (((h >>> 10) & 255) / 256)) * size, cy = (jy + 0.2 + 0.6 * (((h >>> 18) & 255) / 256)) * size;
    const u = (h >>> 26) / 64;
    const r = k.r0 + (k.r1 - k.r0) * u;
    const ex = torusDelta(cx, x, n), ey = torusDelta(cy, y, n);
    const q2 = (ex * ex + ey * ey) / (r * r);
    if (q2 >= 1) continue;
    // A tower stands to nearly its full height across most of its width; a dome falls away from its crown.
    const shape = tower ? 1 - q2 * Math.sqrt(q2) : (1 - q2) * Math.sqrt(1 - q2);
    const v = shape * (k.h0 + (k.h1 - k.h0) * (1 - u)) / k.h1;
    if (v > best) best = v;
  }
  return best;
}

