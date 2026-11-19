import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../../core/rng.ts";
import { gaussianInto, gcd, noise, NOISE_RMS, SIGN_LOOPS, signLoop, stereoNoise, WAVE_LOOP } from "./noise.ts";

function corr(a: Float32Array, b: Float32Array, lag = 0): number {
  let sa = 0, sb = 0, sab = 0;
  const n = Math.min(a.length, b.length) - lag;
  for (let i = 0; i < n; i++) {
    sa += a[i] * a[i];
    sb += b[i + lag] * b[i + lag];
    sab += a[i] * b[i + lag];
  }
  return sab / Math.sqrt(sa * sb);
}

/** Power of x in the band round `hz`, by the Goertzel sum over a few neighbouring bins. */
function bandPower(x: Float32Array, rate: number, hz: number): number {
  let p = 0;
  const n = 16384;
  for (let b = -4; b <= 4; b++) {
    const k = Math.round((hz * n) / rate) + b * 7;
    const w = (2 * Math.PI * k) / n;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(w * i);
      im += x[i] * Math.sin(w * i);
    }
    p += re * re + im * im;
  }
  return p;
}

test("the five wave-noise loop lengths are pairwise coprime", () => {
  const all = [WAVE_LOOP, ...SIGN_LOOPS];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.equal(gcd(all[i], all[j]), 1, `${all[i]} and ${all[j]}`);
});

test("no pairing of the Gaussian loop and a sign loop realigns within 18 days at 48 kHz", () => {
  for (const s of SIGN_LOOPS) assert.ok((WAVE_LOOP * s) / 48000 / 86400 >= 18, `${s}`);
});

test("a Gaussian loop times a sign loop is white: flat spectrum, kurtosis near 3", () => {
  const g = gaussianInto(new Float32Array(WAVE_LOOP), rngFor(3, "sound/test/a"));
  const s = signLoop(SIGN_LOOPS[2], rngFor(3, "sound/test/s"));
  const x = new Float32Array(WAVE_LOOP);
  for (let i = 0; i < x.length; i++) x[i] = g[i] * s[i];
  let m2 = 0, m4 = 0;
  for (const v of x) {
    m2 += v * v;
    m4 += v * v * v * v;
  }
  m2 /= x.length;
  m4 /= x.length;
  assert.ok(Math.abs(m4 / (m2 * m2) - 3) < 0.1, `kurtosis ${m4 / (m2 * m2)}`);
  for (let lag = 1; lag <= 16; lag++) assert.ok(Math.abs(corr(x, x, lag)) < 0.01, `lag ${lag}`);
  const lo = bandPower(x, 48000, 300), hi = bandPower(x, 48000, 9000);
  assert.ok(Math.abs(10 * Math.log10(lo / hi)) < 3, "flat within 3 dB");
});

test("two streams that share a factor correlate under 0.02", () => {
  const g = gaussianInto(new Float32Array(WAVE_LOOP), rngFor(3, "sound/test/a"));
  const g2 = gaussianInto(new Float32Array(WAVE_LOOP), rngFor(3, "sound/test/b"));
  const s1 = signLoop(SIGN_LOOPS[0], rngFor(3, "sound/test/s1"));
  const s2 = signLoop(SIGN_LOOPS[1], rngFor(3, "sound/test/s2"));
  const mul = (a: Float32Array, b: Float32Array) => Float32Array.from({ length: WAVE_LOOP }, (_, i) => a[i] * b[i]);
  assert.ok(Math.abs(corr(mul(g, s1), mul(g, s2))) < 0.02, "shared Gaussian loop");
  assert.ok(Math.abs(corr(mul(g, s1), mul(g2, s1))) < 0.02, "shared sign loop");
  assert.ok(Math.abs(corr(mul(g, s1), mul(g, s1)) - 1) < 1e-9);
});

test("coloured noise: levelled, zero mean, the right tilt, and seamless at the loop point", () => {
  const rate = 48000;
  for (const [colour, tilt] of [["white", 0], ["pink", 10], ["brown", 20]] as const) {
    const x = noise(colour, 65536, rate, rngFor(3, `sound/test/${colour}`));
    let sum = 0, s2 = 0;
    for (const v of x) {
      sum += v;
      s2 += v * v;
    }
    assert.ok(Math.abs(sum / x.length) < 1e-6);
    assert.ok(Math.abs(Math.sqrt(s2 / x.length) - NOISE_RMS) < 1e-4);
    // A decade apart: 0, 10 and 20 dB of tilt.
    const d = 10 * Math.log10(bandPower(x, rate, 400) / bandPower(x, rate, 4000));
    assert.ok(Math.abs(d - tilt) < 3.5, `${colour}: ${d} dB a decade`);
    // The jump across the loop point is no bigger than the jumps inside the loop.
    let big = 0;
    for (let i = 1; i < x.length; i++) big = Math.max(big, Math.abs(x[i] - x[i - 1]));
    assert.ok(Math.abs(x[0] - x[x.length - 1]) <= big);
  }
});

test("stereo noise holds the correlation asked for", () => {
  const [l0, r0] = stereoNoise("brown", 131072, 48000, 0, rngFor(3, "sound/test/st0"));
  assert.ok(Math.abs(corr(l0, r0)) < 0.12, `rho 0: ${corr(l0, r0)}`);
  const [l7, r7] = stereoNoise("white", 131072, 48000, 0.7, rngFor(3, "sound/test/st7"));
  assert.ok(Math.abs(corr(l7, r7) - 0.7) < 0.02, `rho 0.7: ${corr(l7, r7)}`);
});

test("the same seed gives the same noise", () => {
  const a = noise("pink", 4096, 48000, rngFor(3, "sound/x"));
  const b = noise("pink", 4096, 48000, rngFor(3, "sound/x"));
  assert.deepEqual(a, b);
});
