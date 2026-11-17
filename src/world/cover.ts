// S8 cover: what one cell of land is. A pure function of the generator's
// smooth fields and the rebuilt surface, evaluated per cell in the bake and
// offline for siting.
//
// The rules run in table order and the first match wins. Every threshold is
// compared against its value plus blue-noise jitter scaled to the rule's edge
// width, so two covers meet in a speckled band and never along a contour.

import { hash2 } from "./core/hash.ts";
import { gradNoise } from "./core/noise.ts";
import type { CoverInput } from "./look/contract.ts";
import { MATERIAL as M } from "./look/materials.ts";

/** World size the periodic fields default to; must be a multiple of 256, the mask's period. */
export const WORLD_N = 6400;

/** One mask lookup per rule, each at its own offset so no two rules share a speckle. */
export const RULE = {
  sea: 0, sand: 1, snow: 2, rock: 3, scree: 4, snowLate: 5, alpine: 6,
  heath: 7, forest: 8, farm: 9, marsh: 10, grass: 11, hue: 12,
} as const;

const RULE_OX = [13, 29, 47, 67, 89, 107, 139, 157, 181, 197, 211, 229, 241];
const RULE_OY = [7, 43, 61, 83, 101, 127, 149, 173, 191, 211, 223, 239, 251];

/**
 * What one cell of edge width is worth in each field's own units: the
 * typical change of that field across a cell. A rule's jitter on a field is
 * its edge width in cells times this.
 */
const PER_CELL = {
  /** Height near the shore, units. */
  e: 0.15,
  slope: 0.02,
  /** Cold score, on a mountain flank. */
  cold: 0.003,
  hand: 0.25,
  /** Moisture, wind, exposure and region weights: smooth fields from the coarse grid. */
  field: 0.006,
  debris: 0.012,
} as const;

/** Blue-noise jitter in [−0.5, 0.5) for one rule at one cell. */
export function ruleJitter(mask: Uint8Array, x: number, y: number, rule: number): number {
  return (mask[(((y + RULE_OY[rule]) & 255) << 8) | ((x + RULE_OX[rule]) & 255)] + 0.5) / 256 - 0.5;
}

/** Cover families that take hue variants; each reads the hue field at its own shift. */
export const HUE_CLASS = {
  alpine: 0, heath: 1, moor: 2, meadow: 3, pasture: 4, scrub: 5, broadleaf: 6, conifer: 7,
} as const;

const HUE_SEED = 0x51a7e;
const HUE_SEED_2 = 0x2c0de;
const HEATHER_SEED = 0x4ea7;
const PARCEL_SEED = 0xf1e1d;

/**
 * The hue field: 200-cell periodic noise with a finer rotated octave, about
 * 0 (cool) … 1 (mid) … 2 (warm). Tiles on a world of n cells.
 */
export function hueField(x: number, y: number, hueClass: number, n: number): number {
  const p = Math.max(1, Math.round(n / 200));
  const u = ((x + 0.5) * p) / n + hueClass * 0.618;
  const v = ((y + 0.5) * p) / n + hueClass * 0.382;
  return 1 + 2.4 * gradNoise(u, v, p, HUE_SEED) + 0.9 * gradNoise(2 * u + v, 2 * v - u, p, HUE_SEED_2);
}

/** Hue variant 0…2: the hue field dithered against the mask, so variants blend over 8–16 cells. */
export function hueVariant(x: number, y: number, hueClass: number, mask: Uint8Array, n: number): number {
  const f = hueField(x, y, hueClass, n) + ruleJitter(mask, x, y, RULE.hue) * 0.13;
  return f < 0.5 ? 0 : f < 1.5 ? 1 : 2;
}

/** Stand-in parcels until S10 ships its own: jittered Voronoi cells, long axis west–east. */
const PARCEL_W = 46;
const PARCEL_H = 30;
/** Karst farmland keeps to ground this close to the valley floor; the rest is scrub. */
const KARST_FARM_HAND = 7;
/** Half-width of the hedge drawn on a parcel boundary, cells. */
const HEDGE_HALF = 0.55;

const CROPS = [
  M.wheat, M.wheat, M.wheat, M.wheat, M.wheat, M.barley, M.barley, M.barley,
  M.ley, M.ley, M.ley, M.ley, M.hay, M.hay, M.plough, M.vine,
];
const KARST_CROPS = [
  M.vine, M.vine, M.vine, M.vine, M.vine, M.vine, M.hay, M.hay,
  M.hay, M.hay, M.hay, M.plough, M.plough, M.wheat, M.wheat, M.barley,
];

function wrapInt(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

/** A parcel's field: about half the parcels join the others of their 2 × 2 block into one larger, irregular field. */
function fieldOf(cx: number, cy: number, h: number): number {
  return (h & 0x30000000) === 0 ? h : hash2(cx >> 1, cy >> 1, PARCEL_SEED + 1);
}

/**
 * The field a cell lies in, as a u32 hash of the field with bit 0 set where
 * the cell is on the field's boundary. Tiles on a world of n cells.
 */
export function parcelAt(x: number, y: number, n: number): number {
  // Even counts, so the 2 × 2 blocks wrap with the world.
  const nx = Math.max(2, 2 * Math.round(n / (2 * PARCEL_W)));
  const ny = Math.max(2, 2 * Math.round(n / (2 * PARCEL_H)));
  const pw = n / nx;
  const ph = n / ny;
  const gx = (x + 0.5) / pw;
  const gy = (y + 0.5) / ph;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let best = 1e30;
  let second = 1e30;
  let bestField = 0;
  let secondField = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = wrapInt(ix + di, nx);
      const cy = wrapInt(iy + dj, ny);
      const h = hash2(cx, cy, PARCEL_SEED);
      const px = ix + di + 0.5 + ((h & 0xffff) / 65536 - 0.5) * 0.94;
      const py = iy + dj + 0.5 + (((h >>> 16) & 0xfff) / 4096 - 0.5) * 0.94;
      const dx = (gx - px) * pw;
      const dy = (gy - py) * ph;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        second = best;
        secondField = bestField;
        best = d2;
        bestField = fieldOf(cx, cy, h);
      } else if (d2 < second) {
        second = d2;
        secondField = fieldOf(cx, cy, h);
      }
    }
  }
  const onEdge = bestField !== secondField && (Math.sqrt(second) - Math.sqrt(best)) * 0.5 < HEDGE_HALF ? 1 : 0;
  return ((hash2(bestField, 7, PARCEL_SEED) & 0xfffffffe) | onEdge) >>> 0;
}

function rockKind(karst: number, slate: number, rock: number, j: number): number {
  if (karst > 0.5 + j * 0.02) return 2;
  if (slate > 0.5 + j * 0.02) return 3;
  return rock < 0.5 + j * 0.1 ? 0 : 1;
}

/**
 * The material of one land or water cell. `n` is the world size the periodic
 * hue field and parcels tile on.
 */
export function cover(c: CoverInput, mask: Uint8Array, n: number = WORLD_N): number {
  const x = Math.floor(c.x);
  const y = Math.floor(c.y);
  const region = c.region;
  const karst = region[4];
  const slate = region[2];

  if (c.water !== 0) {
    if (c.water === 3) return M.river;
    if (c.water === 2) return M.lake;
    return karst > 0.5 + ruleJitter(mask, x, y, RULE.sea) * 16 * PER_CELL.field ? M.seaClear : M.sea;
  }

  const e = c.e;
  const s = c.slope;
  const hand = c.hand;
  const cold = e / 100 + 0.1 * c.northness;

  // Sand: the beach stamp, or low sheltered flat ground. Edge 2. Rocky shores
  // get a shingle line and a bare rock bench instead.
  let j = ruleJitter(mask, x, y, RULE.sand);
  const dE = j * 2 * PER_CELL.e;
  const dS2 = j * 2 * PER_CELL.slope;
  if (
    ((c.shore === 1 || c.shore === 4) && e < 2.5 + dE && s < 0.5 + dS2) ||
    (e < 1.5 + dE && c.exposure < 0.35 + j * 2 * PER_CELL.field && s < 0.15 + dS2)
  ) {
    return karst > 0.5 + j * 0.05 ? M.sandPale : M.sand;
  }
  if (c.shore === 2 && s < 0.9 + dS2) {
    if (e < 1 + dE) return M.shingle;
    if (e < 2.5 + dE) return M.rockHard + rockKind(karst, slate, c.rock, j);
  }

  // Snow: cold and not too steep; cliffs shed it. Edge 2.
  j = ruleJitter(mask, x, y, RULE.snow);
  if (cold > 0.82 + j * 2 * PER_CELL.cold && s < 1.1 + j * 2 * PER_CELL.slope) return M.snow;

  // Bare rock: faces, and steep ground on hard rock. Edge 3.
  j = ruleJitter(mask, x, y, RULE.rock);
  const dS3 = j * 3 * PER_CELL.slope;
  if (s > 1.7 + dS3 || (c.shore === 3 && s > 0.9 + dS3)) return M.cliffHard + rockKind(karst, slate, c.rock, j);
  if (s > 0.9 + dS3 && c.rock < 0.5 + j * 0.1) return M.rockHard + rockKind(karst, slate, 0, j);

  // Scree: where debris gathers on a middling slope. Edge 6.
  j = ruleJitter(mask, x, y, RULE.scree);
  const dS6 = j * 6 * PER_CELL.slope;
  if (c.debris > 0.75 + j * 6 * PER_CELL.debris && s >= 0.45 + dS6 && s < 1.2 + dS6) {
    return slate > 0.5 + j * 0.05 ? M.screeSlate : M.scree;
  }

  // Late snow: the band under the permanent snow that melts to fellfield in
  // high summer. Edge 4.
  j = ruleJitter(mask, x, y, RULE.snowLate);
  if (cold > 0.72 + j * 4 * PER_CELL.cold && s < 0.9 + j * 4 * PER_CELL.slope) return M.snowLate;

  // Alpine meadow: highland and lake country, cold, gentle. Edge 10.
  j = ruleJitter(mask, x, y, RULE.alpine);
  if (
    region[1] + region[3] > 0.5 + j * 10 * PER_CELL.field &&
    cold > 0.55 + j * 10 * PER_CELL.cold &&
    s < 0.5 + j * 10 * PER_CELL.slope
  ) {
    return M.alpineCool + hueVariant(x, y, HUE_CLASS.alpine, mask, n);
  }

  // Heath: wind-blown ground, and the tops of valley country. Edge 12.
  j = ruleJitter(mask, x, y, RULE.heath);
  const dF12 = j * 12 * PER_CELL.field;
  if (c.wind > 0.55 + dF12 || (hand > 30 + j * 12 * PER_CELL.hand && slate > 0.5 + dF12)) {
    // Heather where it is dry or slaty, grass moor where it is wet, in drifts.
    const p = Math.max(1, Math.round(n / 64));
    const drift = gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, HEATHER_SEED);
    const heather = 0.9 * slate + 0.3 * region[1] + 1.2 * (0.55 - c.moisture) + 0.9 * drift + j * 0.3;
    return heather > 0.25
      ? M.heathCool + hueVariant(x, y, HUE_CLASS.heath, mask, n)
      : M.moorCool + hueVariant(x, y, HUE_CLASS.moor, mask, n);
  }

  // Forest: the lower valley sides. The edge is drawn by the trees, so the
  // floor's own edge is narrow; the conifer line is a wide belt of mixed wood,
  // some 20 units of height deep, so it never rings a hill.
  j = ruleJitter(mask, x, y, RULE.forest);
  const dH = j * 3 * PER_CELL.hand;
  const dS = j * 3 * PER_CELL.slope;
  const dF = j * 3 * PER_CELL.field;
  if (
    hand > 2 + dH && hand < 30 + dH &&
    s > 0.08 + dS * 0.5 && s < 0.8 + dS &&
    c.moisture > 0.4 + dF && c.wind < 0.5 + dF &&
    cold < 0.6 + j * 3 * PER_CELL.cold
  ) {
    return cold > 0.45 + j * 0.2 ? M.floorConifer : M.floorBroadleaf;
  }

  // Farmland: flat low ground of the home lowland, and the valley floors of
  // the karst coast, cut into parcels.
  j = ruleJitter(mask, x, y, RULE.farm);
  if (
    s < 0.14 + j * PER_CELL.slope && hand < 25 + j * 4 * PER_CELL.hand &&
    region[0] + (hand < KARST_FARM_HAND + j * 4 * PER_CELL.hand ? 0.7 * karst : 0) > 0.5 + j * 4 * PER_CELL.field
  ) {
    const parcel = parcelAt(x, y, n);
    if ((parcel & 1) !== 0) return M.hedge;
    const pick = (parcel >>> 8) & 15;
    return karst > 0.5 ? KARST_CROPS[pick] : CROPS[pick];
  }

  // Marsh and reeds: flat ground at the water's level. Edge 4; on ground this
  // flat HAND changes slowly, so the band is narrow in units.
  j = ruleJitter(mask, x, y, RULE.marsh);
  if (hand < 1 + j * 0.5 && s < 0.02 + j * 0.01) {
    return hand < 0.4 + j * 0.3 ? M.reeds : M.marsh;
  }

  // Otherwise grass: dry scrub, valley-floor meadow, or pasture. Edge 8.
  j = ruleJitter(mask, x, y, RULE.grass);
  if (c.moisture < 0.3 + j * 8 * PER_CELL.field) return M.scrubCool + hueVariant(x, y, HUE_CLASS.scrub, mask, n);
  if (hand < 6 + j * 8 * PER_CELL.hand && s < 0.2 + j * 8 * PER_CELL.slope) {
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }
  return M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
}
