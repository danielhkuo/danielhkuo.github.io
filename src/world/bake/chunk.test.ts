import assert from "node:assert/strict";
import { test } from "node:test";
import { bsplineAt } from "../core/bspline.ts";
import { createView } from "../runtime/view.ts";
import { fieldWorld, generatedWorld, loadMask, M_LAND, plainLook } from "../testing/bakefix.ts";
import { buildCells, upsampleGround } from "./cells.ts";
import { bakeChunk, bakeWindow, CHUNK, depthBase, paint, tileCache } from "./chunk.ts";
import { worldLook } from "./look.ts";

const standinLook = () => worldLook(1280, new Uint32Array(65536));

const mask = loadMask();

test("the ground upsample matches core/bspline.ts", () => {
  const w = generatedWorld();
  const src = Float64Array.from(w.ground);
  const out = new Float32Array(40 * 30);
  upsampleGround(w.ground, w.gN, -17, 1270, 40, 30, out);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
    const u = (x - 17 + 0.5) / 4 - 0.5, v = (1270 + y + 0.5) / 4 - 0.5;
    assert.equal(out[y * 40 + x], Math.fround(bsplineAt(src, w.gN, u, v)));
  }
});

test("cells: a window equals the same crop of a larger window, and of one a world period away", () => {
  const w = generatedWorld(), look = standinLook();
  // Find a busy spot: a window that holds both a river and trees.
  let x0 = 0, y0 = 0, small = buildCells(w, look, mask, 0, 0, 64, 64);
  for (let i = 0, tried = 0; i < w.riverWidth.length && tried < 60; i++) {
    if (w.riverWidth[i] < 2) continue;
    tried++;
    x0 = 4 * (i % w.gN) - 30;
    y0 = 4 * Math.floor(i / w.gN) - 30;
    small = buildCells(w, look, mask, x0, y0, 64, 64);
    if (small.mat.includes(4) && small.mat.some((m) => look.isCanopy[m] === 1)) break;
  }
  const big = buildCells(w, look, mask, x0 - 37, y0 - 21, 128, 128);
  const far = buildCells(w, look, mask, x0 + w.n, y0 - 2 * w.n, 64, 64);
  let crowns = 0, river = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = y * 64 + x, b = (y + 21) * 128 + x + 37;
    for (const k of ["surf", "mat", "light", "flags", "aux"] as const) {
      assert.equal(small[k][a], big[k][b], `${k} at ${x},${y}`);
      assert.equal(small[k][a], far[k][a], `${k} at ${x},${y} across the wrap`);
    }
    if (look.isCanopy[small.mat[a]]) crowns++;
    if (small.mat[a] === 4) river++;
  }
  assert.ok(crowns > 0 && river > 0, "the window holds trees and a river");
});

test("chunks: a chunk equals the same crop of a larger window", () => {
  const w = generatedWorld(), look = standinLook();
  const tiles = tileCache(w, look, mask, 40);
  // The chunk with the most land in it.
  let best = 0, bx = 0, by = 0;
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 5; cx++) {
    const px = bakeChunk(w, look, mask, tiles, cx, cy);
    let land = 0;
    for (let i = 0; i < px.length; i += 7) if (!look.isWater[px[i] & 255]) land++;
    if (land > best) { best = land; bx = cx; by = cy; }
  }
  const chunk = bakeChunk(w, look, mask, tiles, bx, by);
  const ox = 70, oy = 45, W = 400, H = 360;
  const x0 = bx * CHUNK - ox, r0 = by * CHUNK - oy;
  const win = bakeWindow(w, look, mask, tiles, x0, r0, W, H);
  // Depth is relative to each window's first world row.
  const shift = (depthBase(by * CHUNK) - depthBase(r0)) * 8;
  let ink = 0;
  for (let r = 0; r < CHUNK; r++) for (let c = 0; c < CHUNK; c++) {
    const a = chunk[r * CHUNK + c], b = win[(r + oy) * W + c + ox];
    assert.equal(a & 0xffff, b & 0xffff, `pixel ${c},${r}`);
    assert.equal((a >>> 16) + shift, b >>> 16, `depth ${c},${r}`);
    if ((a >>> 14) & 3) ink++;
  }
  assert.ok(ink > 20, "the chunk holds ink");
  // Deterministic: a second bake from a cold cache is identical.
  assert.deepEqual(bakeChunk(w, look, mask, tileCache(w, look, mask, 8), bx, by), chunk);
});

test("a view offset by one world period is byte-identical", () => {
  const w = generatedWorld(), look = standinLook();
  const a = createView(w, look, mask), b = createView(w, look, mask);
  const fa = new Uint32Array(400 * 225), fb = new Uint32Array(400 * 225);
  // Across the wrap corner.
  a.setCamera(20, 30);
  b.setCamera(20 + w.n, 30 - w.n);
  a.frame(fa);
  b.frame(fb);
  assert.deepEqual(fa, fb);
  assert.equal(a.depthAt(200, 100) - b.depthAt(200, 100), w.n);
});

test("the painter on a flat field shows, at every pixel, the nearest cell that projects there", () => {
  const level = 5;
  const w = fieldWorld(512, () => level), look = plainLook();
  const tiles = tileCache(w, look, mask, 8);
  const x0 = 100, r0 = 37, W = 64, H = 48;
  const p = paint(w, tiles, x0, r0, W, H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c, y = p.y[i];
    assert.equal(Math.floor((4 * y) / 5) - level, r0 + r, "the cell projects to this row");
    assert.notEqual(Math.floor((4 * (y + 1)) / 5) - level, r0 + r, "and no nearer cell does");
    assert.equal(p.mat[i], M_LAND);
    assert.equal(p.height[i], level);
    assert.equal(p.hidden[i], 0);
  }
  // Flat ground sits at FLAT_TONE, with no shadow and no ink.
  const px = bakeWindow(w, look, mask, tiles, x0, r0, W, H);
  for (const v of px) {
    const light = (v >>> 8) & 255;
    assert.equal(light & 15, 9);
    assert.equal(light >> 4, 0);
  }
});
