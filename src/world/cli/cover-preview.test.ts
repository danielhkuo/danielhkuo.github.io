import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { worldLook } from "../bake/look.ts";
import { buildPalette } from "../render/palette.ts";
import { isCrop, isWater, MATERIAL_COUNT } from "../look/materials.ts";
import {
  busiest, cameraFrame, coverShares, mapWindow, paint, previewWorld, upscale, VIEW_H, VIEW_W,
} from "./cover-preview.ts";
import { encodePng } from "./png.ts";

const MASK = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));
const N = 1024;
const SEED = 7;

test("the preview maps and films the generator's real land, the same every time", () => {
  const { world, plan } = previewWorld(N, SEED);
  assert.equal(world.n, N);
  for (const v of world.debris) assert.ok(v >= 0 && v <= 1);
  const look = worldLook(N, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const core = plan.cores[0];
  const x0 = Math.round(core.x) - 96, y0 = Math.round(core.y) - 64;

  const map = mapWindow(world, look, MASK, x0, y0, 192, 128);
  assert.deepEqual(mapWindow(world, look, MASK, x0, y0, 192, 128), map);
  const seen = new Set<number>();
  let land = 0;
  for (const m of map.material) {
    assert.ok(m > 0 && m < MATERIAL_COUNT);
    seen.add(m);
    land += 1 - isWater[m];
  }
  assert.ok(land > 0 && seen.size >= 6, `${seen.size} materials, ${land} land cells`);
  // A window is the same cells whichever tiles it is cut from.
  const part = mapWindow(world, look, MASK, x0 + 40, y0 + 30, 60, 50);
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 60; x++) assert.equal(part.material[y * 60 + x], map.material[(y + 30) * 192 + x + 40]);
  }

  const rgba = paint(map, look.palette);
  assert.equal(rgba.length, 192 * 128 * 4);
  assert.ok(encodePng(rgba, 192, 128).length > 1000);
  assert.equal(upscale(rgba, 192, 128, 2).length, rgba.length * 4);

  const shares = coverShares(map, isWater, 0.02);
  assert.ok(shares.length >= 3);
  let total = 0;
  for (const line of shares) total += Number(line.split(" ")[1]);
  assert.ok(total > 50 && total <= 100.5);

  const at = busiest(map, isCrop);
  assert.ok(at.x >= 0 && at.x <= 192 && at.y >= 0 && at.y <= 128);
  const frame = cameraFrame(world, look, MASK, x0 + 96, y0 + 64);
  assert.equal(frame.length, VIEW_W * VIEW_H * 4);
  assert.deepEqual(cameraFrame(world, look, MASK, x0 + 96, y0 + 64), frame);
});
