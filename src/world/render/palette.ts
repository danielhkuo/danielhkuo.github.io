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
  /** "land" ramps run shade → light; "depth" ramps run shore → deep; "flow" ramps cycle. */
  ramp: "land" | "depth" | "flow";
  /** Depth ramps: mid and deep anchors, as offsets applied to the season colour. */
  mid?: Lch;
  deep?: Lch;
}

function all(c: Lch): Seasons {
  return [c, c, c, c];
}

/** Grass through the year from its summer colour: fresh in spring, tawny in autumn, bleached in winter. */
function grass(c: Lch): Seasons {
  return [
    [c[0] + 0.012, c[1] + 0.012, c[2] + 1],
    c,
    [c[0] - 0.012, c[1] - 0.022, c[2] - 15],
    [c[0] - 0.045, c[1] - 0.045, c[2] - 24],
  ];
}

/** Evergreens barely change. */
function evergreen(c: Lch): Seasons {
  return [[c[0] + 0.015, c[1] + 0.008, c[2] - 3], c, [c[0] - 0.005, c[1] - 0.004, c[2]], [c[0] - 0.02, c[1] - 0.012, c[2] + 6]];
}

// Vegetation shades toward teal and lights toward gold; stone and snow shade toward violet.
const LAND = { drop: 0.5, rise: 0.58, cool: 0.055, coolHue: 238, warm: 0.046, ramp: "land" } as const;
const CANOPY = { drop: 0.54, rise: 0.5, cool: 0.06, coolHue: 228, warm: 0.04, ramp: "land" } as const;
const STONE = { drop: 0.5, rise: 0.6, cool: 0.075, coolHue: 278, warm: 0.075, ramp: "land" } as const;
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
  set(M.scree, all([0.82, 0.022, 82]), STONE);
  set(M.screeSlate, all([0.68, 0.02, 258]), STONE);
  // Its stones are a tone under the fan: grey-buff, nowhere near ink.
  set(M.screeStone, all([0.7, 0.018, 80]), STONE);

  // Upland. Alpine meadow is the winter snow band.
  const alpine: Lch[] = [[0.72, 0.08, 148], [0.74, 0.085, 140], [0.76, 0.09, 128]];
  for (let v = 0; v < 3; v++) {
    const g = grass(alpine[v]);
    set(M.alpineCool + v, [g[0], g[1], g[2], SNOW], LAND);
  }
  // Heather blooms purple in summer and is brown the rest of the year.
  const heathBloom: Lch[] = [[0.58, 0.055, 325], [0.59, 0.045, 355], [0.61, 0.04, 96]];
  const heathBrown: Lch[] = [[0.53, 0.03, 20], [0.54, 0.035, 55], [0.57, 0.04, 85]];
  for (let v = 0; v < 3; v++) {
    const b = heathBrown[v];
    set(M.heathCool + v, [[b[0] + 0.01, b[1], b[2] + 20], heathBloom[v], b, [b[0] + 0.04, b[1] - 0.012, b[2]]], LAND);
  }
  const moor: Lch[] = [[0.65, 0.06, 130], [0.67, 0.065, 120], [0.69, 0.07, 109]];
  for (let v = 0; v < 3; v++) {
    const g = grass(moor[v]);
    set(M.moorCool + v, [g[0], g[1], g[2], [g[3][0] + 0.05, g[3][1], g[3][2]]], LAND);
  }

  // Woods.
  // Floors sit between the crowns' shade and open grass, so a floor cell with no tree on it is not a dark tick.
  set(M.floorBroadleaf, [[0.56, 0.08, 140], [0.5, 0.075, 147], [0.5, 0.06, 85], [0.5, 0.03, 60]], LAND);
  set(M.floorConifer, evergreen([0.44, 0.055, 160]), LAND);
  // Woods are the dark mass of a lowland view; meadows and corn the light one.
  set(M.broadleafCool, [[0.57, 0.095, 146], [0.46, 0.08, 156], [0.6, 0.085, 112], [0.5, 0.022, 25]], CANOPY);
  set(M.broadleafMid, [[0.61, 0.11, 135], [0.51, 0.092, 142], [0.66, 0.095, 88], [0.52, 0.028, 50]], CANOPY);
  set(M.broadleafWarm, [[0.65, 0.115, 126], [0.56, 0.098, 128], [0.56, 0.095, 52], [0.54, 0.032, 65]], CANOPY);
  set(M.coniferCool, evergreen([0.37, 0.05, 178]), CANOPY);
  set(M.coniferMid, evergreen([0.39, 0.055, 165]), CANOPY);
  set(M.coniferWarm, evergreen([0.42, 0.06, 152]), CANOPY);
  set(M.alder, [[0.56, 0.095, 138], [0.47, 0.08, 150], [0.56, 0.07, 105], [0.5, 0.02, 30]], CANOPY);
  set(M.shrub, evergreen([0.5, 0.055, 128]), CANOPY);

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
  set(M.reeds, [[0.66, 0.07, 115], [0.67, 0.065, 105], [0.7, 0.07, 85], [0.72, 0.06, 82]], LAND);

  // The shore's own plants. Marram is a pale sage that bleaches in winter; saltmarsh a grey-green, its creeks wet mud.
  set(M.duneGrass, [[0.8, 0.05, 124], [0.81, 0.045, 118], [0.8, 0.045, 104], [0.79, 0.035, 96]], LAND);
  set(M.saltmarsh, [[0.68, 0.045, 138], [0.67, 0.042, 142], [0.66, 0.04, 118], [0.65, 0.03, 110]], LAND);
  set(M.saltCreek, all([0.71, 0.022, 215]), LINE);

  // Lowland grass.
  const meadow: Lch[] = [[0.785, 0.1, 140], [0.8, 0.105, 131], [0.81, 0.1, 121]];
  const pasture: Lch[] = [[0.69, 0.09, 143], [0.705, 0.095, 136], [0.72, 0.095, 127]];
  const scrub: Lch[] = [[0.72, 0.06, 118], [0.745, 0.068, 108], [0.765, 0.072, 98]];
  for (let v = 0; v < 3; v++) {
    set(M.meadowCool + v, grass(meadow[v]), LAND);
    set(M.pastureCool + v, grass(pasture[v]), LAND);
    set(M.scrubCool + v, [scrub[v], scrub[v], [scrub[v][0], scrub[v][1], scrub[v][2] - 8], [scrub[v][0] - 0.02, scrub[v][1] - 0.015, scrub[v][2] - 10]], LAND);
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
  set(M.bracken, [[0.6, 0.07, 96], [0.64, 0.088, 116], [0.6, 0.09, 58], [0.55, 0.06, 55]], LAND);
  set(M.hedgeCrown, [[0.56, 0.1, 138], [0.48, 0.085, 146], [0.57, 0.08, 95], [0.48, 0.025, 45]], CANOPY);
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
  /** OKLab a, b added to light tones and to dark tones. */
  warmA: number;
  warmB: number;
  coolA: number;
  coolB: number;
}

function grade(gain: number, lift: number, sat: number, warm: readonly [number, number], cool: readonly [number, number]): Grade {
  return {
    gain, lift, sat,
    warmA: warm[0] * Math.cos(warm[1] * RAD), warmB: warm[0] * Math.sin(warm[1] * RAD),
    coolA: cool[0] * Math.cos(cool[1] * RAD), coolB: cool[0] * Math.sin(cool[1] * RAD),
  };
}

const NIGHT = grade(0.4, 0.07, 0.4, [0.03, 255], [0.035, 270]);
const DAWN = grade(0.8, 0.03, 0.75, [0.028, 20], [0.03, 270]);
const MORNING = grade(0.985, 0.008, 0.94, [0.012, 70], [0.012, 250]);
const NOON = grade(1, 0, 1, [0, 0], [0, 0]);
const DUSK = grade(0.88, 0, 0.9, [0.024, 42], [0.035, 295]);

const DAY: readonly (readonly [number, Grade])[] = [
  [0, NIGHT], [0.12, NIGHT], [0.19, DAWN], [0.25, MORNING], [0.4, NOON], [0.62, NOON], [0.8, DUSK], [0.92, NIGHT], [1, NIGHT],
];

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
    warmA: l(g0.warmA, g1.warmA), warmB: l(g0.warmB, g1.warmB),
    coolA: l(g0.coolA, g1.coolA), coolB: l(g0.coolB, g1.coolB),
  };
}

function applyGrade(c: Lab, g: Grade, overcast: number): Lab {
  const w = smooth((c[0] - 0.35) / 0.5);
  let L = g.lift + g.gain * c[0];
  let a = c[1] * g.sat + w * g.warmA + (1 - w) * g.coolA;
  let b = c[2] * g.sat + w * g.warmB + (1 - w) * g.coolB;
  if (overcast > 0) {
    // Flat grey light: less contrast, less colour, a little darker and cooler.
    const pivot = g.lift + g.gain * 0.62;
    L = pivot + (L - pivot) * (1 - 0.22 * overcast) - 0.03 * overcast * g.gain;
    const k = 1 - 0.4 * overcast;
    a = a * k - 0.001 * overcast;
    b = b * k - 0.007 * overcast;
  }
  // Keep terrain clear of the dragon's vermilion and gold: a chroma cap over
  // the reserved hues, feathered out over the 18° to either side.
  const chroma = Math.sqrt(a * a + b * b);
  if (chroma > TERRAIN_CHROMA_CAP) {
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
    // Tones 0–7: the flow phase of a river. Tones 8–14: a 1 px stream, quieter. Tone 15: the foam of a fall.
    for (let t = 0; t < 8; t++) {
      const wave = Math.cos((t / 8) * 2 * Math.PI);
      out[t] = [base[0] - 0.011 + 0.011 * wave, base[1] * (1.15 - 0.15 * wave), base[2] * (1.15 - 0.15 * wave)];
    }
    for (let t = 8; t < 15; t++) out[t] = [base[0] - 0.045, base[1] * 0.62, base[2] * 0.62];
    out[15] = [0.975, base[1] * 0.22, base[2] * 0.22];
    return out;
  }
  const blue = lab([1, 1, spec.coolHue ?? 265]);
  const shade: Lab = [
    base[0] * (1 - spec.drop),
    base[1] * 0.9 + spec.cool * blue[1],
    base[2] * 0.9 + spec.cool * blue[2],
  ];
  const light: Lab = [
    Math.min(0.99, base[0] + (1 - base[0]) * spec.rise + 0.02),
    base[1] * 0.9 + (spec.warm ?? 0.034) * LIGHT_YELLOW[1],
    base[2] * 0.9 + (spec.warm ?? 0.034) * LIGHT_YELLOW[2],
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

/** The whole table for one moment: 256 materials × 256 light bytes. */
export function buildPalette(o: PaletteOptions): Palette {
  const pal = new Uint32Array(256 * 256);
  const g = gradeAt(o.time);
  const overcast = o.overcast < 0 ? 0 : o.overcast > 1 ? 1 : o.overcast;
  const ink = applyGrade(lab(INK), g, overcast);
  const paper = pack(applyGrade(lab(PAPER), g, overcast));
  pal.fill(paper);

  // Graded tones per material and shadow depth, before ink.
  const tones: Lab[][][] = new Array(MATERIAL_COUNT);
  for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
    const r = ramp(SPECS[mat], o.season);
    // Water keeps its own depth ramp; land darks are lifted once, after shade and shadow have both been laid.
    const land = SPECS[mat].ramp === "land";
    tones[mat] = [0, 1, 2, 3].map((depth) => r.map((c) => {
      const s = shadowed(c, depth, overcast);
      return applyGrade(land ? liftDark(s) : s, g, overcast);
    }));
  }

  // Lift the river until it clears every vegetation it may cross, at each shadow depth.
  for (let depth = 0; depth < 4; depth++) {
    let vegMax = 0;
    for (let mat = 0; mat < MATERIAL_COUNT; mat++) {
      if (isVegetation[mat] === 0 || snowCover(mat, o.season) > 0.25) continue;
      for (let t = 0; t <= RIVER_GUARD_TONE; t++) vegMax = Math.max(vegMax, lstar(pack(tones[mat][depth][t])));
    }
    // One lift for the whole ramp, so the flow streak keeps its shape.
    const river = tones[M.river][depth];
    for (let i = 0; i < 120; i++) {
      let lowest = Infinity;
      for (let t = 0; t < 16; t++) lowest = Math.min(lowest, lstar(pack(river[t])));
      if (lowest >= vegMax + RIVER_MARGIN + 0.5) break;
      for (let t = 0; t < 16; t++) river[t][0] = Math.min(1, river[t][0] + 0.004);
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
