// The genie, after macOS: frame tests for its geometry. The window's sides bend into S-curves from its top corners down
// to a narrow neck below the screen; first its bottom is drawn down into the neck, then the rest flows through after
// it. The window is cut into horizontal bands, and each band is mapped onto a four-cornered piece of the funnel.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GENIE_MS, GENIE_SLOW, GENIE_SPLIT, genieBands, quadMatrix, type Band, type GenieSetup, type Point } from "./genie.ts";

const WIN = { x: 272, y: 80, w: 896, h: 548 };
const SETUP: GenieSetup = { win: WIN, neckX: 720, neckHalf: 22, floorY: 930 };
const N = 32;
const EPS = 1e-6;

const width = (b: Band, edge: "top" | "bottom"): number => (edge === "top" ? b.quad[1].x - b.quad[0].x : b.quad[2].x - b.quad[3].x);
const samples = Array.from({ length: 41 }, (_, i) => i / 40);

test("timing is a macOS genie's: about half a second, and ten times slower with Shift", () => {
  assert.ok(GENIE_MS >= 450 && GENIE_MS <= 700, `GENIE_MS ${GENIE_MS}`);
  assert.equal(GENIE_SLOW, 10);
  assert.ok(GENIE_SPLIT > 0.3 && GENIE_SPLIT < 0.55, "the bottom is drawn down for the first part, then the rest follows");
});

test("at t = 0 the bands tile the window exactly", () => {
  const bands = genieBands(SETUP, 0, N);
  assert.equal(bands.length, N);
  bands.forEach((b, k) => {
    const y0 = WIN.y + (k * WIN.h) / N, y1 = WIN.y + ((k + 1) * WIN.h) / N;
    assert.ok(Math.abs(b.from - (k * WIN.h) / N) < EPS && Math.abs(b.to - ((k + 1) * WIN.h) / N) < EPS, `band ${k} source rows`);
    const want: Point[] = [{ x: WIN.x, y: y0 }, { x: WIN.x + WIN.w, y: y0 }, { x: WIN.x + WIN.w, y: y1 }, { x: WIN.x, y: y1 }];
    b.quad.forEach((p, i) => assert.ok(Math.abs(p.x - want[i].x) < EPS && Math.abs(p.y - want[i].y) < EPS, `band ${k} corner ${i}`));
  });
});

test("the bands stay contiguous and cover the whole window, in order, at every moment", () => {
  for (const t of samples) {
    const bands = genieBands(SETUP, t, N);
    assert.ok(Math.abs(bands[0].from) < EPS && Math.abs(bands[N - 1].to - WIN.h) < EPS, `t=${t} covers the window's rows`);
    for (let k = 1; k < N; k++) {
      const a = bands[k - 1], b = bands[k];
      assert.ok(Math.abs(a.to - b.from) < EPS, `t=${t} rows ${k}`);
      // the bottom edge of one band is the top edge of the next
      assert.ok(Math.abs(a.quad[3].x - b.quad[0].x) < 1e-4 && Math.abs(a.quad[3].y - b.quad[0].y) < 1e-4, `t=${t} band ${k} left join`);
      assert.ok(Math.abs(a.quad[2].x - b.quad[1].x) < 1e-4 && Math.abs(a.quad[2].y - b.quad[1].y) < 1e-4, `t=${t} band ${k} right join`);
      assert.ok(b.quad[0].y >= a.quad[0].y - EPS, `t=${t} bands go down the screen in order`);
    }
  }
});

test("while the bottom is drawn down, the top edge holds its place and its width", () => {
  for (const t of samples.filter((s) => s < GENIE_SPLIT)) {
    const top = genieBands(SETUP, t, N)[0];
    assert.ok(Math.abs(top.quad[0].x - WIN.x) < EPS && Math.abs(top.quad[0].y - WIN.y) < EPS, `t=${t} top-left`);
    assert.ok(Math.abs(top.quad[1].x - (WIN.x + WIN.w)) < EPS && Math.abs(top.quad[1].y - WIN.y) < EPS, `t=${t} top-right`);
  }
});

test("the bottom edge goes down into the neck: steadily, and it is there by the split", () => {
  let last = -Infinity;
  for (const t of samples) {
    const bottom = genieBands(SETUP, t, N)[N - 1].quad[3].y;
    assert.ok(bottom >= last - EPS, `t=${t} the bottom never rises`);
    last = bottom;
  }
  const atSplit = genieBands(SETUP, GENIE_SPLIT, N)[N - 1];
  assert.ok(Math.abs(atSplit.quad[3].y - SETUP.floorY) < 0.5, "the bottom reaches the neck at the split");
  assert.ok(Math.abs(atSplit.quad[3].x - (SETUP.neckX - SETUP.neckHalf)) < 0.5, "bottom-left at the neck's left");
  assert.ok(Math.abs(atSplit.quad[2].x - (SETUP.neckX + SETUP.neckHalf)) < 0.5, "bottom-right at the neck's right");
});

test("the sides curve inward: nothing grows wider than the window, and lower edges are never wider than higher ones", () => {
  for (const t of samples) {
    const bands = genieBands(SETUP, t, N);
    let above = Infinity;
    for (const b of bands) {
      for (const p of b.quad) assert.ok(p.x >= WIN.x - 1e-4 && p.x <= WIN.x + WIN.w + 1e-4, `t=${t} inside the window's columns`);
      assert.ok(width(b, "top") >= -EPS && width(b, "bottom") >= -EPS, `t=${t} left of right`);
      assert.ok(width(b, "top") <= above + 1e-4 && width(b, "bottom") <= width(b, "top") + 1e-4, `t=${t} narrowing downward`);
      above = width(b, "bottom");
    }
  }
});

test("the curve is an S: it leaves the window's side gently and meets the neck gently", () => {
  const bands = genieBands(SETUP, GENIE_SPLIT, 200);
  const xs = bands.map((b) => b.quad[0].x);
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  // inward steps grow and then shrink again: largest in the middle, small at both ends
  const mid = Math.max(...steps.map(Math.abs));
  assert.ok(Math.abs(steps[0]) < mid / 3 && Math.abs(steps[steps.length - 1]) < mid / 3, "gentle at both ends");
});

test("at the end the whole window is through the neck, below the screen's edge", () => {
  for (const b of genieBands(SETUP, 1, N)) {
    for (const p of b.quad) assert.ok(p.y >= SETUP.floorY - 0.5, `${p.y} at or below the floor`);
    assert.ok(width(b, "top") <= 2 * SETUP.neckHalf + 0.5, "no wider than the neck");
  }
});

test("the same moment gives the same frame: it can run backwards by running t from 1 to 0", () => {
  for (const t of [0.13, 0.42, 0.77]) assert.deepEqual(genieBands(SETUP, t, N), genieBands(SETUP, t, N));
});

/** Applies a CSS matrix3d (column-major, as CSS writes it) to a point in the band's own coordinates. */
function apply(m: string, x: number, y: number): Point {
  const v = m.replace(/^matrix3d\(|\)$/g, "").split(",").map(Number);
  assert.equal(v.length, 16, "sixteen numbers");
  const X = v[0] * x + v[4] * y + v[12], Y = v[1] * x + v[5] * y + v[13], W = v[3] * x + v[7] * y + v[15];
  return { x: X / W, y: Y / W };
}

test("quadMatrix maps a band's rectangle onto its four corners, in perspective", () => {
  const quad: [Point, Point, Point, Point] = [{ x: 300, y: 500 }, { x: 1100, y: 510 }, { x: 900, y: 560 }, { x: 420, y: 555 }];
  const m = quadMatrix(896, 17, quad);
  const corners: Point[] = [apply(m, 0, 0), apply(m, 896, 0), apply(m, 896, 17), apply(m, 0, 17)];
  corners.forEach((p, i) => assert.ok(Math.abs(p.x - quad[i].x) < 1e-6 && Math.abs(p.y - quad[i].y) < 1e-6, `corner ${i}: ${p.x},${p.y}`));
  const id = quadMatrix(10, 20, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }]);
  const q = apply(id, 3, 7);
  assert.ok(Math.abs(q.x - 3) < 1e-9 && Math.abs(q.y - 7) < 1e-9, "a rectangle onto itself is the identity");
});
