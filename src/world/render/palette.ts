// The paint. For every material a 16-tone ramp built in OKLab: cooler in shade
// (teal under leaves, violet on stone and snow), warmer in light. Shadow bits
// darken toward a blue-violet shadow that never reaches black; ink bits mix toward a warm sepia-black. Time of day, season and
// overcast are transforms of the whole table, so the frame loop is a lookup:
// out = PAL[(mat << 8) | light].
//
// Vermilion and gold belong to the dragon and the landmarks. No terrain colour
// comes near them, in any light.

import {
  LIGHT_INK_SHIFT, LIGHT_SHADOW_SHIFT, LIGHT_TONE_MASK, type Palette, type PaletteOptions,
} from "../look/contract.ts";
import { isVegetation, MATERIAL as M, MATERIAL_COUNT } from "../look/materials.ts";

/** The tone flat, unshaded ground takes; shade runs below it and light above. */
export const FLAT_TONE = 9;
/**
 * A river runs in valley floors, so it is held lighter than vegetation up to
 * this tone: the shaded and mid tones it actually crosses. (Guarding against
 * sunlit vegetation as well drove the river to chalk white.)
 */
export const RIVER_GUARD_TONE = FLAT_TONE - 3;
/** The river must be this many L* lighter than any vegetation it crosses. */
export const RIVER_MARGIN = 15;
/** The first and the last of the river's tones that belong to 1 px streams, and the lightness they run between. */
export const STREAM_TONE = 8;
export const STREAM_TONES = 6;
export const STREAM_DARK = 0.49;
export const STREAM_LIGHT = 0.723;

/** Share of ink mixed in for each value of the ink bits: none, soft, full, solid. */
export const INK_MIX: readonly number[] = [0, 0.5, 0.85, 1];
/** Share of the shadow colour mixed in for each shadow depth, under a clear sky. */
export const SHADOW_MIX: readonly number[] = [0, 0.34, 0.52, 0.68];

type Lch = readonly [number, number, number];
type Lab = [number, number, number];

/** Reserved for the dragon and landmarks, as OKLCH. */
export const RESERVED: { vermilion: Lch; gold: Lch } = {
  vermilion: [0.6, 0.2, 33],
  gold: [0.78, 0.14, 85],
};
/** Terrain chroma is capped at this inside the reserved hue sector (red through yellow). */
export const RESERVED_SECTOR: readonly [number, number] = [8, 106];
export const TERRAIN_CHROMA_CAP = 0.09;

const INK: Lch = [0.24, 0.03, 60];
const PAPER: Lch = [0.955, 0.02, 90];
/** Snow is a cool blue-white wash, never the paper's cream: a shade bluer than the sky leaves it, and lighter than any sand. */
const SNOW: Lch = [0.945, 0.02, 245];
/** Snow: a long, even fall into blue-violet shade and a short rise to clean white. Its light takes no yellow. */
const SNOWY = { drop: 0.3, rise: 0.75, cool: 0.068, coolHue: 272, warm: 0, ramp: "land" } as const;

const RAD = Math.PI / 180;

function lab(c: Lch): Lab {
  return [c[0], c[1] * Math.cos(c[2] * RAD), c[1] * Math.sin(c[2] * RAD)];
}

function mix(p: Lab, q: Lab, t: number): Lab {
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function oklabToLinear(c: Lab): Lab {
  const l = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
  const m = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
  const s = c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2];
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

function inGamut(rgb: Lab): boolean {
  return rgb[0] >= -1e-4 && rgb[0] <= 1.0001 && rgb[1] >= -1e-4 && rgb[1] <= 1.0001 && rgb[2] >= -1e-4 && rgb[2] <= 1.0001;
}

function gamma(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** OKLab → packed 0xAABBGGRR. Out-of-gamut colours lose chroma, not hue or lightness. */
function pack(c: Lab): number {
  const L = c[0] < 0 ? 0 : c[0] > 1 ? 1 : c[0];
  let rgb = oklabToLinear([L, c[1], c[2]]);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(oklabToLinear([L, c[1] * k, c[2] * k]))) lo = k;
      else hi = k;
    }
    rgb = oklabToLinear([L, c[1] * lo, c[2] * lo]);
  }
  const r = Math.round(gamma(rgb[0]) * 255);
  const g = Math.round(gamma(rgb[1]) * 255);
  const b = Math.round(gamma(rgb[2]) * 255);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function degamma(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** CIE L* (0–100) of a packed colour. */
export function lstar(rgba: number): number {
  const y = 0.2126729 * degamma(rgba & 255) + 0.7151522 * degamma((rgba >>> 8) & 255) + 0.072175 * degamma((rgba >>> 16) & 255);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** OKLab [L, a, b] of a packed colour. */
export function oklabOf(rgba: number): [number, number, number] {
  const r = degamma(rgba & 255);
  const g = degamma((rgba >>> 8) & 255);
  const b = degamma((rgba >>> 16) & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// ---------------------------------------------------------------------------
// Material colours: OKLCH [lightness, chroma, hue°] of flat ground at noon,
// one per season (spring, summer, autumn, winter).

type Seasons = readonly [Lch, Lch, Lch, Lch];

interface Spec {
  seasons: Seasons;
  /** How far the shade end of the ramp drops, as a share of lightness. */
  drop: number;
  /** How far the light end rises toward white. */
  rise: number;
  /** Chroma of the blue added in shade. */
  cool: number;
  /** Hue of that shade colour; 265 (blue-violet) when absent. Vegetation shades toward teal, stone and snow toward violet. */
  coolHue?: number;
  /** Chroma of the yellow added in light; 0.034 when absent. Rock warms to buff where lit. */
  warm?: number;
  /** 0–1: how thin the wash runs in full light, where the cream of the paper shows through it; 0 when absent. */
  thin?: number;
  /** "land" ramps run shade → light; "depth" ramps run shore → deep; "flow" ramps cycle. */
  ramp: "land" | "depth" | "flow";
  /** Depth ramps: mid and deep anchors, as offsets applied to the season colour. */
  mid?: Lch;
  deep?: Lch;
}

function all(c: Lch): Seasons {
  return [c, c, c, c];
}

/** Grass through the year from its summer colour: fresh in spring, tawny in autumn, a pale frosted sage in winter. */
function grass(c: Lch): Seasons {
  return [
    [c[0] + 0.012, c[1] + 0.012, c[2] + 1],
    c,
    [c[0] - 0.012, c[1] - 0.022, c[2] - 15],
    [c[0] + 0.01, c[1] - 0.058, c[2] + 12],
  ];
}

/** Evergreens barely change. */
function evergreen(c: Lch): Seasons {
  return [[c[0] + 0.015, c[1] + 0.008, c[2] - 3], c, [c[0] - 0.005, c[1] - 0.004, c[2]], [c[0] - 0.02, c[1] - 0.012, c[2] + 6]];
}

// Vegetation shades toward teal and lights toward gold; stone and snow shade toward violet.
// In full light their wash runs thin and the paper's cream shows through: a lit slope is pale, never a yellow-green.
const LAND = { drop: 0.5, rise: 0.58, cool: 0.046, coolHue: 240, warm: 0.03, thin: 0.5, ramp: "land" } as const;
// Upland turf, heather and moor: a deeper, bluer shade and a light that stays a colour, so a lit crest is gold-green
// and not a mint rim, and lit and shaded faces part in value.
const UPLAND = { drop: 0.55, rise: 0.5, cool: 0.04, coolHue: 236, warm: 0.03, thin: 0.6, ramp: "land" } as const;
const CANOPY = { drop: 0.54, rise: 0.5, cool: 0.06, coolHue: 228, warm: 0.04, thin: 0.15, ramp: "land" } as const;
const STONE = { drop: 0.5, rise: 0.6, cool: 0.075, coolHue: 278, warm: 0.075, ramp: "land" } as const;
const TALUS = { drop: 0.26, rise: 0.6, cool: 0.012, coolHue: 278, warm: 0.06, ramp: "land" } as const;
const PALE = { drop: 0.36, rise: 0.6, cool: 0.085, ramp: "land" } as const;
const LINE = { drop: 0.2, rise: 0.3, cool: 0.02, ramp: "land" } as const;

function buildSpecs(): Spec[] {
  const s: Spec[] = new Array(MATERIAL_COUNT);
  const set = (id: number, seasons: Seasons, shape: Omit<Spec, "seasons">): void => {
    s[id] = { seasons, ...shape };
  };

  set(M.none, all(PAPER), LINE);

  // Water. Depth ramps: tone 0 is the shore, 15 is far out.
  set(M.sea, [[0.85, 0.06, 194], [0.86, 0.065, 192], [0.84, 0.055, 198], [0.82, 0.04, 205]],
    { drop: 0, rise: 0, cool: 0, ramp: "depth", mid: [0.67, 0.082, 226], deep: [0.48, 0.085, 250] });
  set(M.seaClear, [[0.88, 0.07, 188], [0.89, 0.078, 186], [0.87, 0.065, 190], [0.85, 0.05, 196]],
    { drop: 0, rise: 0, cool: 0, ramp: "depth", mid: [0.74, 0.1, 203], deep: [0.52, 0.095, 242] });
  set(M.lake, [[0.75, 0.05, 222], [0.76, 0.055, 220], [0.74, 0.05, 226], [0.76, 0.03, 232]],
    { drop: 0, rise: 0, cool: 0, ramp: "depth", mid: [0.62, 0.068, 238], deep: [0.47, 0.072, 254] });
  set(M.river, [[0.73, 0.044, 224], [0.73, 0.046, 222], [0.72, 0.042, 226], [0.76, 0.034, 230]],
    { drop: 0, rise: 0, cool: 0, ramp: "flow" });

  // Shore.
  set(M.sand, all([0.9, 0.04, 85]), PALE);
  set(M.sandPale, all([0.945, 0.018, 95]), PALE);
  set(M.shingle, all([0.8, 0.015, 85]), STONE);

  // Snow; late snow melts to fellfield in summer.
  set(M.snow, all(SNOW), SNOWY);
  set(M.snowLate, [SNOW, [0.73, 0.03, 118], SNOW, SNOW], SNOWY);

  // Rock.
  set(M.rockHard, all([0.68, 0.012, 265]), STONE);
  set(M.rockSed, all([0.7, 0.022, 78]), STONE);
  set(M.rockLime, all([0.9, 0.012, 95]), PALE);
  set(M.rockSlate, all([0.53, 0.03, 262]), STONE);
  set(M.cliffHard, all([0.62, 0.015, 270]), STONE);
  set(M.cliffSed, all([0.65, 0.03, 72]), STONE);
  set(M.cliffLime, all([0.86, 0.018, 90]), PALE);
  set(M.cliffSlate, all([0.47, 0.035, 265]), STONE);
  // Scree is fresh, broken stone: lighter and warmer than the face it fell from.
  // It stays warm in shade: a fan that went violet there would read as a slab of the face.
  set(M.scree, all([0.84, 0.034, 76]), TALUS);
  set(M.screeSlate, all([0.76, 0.014, 250]), TALUS);
  // Its stones are a tone under the fan: grey-buff, nowhere near ink.
  set(M.screeStone, all([0.66, 0.024, 62]), TALUS);

  // Upland. Alpine meadow is the winter snow band.
  const alpine: Lch[] = [[0.71, 0.07, 140], [0.73, 0.075, 131], [0.75, 0.08, 121]];
  for (let v = 0; v < 3; v++) {
    const g = grass(alpine[v]);
    set(M.alpineCool + v, [g[0], g[1], g[2], SNOW], UPLAND);
  }
  // Heather blooms purple in summer and is brown the rest of the year.
  const heathBloom: Lch[] = [[0.62, 0.058, 326], [0.64, 0.042, 345], [0.65, 0.032, 15]];
  const heathBrown: Lch[] = [[0.56, 0.035, 25], [0.575, 0.04, 58], [0.6, 0.045, 85]];
  for (let v = 0; v < 3; v++) {
    const b = heathBrown[v];
    set(M.heathCool + v, [[b[0] + 0.01, b[1], b[2] + 20], heathBloom[v], b, [b[0] + 0.04, b[1] - 0.012, b[2]]], UPLAND);
  }
  const moor: Lch[] = [[0.69, 0.076, 137], [0.705, 0.082, 130], [0.72, 0.086, 123]];
  for (let v = 0; v < 3; v++) {
    const g = grass(moor[v]);
    set(M.moorCool + v, [g[0], g[1], g[2], [g[3][0] + 0.05, g[3][1], g[3][2]]], UPLAND);
  }

  // Woods.
  // Floors sit between the crowns' shade and open grass, so a floor cell with no tree on it is not a dark tick.
  set(M.floorBroadleaf, [[0.56, 0.08, 140], [0.5, 0.075, 147], [0.5, 0.06, 85], [0.6, 0.026, 75]], LAND);
  set(M.floorConifer, evergreen([0.44, 0.055, 160]), LAND);
  // Woods are the dark mass of a lowland view; meadows and corn the light one. Bare in winter they are a plum-grey
  // haze of twigs over pale litter, cool against the frosted grass: never a brown.
  set(M.broadleafCool, [[0.57, 0.095, 146], [0.46, 0.08, 156], [0.6, 0.085, 112], [0.44, 0.03, 335]], CANOPY);
  set(M.broadleafMid, [[0.61, 0.11, 135], [0.51, 0.092, 142], [0.66, 0.095, 88], [0.47, 0.03, 348]], CANOPY);
  set(M.broadleafWarm, [[0.65, 0.115, 126], [0.56, 0.098, 128], [0.56, 0.095, 52], [0.5, 0.032, 5]], CANOPY);
  set(M.coniferCool, evergreen([0.37, 0.05, 178]), CANOPY);
  set(M.coniferMid, evergreen([0.39, 0.055, 165]), CANOPY);
  set(M.coniferWarm, evergreen([0.42, 0.06, 152]), CANOPY);
  set(M.alder, [[0.56, 0.095, 138], [0.47, 0.08, 150], [0.56, 0.07, 105], [0.46, 0.028, 340]], CANOPY);
  set(M.shrub, evergreen([0.46, 0.07, 141]), CANOPY);

  // Crops ripen and are cut; ploughland shows in winter.
  set(M.wheat, [[0.76, 0.11, 132], [0.815, 0.082, 97], [0.7, 0.06, 80], [0.56, 0.05, 58]], LAND);
  set(M.barley, [[0.78, 0.11, 128], [0.79, 0.085, 110], [0.68, 0.055, 78], [0.6, 0.07, 125]], LAND);
  set(M.ley, [[0.77, 0.13, 134], [0.76, 0.12, 136], [0.72, 0.1, 130], [0.68, 0.07, 125]], LAND);
  set(M.hay, [[0.79, 0.115, 128], [0.8, 0.09, 116], [0.75, 0.09, 122], [0.7, 0.06, 112]], LAND);
  set(M.plough, [[0.56, 0.05, 55], [0.62, 0.055, 85], [0.55, 0.05, 55], [0.53, 0.045, 50]], LAND);
  // Vines: rows of green over pale stony earth.
  set(M.vine, [[0.7, 0.045, 88], [0.715, 0.05, 92], [0.7, 0.05, 80], [0.66, 0.04, 70]], LAND);
  set(M.vineRow, [[0.62, 0.07, 110], [0.59, 0.085, 134], [0.6, 0.09, 72], [0.52, 0.03, 55]], LAND);
  // Lines across a crop sit a tone or two from the field: tramlines and
  // furrows darker, windrows and mown swaths lighter.
  set(M.wheatRow, [[0.72, 0.105, 134], [0.775, 0.08, 100], [0.66, 0.055, 80], [0.52, 0.05, 55]], LAND);
  set(M.barleyRow, [[0.72, 0.105, 130], [0.755, 0.085, 114], [0.645, 0.055, 78], [0.565, 0.07, 122]], LAND);
  set(M.leyStripe, [[0.775, 0.125, 132], [0.785, 0.115, 133], [0.745, 0.095, 128], [0.7, 0.07, 123]], LAND);
  set(M.hayRow, [[0.785, 0.11, 126], [0.825, 0.075, 104], [0.77, 0.085, 118], [0.715, 0.06, 110]], LAND);
  set(M.ploughRow, [[0.51, 0.05, 50], [0.57, 0.055, 80], [0.5, 0.05, 50], [0.485, 0.045, 46]], LAND);
  // Stubble: what a cut cornfield leaves, paler than the standing crop, with the drill rows showing.
  set(M.stubble, [[0.77, 0.1, 128], [0.83, 0.06, 96], [0.72, 0.055, 84], [0.57, 0.05, 58]], LAND);
  set(M.stubbleRow, [[0.72, 0.1, 130], [0.795, 0.065, 92], [0.69, 0.055, 82], [0.54, 0.05, 56]], LAND);

  // Wet ground.
  set(M.marsh, grass([0.62, 0.065, 128]), LAND);
  set(M.reeds, [[0.66, 0.07, 115], [0.69, 0.072, 90], [0.7, 0.07, 82], [0.72, 0.06, 80]], LAND);

  // The shore's own plants. Marram is a pale sage that bleaches in winter; saltmarsh a grey-green, its creeks wet mud.
  set(M.duneGrass, [[0.8, 0.05, 124], [0.81, 0.045, 118], [0.8, 0.045, 104], [0.79, 0.035, 96]], LAND);
  set(M.saltmarsh, [[0.68, 0.045, 138], [0.67, 0.042, 142], [0.66, 0.04, 118], [0.65, 0.03, 110]], LAND);
  set(M.saltCreek, all([0.71, 0.022, 215]), LINE);

  // Lowland grass.
  const meadow: Lch[] = [[0.785, 0.1, 140], [0.8, 0.105, 131], [0.81, 0.1, 121]];
  const pasture: Lch[] = [[0.69, 0.09, 143], [0.705, 0.095, 136], [0.72, 0.095, 127]];
  // Dry sward is thin and sage-green, never straw: straw-yellow ground under dotted bushes reads as savanna.
  const scrub: Lch[] = [[0.725, 0.08, 132], [0.745, 0.084, 126], [0.76, 0.086, 119]];
  for (let v = 0; v < 3; v++) {
    set(M.meadowCool + v, grass(meadow[v]), LAND);
    set(M.pastureCool + v, grass(pasture[v]), LAND);
    set(M.scrubCool + v, [scrub[v], scrub[v], [scrub[v][0], scrub[v][1], scrub[v][2] - 8], [scrub[v][0], scrub[v][1] - 0.04, scrub[v][2] + 8]], LAND);
  }

  // Flowers are out in spring and summer; afterwards the cell is meadow again.
  const gone = grass(meadow[1]);
  set(M.flowerPale, [[0.95, 0.02, 105], [0.95, 0.02, 105], gone[2], gone[3]], LINE);
  set(M.flowerMauve, [[0.76, 0.07, 325], [0.74, 0.08, 328], gone[2], gone[3]], LINE);
  set(M.boulder, all([0.77, 0.012, 95]), STONE);

  // Lines.
  set(M.road, all([0.87, 0.03, 82]), LINE);
  set(M.path, all([0.82, 0.035, 80]), LINE);
  // A hedge's ground is rough grass; the hedge itself is the row of crowns scatter plants on it.
  set(M.hedge, grass([0.68, 0.09, 138]), LAND);
  set(M.bracken, [[0.63, 0.075, 98], [0.67, 0.092, 122], [0.63, 0.095, 58], [0.57, 0.06, 55]], LAND);
  // Gorse blooms gold in spring and keeps a little of it all summer.
  set(M.gorse, [[0.66, 0.105, 100], [0.6, 0.09, 108], [0.55, 0.07, 122], [0.53, 0.06, 125]], LAND);
  set(M.hedgeCrown, [[0.56, 0.1, 138], [0.48, 0.085, 146], [0.57, 0.08, 95], [0.45, 0.03, 345]], CANOPY);
  set(M.wall, all([0.69, 0.012, 265]), LINE);

  // Built things. Walls are seen from the south, in soft shade: their own tone carries that, so the flat colour is the lit one.
  const BUILT = { drop: 0.34, rise: 0.5, cool: 0.06, ramp: "land" } as const;
  set(M.whitewash, all([0.95, 0.012, 90]), BUILT);
  set(M.plaster, all([0.86, 0.05, 75]), BUILT);
  set(M.stone, all([0.83, 0.025, 85]), BUILT);
  set(M.stoneDark, all([0.66, 0.02, 80]), STONE);
  set(M.roofSlate, all([0.5, 0.03, 255]), STONE);
  set(M.roofTile, all([0.64, 0.085, 45]), BUILT);
  set(M.roofLead, all([0.66, 0.03, 190]), STONE);
  set(M.timber, all([0.5, 0.05, 60]), BUILT);
  set(M.brick, all([0.55, 0.075, 35]), BUILT);
  set(M.opening, all([0.42, 0.03, 265]), LINE);
  set(M.cobble, all([0.84, 0.022, 80]), PALE);
  set(M.yew, evergreen([0.36, 0.05, 158]), CANOPY);
  set(M.gilt, all([0.8, 0.09, 88]), LINE);
  set(M.dial, all([0.95, 0.02, 95]), LINE);
  set(M.lantern, all([0.93, 0.05, 98]), LINE);
  set(M.sailcloth, all([0.93, 0.018, 85]), LINE);
  set(M.quarry, all([0.58, 0.03, 258]), STONE);
  // Verdigris sits apart from the grey of lead: greener, and a little darker in the hollows of a dome.
  set(M.copper, all([0.54, 0.078, 166]), STONE);
  // Coloured plaster for a crowded town. Rose, sage and sea sit outside the reserved hues so they can
  // carry enough colour to read as different houses; butter stays inside the cap, clear of the gold.
  set(M.plasterButter, all([0.88, 0.055, 96]), BUILT);
  set(M.plasterRose, all([0.68, 0.1, 352]), BUILT);
  set(M.plasterSage, all([0.58, 0.08, 145]), BUILT);
  set(M.plasterSea, all([0.66, 0.065, 232]), BUILT);
  set(M.ivy, evergreen([0.5, 0.068, 148]), BUILT);
  set(M.moss, evergreen([0.64, 0.055, 128]), BUILT);

  return s;
}

const SPECS = buildSpecs();

function wrap01(v: number): number {
  return v - Math.floor(v);
}

/** A material's flat noon colour at a point in the year, blended in OKLab between the two nearest seasons. */
function seasonal(seasons: Seasons, season: number): Lab {
  const p = wrap01(season) * 4;
  const i = Math.floor(p) & 3;
  return mix(lab(seasons[i]), lab(seasons[(i + 1) & 3]), smooth(p - Math.floor(p)));
}

/**
 * 0–1: how much of this material is under snow at this point in the year.
 * Above a quarter it is counted as snow, not as vegetation a river crosses.
 */
export function snowCover(mat: number, season: number): number {
  const spec = SPECS[mat];
  if (!spec) return 0;
  const p = wrap01(season) * 4;
  const i = Math.floor(p) & 3;
  const f = smooth(p - Math.floor(p));
  return (spec.seasons[i] === SNOW ? 1 - f : 0) + (spec.seasons[(i + 1) & 3] === SNOW ? f : 0);
}

// ---------------------------------------------------------------------------
// The light: time of day and overcast.

interface Grade {
  gain: number;
  lift: number;
  sat: number;
  /** The power lightness is raised to before the gain: over 1 it parts pale things from the dark masses in low light. */
  curve: number;
  /** The share of its lightness a face turned from the light loses, on top of the gain. */
  shade: number;
  /** The share of the light's colour a strongly coloured thing takes: a red sun on leaves makes olive, never orange-brown. */
  dyed: number;
  /** How much of the sky's colour water takes, against the land's 1. */
  water: number;
  /** OKLab a, b added to faces in the light and to faces in shade. */
  warmA: number;
  warmB: number;
  coolA: number;
  coolB: number;
}

interface GradeSpec {
  gain: number;
  lift?: number;
  sat: number;
  curve?: number;
  shade?: number;
  dyed?: number;
  water?: number;
  /** The light's colour and the shade's, each as OKLCH chroma and hue. */
  light: readonly [number, number];
  dark: readonly [number, number];
}

function grade(s: GradeSpec): Grade {
  return {
    gain: s.gain, lift: s.lift ?? 0, sat: s.sat, curve: s.curve ?? 1, shade: s.shade ?? 0, dyed: s.dyed ?? 1, water: s.water ?? 1,
    warmA: s.light[0] * Math.cos(s.light[1] * RAD), warmB: s.light[0] * Math.sin(s.light[1] * RAD),
    coolA: s.dark[0] * Math.cos(s.dark[1] * RAD), coolB: s.dark[0] * Math.sin(s.dark[1] * RAD),
  };
}

// The day, in sun phase (sky/clock.ts): 0.25 sunrise, 0.5 noon, 0.75 sunset. Each grade names two lights: the one
// on faces turned to the sun or the moon, and the one in their shade. Night is moonlit: most of the land's own colour
// goes, pale blue-green where the moon falls and indigo in the shade, and the curve keeps roads, fields and snow
// pale over dark woods. The blue hours are one deep blue wash. Dawn is rose-peach over lavender. Golden hour is
// buff-gold over blue-violet. Dusk is a red-orange afterglow over deepening violet.
const NIGHT = grade({ gain: 0.47, lift: 0.09, sat: 0.2, curve: 1.4, shade: 0.1, water: 1.1, light: [0.045, 238], dark: [0.06, 276] });
const BLUE = grade({ gain: 0.62, lift: 0.07, sat: 0.3, curve: 1.2, shade: 0.08, water: 1.2, light: [0.042, 250], dark: [0.064, 274] });
const DAWN = grade({ gain: 0.88, lift: 0.06, sat: 0.7, shade: 0.07, dyed: 0.6, water: 1.3, light: [0.056, 18], dark: [0.05, 282] });
const MORNING = grade({ gain: 0.985, lift: 0.008, sat: 0.94, light: [0.014, 70], dark: [0.014, 255] });
const NOON = grade({ gain: 1, sat: 1, light: [0, 0], dark: [0, 0] });
const GOLDEN = grade({ gain: 0.95, sat: 0.9, shade: 0.08, dyed: 0.7, water: 0.5, light: [0.056, 72], dark: [0.04, 284] });
const DUSK = grade({ gain: 0.82, lift: 0.01, sat: 0.7, curve: 1.05, shade: 0.16, dyed: 0.45, water: 1.4, light: [0.074, 33], dark: [0.06, 302] });

/** Sun phase of each keyframe of the day. Noon holds from NOON_FROM to NOON_TO, so the shipped midday is plain noon. */
export const DAY_KEYS = {
  nightEnds: 0.17, blueDawn: 0.215, sunrise: 0.25, morning: 0.29, noonFrom: 0.36, noonTo: 0.64, golden: 0.705,
  sunset: 0.75, blueDusk: 0.785, nightFalls: 0.83,
} as const;

const K = DAY_KEYS;
const DAY: readonly (readonly [number, Grade])[] = [
  [0, NIGHT], [K.nightEnds, NIGHT], [K.blueDawn, BLUE], [K.sunrise, DAWN], [K.morning, MORNING], [K.noonFrom, NOON],
  [K.noonTo, NOON], [K.golden, GOLDEN], [K.sunset, DUSK], [K.blueDusk, BLUE], [K.nightFalls, NIGHT], [1, NIGHT],
];

/**
 * 0–1: how dark the light is at sun phase `time`, from the day's own grades: 0 while the light keeps its full
 * gain, 1 at night. Lamps, windows and stars come up with it.
 */
export function darkness(time: number): number {
  const g = gradeAt(time);
  const d = (NOON.gain - g.gain) / (NOON.gain - NIGHT.gain);
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

function gradeAt(time: number): Grade {
  const t = wrap01(time);
  let k = 0;
  while (k < DAY.length - 2 && t >= DAY[k + 1][0]) k++;
  const [t0, g0] = DAY[k];
  const [t1, g1] = DAY[k + 1];
  const f = smooth((t - t0) / (t1 - t0));
  const l = (p: number, q: number): number => p + (q - p) * f;
  return {
    gain: l(g0.gain, g1.gain), lift: l(g0.lift, g1.lift), sat: l(g0.sat, g1.sat),
    curve: l(g0.curve, g1.curve), shade: l(g0.shade, g1.shade), dyed: l(g0.dyed, g1.dyed), water: l(g0.water, g1.water),
    warmA: l(g0.warmA, g1.warmA), warmB: l(g0.warmB, g1.warmB),
    coolA: l(g0.coolA, g1.coolA), coolB: l(g0.coolB, g1.coolB),
  };
}

/** Mist: a pale, cool blue-grey veil, graded with the light, laid over every colour. */
const MIST: Lch = [0.935, 0.022, 232];
/**
 * At full mist: the share of the way a dark colour goes to the veil, how much further a pale one goes, and the share
 * of its own colour each loses first.
 */
export const MIST_VEIL = 0.46;
const MIST_MELT = 0.14;
const MIST_DRAIN = 0.45;
/** Mist lies in the cool of the shade: it takes this little of the sun's colour, so a dusk mist is violet-grey, never sepia. */
const MIST_LIT = 0.25;

/** The light of one moment: the day's grade, the overcast, and the mist with its veil already graded. */
interface Light {
  g: Grade;
  overcast: number;
  mist: number;
  veil: Lab;
}

function lightOf(o: PaletteOptions): Light {
  const g = gradeAt(o.time);
  const overcast = o.overcast < 0 ? 0 : o.overcast > 1 ? 1 : o.overcast;
  const m = o.mist ?? 0;
  const mist = m < 0 ? 0 : m > 1 ? 1 : m;
  return { g, overcast, mist, veil: applyGrade(lab(MIST), { g, overcast, mist: 0, veil: [0, 0, 0] }, false, MIST_LIT) };
}

/**
 * A colour's own chroma from which it starts to resist the light's colour, and the span over which it comes to take
 * only the grade's `dyed` share. Whitewash, roads, rock and snow take the light whole; leaves and tiles keep their own.
 */
const DYED_FROM = 0.02;
const DYED_SPAN = 0.05;

/**
 * A colour in the light: graded, greyed, misted and, unless `cap` is false (the dragon), kept off the reserved hues.
 * `lit` is how far the face is turned to the light, 0 shade to 1 full light; without it the colour's own lightness
 * stands in (pale things catch the light). `take` is how much of the light's colour it takes, against the land's 1.
 * `wash` is false for what is no wash of pigment: water and cloud take the light whatever their colour.
 */
function applyGrade(c: Lab, light: Light, cap = true, lit?: number, take = 1, wash = true): Lab {
  const { g, overcast, mist } = light;
  const w = lit ?? smooth((c[0] - 0.35) / 0.5);
  let L = g.lift + g.gain * (g.curve === 1 ? c[0] : Math.pow(c[0], g.curve)) * (1 - g.shade * (1 - w));
  const own = wash && g.dyed !== 1 ? smooth((Math.sqrt(c[1] * c[1] + c[2] * c[2]) - DYED_FROM) / DYED_SPAN) : 0;
  const wl = w * (1 - (1 - g.dyed) * own) * take, wd = (1 - w) * take;
  let a = c[1] * g.sat + wl * g.warmA + wd * g.coolA;
  let b = c[2] * g.sat + wl * g.warmB + wd * g.coolB;
  if (overcast > 0) {
    // Rain light, flat and wet: the lights come down to a grey-green, the darks hold, and colour thins.
    const pivot = g.lift + g.gain * 0.5;
    L = pivot + (L - pivot) * (1 - 0.2 * overcast) - 0.04 * overcast * g.gain;
    const k = 1 - 0.38 * overcast;
    a = a * k - 0.004 * overcast;
    b = b * k - 0.007 * overcast;
  }
  if (mist > 0) {
    // The veil: everything goes part of the way to the mist's own colour and loses some of its own. Pale washes
    // melt furthest into it; woods and inked edges stay as soft blue-grey shapes.
    const melt = smooth((L - g.lift - g.gain * 0.35) / (g.gain * 0.45));
    const k = (MIST_VEIL + MIST_MELT * melt) * mist, keep = 1 - MIST_DRAIN * mist;
    L += (light.veil[0] - L) * k;
    a = a * keep + (light.veil[1] - a * keep) * k;
    b = b * keep + (light.veil[2] - b * keep) * k;
  }
  // Keep terrain clear of the dragon's vermilion and gold: a chroma cap over
  // the reserved hues, feathered out over the 18° to either side.
  const chroma = Math.sqrt(a * a + b * b);
  if (cap && chroma > TERRAIN_CHROMA_CAP) {
    let hue = Math.atan2(b, a) / RAD;
    if (hue < 0) hue += 360;
    const outside = Math.max(RESERVED_SECTOR[0] - hue, hue - RESERVED_SECTOR[1], 0);
    const cap = TERRAIN_CHROMA_CAP + 0.07 * smooth(outside / 18);
    if (chroma > cap) {
      a *= cap / chroma;
      b *= cap / chroma;
    }
  }
  return [L, a, b];
}

// ---------------------------------------------------------------------------

const LIGHT_YELLOW = lab([1, 1, 95]);
const SHADOW_VIOLET = lab([1, 0.055, 285]);
/** No shade or shadow falls below this lightness by much: darks are colour, and stay clear of the ink. */
const DARK_KNEE = 0.36;

/** Compresses the darks under DARK_KNEE, so the deepest shadow on the darkest wood is still a colour. */
function liftDark(c: Lab): Lab {
  return c[0] >= DARK_KNEE ? c : [DARK_KNEE - (DARK_KNEE - c[0]) * 0.42, c[1], c[2]];
}

/** The 16 tones of one material, before shadow and ink. */
function ramp(spec: Spec, season: number): Lab[] {
  const base = seasonal(spec.seasons, season);
  const out: Lab[] = new Array(16);
  if (spec.ramp === "depth") {
    const mid = lab(spec.mid!);
    const deep = lab(spec.deep!);
    for (let t = 0; t < 16; t++) {
      const d = t / 15;
      out[t] = d < 0.4 ? mix(base, mid, smooth(d / 0.4)) : mix(mid, deep, smooth((d - 0.4) / 0.6));
    }
    return out;
  }
  if (spec.ramp === "flow") {
    // One soft streak per cycle of the flow phase; the ends meet.
    // Tones 0–7: the flow phase of a river. Tones 8–13: a 1 px stream, from deep shade to full light. Tone 14: falling water. Tone 15: foam.
    for (let t = 0; t < 8; t++) {
      const wave = Math.cos((t / 8) * 2 * Math.PI);
      out[t] = [base[0] - 0.011 + 0.011 * wave, base[1] * (1.15 - 0.15 * wave), base[2] * (1.15 - 0.15 * wave)];
    }
    // A stream is a line of water darker than the ground it crosses, never a white scratch: its tone follows that ground's shade.
    for (let t = STREAM_TONE; t < STREAM_TONE + STREAM_TONES; t++) {
      const k = (t - STREAM_TONE) / (STREAM_TONES - 1);
      out[t] = [STREAM_DARK + (STREAM_LIGHT - STREAM_DARK) * k, base[1] * (1.4 - 0.3 * k), base[2] * (1.4 - 0.3 * k)];
    }
    // Falling water is a pale teal; its foam is the paper left bare, a cream and never a hard white.
    out[14] = [0.875, base[1] * 0.8, base[2] * 0.8];
    const foam = lab(PAPER);
    out[15] = [0.965, foam[1] * 0.8 + base[1] * 0.1, foam[2] * 0.8 + base[2] * 0.1];
    return out;
  }
  const blue = lab([1, 1, spec.coolHue ?? 265]);
  const shade: Lab = [
    base[0] * (1 - spec.drop),
    base[1] * 0.9 + spec.cool * blue[1],
    base[2] * 0.9 + spec.cool * blue[2],
  ];
  // A thin wash: the colour gives way to the paper's own cream.
  const thin = spec.thin ?? 0;
  const cream = lab(PAPER);
  const light: Lab = [
    Math.min(0.99, base[0] + (1 - base[0]) * spec.rise + 0.02),
    base[1] * 0.9 * (1 - thin) + thin * cream[1] + (spec.warm ?? 0.034) * LIGHT_YELLOW[1],
    base[2] * 0.9 * (1 - thin) + thin * cream[2] + (spec.warm ?? 0.034) * LIGHT_YELLOW[2],
  ];
  // The gold of the light never pushes a strong green to a game green.
  const lc = Math.sqrt(light[1] * light[1] + light[2] * light[2]);
  if (lc > 0.125) { light[1] *= 0.125 / lc; light[2] *= 0.125 / lc; }
  for (let t = 0; t < 16; t++) {
    out[t] = t <= FLAT_TONE
      ? mix(shade, base, Math.pow(t / FLAT_TONE, 0.9))
      : mix(base, light, (t - FLAT_TONE) / (15 - FLAT_TONE));
  }
  return out;
}

function shadowed(c: Lab, depth: number, overcast: number): Lab {
  if (depth === 0) return c;
  // In the darks the colour stays what it was, a dark teal under trees: the lift leaves a shadow little lightness to darken with.
  const v = smooth((c[0] - 0.3) / 0.25);
  const k = 1 - 0.3 * v;
  const target: Lab = [c[0] * 0.52, c[1] * k + v * SHADOW_VIOLET[1], c[2] * k + v * SHADOW_VIOLET[2]];
  return mix(c, target, SHADOW_MIX[depth] * (1 - 0.5 * overcast));
}

/**
 * How far each tone of a land ramp is turned to the light: flat ground takes most of a low sun, a slope facing it
 * all, a slope turned away none. A cast shadow takes most of it away again.
 */
const LIT_TONE: readonly number[] = Array.from({ length: 16 }, (_, t) => smooth((t / 15) * 1.25 - 0.15));
const LIT_SHADOW: readonly number[] = [1, 0.5, 0.28, 0.12];
/** The share of a land colour's light that comes from its tone; the rest from its own lightness, so pale walls still catch it. */
const LIT_BY_TONE = 0.75;

/** The whole table for one moment: 256 materials × 256 light bytes. */
/** The light the world is baked and shown in until time of day lands: midday, early summer, clear. The bake workers and the page must agree on it. */
export const MIDDAY: PaletteOptions = { time: 0.5, season: 0.25, overcast: 0 };

/**
 * A colour that is not terrain (a cloud, the dragon) in the light of `o`, as packed RGBA: the same grade, overcast
 * and mist as the land, without the land's cap on the reserved hues. `lit` and `take` as for the land's own grade.
 */
export function gradeRgb(rgba: number, o: PaletteOptions, lit?: number, take = 1): number {
  const light = lightOf(o);
  // Plain noon light changes nothing: the colour comes back exactly as it went in.
  const g = light.g;
  if (g.gain === 1 && g.lift === 0 && g.sat === 1 && g.curve === 1 && g.shade === 0 && g.warmA === 0 && g.warmB === 0
    && g.coolA === 0 && g.coolB === 0 && light.overcast === 0 && light.mist === 0) return rgba;
  return pack(applyGrade(oklabOf(rgba), light, false, lit, take, false));
}

/** The paper in the light of `o`, as packed RGBA: what bare paper and the haze fade toward. */
export function paperIn(o: PaletteOptions): number {
  return pack(applyGrade(lab(PAPER), lightOf(o)));
}

export function buildPalette(o: PaletteOptions): Palette {
  const pal = new Uint32Array(256 * 256);
  const light = lightOf(o);
  const overcast = light.overcast;
  const ink = applyGrade(lab(INK), light);
  const paper = pack(applyGrade(lab(PAPER), light));
  pal.fill(paper);

  // Graded tones per material and shadow depth, before ink.
  const tones: Lab[][][] = new Array(MATERIAL_COUNT);
  for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
    const r = ramp(SPECS[mat], o.season);
    // Water keeps its own depth ramp; land darks are lifted once, after shade and shadow have both been laid.
    const land = SPECS[mat].ramp === "land";
    tones[mat] = [0, 1, 2, 3].map((depth) => r.map((c, tone) => {
      const s = shadowed(c, depth, overcast);
      if (!land) return applyGrade(s, light, true, undefined, light.g.water, false);
      const d = liftDark(s);
      return applyGrade(d, light, true, LIT_BY_TONE * LIT_TONE[tone] * LIT_SHADOW[depth] + (1 - LIT_BY_TONE) * smooth((d[0] - 0.35) / 0.5));
    }));
  }

  // Lift the river until it clears every vegetation it may cross, at each shadow depth.
  for (let depth = 0; depth < 4; depth++) {
    let vegMax = 0;
    for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
      if (isVegetation[mat] === 0 || snowCover(mat, o.season) > 0.25) continue;
      for (let t = 0; t <= RIVER_GUARD_TONE; t++) vegMax = Math.max(vegMax, lstar(pack(tones[mat][depth][t])));
    }
    // One lift for the whole flow ramp, so the streak keeps its shape. Streams are left as they are: they are dark lines.
    const river = tones[M.river][depth];
    const flows = (t: number): boolean => t < STREAM_TONE;
    for (let i = 0; i < 120; i++) {
      let lowest = Infinity;
      for (let t = 0; t < 16; t++) if (flows(t)) lowest = Math.min(lowest, lstar(pack(river[t])));
      if (lowest >= vegMax + RIVER_MARGIN + 0.5) break;
      for (let t = 0; t < 16; t++) if (flows(t)) river[t][0] = Math.min(1, river[t][0] + 0.004);
    }
    // A fall's water and its foam are pale already: each is lifted only as far as it needs, or by day it would be a hard white.
    for (let t = STREAM_TONE + STREAM_TONES; t < 16; t++) {
      for (let i = 0; i < 120 && lstar(pack(river[t])) < vegMax + RIVER_MARGIN + 0.5; i++) river[t][0] = Math.min(1, river[t][0] + 0.004);
    }
  }

  // Material 0 is bare paper whatever its light byte says.
  for (let mat = 1; mat < MATERIAL_COUNT; mat++) {
    for (let light = 0; light < 256; light++) {
      const tone = light & LIGHT_TONE_MASK;
      const depth = (light >> LIGHT_SHADOW_SHIFT) & 3;
      const inked = (light >> LIGHT_INK_SHIFT) & 3;
      const c = tones[mat][depth][tone];
      pal[(mat << 8) | light] = pack(inked === 0 ? c : mix(c, ink, INK_MIX[inked]));
    }
  }
  return pal;
}
