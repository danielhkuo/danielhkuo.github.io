import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../core/rng.ts";
import { bytesEqual, chiSquare, components8, gridScore, inkShare, repeatScore, toneExtremes, toneImage } from "./gates.ts";

const px = (mat: number, tone: number, shadow = 0, ink = 0, depth = 0) => (mat | ((tone | (shadow << 4) | (ink << 6)) << 8) | (depth << 16)) >>> 0;

test("inkShare counts inked land pixels only", () => {
  const isWater = new Uint8Array(256); isWater[1] = 1;
  const p = new Uint32Array([px(5, 3, 0, 1), px(5, 3), px(5, 3, 0, 2), px(1, 3, 0, 2)]);
  assert.equal(inkShare(p, isWater), 2 / 3);
});

test("toneExtremes and toneImage", () => {
  const p = new Uint32Array([px(5, 0), px(5, 15), px(5, 7, 3, 3), px(5, 8)]);
  assert.equal(toneExtremes(p), 0.5);
  assert.deepEqual([...toneImage(p)], [0, 15, 7, 8]);
});

function noise(size: number, seed: number) {
  const r = rngFor(seed, "gates"), a = new Float32Array(size * size);
  for (let i = 0; i < a.length; i++) a[i] = r.float();
  return a;
}

test("gridScore: ~1 for noise, high for a lattice", () => {
  const size = 64, n = noise(size, 1);
  const s = gridScore(n, size);
  assert.ok(s > 0.5 && s < 1.5, `noise ${s}`);
  const lattice = n.map((v, i) => v * 0.3 + ((i % size) % 8 === 0 || Math.floor(i / size) % 8 === 0 ? 1 : 0));
  assert.ok(gridScore(lattice, size) > 3, `lattice ${gridScore(lattice, size)}`);
});

test("repeatScore: ~1 for noise, high when a tile repeats", () => {
  const w = 512, h = 32, base = noise(128, 2), img = new Float32Array(w * h), rnd = noise(512, 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = rnd[y * w + x];
  assert.ok(repeatScore(img, w, h, [128, 256]) < 1.25);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = base[y * 128 + (x % 128)];
  assert.ok(repeatScore(img, w, h, [128, 256]) > 2);
});

test("components8 joins diagonals", () => {
  const w = 5, m = new Uint8Array([
    1, 0, 0, 0, 1,
    0, 1, 0, 0, 1,
    0, 0, 1, 0, 0,
    0, 0, 0, 0, 0,
    1, 1, 0, 0, 1,
  ]);
  assert.equal(components8(m, w, 5), 4);
  assert.equal(components8(new Uint8Array(25), w, 5), 0);
});

test("chiSquare is 0 for equal histograms and grows with difference", () => {
  assert.equal(chiSquare([0.5, 0.5], [0.5, 0.5]), 0);
  assert.ok(chiSquare([1, 0], [0, 1]) > chiSquare([0.6, 0.4], [0.4, 0.6]));
  assert.equal(chiSquare([0, 1], [0, 1]), 0);
});

test("bytesEqual", () => {
  assert.ok(bytesEqual(new Uint32Array([1, 2]), new Uint32Array([1, 2])));
  assert.ok(!bytesEqual(new Uint32Array([1, 2]), new Uint32Array([1, 3])));
  assert.ok(!bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0])));
});
