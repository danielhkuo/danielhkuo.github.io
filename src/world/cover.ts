// S8 cover: what one cell of land is. A pure function of the generator's
// smooth fields and the rebuilt surface, evaluated per cell in the bake and
// offline for siting.
//
// The rules run in table order and the first match wins. Every threshold is
// compared against its value plus blue-noise jitter scaled to the rule's edge
// width, so two covers meet in a speckled band and never along a contour.
//
// Enclosed land (S10) comes before heath and forest: where people farm, the
// field decides, and woods keep to the ground too steep to plough.

import { gradNoise } from "./core/noise.ts";
import type { CoverInput } from "./look/contract.ts";
import { MATERIAL as M } from "./look/materials.ts";
import { furrowAt, newParcel, parcelAt, RIVER_BANK, type Parcel } from "./parcels.ts";

/** World size the periodic fields default to; must be a multiple of 256, the mask's period. */
export const WORLD_N = 6400;

/** One mask lookup per rule, each at its own offset so no two rules share a speckle. */
export const RULE = {
  sea: 0, sand: 1, snow: 2, rock: 3, scree: 4, snowLate: 5, alpine: 6,
  heath: 7, forest: 8, farm: 9, marsh: 10, grass: 11, hue: 12, furrow: 13, margin: 14,
} as const;

const RULE_OX = [13, 29, 47, 67, 89, 107, 139, 157, 181, 197, 211, 229, 241, 3, 121];
const RULE_OY = [7, 43, 61, 83, 101, 127, 149, 173, 191, 211, 223, 239, 251, 97, 33];

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
  /** Moisture, exposure and region weights: smooth fields from the coarse grid. */
  field: 0.006,
  /** Wind exposure is flatter still across open country. */
  wind: 0.0025,
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
const OUTCROP_SEED = 0x11e57;

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

// ---------------------------------------------------------------------------
// Enclosed land: what grows in a field, and the lines drawn across it.

/** A boundary is drawn where a cell lies within this of the next field: a one-cell hedge or wall. */
export const BOUNDARY_HALF = 0.55;
/** Arable fields keep a rough grass margin this far in from the boundary. */
export const MARGIN = 1.6;
/** Lowland fields stop at this slope and this height above the valley floor; upland in-bye land runs steeper but stays lower. */
const LOWLAND_SLOPE = 0.15;
const LOWLAND_HAND = 20;
const UPLAND_SLOPE = 0.27;
const UPLAND_HAND = 14;
/** In upland country, open ground this far above the valley floor is moor. */
const ROUGH_HAND = 12;
/** How far lake country lowers the alpine meadow's cold score. */
const ALPINE_LAKES = 0.13;
/** Karst farmland keeps to ground this close to the valley floor; the rest is scrub. */
const KARST_FARM_HAND = 7;

const WHEAT = 0, BARLEY = 1, LEY = 2, HAY = 3, PASTURE = 4, MEADOW = 5, PLOUGH = 6, VINE = 7, COPSE = 8, ROUGH = 9;

/** What a field grows, by 32nds. Lowland: mostly arable, a third grass. */
const LOWLAND_USE = [
  WHEAT, WHEAT, WHEAT, WHEAT, WHEAT, WHEAT, WHEAT, BARLEY, BARLEY, BARLEY, BARLEY, LEY, LEY, LEY, LEY, HAY,
  HAY, HAY, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, MEADOW, MEADOW, MEADOW, PLOUGH, PLOUGH, VINE, COPSE, COPSE, PASTURE,
];
/** Karst valley floors: vines and hay between stony pasture. */
const KARST_USE = [
  VINE, VINE, VINE, VINE, VINE, VINE, VINE, VINE, VINE, HAY, HAY, HAY, HAY, WHEAT, WHEAT, WHEAT,
  BARLEY, BARLEY, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, MEADOW, MEADOW, PLOUGH, PLOUGH, PLOUGH, COPSE, COPSE, COPSE, PASTURE,
];
/** Upland in-bye land: walled pasture and hay meadow, a rough field here and there. */
const UPLAND_USE = [
  PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE, PASTURE,
  MEADOW, MEADOW, MEADOW, MEADOW, MEADOW, MEADOW, HAY, HAY, HAY, HAY, LEY, LEY, COPSE, COPSE, ROUGH, PASTURE,
];

const scratch: Parcel = newParcel();

/** The field a cell lies in: see parcels.ts. A fresh copy; cover itself reuses one. */
export function fieldAt(c: CoverInput, n: number = WORLD_N): Parcel {
  return parcelAt(c, n, newParcel());
}

/**
 * One cell of a field. `upland` fields are walled and grass; lowland fields
 * are hedged and mostly arable. Furrows, rows and swaths are single lines in
 * screen pixels along the field's axis, broken by the mask.
 */
function fieldCell(c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, upland: boolean, karst: boolean): number {
  const f = parcelAt(c, n, scratch, RIVER_BANK + 1.6 * ruleJitter(mask, x, y, RULE.margin));
  if (f.edge < BOUNDARY_HALF) return upland ? M.wall : M.hedge;
  const id = f.id;
  // The bank of a river is left as meadow: a verge the plough does not reach.
  if (f.bank !== 0) return M.meadowCool + (id >>> 3) % 3;
  const pick = (id >>> 8) & 31;
  let use = upland ? UPLAND_USE[pick] : karst ? KARST_USE[pick] : LOWLAND_USE[pick];
  // Only a small field is given over to trees.
  if (use === COPSE && f.single === 0) use = PASTURE;
  const variant = (id >>> 3) % 3;
  if (use === PASTURE) return (karst ? M.scrubCool : M.pastureCool) + variant;
  if (use === MEADOW) return M.meadowCool + variant;
  if (use === COPSE) return M.floorBroadleaf;
  if (use === ROUGH) return M.moorCool + variant;

  // Arable fields keep a grass margin inside the hedge.
  if (use !== LEY && use !== HAY && f.edge < MARGIN && ruleJitter(mask, x, y, RULE.margin) < 0.25) return M.pastureMid;

  const u = furrowAt(x, y, f.axis);
  const r = ruleJitter(mask, x, y, RULE.furrow) + 0.5;
  const state = (id >>> 13) & 7;
  if (use === WHEAT || use === BARLEY) {
    // Standing corn with tramlines; stubble; or a field half cut, in swaths eight pixels wide.
    const cut = state >= 6 ? true : state >= 4 ? (((u >> 3) + (id >>> 16)) & 1) === 1 : false;
    if (cut) return u % 4 === 0 && r < 0.65 ? M.stubbleRow : M.stubble;
    if (use === WHEAT) return u % 8 === 0 && r < 0.8 ? M.wheatRow : M.wheat;
    return u % 5 === 0 && r < 0.75 ? M.barleyRow : M.barley;
  }
  if (use === LEY) return state < 4 && ((u >> 2) & 1) === 1 ? M.leyStripe : M.ley;
  if (use === HAY) return u % 5 === 0 && r < 0.8 ? M.hayRow : M.hay;
  if (use === PLOUGH) return u % 2 === 0 && r < 0.7 ? M.ploughRow : M.plough;
  return u % 4 < 2 && r < 0.85 ? M.vineRow : M.vine;
}

/** Open hill ground: heather where it is dry or slaty, grass moor where it is wet, in drifts. */
function heathOrMoor(c: CoverInput, x: number, y: number, j: number, mask: Uint8Array, n: number): number {
  const p = Math.max(1, Math.round(n / 64));
  const drift = gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, HEATHER_SEED);
  const heather = 0.9 * c.region[2] + 0.3 * c.region[1] + 1.2 * (0.55 - c.moisture) + 0.9 * drift + j * 0.3;
  return heather > 0.25
    ? M.heathCool + hueVariant(x, y, HUE_CLASS.heath, mask, n)
    : M.moorCool + hueVariant(x, y, HUE_CLASS.moor, mask, n);
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
    ((c.shore === 1 || c.shore === 4) && e < 1.1 + dE && s < 0.5 + dS2) ||
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

  // Alpine meadow: highland and lake country, cold, gentle. Edge 10. Lake
  // country's fells are lower, so its meadows start lower.
  j = ruleJitter(mask, x, y, RULE.alpine);
  if (
    region[1] + region[3] > 0.5 + j * 10 * PER_CELL.field &&
    cold > 0.55 - ALPINE_LAKES * region[3] + j * 10 * PER_CELL.cold &&
    s < 0.5 + j * 10 * PER_CELL.slope
  ) {
    return M.alpineCool + hueVariant(x, y, HUE_CLASS.alpine, mask, n);
  }

  // Enclosed land. Lowland: the home island's gentle ground and the karst
  // valley floors, hedged. Upland: the in-bye land of valley and lake country
  // and the highland's margins, walled. Edge 4.
  j = ruleJitter(mask, x, y, RULE.farm);
  const dW = j * 4 * PER_CELL.field;
  const lowlandW = region[0] + (hand < KARST_FARM_HAND + j * 4 * PER_CELL.hand ? 0.8 * karst : 0);
  const uplandW = 0.9 * slate + 0.75 * region[3] + 0.55 * region[1];
  if (e > 1.2 && c.wind < 0.72 + j * 4 * PER_CELL.wind) {
    if (lowlandW > 0.5 + dW) {
      if (s < LOWLAND_SLOPE + j * PER_CELL.slope && hand < LOWLAND_HAND + j * 4 * PER_CELL.hand) {
        return fieldCell(c, x, y, mask, n, false, karst > region[0]);
      }
    } else if (
      uplandW > 0.45 + dW && s < UPLAND_SLOPE + j * PER_CELL.slope &&
      hand < UPLAND_HAND + j * 4 * PER_CELL.hand && cold < 0.42 + j * 4 * PER_CELL.cold && c.wind < 0.6 + j * 4 * PER_CELL.wind
    ) {
      return fieldCell(c, x, y, mask, n, true, false);
    }
  }

  // Low ground is sheltered: the wind that bares a hilltop does not bare a
  // valley floor or the home lowland.
  const lee = 0.25 * (e < 0 ? 1 : e > 24 ? 0 : 1 - e / 24) + 0.1 * region[0];

  // Heath: wind-blown ground, and the tops of valley country. Edge 12.
  j = ruleJitter(mask, x, y, RULE.heath);
  const dX12 = j * 12 * PER_CELL.wind;
  if (c.wind > 0.55 + lee + dX12 || (hand > 30 + j * 12 * PER_CELL.hand && slate > 0.5 + j * 12 * PER_CELL.field)) {
    return heathOrMoor(c, x, y, j, mask, n);
  }

  // The karst coast is dry whatever the rain: its limestone drains it.
  const moisture = c.moisture * (1 - 0.62 * karst);

  // Forest: the lower valley sides. The edge is drawn by the trees, so the
  // floor's own edge is narrow; the conifer line is a wide belt of mixed wood,
  // some 20 units of height deep, so it never rings a hill. In the highland
  // woods keep to the valleys and turn to conifer sooner.
  j = ruleJitter(mask, x, y, RULE.forest);
  const dH = j * 3 * PER_CELL.hand;
  const dS = j * 3 * PER_CELL.slope;
  const dF = j * 3 * PER_CELL.field;
  if (
    hand > 2 + dH && hand < 30 - 14 * region[1] - 16 * region[3] + dH &&
    s > 0.08 + dS * 0.5 && s < 0.8 + dS &&
    moisture > 0.4 + dF && c.wind < 0.5 + lee + j * 3 * PER_CELL.wind &&
    cold < 0.6 - 0.2 * (region[1] + region[3]) + j * 3 * PER_CELL.cold
  ) {
    return cold > 0.45 - 0.22 * region[1] + j * 0.2 ? M.floorConifer : M.floorBroadleaf;
  }

  // Marsh and reeds: flat ground at the water's level. Edge 4; on ground this
  // flat HAND changes slowly, so the band is narrow in units.
  j = ruleJitter(mask, x, y, RULE.marsh);
  if (hand < 1 + j * 0.5 && s < 0.02 + j * 0.01) {
    return hand < 0.4 + j * 0.3 ? M.reeds : M.marsh;
  }

  // Otherwise grass: dry scrub, valley-floor meadow, or pasture. Edge 8.
  j = ruleJitter(mask, x, y, RULE.grass);
  if (moisture < 0.3 + j * 8 * PER_CELL.field) {
    // Limestone shows through the karst scrub in pale outcrops on its steeper ground.
    if (karst > 0.5 && s > 0.22 + j * 0.1) {
      const p = Math.max(1, Math.round(n / 36));
      if (gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, OUTCROP_SEED) > 0.18 + j * 0.2) return M.rockLime;
    }
    return M.scrubCool + hueVariant(x, y, HUE_CLASS.scrub, mask, n);
  }
  if (hand < 6 + j * 8 * PER_CELL.hand && s < 0.2 + j * 8 * PER_CELL.slope) {
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }
  // Above the walls the hill is rough grazing, not pasture.
  if (uplandW > 0.5 + j * 8 * PER_CELL.field && hand > ROUGH_HAND + j * 8 * PER_CELL.hand) return heathOrMoor(c, x, y, j, mask, n);
  return M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
}
