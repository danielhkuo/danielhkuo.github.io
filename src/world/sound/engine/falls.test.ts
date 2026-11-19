import assert from "node:assert/strict";
import { test } from "node:test";
import type { FallPoint, Pose } from "../types.ts";
import { createFallTracker, fallGain, tallness } from "./falls.ts";

const N = 10240;
const pose = (x: number, y: number): Pose => ({ t: 0, dt: 1 / 30, x, y, alt: 30, heading: 0, speed: 0, bank: 0, rest: 0 });
const fall = (x: number, y: number, run = 4, edge = 1): FallPoint => ({ x, y, h: 0, run, w: run * edge, edge });
const DT = 1 / 30;

test("tallness: 0 for a run of 6 rows or fewer, 1 from 18; a tall fall carries further", () => {
  assert.equal(tallness(4), 0);
  assert.equal(tallness(12), 0.5);
  assert.equal(tallness(30), 1);
  const p = pose(0, 0);
  assert.ok(fallGain(p, 300, 0, 0, 18, N) > 0 && fallGain(p, 350, 0, 0, 4, N) === 0);
});

test("a voice is its fall by place: it follows a fall that slides, at 250 ms, and never changes chain", () => {
  const tr = createFallTracker({ chains: 3, n: N });
  const p = pose(5000, 5000);
  tr.step(p, [fall(5020, 5000)], DT);
  assert.equal(tr.bound, 1);
  const v = tr.voices.find((x) => x.live)!;
  // The report slides 6 cells a step for ten steps (each within reach of the last): the same voice, no new bind.
  for (let k = 1; k <= 10; k++) tr.step(p, [fall(5020, 5000 - 6 * k)], DT);
  assert.equal(tr.bound, 1);
  assert.equal(tr.voices.filter((x) => x.live).length, 1);
  assert.equal(v.binds, 1);
  assert.equal(v.ty, 4940);
  assert.ok(v.y > 4940 && v.y < 5000, "its place eases after the report");
  for (let k = 0; k < 60; k++) tr.step(p, [fall(5020, 4940)], DT);
  assert.ok(Math.abs(v.y - 4940) < 0.1 && Math.abs(v.edge - 1) < 0.01);
  // Across the world's seam too.
  const seam = createFallTracker({ chains: 3, n: N });
  seam.step(pose(5, 5), [fall(N - 3, 5)], DT);
  seam.step(pose(5, 5), [fall(4, 5)], DT);
  assert.equal(seam.bound, 1);
});

test("two reports of one wide fall are one voice; a fall that leaves fades with its edge, then frees its chain", () => {
  const tr = createFallTracker({ chains: 3, n: N });
  const p = pose(5000, 5000);
  tr.step(p, [fall(5020, 5000, 8), fall(5026, 5001, 6)], DT);
  assert.equal(tr.voices.filter((x) => x.live).length, 1);
  for (let k = 0; k < 30; k++) tr.step(p, [fall(5020, 5000, 8)], DT);
  const v = tr.voices.find((x) => x.live)!;
  assert.ok(v.edge > 0.95);
  // No longer reported: its edge runs down, and the chain is free in about two seconds.
  let steps = 0;
  while (v.live && steps < 200) {
    tr.step(p, [], DT);
    steps++;
  }
  assert.ok(steps > 20 && steps < 70, `${steps} steps`);
});

test("three chains hold two falls; a third takes the spare only by beating the weaker by 6 dB for half a second", () => {
  const tr = createFallTracker({ chains: 3, n: N });
  const p = pose(5000, 5000);
  const a = fall(5030, 5000), b = fall(4930, 5000);
  for (let k = 0; k < 30; k++) tr.step(p, [a, b], DT);
  assert.equal(tr.bound, 2);
  // A third, no louder than the weaker: never bound, however long it is there.
  for (let k = 0; k < 60; k++) tr.step(p, [a, b, fall(5000, 5075)], DT);
  assert.equal(tr.voices.filter((x) => x.live).length, 2);
  assert.equal(tr.handovers, 0);
  // A tall one close by beats the far small one by far more than 6 dB: after half a second it crosses in.
  const c = fall(5010, 5040, 18);
  let steps = 0;
  while (tr.handovers === 0 && steps < 60) {
    tr.step(p, [c, a, b], DT);
    steps++;
  }
  assert.ok(Math.abs(steps * DT - 0.5) <= 2 * DT, `handed over after ${(steps * DT).toFixed(2)} s`);
  const rising = tr.voices.find((x) => x.live && x.dir > 0)!, falling = tr.voices.find((x) => x.live && x.dir < 0)!;
  assert.equal(falling.tx, b.x, "the weaker one makes way");
  // Equal power all the way: the two shares' squares (sin² of each) sum to one.
  for (let k = 0; k < 7; k++) {
    tr.step(p, [c, a, b], DT);
    const up = Math.sin((rising.mix * Math.PI) / 2), down = Math.sin((falling.mix * Math.PI) / 2);
    assert.ok(Math.abs(up * up + down * down - 1) < 1e-9);
  }
  for (let k = 0; k < 20; k++) tr.step(p, [c, a, b], DT);
  assert.ok(!falling.live && rising.dir === 0 && rising.mix === 1, "the old chain is the spare again");
  assert.equal(tr.voices.filter((x) => x.live).length, 2);
  // One chain fewer on touch: one sounding fall.
  const touch = createFallTracker({ chains: 2, n: N });
  for (let k = 0; k < 30; k++) touch.step(p, [a, b], DT);
  assert.equal(touch.voices.filter((x) => x.live).length, 1);
});
