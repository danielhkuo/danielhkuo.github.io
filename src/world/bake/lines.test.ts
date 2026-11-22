import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldWorld, loadMask, M_RIVER, plainLook } from "../testing/bakefix.ts";
import { riverIndex, type BakeWorld } from "./world.ts";
import { bakeWindow, depthBase, tileCache } from "./chunk.ts";
import { forEachRiverPoint } from "./lines.ts";

const mask = loadMask();
const N = 512;

/** Lays a river through the centres of a chain of G nodes. */
function layRiver(w: BakeWorld, nodes: [number, number][], width: number): void {
  const v: number[] = [];
  for (const [gx, gy] of nodes) v.push(4 * gx + 2, 4 * gy + 2, width);
  w.rivers = riverIndex([{ vertices: v, stride: 3 }], w.n);
}

/** A river that wanders east, south-east, south and south-west across the window. */
function wandering(): [number, number][] {
  const nodes: [number, number][] = [];
  let x = 20, y = 30;
  const steps = [[1, 0], [1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [1, 0], [0, 1], [-1, 1], [0, 1], [1, 1]];
  for (let k = 0; k < 44; k++) {
    nodes.push([x, y]);
    const [dx, dy] = steps[k % steps.length];
    x += dx;
    y += dy;
  }
  return nodes;
}

function riverPixels(px: Uint32Array): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < px.length; i++) if ((px[i] & 255) === M_RIVER) set.add(i);
  return set;
}

/** Number of 8-connected components of a pixel set in a window w wide. */
function components(set: Set<number>, w: number): number {
  const left = new Set(set);
  let count = 0;
  for (const start of set) {
    if (!left.has(start)) continue;
    count++;
    const stack = [start];
    left.delete(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const c = i % w;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (c + dc < 0 || c + dc >= w) continue;
        const j = i + dr * w + dc;
        if (left.has(j)) { left.delete(j); stack.push(j); }
      }
    }
  }
  return count;
}

test("a river's raster is 8-connected at every width, and no ink falls on it", () => {
  for (const width of [1, 2, 4, 6]) {
    const world = fieldWorld(N, () => 4), look = plainLook();
    layRiver(world, wandering(), width);
    const W = 360, H = 300, x0 = 40, r0 = 60;
    const px = bakeWindow(world, look, mask, tileCache(world, look, mask, 12), x0, r0, W, H);
    const set = riverPixels(px);
    assert.ok(set.size > 150 * width, `width ${width}: ${set.size} px`);
    assert.equal(components(set, W), 1, `width ${width} is one piece`);
    for (const i of set) assert.equal((px[i] >>> 14) & 3, 0);
  }
});

test("the curve is emitted whole whatever rectangle asks for it", () => {
  const world = fieldWorld(N, () => 4);
  layRiver(world, wandering(), 2);
  const collect = (x0: number, y0: number, x1: number, y1: number) => {
    const pts = new Set<string>();
    forEachRiverPoint(world, x0, y0, x1, y1, (x, y, w, run) => {
      if (x >= 150 && x < 180 && y >= 150 && y < 180) pts.add(`${x.toFixed(6)},${y.toFixed(6)},${w},${run}`);
    });
    return pts;
  };
  const a = collect(150, 150, 180, 180), b = collect(0, 0, 400, 400);
  assert.ok(a.size > 10);
  assert.deepEqual(a, b);
  // And one world period away, to within rounding.
  const far = new Set<string>();
  forEachRiverPoint(world, 150 + N, 150, 180 + N, 180, (x, y, w, run) => {
    if (x - N >= 150 && x - N < 180 && y >= 150 && y < 180) far.add(`${(x - N).toFixed(6)},${y.toFixed(6)},${w},${run}`);
  });
  assert.deepEqual(far, a);
});

test("a river is never drawn on a ridge that hides it", () => {
  // The river runs west–east along world row ~200. South of it, between x = 180 and 260, a wall 40 high hides it.
  const yRiver = 50 * 4 + 2;
  const hill = (x: number, y: number) => 4 + (x >= 180 && x < 260 && y >= 216 && y < 240 ? 40 : 0);
  const world = fieldWorld(N, hill), look = plainLook();
  const nodes: [number, number][] = [];
  for (let gx = 20; gx < 90; gx++) nodes.push([gx, 50]);
  layRiver(world, nodes, 2);
  const W = 300, H = 120, x0 = 70, r0 = 100;
  const px = bakeWindow(world, look, mask, tileCache(world, look, mask, 12), x0, r0, W, H);
  const base = depthBase(r0);
  let open = 0, behind = 0;
  for (const i of riverPixels(px)) {
    const c = i % W, y = base + (px[i] >>> 16) / 8;
    // Every river pixel shows ground at the river, never the wall in front of it.
    assert.ok(Math.abs(y - yRiver) <= 8, `river pixel at depth ${y}`);
    if (x0 + c >= 195 && x0 + c < 245) behind++;
    else open++;
  }
  assert.ok(open > 200, "the river shows either side of the wall");
  assert.equal(behind, 0, "and not through it");
});
