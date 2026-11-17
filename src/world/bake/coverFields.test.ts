import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIFF_FULL, COVER_FIELDS_MARGIN, coverFields, FAN_REACH } from "./coverFields.ts";

/** Ground heights of a W × H window from a height function of world cells; the window starts at (ox, oy). */
function window(W: number, H: number, ox: number, oy: number, height: (x: number, y: number) => number): Float32Array {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = height(ox + x, oy + y);
  return g;
}

/** A hillside falling to the south: a gentle top, a short cliff across columns 60–90 only, and a gentle apron below it. */
function crag(x: number, y: number): number {
  const cliff = x >= 60 && x < 90;
  const top = 60 - 0.3 * (y - 40);
  if (y < 40) return 60 - 0.3 * (y - 40) + 0;
  if (!cliff) return top;
  // Eight cells of face at slope 2, then the apron at slope 0.5.
  return y < 48 ? 60 - 2 * (y - 40) : 44 - 0.5 * (y - 48);
}

const M = COVER_FIELDS_MARGIN;

test("a cliff feeds a fan that runs down the fall line, fades, and widens as it goes", () => {
  const W = 160, H = 120;
  const g = window(W, H, 0, 0, crag);
  const f = coverFields(g, W, H, M, M, W - 2 * M, H - 2 * M);
  const at = (x: number, y: number): number => f.cliffAbove[y * W + x];
  // On the face itself, full strength; just below it, nearly so; then fading to nothing by FAN_REACH.
  assert.equal(at(75, 44), 1);
  assert.ok(at(75, 49) > 0.6, `foot ${at(75, 49)}`);
  for (let d = 2; d < FAN_REACH; d++) assert.ok(at(75, 48 + d) <= at(75, 47 + d) + 1e-6, "the fan fades downhill");
  assert.ok(at(75, 48 + FAN_REACH - 2) > 0 && at(75, 48 + FAN_REACH - 2) < 0.45);
  assert.equal(at(75, 48 + FAN_REACH + 3), 0);
  // Nothing uphill of the cliff, and nothing on the open slope away from it.
  for (let y = M; y < 39; y++) assert.equal(at(75, y), 0);
  for (let y = M; y < H - M; y++) assert.equal(at(20, y), 0);
  // Every value is a share.
  for (const v of f.cliffAbove) assert.ok(v >= 0 && v <= 1);
});

test("a fan widens downhill", () => {
  // A cone: the fall line spreads, so a short cliff band high on it feeds a wider arc below.
  const cone = (x: number, y: number): number => {
    const r = Math.hypot(x - 80, y - 80);
    const face = r > 20 && r < 26 && Math.abs(x - 80) < 6 && y > 80;
    return 100 - 0.6 * r - (r >= 26 && Math.abs(x - 80) < 6 + (r - 26) && y > 80 ? 9 : face ? (r - 20) * 1.5 : 0);
  };
  const W = 160, H = 160;
  const f = coverFields(window(W, H, 0, 0, cone), W, H, M, M, W - 2 * M, H - 2 * M);
  const width = (y: number): number => {
    let n = 0;
    for (let x = M; x < W - M; x++) if (f.cliffAbove[y * W + x] > 0.05 && f.cliffAbove[y * W + x] < 1) n++;
    return n;
  };
  const near = width(108), far = width(113);
  assert.ok(near > 0 && far >= near, `fan is ${near} cells wide near the cliff and ${far} further down`);
});

test("relief is positive on a crest and negative in a gully", () => {
  const W = 80, H = 80;
  const ridge = coverFields(window(W, H, 0, 0, (x) => 50 - Math.abs(x - 40)), W, H, M, M, W - 2 * M, H - 2 * M);
  const gully = coverFields(window(W, H, 0, 0, (x) => 20 + Math.abs(x - 40)), W, H, M, M, W - 2 * M, H - 2 * M);
  assert.ok(ridge.relief[40 * W + 40] > 1.5);
  assert.ok(gully.relief[40 * W + 40] < -1.5);
  // A plane has none, whatever its slope.
  const plane = coverFields(window(W, H, 0, 0, (x, y) => 10 + 0.7 * x + 0.2 * y), W, H, M, M, W - 2 * M, H - 2 * M);
  for (let y = M; y < H - M; y++) for (let x = M; x < W - M; x++) assert.ok(Math.abs(plane.relief[y * W + x]) < 1e-3);
});

test("the fields depend only on nearby ground: any window gives the same cells", () => {
  const land = (x: number, y: number): number => crag(x, y) + 3 * Math.sin(x * 0.21) * Math.cos(y * 0.17) + (x > 110 && y > 30 && y < 40 ? (y - 30) * 2.2 : 0);
  const A = { ox: 0, oy: 0, W: 170, H: 130 };
  const B = { ox: 23, oy: 17, W: 120, H: 100 };
  const fa = coverFields(window(A.W, A.H, A.ox, A.oy, land), A.W, A.H, M, M, A.W - 2 * M, A.H - 2 * M);
  const fb = coverFields(window(B.W, B.H, B.ox, B.oy, land), B.W, B.H, M, M, B.W - 2 * M, B.H - 2 * M);
  let fans = 0;
  for (let y = M; y < B.H - M; y++) {
    for (let x = M; x < B.W - M; x++) {
      const ia = (y + B.oy - A.oy) * A.W + (x + B.ox - A.ox), ib = y * B.W + x;
      assert.equal(fb.cliffAbove[ib], fa.cliffAbove[ia], `cliffAbove differs at ${x + B.ox}, ${y + B.oy}`);
      assert.equal(fb.relief[ib], fa.relief[ia]);
      assert.equal(fb.steep[ib], fa.steep[ia]);
      assert.equal(fb.curve[ib], fa.curve[ia]);
      assert.equal(fb.form[ib], fa.form[ia]);
      if (fb.cliffAbove[ib] > 0 && fb.cliffAbove[ib] < 1) fans++;
    }
  }
  assert.ok(fans > 50, `${fans} fan cells compared`);
});

test("steep is the slope of the form: a plane reads its own slope, a gullied face its face, a crest its flanks", () => {
  const W = 90, H = 90;
  const run = (height: (x: number, y: number) => number) => coverFields(window(W, H, 0, 0, height), W, H, M, M, W - 2 * M, H - 2 * M);
  const mid = 45 * W + 45;
  // Planes of every aspect, to within a few per cent.
  for (const [ax, ay] of [[0.7, 0], [0, 0.7], [0.5, 0.5], [0.66, 0.24], [-0.3, 0.63]]) {
    const f = run((x, y) => 100 + ax * x + ay * y);
    const s = Math.hypot(ax, ay);
    assert.ok(Math.abs(f.steep[mid] - s) < 0.05 * s, `plane ${ax}, ${ay}: ${f.steep[mid]} for ${s}`);
    assert.ok(Math.abs(f.curve[mid]) < 1e-3);
    assert.ok(Math.abs(f.form[mid] - (100 + ax * 45 + ay * 45)) < 1e-3);
  }
  // A south face at slope 0.9 cut by gullies three units deep every five cells: the cell's slope swings, the form's does not.
  const gullied = (x: number, y: number): number => 200 - 0.9 * y - (x % 5 === 0 ? 3 : x % 5 === 1 || x % 5 === 4 ? 1.2 : 0);
  const g = run(gullied);
  let lo = Infinity, hi = -Infinity;
  for (let x = 30; x < 60; x++) {
    lo = Math.min(lo, g.steep[45 * W + x]);
    hi = Math.max(hi, g.steep[45 * W + x]);
  }
  assert.ok(lo > 0.8 && hi < 1.05 && hi - lo < 0.12, `steep runs ${lo} to ${hi} across the gullies`);
  // A sharp crest: the gradient is nil on it, but steep reads something of its flanks, and curve stands well above nought.
  const crest = run((x) => 80 - 0.6 * Math.abs(x - 45));
  assert.ok(crest.steep[mid] > 0.25, `crest ${crest.steep[mid]}`);
  assert.ok(crest.curve[mid] > 1.5 && run((x) => 20 + 0.6 * Math.abs(x - 45)).curve[mid] < -1.5);
});

test("a gully's wall on a moderate slope is no cliff: it feeds no scree", () => {
  const W = 90, H = 90;
  // Slope 0.8 with a deep notch: the notch's walls are far steeper than CLIFF_FEED, the form is not.
  const f = coverFields(window(W, H, 0, 0, (x, y) => 200 - 0.8 * y - (Math.abs(x - 45) < 2 ? 5 : 0)), W, H, M, M, W - 2 * M, H - 2 * M);
  for (const v of f.cliffAbove) assert.equal(v, 0);
});

test("sea cells neither feed nor hold scree, and a window without margin is refused", () => {
  const W = 80, H = 80;
  const g = window(W, H, 0, 0, (x, y) => (y > 50 ? -3 : crag(x + 35, y)));
  const f = coverFields(g, W, H, M, M, W - 2 * M, H - 2 * M);
  for (let y = 51; y < H; y++) for (let x = 0; x < W; x++) assert.equal(f.cliffAbove[y * W + x], 0);
  assert.throws(() => coverFields(g, W, H, 2, 2, W - 4, H - 4));
  assert.ok(CLIFF_FULL > 1.3);
});

test("a whole tile of cliffs stays cheap", () => {
  // The worst case: every cell a source or a fan. It must still take a few milliseconds, not seconds.
  const W = 340, H = 340;
  const g = window(W, H, 0, 0, (x, y) => 400 - 1.4 * y + 6 * Math.sin(x * 0.3) + 5 * Math.cos(y * 0.5));
  const t0 = process.hrtime.bigint();
  coverFields(g, W, H, M, M, W - 2 * M, H - 2 * M);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 400, `${ms.toFixed(0)} ms for a tile`);
});
