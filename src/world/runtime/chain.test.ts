import assert from "node:assert/strict";
import { test } from "node:test";
import { createChain } from "./chain.ts";

const N = 1280;
const ring = (d: number) => ((((d % N) + N * 1.5) % N) - N / 2);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(ring(a.x - b.x), ring(a.y - b.y));

test("on a straight flight the joints are evenly spaced behind the head, all facing the way it flies", () => {
  const c = createChain(N, 512);
  for (let k = 0; k <= 100; k++) c.push(100 + k, 200, 30);
  const j = c.joints(6, 8);
  assert.equal(j.length, 6);
  assert.deepEqual([j[0].x, j[0].y], [200, 200]);
  for (let i = 1; i < 6; i++) {
    assert.ok(Math.abs(j[i].x - (200 - 8 * i)) < 1e-6 && Math.abs(j[i].y - 200) < 1e-6, `joint ${i}`);
    assert.ok(Math.abs(j[i].heading) < 1e-6);
    assert.equal(j[i].alt, 30);
  }
});

test("after a turn the body follows the path the head took", () => {
  const c = createChain(N, 512);
  // East for 60 cells, then south for 60.
  for (let k = 0; k <= 60; k++) c.push(100 + k, 100, 20);
  for (let k = 1; k <= 60; k++) c.push(160, 100 + k, 20);
  const j = c.joints(12, 10);
  // Joints within the last 60 cells of path lie on the southward leg; beyond, on the eastward leg.
  for (const p of j.slice(0, 6)) assert.ok(Math.abs(p.x - 160) < 1e-6, `on the south leg: ${p.x}, ${p.y}`);
  for (const p of j.slice(7, 12)) assert.ok(Math.abs(p.y - 100) < 1e-6, `on the east leg: ${p.x}, ${p.y}`);
  assert.ok(Math.abs(j[0].heading - Math.PI / 2) < 1e-6, "the head faces south");
  assert.ok(Math.abs(j[11].heading) < 1e-6, "the tail still faces east");
  for (let i = 1; i < j.length; i++) assert.ok(dist(j[i], j[i - 1]) <= 10 + 1e-6, "path spacing never stretches the body");
});

test("the chain is continuous across the world's edge", () => {
  const c = createChain(N, 512);
  for (let k = 0; k <= 50; k++) c.push((N - 25 + k) % N, 300, 20);
  const j = c.joints(5, 10);
  assert.ok(Math.abs(j[0].x - 25) < 1e-6);
  assert.ok(Math.abs(j[3].x - (N - 5)) < 1e-6, `joint 3 at ${j[3].x}`);
  for (const p of j) assert.ok(p.x >= 0 && p.x < N);
});

test("joints past the remembered path continue straight back", () => {
  const c = createChain(N, 512);
  for (let k = 0; k <= 10; k++) c.push(500 + k, 500, 20);
  const j = c.joints(4, 8);
  assert.ok(Math.abs(j[3].x - (510 - 24)) < 1e-6 && Math.abs(j[3].y - 500) < 1e-6, `${j[3].x}, ${j[3].y}`);
});

test("memory is bounded", () => {
  const c = createChain(N, 64);
  for (let k = 0; k < 10000; k++) c.push((k * 1.5) % N, 400, 20);
  const j = c.joints(3, 5);
  assert.equal(j.length, 3);
  assert.ok(Math.abs(dist(j[0], j[1]) - 5) < 1e-6);
});

/** East for 30 cells, then south for 30: a path whose shape a forgetful chain cannot guess. */
function bent(c: ReturnType<typeof createChain>): void {
  for (let k = 0; k <= 30; k++) c.push(100 + k, 200, 30);
  for (let k = 1; k <= 30; k++) c.push(130, 200 + k, 30);
}

test("with a least step, a head that stops keeps the path it came by", () => {
  const c = createChain(N, 128, 0.5);
  bent(c);
  const before = c.joints(7, 8);
  for (let k = 0; k < 5000; k++) c.push(130, 230, 30);
  assert.deepEqual(c.joints(7, 8), before);
});

test("with a least step, a crawling head keeps its path and stays the first joint", () => {
  const c = createChain(N, 128, 0.5);
  bent(c);
  // Two cells in 2000 pushes: without the least step, 128 points would hold 0.13 cells of it.
  for (let k = 1; k <= 2000; k++) c.push(130, 230 + k * 0.001, 30 + k * 0.001);
  const j = c.joints(7, 8);
  assert.ok(Math.abs(j[0].y - 232) < 1e-9 && Math.abs(j[0].alt - 32) < 1e-9, `head at ${j[0].y}, ${j[0].alt}`);
  for (let i = 1; i <= 3; i++) assert.ok(Math.abs(j[i].x - 130) < 1e-6 && Math.abs(j[i].y - (232 - 8 * i)) < 1e-6, `joint ${i} at ${j[i].x}, ${j[i].y}`);
  // 48 cells back is 16 cells along the eastward leg.
  assert.ok(Math.abs(j[6].y - 200) < 1e-6 && Math.abs(j[6].x - (130 - 16)) < 1e-6, `joint 6 at ${j[6].x}, ${j[6].y}`);
});

test("without a least step nothing changes: every push is a point", () => {
  const a = createChain(N, 128), b = createChain(N, 128, 0);
  for (let k = 0; k < 300; k++) {
    const x = 100 + 40 * Math.cos(k / 20), y = 200 + 40 * Math.sin(k / 20);
    a.push(x, y, 30);
    b.push(x, y, 30);
  }
  assert.deepEqual(a.joints(9, 6), b.joints(9, 6));
});

test("settling brings the body's heights down to the ground, a share at a time, as far back as it is asked", () => {
  const c = createChain(N, 256, 0.5);
  // South for 60 cells, sinking from 40 to 10.
  for (let k = 0; k <= 60; k++) c.push(300, 100 + k, 40 - k / 2);
  c.settle(() => 4, 0.5, 30, 1);
  let j = c.joints(7, 8);
  // The head keeps its own height; behind it, half the way down; past 30 cells, untouched.
  assert.equal(j[0].alt, 10);
  for (const i of [1, 2, 3]) assert.ok(Math.abs(j[i].alt - (10 + 4 * i + 4) / 2 - 0) < 1.01, `joint ${i} at ${j[i].alt}`);
  assert.ok(Math.abs(j[5].alt - 30) < 1e-9 && Math.abs(j[6].alt - 34) < 1e-9, `beyond reach: ${j[5].alt}, ${j[6].alt}`);
  let moved = Infinity;
  for (let k = 0; k < 40; k++) moved = c.settle(() => 4, 0.5, 30, 1);
  assert.ok(moved < 1e-6, `it says how far it last moved a point: ${moved}`);
  j = c.joints(31, 1);
  // Settled: it ramps down from the head's 10 at one unit a cell, then lies at 4.
  for (let i = 0; i <= 28; i++) assert.ok(Math.abs(j[i].alt - Math.max(4, 10 - i)) < 1e-3, `cell ${i} at ${j[i].alt}`);
});

test("a settled body bridges a drop no steeper than the slope it is given, and never dips under the ground", () => {
  const c = createChain(N, 256, 0.5);
  // East at 20 up for 50 cells, then down to the sea's level over the last ten.
  for (let k = 0; k <= 50; k++) c.push(300 + k, 100, 20);
  for (let k = 1; k <= 10; k++) c.push(350 + k, 100, 20 - 2 * k);
  // A cliff: ground at 12 west of x = 330, the sea at 0 east of it.
  const ground = (x: number) => (x < 330 ? 12 : 0);
  for (let k = 0; k < 60; k++) c.settle(ground, 0.5, 60, 1);
  const j = c.joints(61, 1);
  for (let i = 1; i <= 59; i++) {
    assert.ok(j[i].alt >= ground(j[i].x) - 1e-6, `cell ${i} under the ground: ${j[i].alt}`);
    assert.ok(Math.abs(j[i].alt - j[i - 1].alt) <= 1 + 1e-6, `cell ${i} steps ${j[i].alt - j[i - 1].alt}`);
  }
  // On the cliff top it lies at 12; twelve cells out from the edge it has ramped down to the sea.
  assert.ok(Math.abs(j[40].alt - 12) < 1e-3 && Math.abs(j[10].alt) < 1e-3, `${j[40].alt}, ${j[10].alt}`);
});
