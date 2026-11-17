import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { paramsFor } from "../gen/params.ts";
import { planWorld } from "../gen/plan.ts";
import { isWater, MATERIAL_COUNT } from "../look/materials.ts";
import { APRON, coverAndScatter, paint, renderCoverPreview, standIn, upscale } from "./cover-preview.ts";
import { encodePng } from "./png.ts";

const MASK = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));
const N = 1024;
const SEED = 7;
const NOON = { time: 0.5, season: 0.25, overcast: 0 };

test("the preview renders a window of the test world, the same every time", () => {
  const plan = planWorld(paramsFor(N), SEED);
  const core = plan.cores[0];
  const win = { n: N, x0: Math.round(core.x) - 80, y0: Math.round(core.y) - 40, w: 160, h: 96 };
  const a = renderCoverPreview(plan, win, SEED, MASK, NOON);
  const b = renderCoverPreview(plan, win, SEED, MASK, NOON);
  assert.equal(a.rgba.length, 160 * 96 * 4);
  assert.deepEqual(a.rgba, b.rgba);
  assert.ok(a.stamps > 0);

  // Land and water both show, in more than a handful of materials, all of them real ids.
  const seen = new Set<number>();
  let water = 0;
  for (const m of a.material) {
    assert.ok(m > 0 && m < MATERIAL_COUNT);
    seen.add(m);
    water += isWater[m];
  }
  assert.ok(seen.size >= 8, `${seen.size} materials`);
  assert.ok(water < a.material.length);

  // Re-colouring the same bytes under another palette changes the picture, not its size.
  const dusk = paint(a.material, a.light, win.w, win.h, { time: 0.8, season: 0.5, overcast: 0.5 });
  assert.equal(dusk.length, a.rgba.length);
  assert.notDeepEqual(dusk, a.rgba);

  const big = upscale(a.rgba, win.w, win.h, 2);
  assert.equal(big.length, a.rgba.length * 4);
  assert.deepEqual(big.subarray(0, 4), a.rgba.subarray(0, 4));
  assert.ok(encodePng(a.rgba, win.w, win.h).length > 1000);
});

test("stand-in fields are in range and trees never stand in water", () => {
  const plan = planWorld(paramsFor(N), SEED);
  const core = plan.cores[1];
  const f = standIn(plan, { n: N, x0: Math.round(core.x) - 64, y0: Math.round(core.y) - 64, w: 128, h: 128 }, SEED);
  assert.equal(f.w, 128 + 2 * APRON);
  for (const field of [f.moisture, f.wind, f.exposure, f.debris]) {
    for (const v of field) assert.ok(v >= 0 && v <= 1);
  }
  for (let i = 0; i < f.w * f.h; i++) {
    assert.ok(f.hand[i] >= 0 && f.slope[i] >= 0 && Math.abs(f.northness[i]) <= 1.000001);
    let sum = 0;
    for (let a = 0; a < 6; a++) sum += f.region[a * f.w * f.h + i];
    assert.ok(Math.abs(sum - 1) < 1e-3, `region weights sum to ${sum}`);
  }
  const l = coverAndScatter(f, MASK, N);
  for (let i = 0; i < f.w * f.h; i++) {
    if (f.water[i] !== 0) assert.equal(isWater[l.material[i]], 1, "a crown was stamped over water");
    else assert.equal(isWater[l.material[i]], 0);
  }
});
