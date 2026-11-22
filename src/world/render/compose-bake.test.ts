import assert from "node:assert/strict";
import { test } from "node:test";
import { compose, CHUNK, type ViewRect } from "./compose.ts";

const palette = new Uint32Array(65536);
for (let i = 0; i < palette.length; i++) palette[i] = (0xff000000 | i) >>> 0;
/** Chunk (cx, cy) holds a pixel value that names its chunk and position. */
function chunk(cx: number, cy: number): Uint32Array {
  const px = new Uint32Array(CHUNK * CHUNK);
  for (let i = 0; i < px.length; i++) px[i] = (((cx & 7) << 4) | (cy & 7) | ((i & 0xff) << 8) | ((i >>> 8) << 16)) >>> 0;
  return px;
}

test("compose can hand back the bake pixel under every output pixel", () => {
  const view: ViewRect = { x: 200, y: 100, w: 120, h: 70 };
  const out = new Uint32Array(view.w * view.h), bake = new Uint32Array(view.w * view.h);
  compose((cx, cy) => chunk(cx, cy), palette, view, out, undefined, undefined, bake);
  for (const [c, r] of [[0, 0], [55, 155 - 100], [119, 69], [56, 0]]) {
    const bx = view.x + c, by = view.y + r, cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK);
    const want = chunk(cx, cy)[(by - cy * CHUNK) * CHUNK + (bx - cx * CHUNK)];
    assert.equal(bake[r * view.w + c], want, `pixel ${c},${r}`);
    assert.equal(out[r * view.w + c], palette[((want & 255) << 8) | ((want >>> 8) & 255)]);
  }
});

test("where a chunk is missing, the bake pixel is 0 and the haze shows", () => {
  const view: ViewRect = { x: 0, y: 0, w: 300, h: 10 };
  const out = new Uint32Array(view.w * view.h), bake = new Uint32Array(view.w * view.h).fill(99);
  compose((cx) => (cx === 0 ? chunk(0, 0) : null), palette, view, out, undefined, () => 0xff123456, bake);
  assert.notEqual(bake[5], 0);
  assert.equal(bake[280], 0);
  assert.equal(out[280], 0xff123456);
});

test("without a bake buffer, compose is unchanged", () => {
  const view: ViewRect = { x: 10, y: 10, w: 50, h: 50 };
  const a = new Uint32Array(2500), b = new Uint32Array(2500);
  compose((cx, cy) => chunk(cx, cy), palette, view, a);
  compose((cx, cy) => chunk(cx, cy), palette, view, b, undefined, undefined, new Uint32Array(2500));
  assert.deepEqual(a, b);
});
