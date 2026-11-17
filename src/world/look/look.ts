// The Look the bake draws with: cover, scatter and palette behind the
// interface in bake/cells.ts.

import type { Look } from "../bake/cells.ts";
import { cover, WORLD_N } from "../cover.ts";
import { buildPalette } from "../render/palette.ts";
import { riverDistOf, scatterAt } from "../scatter.ts";
import type { CoverInput, PaletteOptions } from "./contract.ts";
import { isCanopy, isCrop, isLine, isWater, MATERIAL as M } from "./materials.ts";

/** Summer noon under a clear sky. */
export const NOON: PaletteOptions = { time: 0.5, season: 0.25, overcast: 0 };

/** Never inked: fields and their boundaries, beaches, wet ground, flowers. */
export const noInk: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let m = 0; m < 256; m++) if (isCrop[m] === 1 || isLine[m] === 1) t[m] = 1;
  for (const m of [M.sand, M.sandPale, M.shingle, M.marsh, M.reeds, M.flowerPale, M.flowerMauve]) t[m] = 1;
  return t;
})();

/** The look of a world of n cells at one moment. Swap the palette alone to change the hour or the season. */
export function worldLook(n: number = WORLD_N, o: PaletteOptions = NOON): Look {
  return {
    cover: (c: CoverInput, mask: Uint8Array) => cover(c, mask, n),
    scatter: (c: CoverInput, groundMat: number, mask: Uint8Array) => scatterAt(c, groundMat, mask, riverDistOf(c), n),
    isWater,
    isCanopy,
    noInk,
    palette: buildPalette(o),
  };
}
