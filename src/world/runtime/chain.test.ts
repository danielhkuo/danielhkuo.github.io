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
