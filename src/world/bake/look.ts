// The look the bake is given: the cover table, scatter, material flags and a
// palette, bound to one world size.

import { cover } from "../cover.ts";
import type { Palette } from "../look/contract.ts";
import { isBuilt, isCanopy, isCrop, isLine, isWater, MATERIAL as M } from "../look/materials.ts";
import { scatterAt } from "../scatter.ts";
import type { Look } from "./cells.ts";

/**
 * Materials that never take ink: water, crops, sand and shingle, lines,
 * marsh, dunes, saltmarsh and its creeks, scree stones and flowers. Open grass is not here: a grassy ridge is still a
 * silhouette, and the fields of the farmed lowland are crops.
 */
export function noInkFlags(): Uint8Array {
  const out = new Uint8Array(256);
  for (let m = 0; m < 256; m++) if (isWater[m] || isCrop[m] || isLine[m]) out[m] = 1;
  for (const m of [M.sand, M.sandPale, M.shingle, M.marsh, M.reeds, M.flowerPale, M.flowerMauve, M.hedgeCrown, M.duneGrass, M.saltmarsh, M.saltCreek, M.screeStone]) out[m] = 1;
  // The climates: wet flats, pools and every kind of floating ice.
  for (const m of [M.sedge, M.bog, M.bogRed, M.pool, M.frostNet, M.packIce, M.packIceBlue, M.lakeIce, M.riverIce, M.crevasse]) out[m] = 1;
  // Sand, salt, gravel and bare earth are quiet as a beach is; a wadi is a line.
  for (const m of [M.desertSand, M.desertSandDeep, M.reg, M.salt, M.wadi, M.earthPale, M.earthRed, M.mud, M.tigerBush]) out[m] = 1;
  return out;
}

/** Standing water: sea and lakes. */
export function stillFlags(): Uint8Array {
  const out = new Uint8Array(256);
  out[M.sea] = out[M.seaClear] = out[M.lake] = 1;
  // Ice on the water is a shore too: land takes its coast line where it meets a floe or a frozen lake.
  out[M.packIce] = out[M.packIceBlue] = out[M.lakeIce] = 1;
  return out;
}

/** Snow, lit by its true normals. */
export function snowFlags(): Uint8Array {
  const out = new Uint8Array(256);
  out[M.snow] = out[M.snowLate] = 1;
  out[M.glacier] = out[M.iceFoot] = out[M.firn] = 1;
  return out;
}

/** The light washes: meadow, mown and ripe fields, dune grass. Paper shows through them in flecks. */
export function washFlags(): Uint8Array {
  const out = new Uint8Array(256);
  for (const m of [
    M.meadowCool, M.meadowMid, M.meadowWarm, M.wheat, M.barley, M.hay, M.ley, M.stubble,
    M.wheatRow, M.barleyRow, M.hayRow, M.leyStripe, M.stubbleRow, M.duneGrass,
    M.steppeCool, M.steppeMid, M.steppeWarm, M.savannaCool, M.savannaMid, M.savannaWarm,
  ]) out[m] = 1;
  return out;
}

/** Bare rock, whose walls the bake draws as strata: tops, benches and faces of every rock; not scree. */
export function rockFlags(): Uint8Array {
  const out = new Uint8Array(256);
  for (const m of [M.rockHard, M.rockSed, M.rockLime, M.rockSlate, M.cliffHard, M.cliffSed, M.cliffLime, M.cliffSlate, M.rockDesert, M.cliffDesert]) out[m] = 1;
  return out;
}

/** What a river's line is drawn in: water, and what a climate makes of a stream: a dry bed in the desert, ice in the cold. */
export function channelFlags(): Uint8Array {
  const out = new Uint8Array(256);
  for (let m = 0; m < 256; m++) if (isWater[m]) out[m] = 1;
  out[M.wadi] = out[M.riverIce] = 1;
  return out;
}

/** The world's look for a world of n cells, drawn through `palette`. */
export function worldLook(n: number, palette: Palette): Look {
  return {
    cover: (c, mask) => cover(c, mask, n),
    scatter: (c, groundMat, mask, riverDist) => scatterAt(c, groundMat, mask, riverDist, n),
    isWater, isCanopy, palette,
    isStill: stillFlags(),
    noInk: noInkFlags(),
    isSnow: snowFlags(),
    isWash: washFlags(),
    turf: M.pastureCool,
    barSand: M.sandPale,
    isRock: rockFlags(),
    apron: M.shingle,
    apronRock: M.boulder,
    isBuilt,
    isChannel: channelFlags(),
  };
}
