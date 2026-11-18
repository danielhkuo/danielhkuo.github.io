import assert from "node:assert/strict";
import { test } from "node:test";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { buildTile } from "./cells.ts";
import { bakeChunk, tileCache } from "./chunk.ts";
import { worldLook } from "./look.ts";
import { cutWindow, strippedWorld, tileWindows, windowTileSource } from "./window.ts";
import { patchOf, type BakeWorld } from "./world.ts";

const mask = loadMask();

/** The generated 1280 world, plus one oxbow pond and one point bar so every vector kind is read. */
function world(): BakeWorld {
  const w = generatedWorld();
  const square = (x: number, y: number, s: number): number[] => [x, y, x + s, y, x + s, y + s, x, y + s];
  return {
    ...w,
    ponds: [...(w.ponds ?? []), patchOf(square(260, 1250, 14), 3)],
    bars: [...(w.bars ?? []), patchOf(square(1262, 300, 10), 0)],
  };
}

const G_GRIDS = ["ground", "base", "conform", "waterLevel", "waterKind", "hand", "shore"] as const;
const C_GRIDS = ["moisture", "wind", "exposure", "debris", "rock", "regions"] as const;

test("a window is cut from the whole world with wrapping, and its grids are window-sized", () => {
  const w = world();
  const { g, c } = tileWindows(w, 0, 4);
  const win = cutWindow(w, g, c);
  assert.deepEqual(win.gWin, g);
  assert.deepEqual(win.cWin, c);
  assert.equal(win.n, w.n);
  assert.equal(win.gN, w.gN);
  assert.equal(win.cN, w.cN);
  assert.equal(win.rivers, w.rivers, "vectors are shared");
  for (const k of G_GRIDS) {
    const src = w[k] as ArrayLike<number> | undefined, dst = win[k] as ArrayLike<number> | undefined;
    if (!src) continue;
    assert.equal(dst?.length, g.w * g.h, k);
    for (let y = 0; y < g.h; y += 7) for (let x = 0; x < g.w; x += 5) {
      const gx = (((g.x0 + x) % w.gN) + w.gN) % w.gN, gy = (((g.y0 + y) % w.gN) + w.gN) % w.gN;
      assert.equal((dst as ArrayLike<number>)[y * g.w + x], src[gy * w.gN + gx], `${k} at ${x},${y}`);
    }
  }
  for (const k of C_GRIDS) {
    const planes = k === "regions" ? 6 : 1;
    assert.equal((win[k] as ArrayLike<number>).length, c.w * c.h * planes, k);
  }
});

test("the whole world can be stripped of its grids", () => {
  const w = world(), s = strippedWorld(w);
  for (const k of [...G_GRIDS, ...C_GRIDS]) {
    const a = s[k] as ArrayLike<number> | undefined;
    if (a) assert.equal(a.length, 0, k);
  }
  assert.equal(s.rivers, w.rivers);
  assert.equal(s.n, w.n);
});

test("every tile baked from its window equals the tile baked from the whole world", () => {
  const w = world(), look = worldLook(w.n, buildPalette(MIDDAY));
  const nT = w.n / 256;
  for (let ty = 0; ty < nT; ty++) for (let tx = 0; tx < nT; tx++) {
    const { g, c } = tileWindows(w, tx, ty);
    const fromWindow = buildTile(cutWindow(w, g, c), look, mask, tx, ty);
    const fromWorld = buildTile(w, look, mask, tx, ty);
    for (const k of ["surf", "mat", "light", "flags", "aux"] as const) {
      assert.deepEqual(fromWindow[k], fromWorld[k], `tile ${tx},${ty}: ${k}`);
    }
  }
});

test("every chunk baked through window tiles, on a world without grids, equals the whole-world chunk", () => {
  const w = world(), look = worldLook(w.n, buildPalette(MIDDAY));
  const whole = tileCache(w, look, mask, 40);
  const windows = windowTileSource(w, (g, c) => cutWindow(w, g, c), look, mask, 40);
  const bare = strippedWorld(w);
  for (let cy = 0; cy < w.n / 320; cy++) for (let cx = 0; cx < w.n / 256; cx++) {
    const a = bakeChunk(bare, look, mask, windows, cx, cy);
    const b = bakeChunk(w, look, mask, whole, cx, cy);
    assert.deepEqual(a, b, `chunk ${cx},${cy}`);
  }
});

test("a tile's windows are fixed per tile and small: a worker can hold many", () => {
  const w = generatedWorld();
  const a = tileWindows(w, 2, 3), b = tileWindows(w, 2, 3);
  assert.deepEqual(a, b);
  assert.ok(a.g.w * a.g.h <= 128 * 128, `G window ${a.g.w}×${a.g.h}`);
  assert.ok(a.c.w * a.c.h <= 64 * 64, `C window ${a.c.w}×${a.c.h}`);
  // It covers the tile's own nodes.
  assert.ok(a.g.x0 <= 2 * 64 && a.g.x0 + a.g.w >= 3 * 64);
  assert.ok(a.g.y0 <= 3 * 64 && a.g.y0 + a.g.h >= 4 * 64);
});
