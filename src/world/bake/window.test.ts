import assert from "node:assert/strict";
import { test } from "node:test";
import { wrap } from "../core/torus.ts";
import { stampReach, type Stamp } from "../gen/stamps.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { buildTile } from "./cells.ts";
import { bakeChunk, tileCache } from "./chunk.ts";
import { worldLook } from "./look.ts";
import { cutWindow, stampReaches, strippedWorld, tileWindows, windowTileSource } from "./window.ts";
import { patchOf, type BakeWorld } from "./world.ts";

const mask = loadMask();

/** Cliff cuts 76 cells across: on the torus's corner, astride the corner of four 320-cell regions, and on the seam. */
const SEAM_CUTS: Stamp[] = [[0.5, 0.5], [320.25, 639.75], [1279.5, 960.5]].map(([x, y]) => ({
  kind: "cut", x, y, r: 26, level: -1.5, fall: 0.05, cap: 4, slope: 0.3, reach: 12,
}));

/** The generated 1280 world, plus one oxbow pond, one point bar and the seam cuts, so every vector kind is read. */
function world(): BakeWorld {
  const w = generatedWorld();
  const square = (x: number, y: number, s: number): number[] => [x, y, x + s, y, x + s, y + s, x, y + s];
  return {
    ...w,
    ponds: [...(w.ponds ?? []), patchOf(square(260, 1250, 14), 3)],
    bars: [...(w.bars ?? []), patchOf(square(1262, 300, 10), 0)],
    stamps: [...(w.stamps ?? []), ...SEAM_CUTS],
  };
}

/** Distance on a ring of n from v to the closed span [lo, lo + len]. */
function ringGap(v: number, lo: number, len: number, n: number): number {
  const d = wrap(v - lo, n);
  return d <= len ? 0 : Math.min(d - len, n - d);
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

test("a stamp reaches every window the bake would stamp it into, across the seam, and none far past its reach", () => {
  const n = 1280;
  let seed = 0x5eed;
  const rand = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  let near = 0, far = 0;
  for (let k = 0; k < 20000; k++) {
    const s: Stamp = { kind: "strand", x: rand() * n, y: rand() * n, nx: 1, ny: 0, r: 0.5 + rand() * 60, slope: 0.1 };
    const reach = stampReach(s);
    const w = 1 + Math.floor(rand() * 400), h = 1 + Math.floor(rand() * 400);
    // Windows that start anywhere from well before the stamp to well past it, some across the seam.
    const x0 = Math.floor(s.x - w - reach - 40 + rand() * (w + 2 * reach + 80)) + (rand() < 0.3 ? n : 0);
    const y0 = Math.floor(s.y - h - reach - 40 + rand() * (h + 2 * reach + 80)) - (rand() < 0.3 ? n : 0);
    const got = stampReaches(s, n, x0, y0, w, h);
    // The bake's own test (cells.ts stampsNear): the centre within the reach and 2 of the window, on the torus.
    const r = reach + 2;
    if (wrap(s.x - x0 + r, n) <= w + 2 * r && wrap(s.y - y0 + r, n) <= h + 2 * r) {
      near++;
      assert.ok(got, `stamp at ${s.x},${s.y} reach ${reach} misses window ${x0},${y0} ${w}×${h}`);
    }
    if (ringGap(s.x, x0, w, n) > reach + 8 || ringGap(s.y, y0, h, n) > reach + 8) {
      far++;
      assert.ok(!got, `stamp at ${s.x},${s.y} reach ${reach} reaches far window ${x0},${y0} ${w}×${h}`);
    }
  }
  assert.ok(near > 2000 && far > 2000, `near ${near}, far ${far}`);
});

test("a window holds, in world order, just the stamps that can reach its G window's cells", () => {
  const w = world();
  const nT = w.n / 256, per = w.n / w.gN;
  let most = 0;
  for (let ty = 0; ty < nT; ty++) for (let tx = 0; tx < nT; tx++) {
    const { g, c } = tileWindows(w, tx, ty);
    const kept = cutWindow(w, g, c).stamps ?? [];
    const want = (w.stamps ?? []).filter((s) => stampReaches(s, w.n, g.x0 * per, g.y0 * per, g.w * per, g.h * per));
    assert.equal(kept.length, want.length, `tile ${tx},${ty}: how many stamps`);
    assert.deepEqual(kept, want, `tile ${tx},${ty}`);
    most = Math.max(most, kept.length);
  }
  assert.ok(most < (w.stamps ?? []).length / 2, `a window holds ${most} of ${(w.stamps ?? []).length} stamps`);
  // The east tiles' windows run round the seam to the cut on the torus's corner.
  const { g, c } = tileWindows(w, nT - 1, 0);
  assert.ok(cutWindow(w, g, c).stamps?.includes(SEAM_CUTS[0]));
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
