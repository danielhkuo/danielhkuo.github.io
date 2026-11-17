// S8 cover: what one cell of land is. A pure function of the generator's
// smooth fields and the rebuilt surface, evaluated per cell in the bake and
// offline for siting.
//
// The rules run in table order and the first match wins. Every threshold is
// compared against its value plus blue-noise jitter scaled to the rule's edge
// width, so two covers meet in a speckled band and never along a contour.
// On steep ground that is not enough: a face is drawn a pixel to the unit of
// height, so a speckled band there is static. Rock, scree, snow and the
// plants of a face are bounded by smooth noise instead, and judged on the
// slope and height of the land's form (bake/coverFields.ts), not of the cell.
//
// Enclosed land (S10) comes before heath and forest: where people farm, the
// field decides, and woods keep to the ground too steep to plough.

import { hash2 } from "./core/hash.ts";
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
const SNOWLINE_SEED = 0x5a0e;
/** A true cliff: bare rock whatever else is true. Measured on the land's form, so a gully's wall is not one. */
export const CLIFF_SLOPE = 1.3;
/** A scarp too small to show in the form is still a cliff from this slope of its own. */
const SCARP_SLOPE = 1.35;
/** Crag bands start at this slope and thicken up to a cliff; they repeat every CRAG_SPACING units of height. */
export const CRAG_SLOPE = 0.75;
const CRAG_SPACING = 8;
/** Scree lies at its angle of rest or flatter: steeper ground under a cliff is still the cliff's own slope. */
const SCREE_REST = 0.9;
/** Ground steeper than this sheds its snow, give or take 0.08 for aspect: 0.7 (35°) in the shade, 0.54 in the sun. A couloir holds it to COULOIR_SHED. */
export const SNOW_SHED = 0.62;
const COULOIR_SHED = 1.05;
/** A crest standing this far above the ground round it is too narrow to hold snow. */
const CREST_RELIEF = 1.1;
/** So is a ridge whose form stands this far above the ground eight cells round. */
const CREST_CURVE = 1.05;
/** Ground this close to its river's level is floodplain. */
const FLOOD_HAND = 0.9;
const ROCK_SEED = 0x70c4;
const CRAG_SEED = 0xc4a6;
const MARSH_SEED = 0x3a45;
const EDGE_SEED = 0xed6e;
const SCREE_SEED = 0x5c4ee;
const STRATA_SEED = 0x57a7a;
const HEATH_SEED = 0x4ea7;
const WOOD_SEED = 0x300d;
const CREEK_SEED = 0xc4ee;
/** Vegetation ledges on a steep face follow strata about this many units of height apart. */
const STRATA_SPACING = 5.5;
/** Below this height nothing is ever snow, so the snowline is not worked out. */
const SNOW_FLOOR = 55;

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
/**
 * Fields keep to gentle ground near the valley floor and its rivers: lowland
 * fields stop at this slope and this height above drainage; upland in-bye
 * land runs a little steeper but stays lower still.
 */
const LOWLAND_SLOPE = 0.12;
const LOWLAND_HAND = 12;
/** Ground this gentle is always field in farmed country: a wood strays down a slope's foot, never across the flat and through a parcel. */
const FIELD_SURE = 0.07;
const UPLAND_SLOPE = 0.2;
const UPLAND_HAND = 10;
/** In upland country, open ground this far above the valley floor is moor. */
const ROUGH_HAND = 12;
/** How far lake country lowers the alpine meadow's cold score. */
const ALPINE_LAKES = 0.13;
/** In the home lowland, gentle ground above the fields is open down, not wood: woods start this much steeper there. */
const HOME_OPEN = 0.06;
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
  // A hedge is ground for scatter to plant a broken row of crowns on; a wall is a thin line with gaps.
  if (f.edge < BOUNDARY_HALF) {
    if (!upland) return M.hedge;
    return ruleJitter(mask, x, y, RULE.furrow) < 0.28 ? M.wall : M.pastureCool + (f.id >>> 3) % 3;
  }
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

/** Smooth periodic noise, about ±0.6, with features `cells` cells across. */
function soft(x: number, y: number, n: number, cells: number, seed: number): number {
  const p = Math.max(1, Math.round(n / cells));
  return gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, seed);
}

/**
 * −1…1, constant along a stratum: beds of a steep face, a few units of
 * height thick, bent by slow noise so they dip and pinch. Each bed draws its
 * own value, and beds that draw alike merge, so ledges vary in width and
 * never repeat.
 */
function strata(e: number, x: number, y: number, n: number): number {
  const t = e / STRATA_SPACING + 2.2 * soft(x, y, n, 44, STRATA_SEED) + 0.6 * soft(x, y, n, 12, STRATA_SEED + 1);
  return (hash2(Math.floor(t) + 4096, 0x57, STRATA_SEED) & 1023) / 511.5 - 1;
}

/** 0 on gentle ground … 1 on a steep face: how far ledges and runnels, not the valley below, decide what grows. */
function faceShare(st: number): number {
  return st > 0.75 ? 1 : st < 0.45 ? 0 : (st - 0.45) / 0.3;
}

/** Open hill ground: heather where it is dry or slaty, grass moor where it is wet, in drifts. */
function heathOrMoor(c: CoverInput, x: number, y: number, j: number, mask: Uint8Array, n: number): number {
  // Heather keeps to dry, exposed, well-drained ground: the windward convex
  // tops high above their valleys, and slate country. The score follows the
  // land, so heather follows ridges and spurs; its edge is a narrow dither.
  // On a steep face the height above the valley says little (every spur
  // between two rills would be a stripe): there heather keeps to the drier
  // ledges, bed by bed, and leaves the runnels to grass and bracken.
  const k = faceShare(c.steep === undefined ? c.slope : c.steep);
  const above = (c.hand - 18) / 30;
  // Runnels are the form's own hollows, a dozen cells wide; the cell-wide gullies inside them are left to the light.
  const spur = c.curve === undefined ? 0 : c.curve < -1.5 ? -1.5 : c.curve > 1.5 ? 1.5 : c.curve;
  const drift = 0.4 * soft(x, y, n, 38, HEATH_SEED) + 0.15 * soft(x, y, n, 11, HEATH_SEED + 3);
  let score = 3 * (c.wind - 0.55) + (1 - k) * (above < -0.6 ? -0.6 : above > 0.5 ? 0.5 : above) + 0.5 * c.region[2] + 0.2 * c.region[1] - 3 * (c.moisture - 0.75) + j * 0.06 + drift;
  if (k > 0) {
    score += k * ((above < -0.2 ? -0.2 : above > 0.25 ? 0.25 : above) + 0.34 * strata(c.form === undefined ? c.e : c.form, x, y, n) + 0.14 * spur);
  }
  if (score <= 0.3) return M.moorCool + hueVariant(x, y, HUE_CLASS.moor, mask, n);
  // In bloom at the heart of the heath, browner toward its edge.
  return score > 0.85 ? M.heathCool : score > 0.55 ? M.heathMid : M.heathWarm;
}

/**
 * The stone of a cell: 0 hard, 1 sedimentary, 2 limestone, 3 slate. Where two
 * rock classes meet the line is bent by slow noise, so it never runs straight
 * down the grid the classes were laid out on.
 */
function rockKind(c: CoverInput, x: number, y: number, n: number): number {
  if (c.region[4] > 0.5) return 2;
  if (c.region[2] > 0.5) return 3;
  const p = Math.max(1, Math.round(n / 56));
  const bend = gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, ROCK_SEED);
  // The bend only decides where the two classes are mixed: a cell of one class keeps its stone.
  return c.rock + 0.45 * bend < 0.5 ? 0 : 1;
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

  // Sand: real beaches only, where the coast stage put a sheltered, nearly
  // flat shore. Low flat ground inland is floodplain, not sand. Edge 2. Rocky
  // shores get a shingle line and a narrow rock bench instead.
  let j = ruleJitter(mask, x, y, RULE.sand);
  const dE = j * 2 * PER_CELL.e;
  const dS2 = j * 2 * PER_CELL.slope;
  if ((c.shore === 1 || c.shore === 4) && e < 1.1 + dE && s < 0.2 + dS2 && c.exposure < 0.45 + j * 2 * PER_CELL.field) {
    return karst > 0.5 + j * 0.05 ? M.sandPale : M.sand;
  }
  // Dunes behind a beach are marram, and a sheltered muddy shore is saltmarsh cut by creeks: neither is sand.
  if (c.shore === 5 && e < 4.5 + 3 * dE && s < 0.45 + dS2) return M.duneGrass;
  if (c.shore === 6 && e < 2.2 + 2 * dE && s < 0.12 + dS2) {
    // Creeks: the zero lines of slow noise, a cell or two wide, branching toward the water.
    const creek = soft(x, y, n, 14, CREEK_SEED) + 0.4 * soft(x, y, n, 5, CREEK_SEED + 1);
    return creek > -0.035 && creek < 0.035 && e < 1.6 ? M.saltCreek : M.saltmarsh;
  }
  if (c.shore === 2 && s < 0.9 + dS2) {
    if (e < 1 + dE) return M.shingle;
    if (e < 1.8 + dE) return M.rockHard + rockKind(c, x, y, n);
  }

  // Floodplain: flat ground at the river's own level floods, so it is reeds at
  // the water, marsh in the wet hollows and wet meadow between: never sand,
  // never ploughed. Edge 4.
  j = ruleJitter(mask, x, y, RULE.marsh);
  if (hand < FLOOD_HAND + j * 0.4 && s < 0.045 + j * 0.01 && e < 14) {
    const rdx = c.riverDx === undefined ? 0 : c.riverDx;
    const rdy = c.riverDy === undefined ? 0 : c.riverDy;
    const beside = (rdx !== 0 || rdy !== 0) && rdx * rdx + rdy * rdy < (2.2 + 2 * j) * (2.2 + 2 * j);
    if (beside || hand < 0.25 + j * 0.2) return M.reeds;
    const mp = Math.max(1, Math.round(n / 34));
    if (gradNoise(((x + 0.5) * mp) / n, ((y + 0.5) * mp) / n, mp, MARSH_SEED) > 0.2 + j * 0.1) return M.marsh;
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }

  const relief = c.relief === undefined ? 0 : c.relief;
  const west = c.westness === undefined ? 0 : c.westness;

  // The slope of the land's form. Class borders are drawn on it, not on the
  // slope of the cell: a gullied face changes slope from cell to cell, and a
  // border on that is static.
  const st = c.steep === undefined ? s : c.steep;
  const curve = c.curve === undefined ? 0 : c.curve;
  /** Height on the form: beds and bands follow its contours and so cross gullies unbroken. */
  const ef = c.form === undefined ? e : c.form;

  // Snow is built, not banded: height, less on faces turned south and to the
  // sun, less on spurs and more in corries, shed from steep ground and from
  // narrow crests so ribs and arêtes show, and lingering where the ground is
  // hollow, so it caps the benches and streaks down the couloirs. The edge is
  // a hard threshold on a smooth score: clean, wandering, never speckled.
  let snowScore = 0;
  let fine = 0;
  if (e > SNOW_FLOOR) {
    fine = soft(x, y, n, 18, SNOWLINE_SEED + 1);
    const wander = soft(x, y, n, 28, SNOWLINE_SEED);
    // How far a gully carries its snow below the line differs from one gully to the next: no comb of equal tongues.
    const carry = 0.55 + 1.5 * (wander < -0.3 ? -0.3 : wander > 0.3 ? 0.3 : wander);
    const hollow = relief < 0 ? carry * (relief < -4 ? 0.2 : -0.05 * relief) : relief > 2 ? -0.04 : -0.02 * relief;
    // Corries and gully heads gather snow, spurs and ridges lose it: what breaks the snowline into tongues of unequal length.
    const lie = curve < 0 ? (curve < -1.5 ? 0.12 : -0.08 * curve) : curve > 1.5 ? -0.12 : -0.08 * curve;
    snowScore = e / 100 + 0.2 * c.northness - 0.06 * west + hollow + lie +
      0.13 * soft(x, y, n, 150, SNOWLINE_SEED + 2) + 0.07 * wander + 0.012 * fine;
  }
  // Steep ground sheds its snow, sunny faces sooner than shaded ones; a couloir or a corrie holds it on steeper ground.
  const hollowed = relief < -0.6 || curve < -0.45;
  const shed = st > (hollowed ? COULOIR_SHED : SNOW_SHED + 0.08 * c.northness) + 0.08 * fine;
  // A narrow crest, sharp or rounded, is blown clear: the ridges show as lines of rock.
  const sharp = relief > CREST_RELIEF + 0.5 * fine && st > 0.2;
  const crest = sharp || curve + 2.5 * (relief > 0.5 ? 0.5 : relief) > CREST_CURVE + 0.35 * fine;
  const holdsSnow = !shed && !crest;
  if (snowScore > 0.84 && holdsSnow) return M.snow;

  // Bare rock is the exception, not the rule. Faces: a true cliff, from a
  // form slope of 1.3, its edge bent by smooth noise so it never runs ruled
  // down a face. Summits: ground that is high, wind-blown and convex at once.
  // Above the snowline: whatever is too steep or too narrow to hold snow.
  // Crag bands: thin ribbons of rock along the contour of steep ground,
  // broken and wandering, thicker the steeper it is. Everything else that is
  // merely steep keeps its heath, bracken or grass.
  j = ruleJitter(mask, x, y, RULE.rock);
  const dS3 = j * 3 * PER_CELL.slope;
  const bend = soft(x, y, n, 6, EDGE_SEED);
  if (
    st > CLIFF_SLOPE + 0.24 * bend + j * 0.03 || (c.shore === 3 && s > 0.9 + dS3) ||
    (s > SCARP_SLOPE + dS3 && (c.steep === undefined || st < 0.55))
  ) {
    return M.cliffHard + rockKind(c, x, y, n);
  }
  if (snowScore > 0.8 + 0.03 * bend && !holdsSnow) {
    // Bare faces above the snowline are bedded: dark steps and paler benches, and snow lying on the widest ledges.
    const bed = strata(ef, x, y, n);
    if (bed < -0.42 && !crest && st < 0.8 && soft(x, y, n, 20, SNOWLINE_SEED + 3) > -0.08) return M.snow;
    return (st > 0.95 + 0.2 * bend || bed > 0.35 ? M.cliffHard : M.rockHard) + rockKind(c, x, y, n);
  }
  if (st > 0.45 && (e - 75) / 40 + 2 * (c.wind - 0.6) + (curve > 4 ? 0.16 : curve < -4 ? -0.16 : 0.04 * curve) > 0.45 + 0.14 * bend + j * 0.03) {
    return M.rockHard + rockKind(c, x, y, n);
  }
  if (st > CRAG_SLOPE) {
    const cp = Math.max(1, Math.round(n / 48));
    const gp = Math.max(1, Math.round(n / 96));
    const u = ((x + 0.5) * cp) / n, v = ((y + 0.5) * cp) / n;
    const warp = gradNoise(u, v, cp, CRAG_SEED);
    const gate = gradNoise(((x + 0.5) * gp) / n + 0.5, ((y + 0.5) * gp) / n, gp, CRAG_SEED + 1);
    const t = (ef + 13 * warp) / CRAG_SPACING;
    const steepness = (st - CRAG_SLOPE) / (CLIFF_SLOPE - CRAG_SLOPE);
    // Bands come and go along the face: most of a steep slope carries none.
    const present = gate > 0.08 ? (gate > 0.3 ? 1 : (gate - 0.08) / 0.22) : 0;
    const thick = 0.42 * (steepness > 1 ? 1 : steepness) * present * (1 - 0.25 * (c.rock > 2 ? 2 : c.rock)) + 0.1 * karst * present;
    // A band is a ledge of rock a unit or more thick, broken along its length: a thinner one would be a contour line drawn on the hill.
    if (thick > 0.11 && t - Math.floor(t) < thick + j * 0.04 && soft(x, y, n, 9, CRAG_SEED + 2) > -0.18) return M.rockHard + rockKind(c, x, y, n);
  }

  // Scree: talus fans under a real cliff, where the form breaks from the face
  // to gentler ground, widening down the fall line. A buff wash with a clean,
  // lobed edge and a few stones in clusters: never a stipple.
  const fan = c.cliffAbove === undefined ? 0 : c.cliffAbove;
  if (fan > 0 && st > 0.12 && st < SCREE_REST && s < 1.2) {
    j = ruleJitter(mask, x, y, RULE.scree);
    const reach = fan * (1 + (c.debris > 0.5 ? 0.5 : c.debris));
    const lobe = 0.34 + 0.45 * soft(x, y, n, 5, SCREE_SEED);
    if (reach > (lobe < 0.1 ? 0.1 : lobe) + j * 0.025) {
      if (j > 0.36 && soft(x, y, n, 8, SCREE_SEED + 1) > 0.12) return M.screeStone;
      return slate > 0.5 ? M.screeSlate : M.scree;
    }
  }

  // Late snow: the band under the permanent snow that melts to fellfield in
  // high summer. The same clean edge.
  if (snowScore > 0.74 && holdsSnow) return M.snowLate;

  // Alpine meadow: highland and lake country, cold, gentle. Edge 10. Lake
  // country's fells are lower, so its meadows start lower.
  j = ruleJitter(mask, x, y, RULE.alpine);
  if (
    region[1] + region[3] > 0.5 + j * 10 * PER_CELL.field &&
    cold > 0.55 - ALPINE_LAKES * region[3] + j * 10 * PER_CELL.cold &&
    st < 0.5 + j * 10 * PER_CELL.slope
  ) {
    return M.alpineCool + hueVariant(x, y, HUE_CLASS.alpine, mask, n);
  }

  // Enclosed land. Lowland: the home island's gentle ground and the karst
  // valley floors, hedged. Upland: the in-bye land of valley and lake country
  // and the highland's margins, walled. Edge 4.
  j = ruleJitter(mask, x, y, RULE.farm);
  const dW = j * 4 * PER_CELL.field;
  // A field needs gentle ground in the cell and in the form round it: no enclosures on a moor wall's ledges.
  const lie = s > st ? s : st;
  // The line between plough and wood wanders: it does not keep to the foot of a slope, or to the road that runs there.
  const stray = 0.15 * soft(x, y, n, 50, WOOD_SEED) + 0.04 * soft(x, y, n, 13, WOOD_SEED + 1);
  const lowlandW = region[0] + (hand < KARST_FARM_HAND + j * 4 * PER_CELL.hand ? 0.8 * karst : 0);
  const uplandW = 0.9 * slate + 0.75 * region[3] + 0.55 * region[1];
  if (e > 1.2 && c.wind < 0.7 + j * 4 * PER_CELL.wind) {
    if (lowlandW > 0.5 + dW) {
      if (lie < (stray < FIELD_SURE - LOWLAND_SLOPE ? FIELD_SURE : LOWLAND_SLOPE + stray) + j * PER_CELL.slope && hand < LOWLAND_HAND + j * 4 * PER_CELL.hand) {
        return fieldCell(c, x, y, mask, n, false, karst > region[0]);
      }
    } else if (
      uplandW > 0.45 + dW && lie < UPLAND_SLOPE + j * PER_CELL.slope &&
      hand < UPLAND_HAND + j * 4 * PER_CELL.hand && cold < 0.38 + j * 4 * PER_CELL.cold && c.wind < 0.62 + j * 4 * PER_CELL.wind
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
    s > 0.08 + (HOME_OPEN + stray) * region[0] + dS * 0.5 && st < 0.8 + dS &&
    moisture > 0.4 + dF && c.wind < 0.5 + lee + j * 3 * PER_CELL.wind &&
    cold < 0.6 - 0.2 * (region[1] + region[3]) + j * 3 * PER_CELL.cold &&
    // The home lowland's hills are wood and open down by turns: a wood there never runs unbroken along the foot of its slope.
    soft(x, y, n, 64, WOOD_SEED + 2) > -0.16 - 2 * (1 - region[0]) + j * 0.03
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
  if (moisture < 0.3 + j * 8 * PER_CELL.field) return M.scrubCool + hueVariant(x, y, HUE_CLASS.scrub, mask, n);
  if (hand < 6 + j * 8 * PER_CELL.hand && s < 0.2 + j * 8 * PER_CELL.slope) {
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }
  // Steep open ground is not rock: heather where it is high or wind-blown,
  // bracken on the sunny side, rough grass in the shade.
  if (st > 0.5 + j * 8 * PER_CELL.slope) {
    // On a face a unit of height is a pixel, so these lines are bent by smooth noise and drawn clean: a jittered band would be static.
    if (e > 38 + 16 * soft(x, y, n, 30, HEATH_SEED + 1) + j * 2 || c.wind > 0.56 + j * 8 * PER_CELL.wind) return heathOrMoor(c, x, y, j, mask, n);
    // Bracken takes the sunny side, bed by bed, and the damp runnels of any side.
    const sun = 0.25 + 0.45 * strata(ef, x, y, n) + 0.3 * soft(x, y, n, 22, HEATH_SEED + 2) + j * 0.06;
    if (c.northness < sun || (curve < -0.6 && c.northness < sun + 0.5)) return M.bracken;
    return M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
  }
  // Above the walls the hill is rough grazing, not pasture.
  if (uplandW > 0.5 + j * 8 * PER_CELL.field && hand > ROUGH_HAND + j * 8 * PER_CELL.hand) return heathOrMoor(c, x, y, j, mask, n);
  return M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
}
