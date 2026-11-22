import assert from "node:assert/strict";
import { test } from "node:test";
import { layerInsets, layerSize, layerTransform, toLayer, toScreen, type Turn } from "./turned.ts";

const W = 402;
const H = 714;

test("a quarter turn swaps the layer's sides; none keeps them", () => {
  assert.deepEqual(layerSize(W, H, 0), { w: W, h: H });
  assert.deepEqual(layerSize(W, H, 90), { w: H, h: W });
  assert.deepEqual(layerSize(W, H, -90), { w: H, h: W });
});

test("the layer's corners land on the screen's corners the way the visitor holds the phone", () => {
  // Turned anticlockwise (top of the phone to the left), the layer's top left is the screen's top right.
  assert.deepEqual(toScreen(0, 0, W, H, 90), { x: W, y: 0 });
  assert.deepEqual(toScreen(H, W, W, H, 90), { x: 0, y: H });
  // Turned clockwise, it is the screen's bottom left.
  assert.deepEqual(toScreen(0, 0, W, H, -90), { x: 0, y: H });
  assert.deepEqual(toScreen(H, W, W, H, -90), { x: W, y: 0 });
});

test("toLayer and toScreen undo each other for every turn", () => {
  for (const turn of [0, 90, -90] as Turn[]) {
    for (const [x, y] of [[0, 0], [W, H], [10, 600], [390, 20], [201, 357]]) {
      const l = toLayer(x, y, W, H, turn);
      assert.deepEqual(toScreen(l.x, l.y, W, H, turn), { x, y }, `${turn} ${x},${y}`);
    }
  }
});

test("the transform matches the mapping: the layer's x axis runs down the screen when turned anticlockwise", () => {
  assert.equal(layerTransform(W, H, 0), "none");
  assert.equal(layerTransform(W, H, 90), `translate(${W}px, 0) rotate(90deg)`);
  assert.equal(layerTransform(W, H, -90), `translate(0, ${H}px) rotate(-90deg)`);
  // One layer step right is one screen step down.
  const a = toScreen(100, 50, W, H, 90);
  const b = toScreen(101, 50, W, H, 90);
  assert.deepEqual({ x: b.x - a.x, y: b.y - a.y }, { x: 0, y: 1 });
});

test("insets follow the edges they belong to", () => {
  const i = { top: 1, right: 2, bottom: 3, left: 4 };
  assert.deepEqual(layerInsets(i, 0), i);
  // Turned anticlockwise, the screen's right edge is the layer's top.
  assert.deepEqual(layerInsets(i, 90), { top: 2, right: 3, bottom: 4, left: 1 });
  assert.deepEqual(layerInsets(i, -90), { top: 4, right: 1, bottom: 2, left: 3 });
});
