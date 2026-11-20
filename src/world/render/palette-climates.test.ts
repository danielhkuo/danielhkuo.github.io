// The climates add materials and change none. The one way a new material could change an old colour is through the
// river: it is lifted until it stands RIVER_MARGIN L* over every vegetation it may cross, so new vegetation lighter in
// shade than the palest field of its season would lift it further, in every frame of the world. None is.

import assert from "node:assert/strict";
import { test } from "node:test";
import { LIGHT_SHADOW_SHIFT } from "../look/contract.ts";
import { isVegetation, MATERIAL as M, MATERIAL_NAMES, MATERIAL_COUNT } from "../look/materials.ts";
import { buildPalette, lstar, RIVER_GUARD_TONE, snowCover } from "./palette.ts";

/** The first material the climates added: every id from here on is theirs. */
const FIRST_NEW = M.tundraCool;

test("the climates' materials are added at the end", () => {
  assert.equal(FIRST_NEW, 102);
  assert.ok(MATERIAL_COUNT > FIRST_NEW);
});

test("no vegetation of the climates is lighter in shade than the palest older vegetation, in any light", () => {
  for (let s = 0; s < 8; s++) {
    for (const time of [0.25, 0.5, 0.8, 0.95]) {
      for (const overcast of [0, 0.6]) {
        const season = s / 8;
        const pal = buildPalette({ time, season, overcast });
        for (let depth = 0; depth < 4; depth++) {
          let old = 0, added = 0, which = "";
          for (let mat = 1; mat < MATERIAL_COUNT; mat++) {
            if (isVegetation[mat] === 0 || snowCover(mat, season) > 0.25) continue;
            for (let tone = 0; tone <= RIVER_GUARD_TONE; tone++) {
              const l = lstar(pal[(mat << 8) | tone | (depth << LIGHT_SHADOW_SHIFT)]);
              if (mat < FIRST_NEW) { if (l > old) old = l; } else if (l > added) { added = l; which = MATERIAL_NAMES[mat]; }
            }
          }
          assert.ok(added <= old, `season ${season} time ${time} overcast ${overcast} depth ${depth}: ${which} at ${added.toFixed(2)} over ${old.toFixed(2)}`);
        }
      }
    }
  }
});
