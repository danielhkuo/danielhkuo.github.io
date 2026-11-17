import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldWorld, loadMask, M_LAND, M_SEA, M_TREE, plainLook } from "../testing/bakefix.ts";
import { F_CANOPY, F_QUIET } from "./cells.ts";
import { bakeWindow, depthBase, tileCache } from "./chunk.ts";
import { INK_FULL, INK_SOFT, inkOcclusion, newPainted } from "./ink.ts";

const mask = loadMask();
const N = 512;

/** Ink (0–2) and source world row of each pixel of a baked window. */
function bake(height: (x: number, y: number) => number, x0: number, r0: number, w: number, h: number, trees = false) {
  const world = fieldWorld(N, height), look = plainLook(trees);
  const px = bakeWindow(world, look, mask, tileCache(world, look, mask, 12), x0, r0, w, h);
  const base = depthBase(r0);
  return {
    px,
    ink: (c: number, r: number) => (px[r * w + c] >>> 14) & 3,
    mat: (c: number, r: number) => px[r * w + c] & 255,
    y: (c: number, r: number) => base + (px[r * w + c] >>> 16) / 8,
  };
}

test("a smooth north-facing slope up to 0.8 gets no ink", () => {
  for (const slope of [0.3, 0.6, 0.75, 0.8]) {
    // Rises towards the south from y = 100 to y = 300, then stays level.
    const b = bake((_x, y) => 2 + slope * Math.min(200, Math.max(0, y - 100)), 64, 60, 128, 120);
    let onSlope = 0;
    for (let r = 0; r < 120; r++) for (let c = 0; c < 128; c++) {
      const y = b.y(c, r);
      if (y >= 110 && y <= 290) onSlope++;
      assert.equal(b.ink(c, r), 0, `slope ${slope}: ink at ${c},${r}`);
    }
    if (slope <= 0.6) assert.ok(onSlope > 500, `slope ${slope} is on screen (${onSlope} px)`);
  }
});

test("a ridge hiding three or more rows gets one clean 1 px line", () => {
  // A west–east ridge 30 high: a gentle south face the camera sees, and a north face of slope 3 behind it.
  const ridge = (_x: number, y: number) => 2 + Math.max(0, Math.min((330 - y) * 0.4, (y - 240) * 3, 30));
  const b = bake(ridge, 64, 150, 128, 120);
  for (let c = 0; c < 128; c++) {
    const rows: number[] = [];
    for (let r = 0; r < 120; r++) if (b.ink(c, r)) rows.push(r);
    assert.equal(rows.length, 1, `column ${c} has ${rows.length} ink pixels`);
    assert.equal(b.ink(c, rows[0]), INK_FULL);
    // The line is on the crest: ground just north of it is far behind.
    assert.ok(b.y(c, rows[0]) - b.y(c, rows[0] - 1) > 10);
  }
});

test("no ink on water, on 1 px steps or on gentle south-facing slopes", () => {
  // An island: a south-facing slope of 0.5 steps one pixel at a time down to a beach and the sea.
  const b = bake((_x, y) => (y < 200 ? 30 : Math.max(-3, 30 - 0.5 * (y - 200))), 64, 100, 128, 200);
  let sea = 0, land = 0;
  for (let r = 0; r < 200; r++) for (let c = 0; c < 128; c++) {
    if (b.mat(c, r) === M_SEA) sea++;
    else land++;
    assert.equal(b.ink(c, r), 0, `ink at ${c},${r}`);
  }
  assert.ok(sea > 1000 && land > 1000);
});

test("crowns ink against the ground behind them, never against each other or on quiet ground", () => {
  const p = newPainted(0, 0, 4, 3);
  // Row 1 holds four near pixels, each hiding five rows behind it; row 0 is what lies behind.
  p.hidden.fill(5, 4, 8);
  p.flags[0] = 0; p.flags[4] = F_CANOPY; // crown before ground
  p.flags[1] = F_CANOPY; p.flags[5] = F_CANOPY; // crown before crown
  p.flags[2] = 0; p.flags[6] = F_QUIET; // a river, field or beach
  p.flags[3] = 0; p.flags[7] = 0; // open ground
  p.hidden[7] = 12;
  inkOcclusion(p);
  assert.deepEqual([...p.ink.subarray(4, 8)], [INK_SOFT, 0, 0, INK_FULL]);
});

test("tall crowns on flat ground take soft ink only, on the crown", () => {
  const b = bake(() => 6, 64, 100, 96, 64, true);
  let soft = 0;
  for (let r = 0; r < 64; r++) for (let c = 0; c < 96; c++) {
    const k = b.ink(c, r);
    if (k === 0) continue;
    assert.equal(k, INK_SOFT);
    assert.equal(b.mat(c, r), M_TREE);
    soft++;
  }
  assert.ok(soft > 0, "crowns are outlined against the ground");
  let ground = 0;
  for (let r = 0; r < 64; r++) for (let c = 0; c < 96; c++) if (b.mat(c, r) === M_LAND) ground++;
  assert.ok(ground > 1000);
});
