import assert from "node:assert/strict";
import { test } from "node:test";
import { weatherClouds } from "./field.ts";
import { makeShapes, SHAPE_COUNTS } from "./shapes.ts";

const SEED = 3, N = 10240;
const shapes = makeShapes(SEED, SHAPE_COUNTS);
const clouds = weatherClouds(SEED, N, shapes);
/** The world's area in views (400 × 225 pixels is 400 × 281 cells). */
const VIEWS = (N * N) / (400 * 281.25);
const area = (i: number) => shapes[i].w * shapes[i].h;

test("the weather's clouds are the same for a seed, low, on the world, sorted north to south, each with a need", () => {
  assert.deepEqual(weatherClouds(SEED, N, shapes), clouds);
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    assert.equal(c.layer, "low");
    assert.ok(c.x >= 0 && c.x < N && c.y >= 0 && c.y < N);
    assert.ok(c.need !== undefined && c.need > 0 && c.need < 0.95, `need ${c.need}`);
    if (i > 0) assert.ok(clouds[i - 1].y <= c.y);
  }
});

test("a built sky is middling heaps, about two to a view, and the list stays short enough to walk each frame", () => {
  const heaps = clouds.filter((c) => shapes[c.shape].kind === "heap");
  const perView = heaps.length / VIEWS;
  assert.ok(perView > 1.5 && perView < 2.3, `${perView} heaps a view`);
  assert.ok(clouds.length < 2500, `${clouds.length} weather clouds`);
  // Broken, not a blanket: the heaps' boxes together are well under half the sky.
  const boxes = heaps.reduce((s, c) => s + area(c.shape), 0) / (N * 0.8 * N);
  assert.ok(boxes > 0.2 && boxes < 0.45, `heap boxes cover ${boxes}`);
  // The giants are left to the fair-weather sky: a gathering sky is many heaps, not one pasted on.
  const greatest = Math.max(...shapes.filter((sh) => sh.kind === "heap").map((sh) => sh.w * sh.h));
  for (const c of heaps) assert.ok(area(c.shape) < 0.8 * greatest);
});

test("the sky closes in by steps: puffs first, then heaps, the small before the great", () => {
  const showing = (cloud: number) => clouds.filter((c) => c.need! < cloud);
  const kinds = (cs: typeof clouds, kind: string) => cs.filter((c) => shapes[c.shape].kind === kind).length;
  assert.equal(kinds(showing(0.1), "heap"), 0);
  assert.ok(kinds(showing(0.1), "puff") > 0);
  let last = 0;
  for (const cloud of [0.25, 0.5, 0.75, 1]) {
    const n = kinds(showing(cloud), "heap");
    assert.ok(n > last * (cloud < 1 ? 1.25 : 1), `${n} heaps at ${cloud} after ${last}`);
    last = n;
  }
  assert.equal(showing(1).length, clouds.length);
  const heaps = clouds.filter((c) => shapes[c.shape].kind === "heap");
  const mean = (cs: typeof clouds) => cs.reduce((s, c) => s + area(c.shape), 0) / cs.length;
  assert.ok(mean(heaps.filter((c) => c.need! < 0.4)) < 0.8 * mean(heaps.filter((c) => c.need! > 0.7)));
});

test("no two of the weather's heaps stand on one another", () => {
  const heaps = clouds.filter((c) => shapes[c.shape].kind === "heap");
  const cell = N / Math.round((28 * N) / 6400);
  for (let i = 0; i < heaps.length; i++) for (let j = i + 1; j < heaps.length && heaps[j].y - heaps[i].y < cell * 0.2; j++) {
    const dx = Math.abs(heaps[i].x - heaps[j].x);
    assert.ok(Math.min(dx, N - dx) > cell * 0.05, `heaps ${i} and ${j}`);
  }
});

test("a puff comes before its heap and stands at its foot, so the heap grows where there was cloud", () => {
  const heaps = clouds.filter((c) => shapes[c.shape].kind === "heap");
  const puffs = clouds.filter((c) => shapes[c.shape].kind === "puff");
  assert.ok(puffs.length > 0.2 * heaps.length && puffs.length < 0.4 * heaps.length, `${puffs.length} puffs`);
  const gap = (a: number, b: number, ring = N) => {
    const d = Math.abs(a - b) % ring;
    return Math.min(d, ring - d);
  };
  for (const p of puffs) {
    const ps = shapes[p.shape];
    const host = heaps.find((h) => {
      const hs = shapes[h.shape];
      // Boxes touching on screen, the puff's base within a few pixels of the heap's.
      return gap(p.x + ps.w / 2, h.x + hs.w / 2) < (ps.w + hs.w) / 2 && gap(0.8 * p.y + ps.h, 0.8 * h.y + hs.h, 0.8 * N) < 8
        && p.need! < h.need! && h.need! - p.need! < 0.21;
    });
    assert.ok(host, `puff at ${p.x},${p.y}`);
  }
});
