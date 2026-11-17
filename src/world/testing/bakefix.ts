// Fixtures for bake tests: hand-shaped worlds, a plain Look and the blue-noise mask.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Look } from "../bake/cells.ts";
import { blankWorld, buildBakeWorld, type BakeWorld } from "../bake/world.ts";
import { paramsFor } from "../gen/params.ts";
import { planWorld } from "../gen/plan.ts";

export const M_SEA = 1;
export const M_RIVER = 4;
export const M_LAND = 5;
export const M_TREE = 9;

export function loadMask(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));
}

/** One land material, no scatter unless `trees` (a tall crown on every 16th cell of every 16th row). */
export function plainLook(trees = false): Look {
  const isWater = new Uint8Array(256), isCanopy = new Uint8Array(256);
  isWater[M_SEA] = isWater[3] = isWater[M_RIVER] = 1;
  isCanopy[M_TREE] = 1;
  return {
    cover: (c) => (c.water === 0 ? M_LAND : c.water === 3 ? M_RIVER : c.water === 2 ? 3 : M_SEA),
    scatter: (c) => (trees && c.x % 16 === 3 && c.y % 16 === 3 ? { x: c.x + 0.5, y: c.y + 0.5, r: 2.5, h: 9, mat: M_TREE, shape: 0 } : null),
    isWater, isCanopy, palette: new Uint32Array(65536),
  };
}

/** A world whose ground at G node (gx, gy) is `height(4gx + 2, 4gy + 2)`, in cells. No water unless the ground is ≤ 0. */
export function fieldWorld(n: number, height: (x: number, y: number) => number): BakeWorld {
  const w = blankWorld(n, 1);
  for (let gy = 0; gy < w.gN; gy++) for (let gx = 0; gx < w.gN; gx++) {
    const h = height(4 * gx + 2, 4 * gy + 2);
    w.ground[gy * w.gN + gx] = h;
    if (h <= 0) w.waterKind[gy * w.gN + gx] = 1;
  }
  return w;
}

let generated: BakeWorld | null = null;

/** A generated 1280-cell world (seed 7): the smallest whose bake space wraps on whole chunks. */
export function generatedWorld(): BakeWorld {
  if (!generated) {
    const params = paramsFor(1280);
    generated = buildBakeWorld({ params, plan: planWorld(params, 7), seed: 7 });
  }
  return generated;
}
