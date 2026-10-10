import assert from "node:assert/strict";
import { test } from "node:test";
import { drawFish } from "./build.ts";
import { selfIntersections, type Pt } from "./geometry.ts";
import { buildKeyframes, fitBox, layersAt, outlinePath, shapeAt, TIMELINE } from "./morph.ts";

/**
 * Card sizes the grid actually produces: three-up, the narrow three-up with a
 * wrapped name, one-up — and one on half pixels, which is what a card measures
 * on a 2x display in most window widths.
 */
const CARDS = [
  { w: 344, h: 208 },
  { w: 301, h: 236 },
  { w: 350, h: 265 },
  { w: 326.5, h: 207.5 },
];
const NAMES = ["skyspace", "leaf", "HoldTrue", "example-project"];

/** The fish area tank.ts would give a card: its padding box less a caption strip. */
const fishBox = (w: number, h: number) => ({ x: 20, y: 20, w: w - 40, h: h - 40 - 28 });

const keyframesFor = (name: string, w: number, h: number) => {
  const fish = drawFish(name);
  return buildKeyframes(fish, fitBox(fish.w, fish.h, fishBox(w, h)), w, h);
};

const pairs = (flat: Float32Array, n: number): Pt[] => Array.from({ length: n }, (_, i): Pt => [flat[2 * i], flat[2 * i + 1]]);

test("fitBox centres the largest fish that fits", () => {
  const box = { x: 20, y: 20, w: 304, h: 140 };
  const fit = fitBox(1000, 500, box);
  assert.equal(fit.scale, 0.28);
  assert.equal(fit.dx, 20 + (304 - 280) / 2);
  assert.equal(fit.dy, 20);
});

test("at rest the path is exactly the card's border", () => {
  for (const { w, h } of CARDS) {
    const { n, k0 } = keyframesFor("skyspace", w, h);
    const corners = new Set<string>();
    for (const [x, y] of pairs(k0, n)) {
      const onLine = x === 0.5 || y === 0.5 || x === w - 0.5 || y === h - 0.5;
      assert.ok(onLine, `${w}x${h}: ${x},${y} is off the border's centre line`);
      if ((x === 0.5 || x === w - 0.5) && (y === 0.5 || y === h - 0.5)) corners.add(`${x},${y}`);
    }
    assert.equal(corners.size, 4, `${w}x${h}: all four corners are vertices`);
  }
});

test("the path lands on the fitted silhouette", () => {
  const fish = drawFish("leaf");
  const fit = fitBox(fish.w, fish.h, fishBox(344, 208));
  const { n, k2 } = buildKeyframes(fish, fit, 344, 208);
  // Every silhouette vertex is in k2, in order; the extras are the four inserted corners.
  assert.ok(n >= fish.sil.length / 2 && n <= fish.sil.length / 2 + 4);
  let at = 0;
  for (let i = 0; i < fish.sil.length; i += 2) {
    const x = Math.fround(fish.sil[i] * fit.scale + fit.dx);
    const y = Math.fround(fish.sil[i + 1] * fit.scale + fit.dy);
    while (at < n && (k2[2 * at] !== x || k2[2 * at + 1] !== y)) at++;
    assert.ok(at < n, `silhouette vertex ${i / 2} missing from k2`);
  }
});

test("no in-between shape crosses itself", () => {
  for (const name of NAMES) {
    for (const { w, h } of CARDS) {
      const kf = keyframesFor(name, w, h);
      const points = new Float32Array(kf.n * 2);
      for (let step = 0; step <= 40; step++) {
        shapeAt(kf, (step / 40) * TIMELINE.outlineEnd, points);
        assert.equal(selfIntersections(pairs(points, kf.n)), 0, `${name} at ${w}x${h}, step ${step}`);
      }
    }
  }
});

test("the timeline starts on the border and ends on the fish", () => {
  const kf = keyframesFor("HoldTrue", 344, 208);
  const points = new Float32Array(kf.n * 2);
  shapeAt(kf, 0, points);
  assert.deepEqual(points, kf.k0);
  for (const t of [TIMELINE.outlineEnd, 1]) {
    shapeAt(kf, t, points);
    for (let i = 0; i < points.length; i++) assert.ok(Math.abs(points[i] - kf.k2[i]) < 1e-3, `t=${t}, coordinate ${i}`);
  }
  assert.match(outlinePath(points, kf.n), /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+)+Z$/);
});

test("copy leaves first, ink arrives after the outline has landed, hatching last", () => {
  assert.deepEqual(layersAt(0), { copy: 1, settle: 0, ink: 0, hatch: 0 });
  assert.deepEqual(layersAt(1), { copy: 0, settle: 1, ink: 1, hatch: 1 });
  const landed = layersAt(TIMELINE.outlineEnd);
  assert.equal(landed.copy, 0);
  assert.equal(landed.settle, 1);
  assert.equal(landed.ink, 0);
  assert.equal(landed.hatch, 0);
  const late = layersAt(0.85);
  assert.ok(late.ink > late.hatch && late.hatch > 0);
});
