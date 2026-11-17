import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldWorld, loadMask, M_SEA, M_TREE, plainLook } from "../testing/bakefix.ts";
import { F_CANOPY, F_QUIET } from "./cells.ts";
import { bakeWindow, depthBase, tileCache } from "./chunk.ts";
import { evenLines, INK_FULL, INK_SOFT, inkCliffs, inkCrests, inkOcclusion, newPainted, TARN_LEVEL } from "./ink.ts";
import { AUX_CREST_SHIFT, F_CLIFF } from "./cells.ts";

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
    assert.ok(b.ink(c, rows[0]) >= INK_FULL);
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
    if (b.mat(c, r) === M_SEA || (r + 1 < 200 && b.mat(c, r + 1) !== M_SEA)) assert.equal(b.ink(c, r), 0, `ink at ${c},${r}`);
  }
  assert.ok(sea > 1000 && land > 1000);
});

test("crowns ink against the ground behind them, never against each other or on quiet ground", () => {
  const p = newPainted(0, 0, 4, 3);
  // Row 1 holds four near pixels, each hiding five rows behind it; row 0 is what lies behind.
  p.hidden.fill(5, 4, 8);
  p.flags[0] = 0; p.flags[4] = F_CANOPY; // crown before ground: no ink either
  p.flags[1] = F_CANOPY; p.flags[5] = F_CANOPY; // crown before crown
  p.flags[2] = 0; p.flags[6] = F_QUIET; // a river, field or beach
  p.flags[3] = 0; p.flags[7] = 0; // open ground
  p.hidden[7] = 12;
  inkOcclusion(p);
  assert.deepEqual([...p.ink.subarray(4, 8)], [0, 0, 0, INK_FULL]);
});

test("crowns take no ink", () => {
  const b = bake(() => 6, 64, 100, 96, 64, true);
  let trees = 0;
  for (let r = 0; r < 64; r++) for (let c = 0; c < 96; c++) {
    assert.equal(b.ink(c, r), 0);
    if (b.mat(c, r) === M_TREE) trees++;
  }
  assert.ok(trees > 50);
});

test("a coast takes a thin line where land meets the sea, and the sea takes none", () => {
  // Land to the north, falling to the sea at about y = 260 on a slope steep enough not to be a beach.
  const b = bake((_x, y) => (y < 200 ? 30 : 30 - 0.5 * (y - 200)), 64, 150, 128, 120);
  let coast = 0;
  for (let r = 0; r < 119; r++) for (let c = 0; c < 128; c++) {
    if (b.mat(c, r) === M_SEA) assert.equal(b.ink(c, r), 0);
    else if (b.mat(c, r + 1) === M_SEA) { assert.ok(b.ink(c, r) > 0); coast++; }
  }
  assert.equal(coast, 128);
});

test("a dashed crest is evened into one line of one weight that tapers at its ends", () => {
  const p = newPainted(0, 0, 64, 16);
  // A break along row 8 from column 10 to 50, inked full in dashes of three with gaps of two.
  for (let c = 10; c <= 50; c++) {
    p.hidden[8 * 64 + c] = 12;
    if ((c - 10) % 5 < 3) p.ink[8 * 64 + c] = INK_FULL;
  }
  evenLines(p);
  for (let c = 10; c <= 50; c++) assert.ok(p.ink[8 * 64 + c] !== 0, `gap at column ${c}`);
  for (let c = 14; c <= 46; c++) assert.equal(p.ink[8 * 64 + c], INK_FULL, `weight at column ${c}`);
  assert.equal(p.ink[8 * 64 + 10], INK_SOFT);
  assert.equal(p.ink[8 * 64 + 50], INK_SOFT);
  // Nothing is inked off the break.
  let off = 0;
  for (let i = 0; i < p.ink.length; i++) if (p.ink[i] !== 0 && p.hidden[i] === 0) off++;
  assert.equal(off, 0);
});

test("a crest is inked only where the land breaks behind it", () => {
  const p = newPainted(0, 0, 32, 8);
  for (let c = 0; c < 32; c++) for (let r = 0; r < 8; r++) { p.y[r * 32 + c] = 100 + r; p.height[r * 32 + c] = 50; }
  // A crest across the view on row 4: the left half hides a row behind it, the right half hides nothing.
  for (let c = 4; c < 28; c++) {
    p.aux[4 * 32 + c] = 1 << AUX_CREST_SHIFT;
    if (c < 16) p.hidden[4 * 32 + c] = 1;
  }
  inkCrests(p);
  for (let c = 4; c < 28; c++) assert.equal(p.ink[4 * 32 + c], c < 16 ? INK_SOFT : 0, `column ${c}`);
});

test("a tarn takes a light line under its headwall only; a lowland lake a broken far shore; neither a ring", () => {
  const still = new Uint8Array(256);
  still[3] = 1;
  for (const level of [TARN_LEVEL + 20, 5]) {
    const p = newPainted(0, 0, 40, 20);
    p.mat.fill(1);
    p.height.fill(level + 1);
    // Water in rows 8–12, columns 10–29; the far shore's left half is a cliff.
    for (let r = 8; r <= 12; r++) for (let c = 10; c < 30; c++) { p.mat[r * 40 + c] = 3; p.height[r * 40 + c] = level; }
    for (let c = 10; c < 20; c++) p.flags[7 * 40 + c] = F_CLIFF;
    inkCliffs(p, still);
    let far = 0;
    for (let i = 0; i < p.ink.length; i++) {
      if (p.ink[i] === 0) continue;
      const r = Math.floor(i / 40), c = i % 40;
      assert.equal(r, 7, `ink off the far shore at ${c},${r}`);
      assert.equal(p.ink[i], INK_SOFT);
      if (c >= 20) far++;
    }
    for (let c = 10; c < 20; c++) assert.equal(p.ink[7 * 40 + c], INK_SOFT, `headwall at ${c}`);
    if (level > TARN_LEVEL) assert.equal(far, 0, "a tarn's gentle shore is bare");
    else assert.ok(far >= 4 && far < 10, `a lake's gentle far shore is broken (${far})`);
  }
});
