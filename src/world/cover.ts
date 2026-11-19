// S8 cover: what one cell of land is. A pure function of the generator's
// smooth fields and the rebuilt surface, evaluated per cell in the bake and
// offline for siting.
//
// The rules run in table order and the first match wins. Every threshold is
// compared against its value plus blue-noise jitter scaled to the rule's edge
// width, so two covers meet in a speckled band and never along a contour.
// On steep ground that is not enough: a face is drawn a pixel to the unit of
// height, so a speckled band there is static. Rock and the plants of a face
// are bounded by smooth noise instead, and judged on the slope, height and
// aspect of the land's form (bake/coverFields.ts), not of the cell. Snow,
// scree and upland woods are scores on those smooth fields, with edges
// feathered by smooth noise and a little dither.
//
// Enclosed land (S10) comes before heath and forest: where people farm, the
// field decides, and woods keep to the ground too steep to plough.

import { climateShift, DESERT_RAIN, ergAt, HEAT_LAPSE, heatOf, HOT_EDGE, isTemperate, SHIFT_TREELINE, STEPPE_RAIN } from "./biome.ts";
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
/** The snowline on a level, open face, in units of height; slow noise moves it some ten units either way. */
export const SNOWLINE = 93;
/** A face turned full north carries its snow this many units lower; one turned south, as much higher. */
const SNOW_SHADE = 7;
/** Units of height to one point of snow score. */
const SNOW_SPAN = 10;
/** The most the lie of the ground adds, in score: a tongue of snow in a couloir or a cirque ends this far below the line. */
const SNOW_TONGUE = 1.1;
/** Ground this steep is the face the stones fall from, never the fan they lie in. */
const SCREE_FACE = 1.02;
/** The land's form must be this gentle for stones to lie: steeper, they roll on. */
const SCREE_REST = 0.84;
/** A fan shows where the cliff's feed (0–1, coverFields), thickened by the rockfall lying there, comes to this. */
const SCREE_FAN = 0.34;
/** Low ground grows over all but the strongest fans: this much more feed is needed at the foot of the hills. */
const SCREE_GROWN = 0.3;
/** Stones lie scattered this far, in feed, beyond the edge of a fan. */
const SCREE_SPILL = 0.07;
/** A cliff cell that feeds a fan this strongly is drawn as the rock at its head. */
const SCREE_HEAD = 0.4;
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
const COPSE_SEED = 0xc095e;
const MOOR_SEED = 0x3004;
const WIND_SEED = 0x91d5;
/** An upland wood stands where its score passes this: the higher, the less woodland. */
const COPSE_BIAS = 0.03;
/** The width of an upland wood's edge, in score: its trees thin out over some half a dozen cells. */
const WOOD_FEATHER = 0.36;
/** The cold score at which trees give out; lower in highland and lake country. */
const TREE_LINE = 0.6;
/** Vegetation ledges on a steep face follow strata about this many units of height apart. */
const STRATA_SPACING = 5.5;
/** Below this height nothing is ever snow, so the snowline is not worked out. */
const SNOW_FLOOR = 62;
/** Heather wants exposure: the form's convexity (CoverInput.curve) from which a crest begins to count, and at which it counts in full. */
const HEATH_CREST: readonly [number, number] = [0.9, 2.6];
/** What a full crest adds to the heath's score, and what open ground that is no crest loses. */
const HEATH_CREST_GAIN = 1.4;
/** Height above the valley (CoverInput.hand) from which a broad top begins to count as exposed, and counts in full. */
const HEATH_TOP: readonly [number, number] = [30, 50];
const HEATH_OPEN = 0.85;
/** Ground this low, this flat and this close to its drainage is fen: wet whatever the wind. */
const WET_E = 3.2;
const WET_SLOPE = 0.06;
const WET_HAND = 2.6;
/** On a face, how far a bed decides whether snow holds: hard beds shed it, soft ones hold it in ledges across the face. */
const FACE_BEDS = 1;
/** On a face, the share of the turf-to-rock threshold the beds decide; slow noise along the contour decides the rest. */
const LEDGE_BEDS = 0.75;

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

/** No field lies where the cold score passes this: the plough stops in the southern taiga. */
const FIELD_COLD = 0.3;
/** From this shift a lowland field is walled grass, not hedged corn. */
const WALLS_SHIFT = 8;
/** How far a cold latitude lowers the cold score at which conifers take a wood. */
const TAIGA_DARK = 0.5;
const TUNDRA_SEED = 0x7d4a;
const ICE_SEED = 0x1ce5;
const FROST_SEED = 0xf057;
const SKIN_SEED = 0x5c1a;
const WARM_SEED = 0x4a2f;
/** The temperate plateau's temperature (biome.ts TEMPERATE). */
const TEMPERATE_T = 0.5;
/** Rain under which a hot country's streams are dry beds. */
const WADI_RAIN = 0.27;
/** Lakes freeze from this shift, rivers from this, and the pack's edge lies about here: all a little short of the snowline's 93. */
const LAKE_FREEZE = 74;
const RIVER_FREEZE = 84;
const PACK_EDGE = 82;
/** Side of a frost polygon, in cells. */
const FROST_CELLS = 8;
/** Side of the net the pack's floes are cut from, in cells. */
const FLOE_CELLS = 15;

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

/**
 * A cell of a reed bed: reeds, with a short upright stroke of the wetter ground between them here and there, so a bed
 * reads as standing stems and not as a flat blotch.
 */
function reedBed(x: number, y: number): number {
  return (hash2(x, y >> 2, MARSH_SEED + 5) & 7) < 2 ? M.marsh : M.reeds;
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

/**
 * −1…1, constant along a bed: as strata, bent only by the slow noise, so a crag band follows its bed a long way across
 * a face before it breaks.
 */
function beds(e: number, x: number, y: number, n: number): number {
  const t = e / STRATA_SPACING + 2.2 * soft(x, y, n, 44, STRATA_SEED);
  return (hash2(Math.floor(t) + 4096, 0x57, STRATA_SEED) & 1023) / 511.5 - 1;
}

/** 0 on gentle ground … 1 on a steep face: how far ledges and runnels, not the valley below, decide what grows. */
function faceShare(st: number): number {
  return st > 0.75 ? 1 : st < 0.45 ? 0 : (st - 0.45) / 0.3;
}

/**
 * Where upland woods stand, about ±1: clumps some 20–60 cells across, and on
 * steep ground hangers: woods a dozen units of height deep that run along the
 * contour and break every few dozen cells.
 */
function copseScore(x: number, y: number, n: number, st: number, ef: number): number {
  const k = st > 0.55 ? 1 : st < 0.25 ? 0 : (st - 0.25) / 0.3;
  const clumps = soft(x, y, n, 58, COPSE_SEED) + 0.45 * soft(x, y, n, 21, COPSE_SEED + 1);
  if (k === 0) return 1.7 * clumps;
  const p = Math.max(1, Math.round(n / 46));
  const hang = gradNoise(ef / 15 + 2.2 * soft(x, y, n, 70, COPSE_SEED + 2), ((x + y + 0.5) * p) / n, p, COPSE_SEED + 3);
  return 1.7 * ((1 - 0.5 * k) * clumps + 0.8 * k * hang);
}

/**
 * Grass moor is never one flat wash: bracken beds in drifts on its lower,
 * sunnier slopes, gorse in loose groups of bushes on the drier banks, and
 * the grass itself in tussocky patches a few cells across.
 */
function moorGround(c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, ec: number): number {
  const jj = ruleJitter(mask, x, y, RULE.hue);
  const st = c.steep === undefined ? c.slope : c.steep;
  const north = c.formNorth === undefined ? c.northness : c.formNorth;
  const drift = soft(x, y, n, 34, MOOR_SEED + 3);
  if (ec < 70) {
    const high = ec > 40 ? (ec - 40) / 40 : 0;
    const bed = soft(x, y, n, 23, MOOR_SEED) + 0.5 * soft(x, y, n, 8, MOOR_SEED + 1) - 0.22 * north - high - (st < 0.2 ? 2 * (0.2 - st) : st > 0.85 ? st - 0.85 : 0);
    if (bed > 0.3 + 0.24 * jj) return M.bracken;
    // Gorse: bushes two or three cells across, gathered where the drift is, never spread evenly.
    if (drift > 0.1 + high && soft(x, y, n, 4.5, MOOR_SEED + 2) > 0.34 - 0.3 * (drift > 0.5 ? 0.4 : drift - 0.1)) return M.gorse;
  }
  const f = hueField(x, y, HUE_CLASS.moor, n) + 1.5 * soft(x, y, n, 7, MOOR_SEED + 4) + 0.5 * jj;
  return M.moorCool + (f < 0.5 ? 0 : f < 1.5 ? 1 : 2);
}

/** Open hill ground: heather on the exposed crests, grass moor and bracken on the open slopes and in the hollows. `ec` is the height as the climate reads it. */
function heathOrMoor(c: CoverInput, x: number, y: number, j: number, mask: Uint8Array, n: number, ec: number): number {
  // Heather keeps to dry, exposed, well-drained ground: the windward crests,
  // the backs of spurs and the tops high above their valleys, a little more
  // of it in slate country. The open slope, the hollow and the runnel are
  // grass moor and bracken, so a hill is green with heather along its tops,
  // never blanketed in it nor striped down its face. Exposure is read off
  // the form's convexity, a dozen cells across, so a cell-wide rib between
  // two gullies is not a crest.
  const k = faceShare(c.steep === undefined ? c.slope : c.steep);
  const above = (c.hand - 18) / 30;
  const curve = c.curve === undefined ? 0 : c.curve;
  // A long spur is heather in patches along its back, not one stripe from top to foot.
  const patch = 0.2 + 1.6 * soft(x, y, n, 17, HEATH_SEED + 7);
  const ridge = (curve <= HEATH_CREST[0] ? 0 : curve >= HEATH_CREST[1] ? 1 : (curve - HEATH_CREST[0]) / (HEATH_CREST[1] - HEATH_CREST[0])) *
    (patch <= 0 ? 0 : patch >= 1 ? 1 : patch);
  // A broad top far above its valleys is as exposed as a crest; a face, however high, is not.
  const height = c.hand <= HEATH_TOP[0] ? 0 : c.hand >= HEATH_TOP[1] ? 1 : (c.hand - HEATH_TOP[0]) / (HEATH_TOP[1] - HEATH_TOP[0]);
  // Only a top that rises, never the open slope below it; and in patches, as on a ridge.
  const top = (1 - k) * height * (curve <= 0 ? 0 : curve >= 1 ? 1 : curve) * (patch <= 0 ? 0 : patch >= 1 ? 1 : patch);
  const crest = ridge > top ? ridge : top;
  const drift = 0.3 * soft(x, y, n, 38, HEATH_SEED) + 0.12 * soft(x, y, n, 11, HEATH_SEED + 3);
  // Wind alone does not make a heath: a blown slope is grass moor until it is also a crest or a top.
  const blown = 3 * (c.wind - 0.55);
  let score = (blown < -0.9 ? -0.9 : blown > 0.5 ? 0.5 : blown) + (1 - k) * (above < -0.6 ? -0.6 : above > 0.3 ? 0.3 : above) + 0.25 * c.region[2] + 0.1 * c.region[1] - 3 * (c.moisture - 0.75) + j * 0.06 + drift;
  score += HEATH_CREST_GAIN * crest - HEATH_OPEN;
  // The heath's edge is ragged: heather and grass in a mosaic for a few cells either side of it.
  score += 0.14 * ruleJitter(mask, x, y, RULE.hue) + 0.12 * soft(x, y, n, 5, HEATH_SEED + 5);
  if (score <= 0.3) return moorGround(c, x, y, mask, n, ec);
  // In bloom only at the heart of the heath, on the barest crests; browner toward its edge.
  return score > 1.05 ? M.heathCool : score > 0.65 ? M.heathMid : M.heathWarm;
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

// ---------------------------------------------------------------------------
// The warm climates. The rule table still decides the land's structure (water, shore, rock, snow, wet ground); what
// it would grow there is replaced by what the heat and the rain allow. Every line is drawn on what the plants have to
// drink at the cell, not on its latitude: a valley floor and a river bank are wetter, a sunny face and a spur drier.

/** Whether a material from the rule table is plant cover a climate may replace: grass, heath, moor, a wood's floor, a crop, a hedge. */
function zonal(m: number): boolean {
  return (m >= M.alpineCool && m <= M.floorConifer) || (m >= M.wheat && m <= M.vine) || (m >= M.meadowCool && m <= M.scrubWarm) ||
    m === M.hedge || m === M.wall || (m >= M.wheatRow && m <= M.stubbleRow) || m === M.bracken || m === M.gorse;
}

/** Hot ground by what it has to drink: desert, thin steppe and thorn, savanna, open woodland, jungle. */
function hotGround(c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, heat: number, hl: number, wet: number, st: number, near: number): number {
  const j = ruleJitter(mask, x, y, RULE.grass);
  const ef = c.form === undefined ? c.e : c.form;
  // By water in dry country the bank is green: plots under palms, and the reeds the table left at the water.
  if (c.moisture < STEPPE_RAIN && near > 0.42 && st < 0.25) return M.ley;
  if (wet < DESERT_RAIN + 0.012 * j) {
    // Sand is in seas; between them, and on any slope too steep to hold it, is gravel, with pale earth in patches.
    if (ergAt(x, y, n) > 0 && st < 0.55) return soft(x, y, n, 120, WARM_SEED + 6) + 0.4 * soft(x, y, n, 31, WARM_SEED + 7) > 0.2 ? M.desertSandDeep : M.desertSand;
    // Gravel on the swells; pale silt where the rare water runs and stands, along the washes and on their floors.
    return c.hand < 1.6 + 1.4 * soft(x, y, n, 34, WARM_SEED + 8) + 0.3 * soft(x, y, n, 6, WARM_SEED + 9) + 1.2 * j ? M.earthPale : M.reg;
  }
  if (wet < STEPPE_RAIN + 0.012 * j) {
    // Toward the savanna the thorn stands in dark bands along the contour, a dozen cells apart: tiger bush.
    if (hl > 0.52 && st > 0.035 && st < 0.3) {
      const t = ef / 1.25 + 1.6 * soft(x, y, n, 46, WARM_SEED + 10);
      if (t - Math.floor(t) < 0.2 && soft(x, y, n, 19, WARM_SEED + 11) > -0.2) return M.tigerBush;
    }
    // The grass is thin: pale earth shows through it in worn patches, more of them the drier it is.
    if (soft(x, y, n, 24, WARM_SEED + 12) + 0.4 * soft(x, y, n, 7, WARM_SEED + 13) > 0.3 + 2.5 * (wet - DESERT_RAIN)) return M.earthPale;
    return M.steppeCool + hueVariant(x, y, HUE_CLASS.scrub, mask, n);
  }
  // Grass country: steppe on the cooler side of the dry belt, savanna on the tropical side, the two mixed between.
  const tropic = hl - 0.5 + 0.12 * soft(x, y, n, 64, WARM_SEED + 14) + 0.04 * j;
  // How much rain a forest needs. The savanna's latitudes have a long dry season and burn: there only the wettest
  // ground, the river banks and the hollows keep forest. At the equator it rains all year, and nearly all of it is forest.
  // The belt is the latitude's, read at the sea: a mountain in the wet tropics is forest to its tree line, not savanna half way up.
  const belt = heat <= 0.5 ? 0 : heat >= 0.9 ? 0 : heat < 0.68 ? (heat - 0.5) / 0.18 : (0.9 - heat) / 0.22;
  const forest = 0.57 + 0.3 * belt;
  if (wet < forest + 0.012 * j) {
    if (tropic < 0) return M.steppeCool + hueVariant(x, y, HUE_CLASS.scrub, mask, n);
    // Forest islands stand in the grass toward the forest's edge, in the hollows first.
    if (wet > forest - 0.2 && soft(x, y, n, 44, WARM_SEED + 18) + 0.4 * soft(x, y, n, 13, WARM_SEED + 19) + (wet - forest + 0.1) * 5 > 0.3) return M.floorJungle;
    // Red earth shows through the grass in small worn patches.
    if (soft(x, y, n, 23, WARM_SEED + 15) + 0.5 * soft(x, y, n, 6, WARM_SEED + 16) > 0.78) return M.earthRed;
    return M.savannaCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
  }
  // Wet enough for forest. Short of the tropics it is the evergreen wood of the warm temperate; in them, jungle.
  if (hl < 0.56 + 0.1 * soft(x, y, n, 52, WARM_SEED + 17) + 0.06 * soft(x, y, n, 15, WARM_SEED + 26) + 0.03 * j) return M.floorBroadleaf;
  // And glades of grass stand open in the forest for some way in from its edge.
  if (belt > 0 && wet < forest + 0.16 && soft(x, y, n, 44, WARM_SEED + 18) + 0.4 * soft(x, y, n, 13, WARM_SEED + 19) + (wet - forest - 0.08) * 5 < -0.3) return M.savannaCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
  return M.floorJungle;
}

/**
 * The warm climates' dress over the rule table's cover `m`. `temp` is above the plateau's. Past the edge of the dry
 * belt the cover is hot country's own (hotGround); short of it the table's cover dries by degrees into the
 * Mediterranean's: sage sward, straw, garrigue and bare earth, the sunny side and the spur first.
 */
function warmSkin(m: number, c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, temp: number): number {
  const heat = heatOf(temp);
  if (c.water !== 0) {
    // The clear sea of the tropics, turquoise over its shelves. Its edge lies in lobes hundreds of cells across.
    if (m === M.sea) return heat > 0.5 + 0.3 * soft(x, y, n, 420, WARM_SEED) + 0.14 * soft(x, y, n, 130, WARM_SEED + 1) + 0.16 * ruleJitter(mask, x, y, RULE.sea) ? M.seaClear : m;
    // A stream is dry where the land is.
    if (m === M.river && c.stream === 1 && heat > 0.4 && c.moisture < WADI_RAIN + 0.05 * soft(x, y, n, 80, WARM_SEED + 4)) return M.wadi;
    return m;
  }
  const e = c.e, hand = c.hand;
  const st = c.steep === undefined ? c.slope : c.steep;
  const north = c.formNorth === undefined ? c.northness : c.formNorth;
  const curve = c.curve === undefined ? 0 : c.curve;
  const steep = st > 0.4 ? 1 : st / 0.4;
  const rdx = c.riverDx === undefined ? 0 : c.riverDx, rdy = c.riverDy === undefined ? 0 : c.riverDy;
  const rd = Math.sqrt(rdx * rdx + rdy * rdy);
  /** 1 at a river's bank … 0 seven cells from it and beyond. */
  const near = rd > 0 && rd < 7 ? 1 - rd / 7 : 0;
  /** Heat at the cell: less with height and on the shaded side. */
  const hl = heat - e / HEAT_LAPSE - 0.04 * north * steep;
  const j = ruleJitter(mask, x, y, RULE.hue);
  // The dry belt begins in patches: islands of its ground stand in the Mediterranean's for a few hundred cells before it is whole.
  if (hl > HOT_EDGE + 0.08 * soft(x, y, n, 90, WARM_SEED + 2) + 0.05 * soft(x, y, n, 27, WARM_SEED + 3) + 0.02 * j) {
    const wet = c.moisture + (hand < 3 ? 0.1 * (1 - hand / 3) : 0) + 0.26 * near + (curve < 0 ? 0.03 * (curve < -2 ? 1 : -curve / 2) : -0.02 * (curve > 2 ? 1 : curve / 2)) -
      0.07 * (north < 0 ? -north : 0) * steep + 0.075 * soft(x, y, n, 70, WARM_SEED + 20) + 0.035 * soft(x, y, n, 21, WARM_SEED + 21);
    // Rock of dry country is banded sandstone, where it is not the white of limestone or the dark of slate.
    if (wet < 0.4) {
      if (m === M.rockHard || m === M.rockSed) return M.rockDesert;
      if (m === M.cliffHard || m === M.cliffSed) return M.cliffDesert;
    }
    // Coral sand in the tropics; a dune behind a desert beach is bare; a muddy tropical shore is mangrove's.
    if (m === M.sand) return heat > 0.6 ? M.sandPale : m;
    if (m === M.duneGrass) return wet < 0.3 ? M.desertSand : m;
    if (m === M.saltmarsh || m === M.saltCreek) return wet > 0.5 ? M.mud : m;
    // Wet ground with no water to keep it is a dry lake's bed: salt, white, with pale silt at its rim.
    if ((m === M.marsh || m === M.reeds || (m >= M.meadowCool && m <= M.meadowWarm && hand < FLOOD_HAND)) && c.moisture < 0.2 && near < 0.3) {
      return soft(x, y, n, 30, WARM_SEED + 5) + 0.4 * soft(x, y, n, 8, WARM_SEED + 24) > -0.15 ? M.salt : M.earthPale;
    }
    if (!zonal(m)) return m;
    return hotGround(c, x, y, mask, n, heat, hl, wet, st, near);
  }
  if (!zonal(m)) return m;
  // The Mediterranean: how dry the cell is, 0 temperate … 1 and over at the dry belt's edge.
  const dry = hl / HOT_EDGE + 0.3 * (north < 0 ? -north : -0.5 * north) * steep + 0.04 * (curve > 2 ? 2 : curve < -2 ? -2 : curve) -
    (hand < 4 ? 0.25 * (1 - hand / 4) : 0) - 0.3 * near - 0.9 * (c.moisture - 0.5) + 0.3 * soft(x, y, n, 60, WARM_SEED + 22) + 0.12 * soft(x, y, n, 17, WARM_SEED + 23) + 0.04 * j;
  if (dry < 0.38) return m;
  // A field keeps its crop, and its ploughland is red earth; but nobody farms the driest ground, and toward the dry
  // belt the fields are given up, in patches, to the sward round them.
  if (ruledField && dry < 0.86 + 0.25 * soft(x, y, n, 75, WARM_SEED + 25)) return m === M.plough ? M.earthRed : m;
  if (m === M.wall || m === M.hedge || (m >= M.wheat && m <= M.vine) || (m >= M.wheatRow && m <= M.stubbleRow)) return dry > 1.05 ? M.steppeMid : M.scrubMid;
  // Bare stony earth on the steepest, driest banks.
  if (dry > 1.2 && st > 0.3 && m !== M.floorBroadleaf && m !== M.floorConifer) return M.earthPale;
  if (m >= M.pastureCool && m <= M.pastureWarm) return dry > 0.95 ? M.steppeCool + (m - M.pastureCool) : M.scrubCool + (m - M.pastureCool);
  if (m >= M.meadowCool && m <= M.meadowWarm) return dry > 0.8 ? M.steppeWarm : m;
  // Grass moor dries to sage and then to khaki steppe; only the heather's own crests turn to garrigue.
  if (m >= M.moorCool && m <= M.moorWarm) return dry > 0.8 ? M.steppeCool + (m - M.moorCool) : M.scrubCool + (m - M.moorCool);
  // Garrigue is only the heart of what was heather, on the driest crests: the rest is sage and khaki like the hill round it.
  if (m >= M.heathCool && m <= M.heathWarm) return m === M.heathCool && dry > 0.6 ? M.garrigue : dry > 0.8 ? M.steppeCool + (m - M.heathCool) : M.scrubCool + (m - M.heathCool);
  if (m === M.bracken) return M.scrubWarm;
  if (m >= M.scrubCool && m <= M.scrubWarm) return dry > 1.05 ? M.steppeCool + (m - M.scrubCool) : m;
  return m;
}

// ---------------------------------------------------------------------------
// The cold climates: ice on the water, the ice of the land, tundra, and the dress of the taiga.

/**
 * Ice on a water cell of a cold latitude, or 0 where the water is open. Lakes and rivers freeze whole some way short
 * of the snowline; a stream is lost under the snow. The sea carries floes: small and apart where the pack begins,
 * grown together further in, with long leads of open water through them, so the pack has no edge.
 */
function frozen(c: CoverInput, x: number, y: number, n: number, shift: number): number {
  // A lake or a river high on a mountain of the cold freezes as one at the sea would further north.
  const high = c.e > 4 ? c.e - 4 : 0;
  if (c.water === 2) {
    if (shift + high <= LAKE_FREEZE) return 0;
    // Drifted snow lies on the ice in a few broad streaks; the wind keeps the rest swept.
    return soft(x, y, n, 46, ICE_SEED + 8) > 0.3 ? M.packIce : M.lakeIce;
  }
  if (c.water === 3) {
    if (shift + high <= RIVER_FREEZE) return 0;
    return c.stream === 1 ? M.snow : M.riverIce;
  }
  // How much of the sea is ice: none short of the pack's edge, which lies in great lobes and tongues, all of it deep in.
  const conc = (shift - PACK_EDGE) / 12 + 2.4 * soft(x, y, n, 620, ICE_SEED) + 1 * soft(x, y, n, 210, ICE_SEED + 1) + 0.35 * soft(x, y, n, 70, ICE_SEED + 12);
  if (conc <= 0) return 0;
  const k = conc > 1 ? 1 : conc;
  // The pack is plates: each cell of a net some FLOE_CELLS across is one floe, drawn back from its neighbours by a
  // lead of dark water that is wide at the pack's edge and a crack deep inside it; at the edge whole floes are missing.
  // Floes come in two sizes, by stretches of sea a few hundred cells across.
  // The net has a whole number of cells round the world, so the pack has no seam.
  const per = Math.max(1, Math.round(n / (soft(x, y, n, 330, ICE_SEED + 18) + 0.3 * soft(x, y, n, 90, ICE_SEED + 19) > 0.12 ? FLOE_CELLS + 10 : FLOE_CELLS))), S = n / per;
  // The net is bent, so no two leads run parallel for long.
  const bx = x + 5 * soft(x, y, n, 60, ICE_SEED + 2), by = y + 5 * soft(x, y, n, 60, ICE_SEED + 3);
  const gx = Math.floor(bx / S), gy = Math.floor(by / S);
  let d1 = 1e9, d2 = 1e9, own = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = hash2(((gx + i) % per + per) % per, ((gy + j) % per + per) % per, ICE_SEED + 4);
      const dx = bx + 0.5 - (gx + i + 0.12 + (0.76 * (h & 255)) / 255) * S, dy = by + 0.5 - (gy + j + 0.12 + (0.76 * ((h >>> 8) & 255)) / 255) * S;
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; own = h; } else if (d < d2) d2 = d;
    }
  }
  // A floe is there when its own draw is under the concentration: nine in ten deep in the pack, one in three at its edge.
  if (((own >>> 16) & 255) / 255 > 0.3 + 0.72 * k) return 0;
  const edge = Math.sqrt(d2) - Math.sqrt(d1);
  // Deep in the pack the floes are frozen together: no water shows between them, or the sea would be a tiled floor.
  // Toward its edge they draw apart.
  if (edge < 3.8 * (1 - k) * (1 - k) + 1.2 * (((own >>> 24) & 15) / 15) * (1 - k) - 0.25) return 0;
  // Through the fused pack run leads: long cracks of open water, all much one way, as the wind opens them.
  const lp = Math.max(1, Math.round(n / 150));
  const lead = gradNoise(((x + 2 * y + 0.5) * lp) / n, ((2 * x - y + 0.5) * lp * 5) / n, lp, ICE_SEED + 5) + 0.25 * soft(x, y, n, 40, ICE_SEED + 6);
  if (lead > -0.022 && lead < 0.022) return 0;
  // Old floes are a shade bluer, whole; where two meet the line between them is the same shade, a seam and not a gap.
  return ((own >>> 28) & 3) === 0 || edge < 0.8 ? M.packIceBlue : M.packIce;
}

/** The ice of the land, where the snow of a cold latitude lies: an ice foot at the sea, bare blue ice in bands on its steep tongues, snow over the rest. */
function iceOf(c: CoverInput, x: number, y: number, n: number, st: number): number {
  if (c.shore !== 0 && c.e < 3.5) return M.iceFoot;
  // Bare ice shows where a steep tongue has shed its snow: a few long patches, never a speckle.
  if (st > 0.62 && st < 1 && soft(x, y, n, 34, ICE_SEED + 10) > 0.28 && soft(x, y, n, 9, ICE_SEED + 11) > -0.15) return M.glacier;
  const curve = c.curve === undefined ? 0 : c.curve;
  // Crevasses open where the ice bends over a rise: short blue cracks in ranks across the fall, a few cells apart.
  if (curve > 0.5 && st > 0.12 && st < 0.7 && soft(x, y, n, 46, ICE_SEED + 13) > 0.1) {
    // Ranks run across the fall, so they are drawn on the height of the land's form, a rank every unit and a half,
    // each broken along its length.
    const t = (c.form === undefined ? c.e : c.form) / 1.5 + 1.2 * soft(x, y, n, 30, ICE_SEED + 14);
    if (t - Math.floor(t) < 0.24 && soft(x, y, n, 5, ICE_SEED + 15) > -0.2) return M.crevasse;
  }
  // Level ice is never one white sheet: the wind lays the snow in long drifts across it, and scours the firn blue between.
  if (st < 0.22) {
    const p = Math.max(1, Math.round(n / 150));
    const drift = gradNoise(((x + y + 0.5) * p) / n, ((x - y + 0.5) * p * 6) / n, p, ICE_SEED + 16) + 0.45 * soft(x, y, n, 38, ICE_SEED + 17);
    if (drift > 0.36) return M.firn;
  }
  return M.snow;
}

/** Whether a cell lies on the line between two frost polygons: a net of cells some FROST_CELLS across, no two alike. */
function frostEdge(x: number, y: number, n: number): boolean {
  const S = FROST_CELLS, per = Math.floor(n / S);
  const gx = Math.floor(x / S), gy = Math.floor(y / S);
  let d1 = 1e9, d2 = 1e9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const h = hash2(((gx + i) % per + per) % per, ((gy + j) % per + per) % per, FROST_SEED);
      const dx = x + 0.5 - (gx + i + 0.15 + (0.7 * (h & 255)) / 255) * S, dy = y + 0.5 - (gy + j + 0.15 + (0.7 * ((h >>> 8) & 255)) / 255) * S;
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  }
  return Math.sqrt(d2) - Math.sqrt(d1) < 0.95;
}

/**
 * Tundra ground: pools, frost polygons and sedge on the wet flats, pale lichen on the dry rises and blown crests,
 * and between them a mosaic of olive, ochre and russet heath in patches a few cells across.
 */
/** The wet level ground of the tundra: dark pools a few cells across, the net of frost polygons, and sedge; 0 where it is dry enough for heath. */
function tundraFlat(c: CoverInput, x: number, y: number, n: number, st: number): number {
  const hand = c.hand;
  if (st >= 0.07 || hand >= 3.5) return 0;
  const wet = soft(x, y, n, 26, TUNDRA_SEED + 4) + 0.5 * soft(x, y, n, 8, TUNDRA_SEED + 5) - 0.2 * hand;
  if (wet > 0.2 && soft(x, y, n, 6.5, TUNDRA_SEED + 6) > 0.16) return M.pool;
  if (wet > -0.2) {
    if (st < 0.05 && frostEdge(x, y, n)) return M.frostNet;
    if (wet > 0.05) return M.sedge;
  }
  return 0;
}

function tundraGround(c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, st: number, curve: number): number {
  const j = ruleJitter(mask, x, y, RULE.hue);
  const flat = tundraFlat(c, x, y, n, st);
  if (flat !== 0) return flat;
  const dry = 0.5 * (curve > 2 ? 1 : curve < -2 ? -1 : curve / 2) + 0.9 * soft(x, y, n, 19, TUNDRA_SEED + 7) + 0.4 * soft(x, y, n, 6, TUNDRA_SEED + 8) + 0.6 * (c.wind - 0.5);
  // A clean lobed edge: a speckled one, on ground this even, would be static.
  if (dry + 0.25 * soft(x, y, n, 3.5, TUNDRA_SEED + 10) > 0.62) return M.lichen;
  // Olive in the damp, khaki between, russet only in patches on the drier banks.
  const f = hueField(x, y, HUE_CLASS.moor, n) + 1.3 * soft(x, y, n, 9, TUNDRA_SEED + 9) + 0.5 * j - 0.8 * (c.moisture - 0.5);
  return M.tundraCool + (f < 0.85 ? 0 : f < 1.9 ? 1 : 2);
}

/**
 * The tundra's cover of a cell beyond the tree line of its latitude, or 0 where trees, or a temperate mountain's
 * own ground, still hold. The line is the trees' own (lower in highland and lake country) moved by shelter: woods
 * hold out longest on valley floors, along rivers, in hollows and on the sunny side, so forest runs up the valleys
 * into the tundra in tongues. On a mountain of a mild latitude only patches of the ground past the trees are tundra.
 */
function tundraAt(c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, shift: number, cold: number, st: number, curve: number, north: number): number {
  const region = c.region, hand = c.hand;
  const line = TREE_LINE - 0.18 * (region[1] + region[3]);
  const rdx = c.riverDx === undefined ? 0 : c.riverDx, rdy = c.riverDy === undefined ? 0 : c.riverDy;
  // Shelter is worth a few units of height, no more: the tundra proper is treeless to the ice.
  const shelter = (hand < 6 ? 0.025 * (1 - hand / 6) : 0) + (rdx !== 0 || rdy !== 0 ? 0.03 : 0) +
    (curve < 0 ? 0.015 * (curve < -2 ? 1 : -curve / 2) : -0.02 * (curve > 2 ? 1 : curve / 2)) - 0.03 * north * (st > 0.4 ? 1 : st / 0.4);
  const patch = 0.09 * soft(x, y, n, 52, TUNDRA_SEED) + 0.04 * soft(x, y, n, 14, TUNDRA_SEED + 1) + 0.02 * ruleJitter(mask, x, y, RULE.alpine);
  if (cold - shelter - line - 0.02 + patch <= 0) return 0;
  const far = shift >= 36 ? 1 : shift / 36;
  if (far < 1 && 0.5 + 0.75 * soft(x, y, n, 40, TUNDRA_SEED + 2) + 0.3 * soft(x, y, n, 11, TUNDRA_SEED + 3) >= far) return 0;
  return tundraGround(c, x, y, mask, n, st, curve);
}

/**
 * The cold's dress over what the rule table leaves temperate: pasture becomes moss heath, meadow and marsh sedge and
 * bog, dry sward lichen, sand shingle, and the deep wood's floor lichen where the spruce stand apart. It comes on in
 * patches a few dozen cells across as the latitude cools, and is whole by the taiga. A field keeps what it grows.
 */
function coldSkin(m: number, c: CoverInput, x: number, y: number, mask: Uint8Array, n: number, shift: number): number {
  if (ruledField) return m;
  // How far the dress has come on: nothing at the plateau, whole by a shift of 40, in patches between.
  const patch = 8 + 26 * (0.5 + 0.6 * soft(x, y, n, 33, SKIN_SEED) + 0.25 * soft(x, y, n, 9, SKIN_SEED + 1)) + 4 * ruleJitter(mask, x, y, RULE.hue);
  // First the greens cool: the warm sward of a temperate hill is the first thing a colder latitude loses.
  // Wet level ground goes to sedge, never to heath: a fen in the taiga is green, its drier rises khaki.
  const fen = c.hand < 3 && c.slope < 0.08;
  // And past the trees a river's flats and a fen are the tundra's own wet ground, with its pools and its frost polygons.
  if (shift > SHIFT_TREELINE - 8 && (m === M.marsh || m === M.reeds || (m >= M.meadowCool && m <= M.meadowWarm) || (fen && m >= M.pastureCool && m <= M.pastureWarm))) {
    const flat = tundraFlat(c, x, y, n, c.steep === undefined ? c.slope : c.steep);
    return flat !== 0 ? flat : m === M.reeds ? m : M.sedge;
  }
  if (shift > 0.3 * patch) {
    if (m === M.pastureWarm || m === M.pastureMid) return shift > patch ? (fen ? M.sedge : M.tundraCool + (m - M.pastureCool > 1 ? 1 : m - M.pastureCool)) : m - 1;
    if (m === M.meadowWarm || m === M.meadowMid) return shift > 0.8 * patch ? M.sedge : m - 1;
    if (m === M.marsh) return soft(x, y, n, 12, SKIN_SEED + 2) > 0.25 ? M.bogRed : M.bog;
  }
  if (shift <= 0.8 * patch) return m;
  if (m === M.pastureCool) return shift > patch ? (fen ? M.sedge : M.tundraCool) : m;
  // Further north the hill's own grass goes the same way: grass moor and alpine meadow to the tundra's olive and ochre.
  if (shift > 34 + 14 * soft(x, y, n, 48, SKIN_SEED + 6)) {
    if (m >= M.moorCool && m <= M.moorWarm) return M.tundraCool + (m - M.moorCool > 1 ? 1 : m - M.moorCool);
    if (m >= M.alpineCool && m <= M.alpineWarm) return M.tundraCool + (m - M.alpineCool);
    if (m === M.bracken) return M.tundraWarm;
  }
  if (m >= M.meadowCool && m <= M.meadowWarm) return M.sedge;
  // Dry sward is lichen in patches and khaki heath between: the two are far apart in value, so their line is a
  // patch's own and never the speckle the dry sward's border is drawn with.
  if (m >= M.scrubCool && m <= M.scrubWarm) return soft(x, y, n, 16, SKIN_SEED + 7) + 0.3 * soft(x, y, n, 4, SKIN_SEED + 8) > 0.12 ? M.lichen : M.tundraMid;
  if (m === M.duneGrass || m === M.saltmarsh || m === M.hedge) return M.sedge;
  if ((m === M.sand || m === M.sandPale) && shift > 30 + 30 * soft(x, y, n, 60, SKIN_SEED + 3)) return M.shingle;
  // Lichen woodland: the further north and the drier the ground, the more of the taiga's floor is pale.
  if (m === M.floorConifer && soft(x, y, n, 45, SKIN_SEED + 4) + 0.4 * soft(x, y, n, 13, SKIN_SEED + 5) + (shift - 44) / 18 - 1.2 * (c.moisture - 0.55) > 0) return M.floorLichen;
  return m;
}

/** Set by the rule table when the cell it has just covered lies in a field: what people keep is not dressed by a climate. */
let ruledField = false;

// What snowAt found beside the score: what steepness and sharpness took off it, the share of that a sharp crest
// shed, and the fine noise of the snow's edge.
let snowShed = 0;
let snowCrest = 0;
let snowFine = 0;

/**
 * The snow score of a cell: above 0 it is snow, and a little below it late snow. `efc` is the height of the land's
 * form as the climate reads it (the form's own height, `ef`, plus the climate's shift): the snowline is drawn on
 * that, while the beds of a face follow the true form. Leaves snowShed, snowCrest and snowFine set.
 */
function snowAt(x: number, y: number, n: number, mask: Uint8Array, ef: number, efc: number, st: number, curve: number, north: number, relief: number): number {
  let snowScore = -9;
  let shed = 0;
  let crestShed = 0;
  let fine = 0;
  if (efc > SNOW_FLOOR) {
    fine = soft(x, y, n, 18, SNOWLINE_SEED + 1);
    const wander = soft(x, y, n, 40, SNOWLINE_SEED);
    /** 0 on open ground … 1 on a sharp crest or a scarp's lip: ground that stands well clear of what lies round it. */
    const crest = curve > 0.4 ? (curve > 2.2 ? 1 : (curve - 0.4) / 1.8) : 0;
    // Shade keeps snow in hollows and on faces; the strip behind a crest is blown clear whichever way it looks.
    const line = SNOWLINE + 5 * soft(x, y, n, 150, SNOWLINE_SEED + 2) + 4 * wander - SNOW_SHADE * (north > 0 ? north * (1 - crest) : north);
    const alt = (efc - line) / SNOW_SPAN;
    if (alt > -SNOW_TONGUE - 0.6) {
      const hollow = curve < 0 ? (curve < -1.6 ? 1 : -curve / 1.6) : 0;
      const gully = relief < 0 ? (relief < -0.7 ? 1 : -relief / 0.7) : 0;
      const bench = st < 0.42 ? (st < 0.2 ? 1 : (0.42 - st) / 0.22) : 0;
      // The lie of the ground is worth up to SNOW_TONGUE of score, and nothing that far below the line.
      const near = alt > -0.25 ? 1 : (alt + SNOW_TONGUE + 0.25) / SNOW_TONGUE;
      // On a face the couloirs hold less of it, so the snow there lies along the ledges and does not hang in tongues.
      const faceShed = st > 0.8 ? 1 : st < 0.5 ? 0 : (st - 0.5) / 0.3;
      const lie = (near < 0 ? 0 : near) * (0.62 * hollow + 0.42 * gully * (1 - 0.75 * faceShed) + 0.3 * bench * (1 - crest));
      // A sharp crest is blown and falls away on both sides: the sharper and the steeper its flanks, the more it sheds.
      // A crest only some way above the line would carry a ribbon of snow and nothing either side of it: it is white only as part of a cap.
      crestShed = crest * (0.9 + (st > 0.42 ? 0.5 * (st > 0.7 ? 1 : (st - 0.42) / 0.28) : 0));
      // Steep ground sheds: its ribs first, and bed by bed, so a snow face shows its rock in ledges and arêtes.
      const face = st > 0.8 ? 1 : st < 0.55 ? 0 : (st - 0.55) / 0.25;
      // On a face the beds decide more than the ribs do, so its rock shows in ledges across it and not in a comb of
      // bare ribs down it; and the noise that breaks the snow's edge is held down there for the same reason.
      shed = crestShed + (st > 0.7 ? 2.4 * (st - 0.7) : 0) + (north < 0 && st > 0.55 ? -0.5 * north * (st > 0.9 ? 1 : (st - 0.55) / 0.35) : 0) +
        face * (relief > 0 ? 0.25 * (relief > 0.9 ? 1 : relief / 0.9) : 0) + (st > 1 ? 1 : st < 0.72 ? 0 : (st - 0.72) / 0.28) * FACE_BEDS * beds(ef, x, y, n);
      snowScore = alt + (lie > SNOW_TONGUE ? SNOW_TONGUE : lie) - shed +
        (1 - 0.6 * face) * (0.22 * soft(x, y, n, 7, SNOWLINE_SEED + 4) + 0.16 * fine + 0.1 * soft(x, y, n, 3.2, SNOWLINE_SEED + 5)) +
        // The dither is worth a cell or two of height whatever the slope: on gentle ground a fixed one would be a field of static.
        (st > 0.8 ? 0.2 : st < 0.12 ? 0.04 : 0.25 * st) * ruleJitter(mask, x, y, RULE.snow);
    }
  }
  snowShed = shed;
  snowCrest = crestShed;
  snowFine = fine;
  return snowScore;
}

/**
 * The material of one land or water cell. `n` is the world size the periodic
 * hue field and parcels tile on.
 *
 * With no temperature, or the temperate plateau's, this is the temperate rule table and nothing else. In another
 * climate the same table is read with the climate's offset of height (biome.ts), and the cold then dresses what the
 * table leaves green.
 */
export function cover(c: CoverInput, mask: Uint8Array, n: number = WORLD_N): number {
  const temp = c.temp;
  if (isTemperate(temp)) return rules(c, mask, n, 0);
  const x = Math.floor(c.x), y = Math.floor(c.y);
  const shift = climateShift(temp as number, x, y, n);
  const m = rules(c, mask, n, shift);
  return (temp as number) < TEMPERATE_T ? coldSkin(m, c, x, y, mask, n, shift) : warmSkin(m, c, x, y, mask, n, temp as number);
}

/**
 * The rule table. `shift` is the climate's offset of height: every comparison of height against a climatic line
 * (the cold score, the snowline, where scree grows over, where summits bare) reads height plus the shift, and the
 * rules marked for the cold are passed over where it is not above 0. At 0 this is the temperate cover, untouched.
 */
function rules(c: CoverInput, mask: Uint8Array, n: number, shift: number): number {
  ruledField = false;
  const x = Math.floor(c.x);
  const y = Math.floor(c.y);
  const region = c.region;
  const karst = region[4];
  const slate = region[2];

  if (c.water !== 0) {
    if (shift > 0) {
      const iced = frozen(c, x, y, n, shift);
      if (iced !== 0) return iced;
    }
    if (c.water === 3) return M.river;
    if (c.water === 2) return M.lake;
    return karst > 0.5 + ruleJitter(mask, x, y, RULE.sea) * 16 * PER_CELL.field ? M.seaClear : M.sea;
  }

  const e = c.e;
  /** Height as the climate reads it: what every cold line is drawn on. */
  const ec = e + shift;
  const s = c.slope;
  const hand = c.hand;
  const cold = ec / 100 + 0.1 * c.northness;

  const relief = c.relief === undefined ? 0 : c.relief;

  // The slope of the land's form. Class borders are drawn on it, not on the
  // slope of the cell: a gullied face changes slope from cell to cell, and a
  // border on that is static.
  const st = c.steep === undefined ? s : c.steep;
  const curve = c.curve === undefined ? 0 : c.curve;
  /** Aspect of the form: what snow and woods are judged on, so a gully's two walls do not differ. */
  const north = c.formNorth === undefined ? c.northness : c.formNorth;
  /** Height on the form: beds and bands follow its contours and so cross gullies unbroken. */
  const ef = c.form === undefined ? e : c.form;

  // The cold: where the snow of the latitude comes down to the shore, the shore is ice. Worked out before the
  // shore and the floodplain, which would keep a polar beach sand and a polar river's flats green.
  let snowScore = -9;
  let snowKnown = false;
  if (shift > 0) {
    // An ice cap's edge on level ground is not a line: snowfields a few dozen cells across lie out on the tundra
    // before it, and windows of bare ground are open in it behind.
    snowScore = snowAt(x, y, n, mask, ef, ef + shift, st, curve, north, relief) +
      (shift >= 40 ? 1 : shift / 40) * (0.4 * soft(x, y, n, 90, ICE_SEED + 20) + 0.75 * soft(x, y, n, 31, ICE_SEED + 21) + 0.5 * soft(x, y, n, 12, ICE_SEED + 22));
    snowKnown = true;
    if (snowScore > 0) return iceOf(c, x, y, n, st);
    // Under the edge of the ice a shore is drifted over and a river's flats lie under late snow.
    if (snowScore > -0.2 && (c.shore !== 0 || (hand < FLOOD_HAND && s < 0.045))) return M.snow;
  }

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
    // Reeds keep to the water's edge. A fen is so flat that all of it lies at its drainage's level, far from any river
    // as near: there reeds stand in beds, and the ground between them is marsh and wet meadow.
    if (beside) return M.reeds;
    if (hand < 0.25 + j * 0.2) {
      if (e >= WET_E) return M.reeds;
      if (soft(x, y, n, 22, MARSH_SEED + 3) + 0.3 * soft(x, y, n, 7, MARSH_SEED + 4) > 0.2 + 0.1 * j) return reedBed(x, y);
    }
    const mp = Math.max(1, Math.round(n / 34));
    if (gradNoise(((x + 0.5) * mp) / n, ((y + 0.5) * mp) / n, mp, MARSH_SEED) > 0.2 + j * 0.1) return M.marsh;
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }

  // Snow is altitude first: it lies by height above a wandering snowline,
  // lower on the shaded side. Near the line the lie of the ground decides:
  // cirques, hollows, couloirs and gentle benches hold snow some way below
  // it, in tongues, and sharp crests, ribs and steep faces shed it some way
  // above and show their rock. The lie counts only near the line, so no
  // hollow far below it, and no valley floor, is ever white. All of it is
  // read off smooth fields; the edge is broken by noise at three scales and
  // a little dither.
  if (!snowKnown) snowScore = snowAt(x, y, n, mask, ef, ef + shift, st, curve, north, relief);
  /** What steepness and sharpness took off the score: ground that would be white but for it is bare rock. */
  const shed = snowShed;
  /** The share of that which a sharp crest shed. */
  const crestShed = snowCrest;
  const fine = snowFine;
  if (snowScore > 0) return M.snow;

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
  // Where a face passes from turf to bare rock is decided bed by bed: a crag band follows its stratum across the face, so
  // the rock shows as ledges along the contour and never as a comb of columns down it.
  const ledge = LEDGE_BEDS * beds(ef, x, y, n) + (1 - LEDGE_BEDS) * soft(x, y, n, 40, EDGE_SEED + 1);
  if (
    st > CLIFF_SLOPE + 0.13 * (1 + ledge) + j * 0.03 || (c.shore === 3 && s > 0.9 + dS3) ||
    (s > SCARP_SLOPE + dS3 && (c.steep === undefined || st < 0.55))
  ) {
    return M.cliffHard + rockKind(c, x, y, n);
  }
  // Scree lies only where rock stands over it: in cones under the chutes of
  // a steep face and aprons along its foot, opening out down the fall line
  // from the cliff's own cells (bake/coverFields.ts). The generator's
  // rockfall thickens a fan it lies in and is never scree by itself: away
  // from any rock it is stony ground, and scatter sets its boulders. A pale
  // warm-grey wash with a lobed edge; its stones are dots a tone darker, fine
  // at the head of the fan and in clusters at the toe, where the big blocks
  // roll to. Ground steep enough to be hatched as a face is the face.
  const fan = c.cliffAbove === undefined ? 0 : c.cliffAbove;
  // The head of a fan is the rock it fell from: a chute or a crag, a few cells of bare stone.
  if (fan > SCREE_HEAD && s > 0.95 && st > 0.85 && soft(x, y, n, 12, SCREE_SEED + 4) > -0.05 + 0.2 * bend) return M.cliffHard + rockKind(c, x, y, n);
  // Stones come to rest where the land's form eases: on the face itself, gullied as it is, a fan would be flecks.
  if (fan > 0.06 && st < SCREE_REST && s < SCREE_FACE && st > 0.2 && hand > 0.6) {
    const sj = ruleJitter(mask, x, y, RULE.scree);
    const reach = fan * (0.8 + 0.9 * (c.debris > 1 ? 1 : c.debris));
    // Low down a fan is grown over: only the thickest falls stay bare there.
    const grown = ec > 70 ? 0 : ec < 25 ? SCREE_GROWN : (SCREE_GROWN * (70 - ec)) / 45;
    const depth = reach - SCREE_FAN - grown - 0.13 * soft(x, y, n, 6, SCREE_SEED) - 0.05 * soft(x, y, n, 2.5, SCREE_SEED + 2);
    if (depth > -SCREE_SPILL) {
      // 0 at the head of the fan … 1 at its toe, where the fan has thinned and the big blocks roll to.
      const toe = fan > 0.75 ? 0 : fan < 0.35 ? 1 : (0.75 - fan) / 0.4;
      const pair = hash2(x >> 1, y >> 1, SCREE_SEED) & 255;
      const own = hash2(x, y, SCREE_SEED + 7) & 255;
      const big = toe > 0.5 ? hash2(Math.floor(x / 3), y >> 1, SCREE_SEED + 9) & 255 : 255;
      const stone = big < 44 * (toe - 0.5) || (pair < 14 + 50 * toe && own < 210) || sj > 0.41 + 0.07 * toe;
      // The fan's edge is not a line: past it the stones lie scattered on the grass.
      if (depth > 0.1 * sj) return stone ? M.screeStone : slate > 0.5 ? M.screeSlate : M.scree;
      if (stone && sj > -0.2) return M.screeStone;
    }
  }
  if (snowScore + shed > -0.2 + 0.1 * ledge && (st > 0.78 + 0.1 * fine || crestShed > 0.4 + 0.2 * fine)) {
    // Bare faces at and above the snowline are bedded: dark steps and paler benches, and snow lying on the widest ledges.
    const bed = beds(ef, x, y, n);
    if (bed < -0.42 && st < 1 && snowScore + shed > 0.3 && soft(x, y, n, 20, SNOWLINE_SEED + 3) > -0.08) return M.snow;
    // Hard beds stand as dark walls, softer ones as paler benches: in bands across the face, bed by bed.
    return (bed > 0.1 ? M.cliffHard : M.rockHard) + rockKind(c, x, y, n);
  }
  if (st > 0.45 && (ec - 75) / 40 + 2 * (c.wind - 0.6) + (curve > 4 ? 0.16 : curve < -4 ? -0.16 : 0.04 * curve) > 0.45 + 0.14 * bend + j * 0.03) {
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

  // Late snow: the feathered band under the permanent snow that melts to
  // fellfield in high summer.
  // Late snow. In a cold latitude it is snow still, in patches that thin out over the tundra: the fellfield it melts
  // to on a temperate mountain would ring every ice cap in grey.
  if (snowScore > -0.45) {
    if (shift <= 0) return M.snowLate;
    if (snowScore > -0.2 - 0.25 * soft(x, y, n, 9, ICE_SEED + 23)) return M.snow;
  }

  // Tundra: the ground beyond the tree line of a cold latitude, whatever the region. Weighted in by the shift, so
  // a temperate mountain keeps its own alpine meadow and moor.
  if (shift > 0) {
    const t = tundraAt(c, x, y, mask, n, shift, cold, st, curve, north);
    if (t !== 0) return t;
  }

  // Alpine meadow: highland and lake country, cold, gentle. Edge 10. Lake
  // country's fells are lower, so its meadows start lower.
  j = ruleJitter(mask, x, y, RULE.alpine);
  if (
    region[1] + region[3] > 0.5 + j * 10 * PER_CELL.field &&
    cold > 0.55 - ALPINE_LAKES * region[3] + j * 10 * PER_CELL.cold &&
    st < 0.5 + j * 10 * PER_CELL.slope &&
    // In patches, with a wide ragged edge: a meadow below every crest would ring the rock in green.
    soft(x, y, n, 46, MOOR_SEED + 6) + 0.4 * soft(x, y, n, 13, MOOR_SEED + 7) - 0.12 * curve > -0.02 + 0.4 * j
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
  // In the cold no field is ploughed past FIELD_COLD, a line that wanders; and well short of it the hedged corn of
  // the lowland has given way to walled grass.
  if (e > 1.2 && c.wind < 0.7 + j * 4 * PER_CELL.wind && (shift <= 0 || cold < FIELD_COLD + 0.1 * soft(x, y, n, 90, WOOD_SEED + 5))) {
    if (lowlandW > 0.5 + dW) {
      if (lie < (stray < FIELD_SURE - LOWLAND_SLOPE ? FIELD_SURE : LOWLAND_SLOPE + stray) + j * PER_CELL.slope && hand < LOWLAND_HAND + j * 4 * PER_CELL.hand) {
        ruledField = true;
        return fieldCell(c, x, y, mask, n, shift > WALLS_SHIFT && shift > WALLS_SHIFT + 5 + 8 * soft(x, y, n, 70, WOOD_SEED + 6), karst > region[0]);
      }
    } else if (
      uplandW > 0.45 + dW && lie < UPLAND_SLOPE + j * PER_CELL.slope &&
      hand < UPLAND_HAND + j * 4 * PER_CELL.hand && cold < 0.38 + j * 4 * PER_CELL.cold && c.wind < 0.62 + j * 4 * PER_CELL.wind
    ) {
      ruledField = true;
      return fieldCell(c, x, y, mask, n, true, false);
    }
  }

  // Fen: the lowest, flattest open ground stands wet whatever the wind does.
  // Heather and moor want drained ground; here reed beds fringe the water,
  // sedge and rush fill the hollows and wet meadow lies between, with the
  // odd carr of alder (scatter plants those on the marsh).
  j = ruleJitter(mask, x, y, RULE.marsh);
  if (e < WET_E + 0.5 * j && st < WET_SLOPE + 0.01 * j && hand < WET_HAND) {
    const rdx = c.riverDx === undefined ? 0 : c.riverDx, rdy = c.riverDy === undefined ? 0 : c.riverDy;
    const bank = (rdx !== 0 || rdy !== 0) && rdx * rdx + rdy * rdy < (1.6 + 1.5 * j) * (1.6 + 1.5 * j);
    if (bank || hand < 0.1 + 0.1 * j) return M.reeds;
    const wet = soft(x, y, n, 28, MARSH_SEED + 1) + 0.45 * soft(x, y, n, 9, MARSH_SEED + 2) - 0.35 * curve - 0.12 * hand + 0.08 * j;
    if (wet > 0.45) return reedBed(x, y);
    if (wet > 0.2) return M.marsh;
    return M.meadowCool + hueVariant(x, y, HUE_CLASS.meadow, mask, n);
  }

  // Low ground is sheltered: the wind that bares a hilltop does not bare a
  // valley floor or the home lowland.
  const lee = 0.25 * (e < 0 ? 1 : e > 24 ? 0 : 1 - e / 24) + 0.1 * region[0];

  // The karst coast is dry whatever the rain: its limestone drains it. Its
  // sward is thin, but trees root deep there: woods feel half that drought.
  const moisture = c.moisture * (1 - 0.62 * karst);
  const woodMoisture = c.moisture * (1 - 0.42 * karst);

  // The wind the plants feel. The generator's field turns sharply at a brow,
  // so a line drawn on it is the brow itself, ruled across the country: slow
  // noise moves that line a dozen cells either way, a hollow is sheltered and
  // a spur is blown. Some gullies shelter more than others, so woods run down
  // a few of them and across the line, never down every one.
  const hollow = curve < 0 ? (curve < -1.5 ? 1 : -curve / 1.5) : 0;
  const dell = 0.55 + 1.3 * soft(x, y, n, 90, WIND_SEED + 2);
  const shelter = hollow * (dell < 0 ? 0 : dell > 1.2 ? 1.2 : dell);
  const gust = c.wind + 0.21 * soft(x, y, n, 75, WIND_SEED) + 0.08 * soft(x, y, n, 24, WIND_SEED + 1) - 0.18 * shelter +
    (curve > 0 ? 0.02 * (curve > 2 ? 2 : curve) : 0) - 0.03 * north;

  // Upland woods are copses and hangers, not a strip up every gully: a slow
  // seeded mask of clumps, pulled along the contour on steep ground, and
  // raised or lowered by moisture, aspect, wind, steepness and cold. Height
  // above the stream hardly counts, so a wood crosses the spurs between
  // gullies. The edge is a wide dither: trees thin out over several cells,
  // at the tree line as anywhere else.
  const home = region[0] > 0.5;
  j = ruleJitter(mask, x, y, RULE.forest);
  // No wood at all on ground too dry, too wind-blown or too steep for one, whatever the mask says.
  if (!home && e > 1.5 && woodMoisture > 0.4 + j * 3 * PER_CELL.field && gust < 0.66 + lee + j * 3 * PER_CELL.wind && st < 1.05) {
    const line = TREE_LINE - 0.18 * (region[1] + region[3]);
    const w = copseScore(x, y, n, st, ef) + 1.5 * (woodMoisture - 0.62) + 0.16 * north + 0.3 * shelter -
      2.2 * (gust > 0.42 + lee ? gust - 0.42 - lee : 0) - 3 * (st > 0.72 ? st - 0.72 : 0) - 7 * (cold > line ? cold - line : 0) -
      (hand > 24 ? 0.015 * (hand - 24) : hand < 2 ? 0.5 * (2 - hand) : 0) - (curve > 0 ? 0.07 * (curve > 2 ? 2 : curve) : 0);
    if (w > COPSE_BIAS + WOOD_FEATHER * j) {
      // Conifers stand in their own blocks among the broadleaf, more of them the colder it is: a line drawn on cold alone
      // would rule a row of them along a hill's rim. On the karst they are pines, down to the shore.
      const dark = 0.5 - 0.22 * region[1] - 0.2 * karst + 0.3 * soft(x, y, n, 44, WOOD_SEED + 3) + 0.1 * soft(x, y, n, 13, WOOD_SEED + 4);
      // The taiga: the colder the latitude, the sooner conifers take the wood, so its broadleaf is the odd birch grove.
      return cold > dark - (shift > 0 ? TAIGA_DARK * (shift >= 22 ? 1 : shift / 22) : 0) + ruleJitter(mask, x, y, RULE.hue) * 0.14 ? M.floorConifer : M.floorBroadleaf;
    }
  }

  // Heath: wind-blown ground, and the tops of valley country. Edge 12.
  j = ruleJitter(mask, x, y, RULE.heath);
  const dX12 = j * 12 * PER_CELL.wind;
  if (gust > 0.55 + lee + dX12 || (hand > 30 + 9 * soft(x, y, n, 60, WIND_SEED + 3) + j * 12 * PER_CELL.hand && slate > 0.5 + j * 12 * PER_CELL.field)) {
    return heathOrMoor(c, x, y, j, mask, n, ec);
  }

  // Forest of the home lowland: the lower valley sides. The edge is drawn by the trees, so the
  // floor's own edge is narrow; the conifer line is a wide belt of mixed wood,
  // some 20 units of height deep, so it never rings a hill. In the highland
  // woods keep to the valleys and turn to conifer sooner.
  j = ruleJitter(mask, x, y, RULE.forest);
  const dH = j * 3 * PER_CELL.hand;
  const dS = j * 3 * PER_CELL.slope;
  const dF = j * 3 * PER_CELL.field;
  if (
    home && hand > 2 + dH && hand < 30 - 14 * region[1] - 16 * region[3] + dH &&
    s > 0.08 + (HOME_OPEN + stray) * region[0] + dS * 0.5 && st < 0.8 + dS &&
    moisture > 0.4 + dF && gust < 0.5 + lee + j * 3 * PER_CELL.wind &&
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
    if (ec > 38 + 16 * soft(x, y, n, 30, HEATH_SEED + 1) + j * 2 || gust > 0.56 + j * 8 * PER_CELL.wind) return heathOrMoor(c, x, y, j, mask, n, ec);
    // Bracken takes the sunny side, bed by bed, and the damp runnels of any side.
    const sun = 0.25 + 0.45 * strata(ef, x, y, n) + 0.3 * soft(x, y, n, 22, HEATH_SEED + 2) + j * 0.06;
    if (north < sun || (curve < -0.6 && north < sun + 0.5)) return M.bracken;
    return home ? M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n) : moorGround(c, x, y, mask, n, ec);
  }
  // Above the walls the hill is rough grazing, not pasture.
  if (uplandW > 0.5 + j * 8 * PER_CELL.field && hand > ROUGH_HAND + j * 8 * PER_CELL.hand) return heathOrMoor(c, x, y, j, mask, n, ec);
  return M.pastureCool + hueVariant(x, y, HUE_CLASS.pasture, mask, n);
}
