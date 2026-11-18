import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveFrame } from "./live.ts";
import { drawSprite, worldRowAt, type LiveSprite } from "./sprites.ts";

const W = 400, H = 225, N = 1280, GREY = 0xff808080, WHITE = 0xffffffff, BLACK = 0xff000000;

/** A frame over flat sea-level land: each pixel's bake depth puts it at world row by / 0.8. */
function frame(rx: number, ry: number, haze = false): LiveFrame {
  const bake = new Uint32Array(W * H);
  if (!haze) for (let r = 0; r < H; r++) {
    const by = ry + r, cy = Math.floor(by / 256);
    const depth = Math.round(((by - 256 * cy) / 0.8) * 8);
    for (let c = 0; c < W; c++) bake[r * W + c] = (5 | (9 << 8) | (depth << 16)) >>> 0;
  }
  return { out: new Uint32Array(W * H).fill(GREY), bake, rect: { x: rx, y: ry, w: W, h: H }, t: 0, palette: new Uint32Array(65536), n: N };
}
function sprite(w: number, h: number, rgba = WHITE, alpha = 255, ax = 0, ay = 0): LiveSprite {
  return { w, h, rgba: new Uint32Array(w * h).fill(rgba), alpha: new Uint8Array(w * h).fill(alpha), ax, ay };
}

test("worldRowAt reads the land's row from the bake, and sea level under haze", () => {
  const f = frame(0, 300);
  assert.ok(Math.abs(worldRowAt(f, 10, 50) - 350 / 0.8) < 0.2);
  const h = frame(0, 300, true);
  assert.equal(worldRowAt(h, 10, 50), 350 / 0.8);
});

test("a sprite's anchor sits on its world point, lifted by its height", () => {
  const f = frame(0, 0);
  // World (100, 150) at 10 up: screen (100, 0.8·150 − 10) = (100, 110). Anchor (2, 2) of a 5×3 sprite.
  drawSprite(f, sprite(5, 3, WHITE, 255, 2, 2), 100, 150, 10, false);
  assert.equal(f.out[110 * W + 100], WHITE);
  assert.equal(f.out[108 * W + 98], WHITE, "top-left");
  assert.equal(f.out[108 * W + 102], WHITE, "top-right");
  assert.equal(f.out[110 * W + 103], GREY);
  assert.equal(f.out[107 * W + 100], GREY);
});

test("land nearer the viewer hides it", () => {
  const f = frame(0, 0);
  // Make the rows the sprite covers show land 60 rows south of the sprite.
  for (let r = 100; r < 115; r++) for (let c = 90; c < 110; c++) f.bake[r * W + c] = (5 | (9 << 8) | (((150 + 60) * 8) << 16)) >>> 0;
  drawSprite(f, sprite(5, 3, WHITE, 255, 2, 2), 100, 150, 10, false);
  assert.ok(f.out.every((v) => v === GREY));
});

test("flip mirrors the sprite, and alpha blends", () => {
  const s = sprite(4, 1, WHITE, 255);
  s.rgba[3] = BLACK;
  const a = frame(0, 0), b = frame(0, 0);
  drawSprite(a, s, 50, 50, 0, false);
  drawSprite(b, s, 50, 50, 0, true);
  assert.equal(a.out[40 * W + 53], BLACK);
  assert.equal(b.out[40 * W + 50], BLACK);
  assert.equal(b.out[40 * W + 53], WHITE);
  const c = frame(0, 0);
  drawSprite(c, sprite(1, 1, WHITE, 128), 50, 50, 0, false);
  const r = c.out[40 * W + 50] & 255;
  assert.ok(Math.abs(r - (0x80 + (0xff - 0x80) * 128 / 255)) <= 1.01, `red ${r}`);
  assert.equal(c.out[40 * W + 50] >>> 24, 255);
});

test("sprites wrap with the world and clip at the frame's edge", () => {
  const f = frame(-10, 0);
  drawSprite(f, sprite(3, 1), N - 2, 50, 0, false);
  assert.equal(f.out[40 * W + 8], WHITE, "x = n − 2 shows at screen 8 when the view starts at −10");
  const g = frame(0, 0);
  drawSprite(g, sprite(6, 1), 397, 50, 0, false);
  assert.equal(g.out[40 * W + 399], WHITE);
  assert.equal(g.out[41 * W + 0], GREY, "not wrapped onto the next row");
  // Bake rows wrap every 0.8·n = 1024: a sprite near the world's southern edge shows above a view just past the top.
  const top = frame(0, -60);
  drawSprite(top, sprite(1, 1), 30, (1024 - 20) / 0.8, 0, false);
  assert.equal(top.out[40 * W + 30], WHITE, "row −20 + 60");
});
