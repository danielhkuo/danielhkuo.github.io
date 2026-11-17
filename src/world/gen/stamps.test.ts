import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStamps, applyStampsTo, type Stamp, stampReach } from "./stamps.ts";

const cut: Stamp = { kind: "cut", x: 100, y: 100, r: 20, level: -2, fall: 0.1, cap: 12, slope: 0.8, reach: 40 };
const stack: Stamp = { kind: "stack", x: 60, y: 140, r: 6, top: 18 };
const cove: Stamp = { kind: "cove", x: 150, y: 60, r: 16, water: 9, base: 0.6, rise: 0.05, shelfSlope: 0.04 };
const beach: Stamp = { kind: "beach", x: 40, y: 40, land: 10, base: 0.6, rise: 0.05, shelf: 30, shelfSlope: 0.04 };
const mouth: Stamp = { kind: "mouth", x: 10, y: 10, dx: 0, dy: 1, area: 5000, form: "plain" };
const ALL: Stamp[] = [stack, beach, cut, mouth, cove];

/** A 200-cell world at one cell a node: land at `land`, with sea west of x = 40. */
function field(n: number, land: number): Float64Array {
  const h = new Float64Array(n * n).fill(land);
  for (let y = 0; y < n; y++) for (let x = 0; x < 40; x++) h[y * n + x] = -20;
  return h;
}
const at = (h: Float64Array, n: number, x: number, y: number): number => h[Math.floor(y) * n + Math.floor(x)];

test("a cut lowers ground within r to a platform that is `level` at the cliff foot, and caps the land behind", () => {
  const n = 200, h = field(n, 60);
  applyStamps(h, n, 1, [cut]);
  // Node (100, 100) is centred at (100.5, 100.5): 0.707 from the stamp.
  assert.ok(Math.abs(at(h, n, 100, 100) - (-2 * 0.7071 / 20 - 0.1 * (20 - 0.7071))) < 1e-3);
  assert.ok(Math.abs(at(h, n, 119, 100) - (-2 * (19.5 / 20) - 0.1 * 0.5)) < 0.01);
  // Just past r the land stands at the cap, then rises at the slope.
  assert.ok(Math.abs(at(h, n, 121, 100) - (12 + 0.8 * 1.5)) < 0.05);
  assert.ok(Math.abs(at(h, n, 140, 100) - (12 + 0.8 * 20.5)) < 0.05);
  assert.equal(at(h, n, 170, 100), 60);
  for (let i = 0; i < h.length; i++) assert.ok(h[i] <= 60);
});

test("a cut with no reach leaves the land behind it alone", () => {
  const n = 200, h = field(n, 60);
  applyStamps(h, n, 1, [{ ...cut, reach: 0 } as Stamp]);
  assert.ok(at(h, n, 110, 100) < 0);
  assert.equal(at(h, n, 121, 100), 60);
});

test("a stack is flat-topped, steep-sided and only ever raises", () => {
  const n = 200, h = field(n, 60);
  for (let i = 0; i < h.length; i++) h[i] = -5;
  applyStamps(h, n, 1, [stack]);
  assert.equal(at(h, n, 60, 140), 18);
  assert.equal(at(h, n, 62, 140), 18);
  const edge = at(h, n, 64, 140);
  assert.ok(edge > 0 && edge < 18);
  assert.equal(at(h, n, 67, 140), -5);
  let cells = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > 0) cells++;
  assert.ok(Math.abs(cells - Math.PI * 36) < 12, `${cells} cells`);
});

test("a beach lowers land to sand and raises the sea bed to a shelf no steeper than its slope", () => {
  const n = 200, h = field(n, 3);
  applyStamps(h, n, 1, [beach]);
  // Land east of the shore point at (40, 40).
  assert.ok(Math.abs(at(h, n, 45, 40) - (0.6 + 0.05 * Math.hypot(5.5, 0.5))) < 1e-9);
  assert.equal(at(h, n, 52, 40), 3);
  // Sea to the west: the bed is −0.04·d on the shelf.
  assert.ok(Math.abs(at(h, n, 30, 40) + 0.04 * Math.hypot(9.5, 0.5)) < 1e-9);
  for (let x = 12; x < 39; x++) {
    const a = at(h, n, x, 40), b = at(h, n, x + 1, 40);
    assert.ok(Math.abs(a - b) <= 0.04 + 1e-9);
  }
  // Past the shelf it falls away to the old bed.
  assert.equal(at(h, n, 39, 150), -20);
  assert.ok(at(h, n, 5, 40) < -1.2);
});

test("a cove is shallow water ringed by sand inside its radius", () => {
  const n = 200, h = field(n, 25);
  applyStamps(h, n, 1, [cove]);
  const mid = at(h, n, 150, 60);
  assert.ok(mid < -0.3 && mid > -1);
  const sand = at(h, n, 162, 60);
  assert.ok(sand > 0.6 && sand < 1.1);
  assert.equal(at(h, n, 168, 60), 25);
});

test("a mouth changes nothing", () => {
  const n = 200, h = field(n, 7), before = h.slice();
  applyStamps(h, n, 1, [mouth]);
  assert.deepEqual(h, before);
  assert.equal(stampReach(mouth), 0);
});

test("stamps are idempotent and do not depend on list order", () => {
  const n = 200, once = field(n, 30), twice = field(n, 30), shuffled = field(n, 30);
  applyStamps(once, n, 1, ALL);
  applyStamps(twice, n, 1, ALL);
  applyStamps(twice, n, 1, ALL);
  applyStamps(shuffled, n, 1, [...ALL].reverse());
  assert.deepEqual(twice, once);
  assert.deepEqual(shuffled, once);
  for (let i = 0; i < once.length; i++) assert.ok(Number.isFinite(once[i]));
});

test("stamps wrap: a stack on the corner lands on all four corners", () => {
  const n = 64, h = new Float64Array(n * n).fill(-3);
  applyStamps(h, n, 4, [{ kind: "stack", x: 0, y: 0, r: 5, top: 9 }]);
  for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) assert.equal(h[y * n + x], 9);
  let raised = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > 0) raised++;
  assert.equal(raised, 4);
});

test("the same stamps cut the same shapes at 4 cells a node and at 1", () => {
  const coarse = field(50, 30);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) coarse[y * 50 + x] = x < 10 ? -20 : 30;
  applyStamps(coarse, 50, 4, ALL);
  let land = 0, sea = 0;
  for (let i = 0; i < coarse.length; i++) if (coarse[i] > 0) land++; else sea++;
  const fine = field(200, 30);
  applyStamps(fine, 200, 1, ALL);
  let fineLand = 0;
  for (let i = 0; i < fine.length; i++) if (fine[i] > 0) fineLand++;
  // Same shapes at either resolution: the land share differs by under one part in a hundred.
  assert.ok(Math.abs(land / coarse.length - fineLand / fine.length) < 0.01, `${land / coarse.length} vs ${fineLand / fine.length}`);
  assert.ok(sea > 0);
});

test("a window of the world gets exactly the crop of the whole, across the wrap", () => {
  const n = 200, whole = field(n, 30);
  const edge: Stamp[] = [...ALL, { kind: "stack", x: 199, y: 2, r: 6, top: 14 }, { kind: "cut", x: 3, y: 198, r: 12, level: -2, fall: 0.1, cap: 12, slope: 0.8, reach: 10 }];
  applyStamps(whole, n, 1, edge);
  const x0 = 170, y0 = 180, w = 70, hgt = 50;
  const win = new Float64Array(w * hgt);
  const src = field(n, 30);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) win[y * w + x] = src[((y0 + y) % n) * n + ((x0 + x) % n)];
  applyStampsTo(win, { w, h: hgt, cellsPerNode: 1, x0, y0, period: n }, edge);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    assert.equal(win[y * w + x], whole[((y0 + y) % n) * n + ((x0 + x) % n)], `(${x}, ${y})`);
  }
});
