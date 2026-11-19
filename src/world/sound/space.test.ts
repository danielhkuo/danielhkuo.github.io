import assert from "node:assert/strict";
import { test } from "node:test";
import {
  airCutoff, BELLS, cutoffCents, distanceGain, dopplerCents, gainToDb, MEDIUM, offsetTo, PAN, panOf, panPair, reverbSend, SMALL, southCutoff,
  southGain, southOf, waveGain,
} from "./space.ts";

const near = (a: number, b: number, eps: number, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);

test("gain curves: full at ref, falling as the class says, faded out by max", () => {
  for (const c of [SMALL, MEDIUM, BELLS]) {
    assert.equal(distanceGain(c, 0), 1);
    assert.equal(distanceGain(c, c.ref), 1);
    // The fade starts at three quarters of max: there the curve is still the bare power law.
    near(distanceGain(c, 0.75 * c.max), Math.pow(c.ref / (0.75 * c.max), c.p), 1e-12);
    assert.equal(distanceGain(c, c.max), 0);
    assert.equal(distanceGain(c, 2 * c.max), 0);
    let last = 1;
    for (let d = c.ref; d <= c.max; d += c.max / 200) {
      const g = distanceGain(c, d);
      assert.ok(g <= last + 1e-12, "monotonic");
      last = g;
    }
  }
  near(gainToDb(distanceGain(SMALL, 50)), -6.02, 0.01);
});

test("the bells are about −18 dB at the start point, 1150 cells off", () => {
  near(gainToDb(distanceGain(BELLS, 1150)), -18, 0.3);
});

test("wave emitters fade out between 80 and 130 cells", () => {
  assert.equal(waveGain(10), 1);
  near(waveGain(60), 0.5, 1e-12);
  assert.equal(waveGain(130), 0);
});

test("air: cutoffs at 25, 100, 500 and 1000 cells", () => {
  near(airCutoff(25), 9487, 1);
  near(airCutoff(100), 4743, 1);
  near(airCutoff(500), 2121, 1);
  near(airCutoff(1000), 1500, 1e-9);
  assert.equal(airCutoff(1), 18000);
  assert.equal(airCutoff(1e6), 800);
  near(cutoffCents(2000), 1200, 1e-9);
  near(cutoffCents(500), -1200, 1e-9);
});

test("pan is 0 under the dragon, monotonic, and never over 0.85", () => {
  assert.equal(panOf(0, 0), 0);
  assert.equal(panOf(0, 500), 0);
  let last = -1;
  for (let dx = -5000; dx <= 5000; dx += 10) {
    const p = panOf(dx, 40);
    assert.ok(p > last, "monotonic");
    assert.ok(Math.abs(p) < PAN);
    last = p;
  }
  near(panOf(1e7, 0), PAN, 1e-6);
  near(panOf(-200, 0, true), -0.42 * (200 / Math.hypot(200, 30)), 1e-12);
  assert.ok(panOf(100, 0) > 0, "east is right");
});

test("pan and distance are measured from the dragon: nothing in them knows the camera", () => {
  // The same dragon and source, whatever the camera does, give the same numbers: the functions take no camera.
  const a = offsetTo(100, 100, 20, 160, 100, 0, 10240);
  assert.deepEqual([a.dx, a.dy, a.dz], [60, 0, 20]);
  near(a.d, Math.hypot(60, 20), 1e-12);
  // Across the seam the short way round is taken.
  const b = offsetTo(10, 10, 0, 10230, 10230, 0, 10240);
  assert.deepEqual([b.dx, b.dy], [-20, -20]);
});

test("the ground under the dragon reads b = 0; the south is duller and a little quieter", () => {
  assert.equal(southOf(0, 0), 0);
  assert.equal(southOf(50, -200), 0);
  assert.ok(southOf(0, 200) > 0.95);
  assert.equal(southCutoff(0), 1);
  near(southCutoff(1), 0.65, 1e-12);
  near(gainToDb(southGain(1)), -1.5, 1e-9);
});

test("a pan is an equal-power gain pair", () => {
  for (const p of [-1, -0.85, -0.3, 0, 0.5, 1]) {
    const [l, r] = panPair(p);
    near(l * l + r * r, 1, 1e-12);
  }
  const [l, r] = panPair(0);
  near(l, r, 1e-12);
  assert.ok(panPair(0.5)[1] > panPair(0.5)[0]);
  near(panPair(-1)[1], 0, 1e-12);
});

test("reverb send grows to three times with distance", () => {
  assert.equal(reverbSend(0.25, BELLS, 10), 0.25);
  near(reverbSend(0.25, BELLS, 5000), 0.75, 1e-12);
});

test("Doppler stays inside ±45 cents at any speed and is 0 when calm", () => {
  for (const v of [-1e6, -500, -78, 0, 78, 500, 1e6]) {
    const c = dopplerCents(v);
    assert.ok(Math.abs(c) <= 45);
    assert.equal(dopplerCents(v, true), 0);
  }
  // Cruising past the running train (closing at 78 cells a second): well under a semitone from approach to retreat.
  assert.ok(dopplerCents(78) - dopplerCents(-78) < 100);
  assert.ok(dopplerCents(78) > 0 && dopplerCents(-78) < 0);
});
