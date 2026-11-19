import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../../core/rng.ts";
import { DROPS, drops } from "./drops.ts";

const RATE = 48000;

test("the drops loop: seeded, at the bubble beds' level, seamless, and drops standing out of a hiss rather than a hiss", () => {
  const x = drops(DROPS, RATE, rngFor(3, "sound/drops"));
  assert.equal(x.length, Math.round(DROPS.seconds * RATE));
  assert.deepEqual(drops(DROPS, RATE, rngFor(3, "sound/drops")), x, "the same seed, the same drops");
  assert.notDeepEqual(drops(DROPS, RATE, rngFor(4, "sound/drops")), x, "another seed, other drops");
  let s2 = 0, s4 = 0;
  for (const v of x) {
    s2 += v * v;
    s4 += v ** 4;
  }
  const rms = Math.sqrt(s2 / x.length);
  assert.ok(Math.abs(rms - 0.1) < 1e-4, `rms ${rms}`);
  // The loop joins itself: the step across the seam is no bigger than a step anywhere (drops wrap round).
  let biggest = 0;
  for (let i = 1; i < x.length; i++) biggest = Math.max(biggest, Math.abs(x[i] - x[i - 1]));
  assert.ok(Math.abs(x[0] - x[x.length - 1]) <= biggest);
  // Drops over a hiss: far from noise (a kurtosis of 3), most drops standing well out of the hiss. (What keeps them from
  // being edges is the 8 ms they take to come up; the click check on the rain's renders is what guards that.)
  const kurtosis = s4 / x.length / (s2 / x.length) ** 2;
  assert.ok(kurtosis > 10, `kurtosis ${kurtosis}`);
  const w = Math.round(0.005 * RATE), m = Math.floor(x.length / w), e = new Float64Array(m);
  for (let b = 0; b < m; b++) {
    let p = 0;
    for (let i = b * w; i < (b + 1) * w; i++) p += x[i] * x[i];
    e[b] = 10 * Math.log10(p / w + 1e-20);
  }
  const median = [...e].sort((a, b) => a - b)[m >> 1];
  let out10 = 0;
  for (let b = 1; b < m - 1; b++) {
    if (!(e[b] >= e[b - 1] && e[b] > e[b + 1])) continue;
    if (e[b] - median >= 10) out10++;
  }
  const per = (k: number) => k / DROPS.seconds;
  assert.ok(per(out10) > 0.5 * DROPS.rate && per(out10) <= DROPS.rate, `${per(out10).toFixed(1)} drops a second 10 dB out of the hiss`);
});
