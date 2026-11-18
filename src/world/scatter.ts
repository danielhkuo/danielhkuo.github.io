// S9 scatter: the tree, bush, boulder or flower that stands on one cell, if
// any. A category places an instance where the blue-noise mask, read at the
// category's own offset, is under the cell's density; species, size and colour
// come from a hash of the cell, which hides the mask's 256-cell period.
// Blue noise has no clumps and no rows, so woods never look planted.

import { hash2 } from "./core/hash.ts";
import { gradNoise } from "./core/noise.ts";
import { HUE_CLASS, hueField, WORLD_N } from "./cover.ts";
import type { CoverInput, Stamp } from "./look/contract.ts";
import { isCrop, MATERIAL as M } from "./look/materials.ts";

/**
 * How far the nearest river cell lies due north and due south of a cell, in
 * cells; Infinity when there is none in reach. The camera looks from the
 * south, so a crown hides ground to its north: a tree standing south of a
 * river (the river is to its north) needs far more room than one on the
 * north bank.
 */
export interface RiverDist {
  /** Cells north (−y) to the river: this cell is on its south bank. */
  north: number;
  /** Cells south (+y) to the river: this cell is on its north bank. */
  south: number;
}

/** Peak densities, instances per cell. */
export const DENSITY = {
  broadleaf: 0.2,
  conifer: 0.22,
  pastureTree: 0.02,
  meadowTree: 0.006,
  marshTree: 0.012,
  /** Crowns per cell of hedge: close enough to read as a row, loose enough to break. */
  hedge: 0.4,
  shrub: 0.05,
  alderBank: 0.3,
  boulder: 0.02,
  flower: 0.02,
} as const;

/** One world height unit is one screen row and a world row is 0.8 of one, so a crown of height h hides 1.25 h cells to its north. */
export const SOUTH_CLEARANCE = 1.25;
/** Farmland alders stand with their crown edge within this many cells of the north bank. */
const ALDER_REACH = 2.6;

/** Densities at or under this are sparse: they clump, and leave room for boulders and flowers. */
const SPARSE = 0.05;

const TREE_OX = 233;
const TREE_OY = 71;
const ROCK_OX = 59;
const ROCK_OY = 163;
const FLOWER_OX = 113;
const FLOWER_OY = 19;

const SCATTER_SEED = 0x5ca77e4;
const DRIFT_SEED = 0xf10e4;
const CLUMP_SEED = 0xc0b5e;
const HEDGE_SEED = 0x4ed6e;
/** Lone trees on upland pasture and meadow are this share of the lowland's, and stand only in their clumps. */
const UPLAND_LONE = 0.45;
/** Sparse scatter outside a clump is this share of its peak density. */
const CLUMP_FLOOR = 0.03;
/** Lone trees stand in spinneys some SPINNEY_CELLS apart; in one they are this many times their mean density, crown to crown. */
const SPINNEY_CELLS = 30;
const SPINNEY_PEAK = 9;
/** Between spinneys the home lowland keeps the odd field tree: this share of the mean. */
const SPINNEY_FLOOR = 0.12;
/** Karst bushes grow in thickets, solid at the heart, some THICKET_CELLS apart, and not at all between. */
const THICKET_CELLS = 22;
const THICKET_PEAK = 6.5;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function inTriple(mat: number, base: number): boolean {
  return mat >= base && mat <= base + 2;
}

/** 0–1: how well trees do here. Rises with moisture, falls with wind; never anything else. */
function vigour(c: CoverInput): number {
  return (0.55 + 0.45 * clamp01((c.moisture - 0.4) / 0.25)) * (0.4 + 0.6 * clamp01((0.6 - c.wind) / 0.2));
}

/** 0 well below the tree line … 1 at it: the cold score cover.ts uses, less the highland's lower line. */
function altitude(c: CoverInput): number {
  const cold = c.e / 100 + 0.1 * (c.formNorth === undefined ? c.northness : c.formNorth);
  return clamp01((cold - 0.46 + 0.18 * (c.region[1] + c.region[3])) / 0.14);
}

/** Trees and bushes per cell on this ground. Monotone: more moisture never means fewer trees, more wind never more. */
export function treeDensity(c: CoverInput, groundMat: number): number {
  // Woods thin toward the tree line: the last ten units of height below it carry half the trees.
  if (groundMat === M.floorBroadleaf) return DENSITY.broadleaf * vigour(c) * (1 - 0.5 * altitude(c));
  if (groundMat === M.floorConifer) return DENSITY.conifer * vigour(c) * (1 - 0.5 * altitude(c));
  // Lone trees are a lowland thing: on the hill they are rare, and none stand near the tree line.
  const lone = c.region[0] > 0.5 ? 1 : UPLAND_LONE * (1 - altitude(c));
  if (inTriple(groundMat, M.pastureCool)) return DENSITY.pastureTree * vigour(c) * lone;
  if (inTriple(groundMat, M.meadowCool)) return DENSITY.meadowTree * vigour(c) * lone;
  if (groundMat === M.marsh) return DENSITY.marshTree;
  if (groundMat === M.hedge) return DENSITY.hedge;
  if (inTriple(groundMat, M.scrubCool)) return DENSITY.shrub * (0.5 + 0.5 * clamp01(c.moisture / 0.3));
  return 0;
}

/** Boulders per cell: the stonier parts of moor, heath and alpine ground. Scree draws its own stones flat: a fan is a wash, not a field of domes. */
export function boulderDensity(c: CoverInput, groundMat: number): number {
  // Elsewhere stones lie only where debris reaches: no debris, no boulders.
  if (inTriple(groundMat, M.moorCool) || inTriple(groundMat, M.heathCool)) return DENSITY.boulder * 0.7 * clamp01(c.debris * 2);
  if (inTriple(groundMat, M.alpineCool) || groundMat === M.snowLate) return DENSITY.boulder * 0.5 * clamp01(c.debris * 2);
  return 0;
}

/** Peak flower density on this ground; drifts thin it further. */
export function flowerDensity(groundMat: number): number {
  // Hay meadows and alpine meadows flower; grazed pasture does not.
  if (inTriple(groundMat, M.meadowCool) || inTriple(groundMat, M.alpineCool)) return DENSITY.flower;
  return 0;
}

function maskAt(mask: Uint8Array, x: number, y: number, ox: number, oy: number): number {
  return (mask[(((y + oy) & 255) << 8) | ((x + ox) & 255)] + 0.5) / 256;
}

/** Rows a stamp hides to its north, measured from its centre. A dome's shoulder reaches past 1.25 h. */
export function northReach(r: number, h: number, shape: number): number {
  const top = SOUTH_CLEARANCE * h;
  return shape === 0 ? Math.sqrt(r * r + top * top) : Math.max(r, top);
}

/**
 * 0–1: sparse things gather. Lone trees stand in copses and boulders in
 * boulder fields, 30–50 cells across, with a thin sprinkle between; an even
 * spread of dots would read as an orchard.
 */
function clump(x: number, y: number, n: number, salt: number, floor: number = CLUMP_FLOOR): number {
  const p = Math.max(1, Math.round(n / 44));
  const g = gradNoise(((x + 0.5) * p) / n + salt, ((y + 0.5) * p) / n, p, CLUMP_SEED);
  const t = clamp01((g - 0.12) * 3.2);
  return floor + (1 - floor) * t * t * (3 - 2 * t);
}

/**
 * How many times its mean density a sparse tree or bush stands at here.
 * Evenly spaced dots on open grass read as an orchard, or as savanna: the
 * trees of pasture are gathered into spinneys of a few crowns touching, and
 * the bushes of dry ground into thickets, with open sward between.
 */
function gathered(x: number, y: number, n: number, cells: number, from: number, peak: number, floor: number, salt: number): number {
  const p = Math.max(1, Math.round(n / cells));
  const g = gradNoise(((x + 0.5) * p) / n + salt, ((y + 0.5) * p) / n + 0.5 * salt, p, CLUMP_SEED + 1);
  const t = clamp01((g - from) * 7);
  return floor + (peak - floor) * t * t * (3 - 2 * t);
}

function farmed(c: CoverInput, groundMat: number): boolean {
  if (isCrop[groundMat] === 1 || groundMat === M.hedge) return true;
  return c.region[0] > 0.5 && (inTriple(groundMat, M.meadowCool) || inTriple(groundMat, M.pastureCool));
}

/**
 * The stamp rooted on this cell, or null. `groundMat` is the cell's cover;
 * `riverDist` keeps rivers in view; `n` is the world size the hue field tiles on.
 */
export function scatterAt(
  c: CoverInput,
  groundMat: number,
  mask: Uint8Array,
  riverDist?: RiverDist,
  n: number = WORLD_N,
): Stamp | null {
  if (c.water !== 0) return null;
  const x = Math.floor(c.x);
  const y = Math.floor(c.y);
  // Hash the wrapped cell, so a caller that hands in an unwrapped position gets the same tree.
  const h32 = hash2(x - Math.floor(x / n) * n, y - Math.floor(y / n) * n, SCATTER_SEED);
  const u1 = (h32 & 255) / 256;
  const u2 = ((h32 >>> 8) & 255) / 256;
  const u3 = ((h32 >>> 16) & 255) / 256;
  const u4 = (h32 >>> 24) / 256;
  const cx = x + 0.5 + (u2 - 0.5) * 0.6;
  const cy = y + 0.5 + (u3 - 0.5) * 0.6;
  const north = riverDist ? riverDist.north : Infinity;
  const south = riverDist ? riverDist.south : Infinity;

  const treeRoll = maskAt(mask, x, y, TREE_OX, TREE_OY);

  // Alders along the north bank of a farmland river, in loose clumps, and
  // only where the river is a river: a tree by every rill reads as a comb.
  if (south < 8 && c.riverWide === 1 && farmed(c, groundMat) && treeRoll < DENSITY.alderBank * clump(x, y, n, 0.23)) {
    const r = 1.2 + 0.6 * u1;
    const gap = south - r;
    if (gap >= 1 + (h32 & 1) && gap <= ALDER_REACH) {
      return { x: cx, y: cy, r, h: 1.2 * r + 1.5, mat: M.alder, shape: 0 };
    }
  }

  if (groundMat === M.hedge) {
    // A hedge: a row of small crowns with gaps, the odd hedgerow tree standing over it; whole stretches are missing.
    if (treeRoll >= DENSITY.hedge) return null;
    const hp = Math.max(1, Math.round(n / 28));
    if (gradNoise(((x + 0.5) * hp) / n, ((y + 0.5) * hp) / n, hp, HEDGE_SEED) < -0.22) return null;
    const tree = u4 > 0.93;
    const r = tree ? 1.6 + 0.7 * u1 : 0.9 + 0.5 * u1;
    const h = tree ? 1.2 * r + 1.5 : 1.3 + u3;
    if (north < northReach(r, h, 0) || south - r < 1) return null;
    return { x: cx, y: cy, r, h, mat: tree ? M.broadleafMid : M.hedgeCrown, shape: 0 };
  }

  let density = treeDensity(c, groundMat);
  // Sparse trees and bushes are gathered: a spinney's or a thicket's cells are dense, the sward between has next to none.
  if (density > 0 && density <= SPARSE) {
    density *= groundMat === M.marsh
      ? clump(x, y, n, 0, c.region[0] > 0.5 ? CLUMP_FLOOR : 0)
      : inTriple(groundMat, M.scrubCool)
        ? gathered(x, y, n, THICKET_CELLS, 0.14, THICKET_PEAK, 0, 0.41)
        : gathered(x, y, n, SPINNEY_CELLS, 0.3, SPINNEY_PEAK, c.region[0] > 0.5 ? SPINNEY_FLOOR : 0, 0.17);
  }
  if (treeRoll < density) {
    let r: number;
    let h: number;
    let mat: number;
    let shape = 0;
    if (groundMat === M.floorConifer) {
      r = 1 + 0.8 * u1;
      h = 3 * r;
      shape = 1;
      const v = hueField(x, y, HUE_CLASS.conifer, n) + (u4 - 0.5) * 1.1;
      mat = M.coniferCool + (v < 0.5 ? 0 : v < 1.5 ? 1 : 2);
    } else if (inTriple(groundMat, M.scrubCool)) {
      r = 0.8 + 0.6 * u1;
      h = 1 + u4;
      mat = M.shrub;
    } else if (groundMat === M.marsh) {
      r = 1.2 + 0.6 * u1;
      h = 1.2 * r + 1.5;
      mat = M.alder;
    } else {
      // Broadleaf: wider than tall, most crowns small, a few big. Lone field trees are the big ones.
      r = groundMat === M.floorBroadleaf ? 1.5 + 1.5 * u1 * u1 : 1.9 + 1.1 * u1;
      h = 1.2 * r + 1.5;
      const v = hueField(x, y, HUE_CLASS.broadleaf, n) + (u4 - 0.5) * 1.1;
      mat = M.broadleafCool + (v < 0.5 ? 0 : v < 1.5 ? 1 : 2);
    }
    // South of a river the whole crown must stay out of the river's sight line;
    // north of it the crown's edge keeps 1–2 cells back.
    if (north < northReach(r, h, shape) || south - r < 1 + (h32 & 1)) return null;
    return { x: cx, y: cy, r, h, mat, shape };
  }
  // A cell that grows trees grows nothing smaller: the canopy would hide it.
  if (density > SPARSE) return null;

  const rockRoll = maskAt(mask, x, y, ROCK_OX, ROCK_OY);
  const rocks = boulderDensity(c, groundMat);
  if (rockRoll < rocks && rockRoll < rocks * clump(x, y, n, 0.37)) {
    // Small and uneven: a boulder field, not a row of headstones.
    const r = 0.5 + 0.7 * u1 * u1;
    const h = 0.8 + 0.9 * u4;
    if (north < northReach(r, h, 0) || south < r) return null;
    return { x: cx, y: cy, r, h, mat: M.boulder, shape: 0 };
  }

  const flowers = flowerDensity(groundMat);
  if (flowers > 0 && maskAt(mask, x, y, FLOWER_OX, FLOWER_OY) < flowers) {
    // Flowers come in drifts a dozen or two cells across, with bare meadow between: never an even sprinkle.
    const p = Math.max(1, Math.round(n / 36));
    const drift = clamp01(4 * (gradNoise(((x + 0.5) * p) / n, ((y + 0.5) * p) / n, p, DRIFT_SEED) - 0.2));
    if (maskAt(mask, x, y, FLOWER_OX, FLOWER_OY) < flowers * drift) {
      return { x: x + 0.5, y: y + 0.5, r: 0.5, h: 0, mat: u1 < 0.6 ? M.flowerPale : M.flowerMauve, shape: 0 };
    }
  }
  return null;
}
