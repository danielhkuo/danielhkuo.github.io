import assert from "node:assert/strict";
import test from "node:test";
import { BELL_PAD, BELL_RATIOS, bellDesign, PARTIALS, ring, RING_S, RING_TAIL_S, strike, TENOR, TENOR_NOMINAL } from "./bells.ts";
import { impulseResponse, IR_S, IR_T60, IR_TAPS, measuredT60 } from "./ir.ts";

const RATE = 32000, SEED = 3;
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** The level of `hz` in x[from, from + n), by one bin of a Fourier sum under a Hann window. */
function levelAt(x: Float32Array, rate: number, hz: number, from: number, n: number): number {
  let re = 0, im = 0;
  const w = (2 * Math.PI * hz) / rate;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += h * x[from + i] * Math.cos(w * i);
    im += h * x[from + i] * Math.sin(w * i);
  }
  return (4 * Math.sqrt(re * re + im * im)) / n;
}

test("five bells: nominals an E-minor pentachord above the tenor, each within 12 cents; old-style hum and prime", () => {
  for (let b = 0; b < 5; b++) {
    const d = bellDesign(SEED, b);
    assert.ok(Math.abs(cents(d.nominal, TENOR_NOMINAL * BELL_RATIOS[b])) <= 12);
    assert.equal(d.partials.length, PARTIALS.length);
    const hum = d.partials[0], prime = d.partials[1];
    // The hum sharp of two octaves under, the prime flat of one: each bell by its own amount.
    assert.ok(cents(hum.hz, d.nominal / 4) > 15 && cents(hum.hz, d.nominal / 4) < 65);
    assert.ok(cents(prime.hz, d.nominal / 2) < -5 && cents(prime.hz, d.nominal / 2) > -55);
    // Smaller bells die sooner.
    assert.ok(Math.abs(d.partials[4].t60 - (8 * TENOR_NOMINAL) / d.nominal) < 1e-9);
    assert.ok(d.partials.filter((p) => p.split > 0).length >= 6);
  }
  assert.equal(BELL_RATIOS[TENOR], 1);
});

test("a ring: the designed partials are there, each dying at its own rate; it ends in silence", () => {
  const x = ring(SEED, TENOR, 0, RATE);
  assert.equal(x.length, Math.round(RING_S[TENOR] * RATE));
  const pad = Math.round(BELL_PAD * RATE);
  for (let i = 0; i < pad; i++) assert.equal(x[i], 0);
  for (let i = x.length - pad; i < x.length; i++) assert.equal(x[i], 0);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  assert.ok(Math.abs(peak - 0.5) < 1e-6);
  const d = bellDesign(SEED, TENOR);
  for (const p of d.partials) {
    if (p.t60 < 2) continue;
    // Two windows a stretch apart: a doublet is read over one whole beat each time, so the beat itself cancels.
    const span = p.split > 0 ? 1 / p.split : 1, n = Math.round(span * RATE);
    const a = levelAt(x, RATE, p.hz, pad + Math.round(0.1 * RATE), n), b = levelAt(x, RATE, p.hz, pad + Math.round(0.1 * RATE) + n, n);
    const fell = 20 * Math.log10(a / b), want = (60 / p.t60) * span;
    assert.ok(Math.abs(fell - want) < 0.15 * want + 0.5, `${p.name}: fell ${fell.toFixed(1)} dB in ${span.toFixed(2)} s, designed ${want.toFixed(1)}`);
  }
  // The last 1.5 s is a ramp to nothing: the hum is still there before it, and gone at the end.
  const before = levelAt(x, RATE, d.partials[0].hz, x.length - pad - Math.round((RING_TAIL_S + 0.5) * RATE), Math.round(0.5 * RATE));
  const end = levelAt(x, RATE, d.partials[0].hz, x.length - pad - Math.round(0.1 * RATE), Math.round(0.1 * RATE));
  assert.ok(before > 1e-3 && end < before / 100);
});

test("the two takes of a bell share their partials and differ in how the doublets fall out", () => {
  const a = ring(SEED, 2, 0, RATE), b = ring(SEED, 2, 1, RATE);
  let diff = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    diff += (a[i] - b[i]) * (a[i] - b[i]);
    sum += a[i] * a[i];
  }
  assert.ok(diff / sum > 0.05, "not the same buffer");
  const d = bellDesign(SEED, 2);
  const at = Math.round(0.2 * RATE);
  for (const p of d.partials.slice(0, 5)) {
    const la = levelAt(a, RATE, p.hz, at, RATE), lb = levelAt(b, RATE, p.hz, at, RATE);
    assert.ok(Math.abs(20 * Math.log10(la / lb)) < 8, p.name);
  }
});

test("a strike is short, starts and ends in silence, and is gone in a third of a second", () => {
  const x = strike(SEED, TENOR, RATE);
  assert.ok(x.length / RATE < 0.4);
  assert.equal(x[0], 0);
  assert.equal(x[x.length - 1], 0);
  let early = 0, late = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < 0.1 * RATE) early += x[i] * x[i];
    else late += x[i] * x[i];
  }
  assert.ok(early > 5 * late);
});

test("the reverb's response: 2.5 s, unit energy an ear, T60 2.2 s, four early taps, the ears unalike, a darkening tail", () => {
  const rate = 48000;
  const [l, r] = impulseResponse(SEED, rate);
  assert.equal(l.length, Math.round(IR_S * rate));
  let el = 0, er = 0, cross = 0;
  for (let i = 0; i < l.length; i++) {
    el += l[i] * l[i];
    er += r[i] * r[i];
    cross += l[i] * r[i];
  }
  assert.ok(Math.abs(el - 1) < 1e-3 && Math.abs(er - 1) < 1e-3);
  assert.ok(Math.abs(cross) < 0.1, "independent ears");
  for (const h of [l, r]) assert.ok(Math.abs(measuredT60(h, rate) - IR_T60) < 0.25, `T60 ${measuredT60(h, rate).toFixed(2)}`);
  // Each tap stands well clear of the tail round it.
  for (const [seconds] of IR_TAPS) {
    assert.ok(seconds >= 0.15 && seconds <= 0.6);
    const at = Math.round(seconds * rate);
    let rms = 0;
    for (let i = at - 600; i < at + 600; i++) if (i !== at) rms += l[i] * l[i];
    rms = Math.sqrt(rms / 1199);
    assert.ok(Math.abs(l[at]) > 4 * rms, `tap at ${seconds} s`);
  }
  // Darkening: the share of energy above 3 kHz (by first difference) is less late than early.
  const bright = (from: number, to: number) => {
    let d = 0, e = 0;
    for (let i = Math.round(from * rate) + 1; i < to * rate; i++) {
      d += (l[i] - l[i - 1]) * (l[i] - l[i - 1]);
      e += l[i] * l[i];
    }
    return d / e;
  };
  assert.ok(bright(1.5, 2.2) < 0.6 * bright(0.2, 0.5));
  assert.equal(l[l.length - 1], 0);
});
