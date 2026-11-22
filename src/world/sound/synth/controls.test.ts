import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../../core/rng.ts";
import { gcd } from "./noise.ts";
import { bandNoise, CONTROL_HZ, DRIFT_S, FLUTTER_S, GUST_S, makeControls, WHISTLE_DELAYS, WHISTLE_S } from "./controls.ts";

const c = makeControls(3);

function partial(x: Float32Array, k: number): number {
  let re = 0, im = 0;
  const w = (2 * Math.PI * k) / x.length;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im += x[i] * Math.sin(w * i);
  }
  return (re * re + im * im) / (x.length * x.length);
}

/** How well x matches itself round its loop at the best lag between `from` and `max` samples. */
function bestRepeat(x: Float32Array, from: number, max: number): number {
  let best = -1, sa = 0;
  for (let i = 0; i < x.length; i += 3) sa += (x[i] - 0.5) * (x[i] - 0.5);
  for (let lag = from; lag < max; lag += 7) {
    let s = 0;
    for (let i = 0; i < x.length; i += 3) s += (x[i] - 0.5) * (x[(i + lag) % x.length] - 0.5);
    best = Math.max(best, s / sa);
  }
  return best;
}

test("loop lengths as played: 61, 13, 47 and 97 s, sharing no factor", () => {
  assert.equal(c.gust[0].length, GUST_S * CONTROL_HZ);
  assert.equal(c.flutter[0].length, FLUTTER_S * CONTROL_HZ);
  assert.equal(c.whistle[0].length, WHISTLE_S * CONTROL_HZ);
  assert.equal(c.drift[0].length, DRIFT_S * CONTROL_HZ);
  const all = [GUST_S, FLUTTER_S, WHISTLE_S, DRIFT_S];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.equal(gcd(all[i], all[j]), 1);
  assert.deepEqual([c.gust.length, c.flutter.length, c.whistle.length, c.drift.length], [1, 2, 6, 2]);
});

test("every signal stays in its range and loops without a step", () => {
  const check = (x: Float32Array, lo: number, hi: number, name: string) => {
    let big = 0;
    for (let i = 0; i < x.length; i++) {
      assert.ok(x[i] >= lo && x[i] <= hi, `${name} in range`);
      if (i) big = Math.max(big, Math.abs(x[i] - x[i - 1]));
    }
    assert.ok(Math.abs(x[0] - x[x.length - 1]) <= big * 1.5 + 1e-6, `${name} seamless`);
  };
  check(c.gust[0], 0, 1, "gust");
  c.flutter.forEach((x, i) => check(x, 0, 1, `flutter ${i}`));
  c.whistle.forEach((x, i) => check(x, 0, 1, `whistle ${i}`));
  c.drift.forEach((x, i) => check(x, -1, 1, `drift ${i}`));
});

test("band noise holds nothing outside its band", () => {
  const x = bandNoise(13, 8, 14, rngFor(3, "sound/test/band"));
  const inBand = partial(x, 13 * 11), below = partial(x, 13 * 4), above = partial(x, 13 * 20);
  assert.ok(inBand > 1e-4);
  assert.ok(below < 1e-9 && above < 1e-9);
});

test("the gust is slow, uses its range, and never repeats inside its loop", () => {
  const g = c.gust[0];
  let lo = 1, hi = 0, crossings = 0;
  for (let i = 0; i < g.length; i++) {
    lo = Math.min(lo, g[i]);
    hi = Math.max(hi, g[i]);
    if (i && (g[i] - 0.5) * (g[i - 1] - 0.5) < 0) crossings++;
  }
  assert.ok(lo < 0.2 && hi > 0.8, `range ${lo} … ${hi}`);
  // A gust every few seconds: between 10 and 60 crossings of the middle in 61 s.
  assert.ok(crossings >= 10 && crossings <= 60, `crossings ${crossings}`);
  // No lag between 3 s and 58 s at which it matches itself: nothing periodic for the ear to catch.
  assert.ok(bestRepeat(g, 3 * CONTROL_HZ, 58 * CONTROL_HZ) < 0.6);
});

test("the two ears' flutters are their own", () => {
  const [l, r] = c.flutter;
  let s = 0, sl = 0, sr = 0;
  for (let i = 0; i < l.length; i++) {
    s += (l[i] - 0.5) * (r[i] - 0.5);
    sl += (l[i] - 0.5) * (l[i] - 0.5);
    sr += (r[i] - 0.5) * (r[i] - 0.5);
  }
  assert.ok(Math.abs(s / Math.sqrt(sl * sr)) < 0.25);
});

test("squalls are rare, last a second or three, and reach each whistle later than the last", () => {
  for (let w = 0; w < 3; w++) {
    const q = c.whistle[2 * w + 1];
    let on = 0, runs = 0;
    for (let i = 0; i < q.length; i++) {
      if (q[i] > 0.05) on++;
      if (q[i] > 0.05 && !(q[(i || q.length) - 1] > 0.05)) runs++;
    }
    const share = on / q.length;
    assert.ok(share > 0.08 && share < 0.35, `whistle ${w} sounds ${Math.round(share * 100)} % of the time`);
    const mean = on / CONTROL_HZ / Math.max(1, runs);
    assert.ok(mean > 0.4 && mean < 4, `whistle ${w}: squalls of ${mean} s`);
  }
  // The gust channels are one wind, delayed.
  const d = Math.round((WHISTLE_DELAYS[1] - WHISTLE_DELAYS[0]) * CONTROL_HZ);
  const a = c.whistle[0], b = c.whistle[2];
  for (let i = 0; i < 2000; i += 97) assert.ok(Math.abs(a[i] - b[i + d]) < 1e-6);
});

test("the same seed gives the same controls; another seed, others", () => {
  assert.deepEqual(makeControls(3).gust[0], c.gust[0]);
  assert.notDeepEqual(makeControls(4).gust[0], c.gust[0]);
});
