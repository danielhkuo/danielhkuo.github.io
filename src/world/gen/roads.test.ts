import assert from "node:assert/strict";
import { test } from "node:test";
import { islandIds, leastCostPath, type RoadInput, roadNetwork, type RoadParams } from "./roads.ts";

const P: RoadParams = { gradeMax: 0.12, slopeCost: 40, southBonus: 0.15, bridgeCost: 50, maxBridgeWidth: 4, turnCost: 0.5, extraEdges: 0.2 };

function flat(n: number, height = 5): RoadInput {
  return { n, cellsPerNode: 4, h: new Float64Array(n * n).fill(height), isSea: new Uint8Array(n * n), lake: new Uint8Array(n * n), riverWidth: new Uint8Array(n * n) };
}
const idx = (x: number, y: number, n: number) => y * n + x;
const xy = (i: number, n: number) => [i % n, Math.floor(i / n)];

function stepsAreLegal(inp: RoadInput, path: Uint32Array) {
  const n = inp.n;
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = xy(path[k - 1], n), [bx, by] = xy(path[k], n);
    let dx = bx - ax, dy = by - ay;
    if (dx > n / 2) dx -= n; if (dx < -n / 2) dx += n; if (dy > n / 2) dy -= n; if (dy < -n / 2) dy += n;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    assert.ok((adx <= 1 && ady <= 1 && adx + ady > 0) || (adx === 2 && ady === 1) || (adx === 1 && ady === 2), `step ${dx},${dy}`);
    const run = Math.sqrt(dx * dx + dy * dy) * inp.cellsPerNode;
    assert.ok(Math.abs(inp.h[path[k]] - inp.h[path[k - 1]]) / run <= P.gradeMax + 1e-9, "grade");
    assert.ok(!inp.isSea[path[k]] && !inp.lake[path[k]], "water");
  }
}

test("islandIds separates islands and joins across the wrap", () => {
  const n = 16, sea = new Uint8Array(n * n).fill(1);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) sea[idx(x, y, n)] = 0;
  for (let y = 9; y < 12; y++) { sea[idx(15, y, n)] = 0; sea[idx(0, y, n)] = 0; }
  const ids = islandIds(sea, new Uint8Array(n * n), n);
  assert.ok(ids[idx(3, 3, n)] >= 0 && ids[idx(15, 10, n)] >= 0);
  assert.notEqual(ids[idx(3, 3, n)], ids[idx(15, 10, n)]);
  assert.equal(ids[idx(15, 10, n)], ids[idx(0, 10, n)]);
  assert.equal(ids[idx(8, 8, n)], -1);
});

test("on flat land a path is near-straight", () => {
  const n = 64, inp = flat(n), path = leastCostPath(inp, P, idx(5, 10, n), idx(30, 25, n))!;
  assert.ok(path);
  assert.equal(path[0], idx(5, 10, n));
  assert.equal(path[path.length - 1], idx(30, 25, n));
  stepsAreLegal(inp, path);
  let len = 0;
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = xy(path[k - 1], n), [bx, by] = xy(path[k], n);
    let dx = bx - ax, dy = by - ay;
    if (dx > n / 2) dx -= n; if (dx < -n / 2) dx += n; if (dy > n / 2) dy -= n; if (dy < -n / 2) dy += n;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  assert.ok(len <= 1.08 * Math.sqrt(25 * 25 + 15 * 15), `length ${len}`);
});

test("a steep hill is climbed by switchbacks within the grade limit", () => {
  const n = 64, inp = flat(n, 0.5);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.sqrt((x - 32) ** 2 + (y - 32) ** 2);
    inp.h[idx(x, y, n)] = Math.max(0.5, 40 - 2 * d); // grade 0.5 per cell: far over the limit straight up
  }
  // To a shoulder 10 nodes from the summit (height 20): reachable only by a long climbing traverse.
  const path = leastCostPath(inp, P, idx(32, 60, n), idx(32, 42, n));
  assert.ok(path, "no path");
  stepsAreLegal(inp, path!);
  assert.ok(path!.length > 60, `too direct: ${path!.length}`);
});

test("roads never cross the sea; the wrap is used when shorter", () => {
  const n = 64, inp = flat(n);
  for (let y = 0; y < n; y++) inp.isSea[idx(32, y, n)] = 1;
  const path = leastCostPath(inp, P, idx(30, 10, n), idx(34, 10, n))!;
  assert.ok(path, "no path round the wrap");
  stepsAreLegal(inp, path);
  assert.ok(path.length < 70, `took ${path.length} steps`);
  for (let y = 0; y < n; y++) inp.isSea[idx(0, y, n)] = 1;
  assert.equal(leastCostPath(inp, P, idx(30, 10, n), idx(34, 10, n)), null);
});

test("a river of width 3 is bridged once; a width-1 stream is forded; width 6 blocks", () => {
  const n = 48;
  for (const [w, kind] of [[3, "bridge"], [1, "ford"], [6, "none"]] as const) {
    const inp = flat(n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x === 24) inp.riverWidth[idx(x, y, n)] = w;
    for (let y = 0; y < n; y++) inp.isSea[idx(0, y, n)] = 1; // close the wrap
    const roads = roadNetwork(inp, P, [idx(10, 20, n), idx(40, 20, n)]);
    if (kind === "none") { assert.equal(roads.length, 0); continue; }
    assert.equal(roads.length, 1);
    stepsAreLegal(inp, roads[0].path);
    assert.equal(roads[0].bridges.length, kind === "bridge" ? 1 : 0, `${w}`);
    assert.equal(roads[0].fords.length, kind === "ford" ? 1 : 0, `${w}`);
  }
});

test("the network connects every point on an island and never links islands", () => {
  const n = 64, inp = flat(n);
  for (let y = 0; y < n; y++) { inp.isSea[idx(0, y, n)] = 1; inp.isSea[idx(32, y, n)] = 1; }
  const pts = [idx(5, 5, n), idx(20, 40, n), idx(25, 10, n), idx(10, 60, n), idx(40, 5, n), idx(50, 50, n)];
  const roads = roadNetwork(inp, P, pts);
  const ids = islandIds(inp.isSea, inp.lake, n);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const r of roads) {
    assert.equal(ids[pts[r.a]], ids[pts[r.b]], "road between islands");
    stepsAreLegal(inp, r.path);
    parent[find(r.a)] = find(r.b);
  }
  for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) {
    if (ids[pts[i]] === ids[pts[j]]) assert.equal(find(i), find(j), `${i} and ${j} unconnected`);
  }
  assert.ok(roads.length >= 4, `${roads.length} roads`);
});

test("detours prefer the south-facing flank", () => {
  const n = 64, inp = flat(n, 0.5);
  // An east–west ridge along y = 32, both flanks at the same gentle grade; a pond on
  // the crest forces a detour, north or south. The south flank faces the camera.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) inp.h[idx(x, y, n)] = 20 - 0.3 * Math.abs(y - 32);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x - 32) ** 2 + (y - 32) ** 2 <= 36) inp.isSea[idx(x, y, n)] = 1;
  for (let y = 0; y < n; y++) inp.isSea[idx(0, y, n)] = 1;
  const path = leastCostPath(inp, P, idx(8, 32, n), idx(56, 32, n))!;
  assert.ok(path);
  stepsAreLegal(inp, path);
  let south = 0, north = 0;
  for (const i of path) { const y = Math.floor(i / n); if (y > 32) south++; else if (y < 32) north++; }
  assert.ok(south > 0 && north === 0, `south ${south} north ${north}`);
});

test("deterministic", () => {
  const n = 48, inp = flat(n), pts = [idx(3, 3, n), idx(40, 9, n), idx(20, 40, n), idx(44, 44, n)];
  assert.deepEqual(roadNetwork(inp, P, pts), roadNetwork(inp, P, pts));
});
