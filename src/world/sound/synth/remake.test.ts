import assert from "node:assert/strict";
import { test } from "node:test";
import { FRESH_NAMES, make, remake, type Raw } from "./make.ts";

// Fresh noise for the beds (design §14.8): each bed's loop is made again, from a new seed, every time it is about to come
// round, so no stretch of it is ever heard twice. remake(name, g) is generation g of buffer `name`; generation 0 is the
// kit's own.

const RATE = 8000;

/** Every buffer by name, from the jobs that make them. */
function kitBuffers(): Record<string, Raw> {
  return { ...make("noise", 3, RATE), ...make("surf", 3, RATE), ...make("river", 3, RATE) };
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

/** Energy in octave bands from 62.5 Hz up to Nyquist, dB, by a plain DFT on a stretch (enough to compare spectra). */
function bands(x: Float32Array): number[] {
  const n = 4096, out: number[] = [];
  const re = new Float64Array(n / 2), at = Math.floor(x.length / 3);
  for (let k = 1; k < n / 2; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      a += w * x[at + i] * Math.cos((2 * Math.PI * k * i) / n);
      b += w * x[at + i] * Math.sin((2 * Math.PI * k * i) / n);
    }
    re[k] = a * a + b * b;
  }
  for (let lo = 62.5; lo < RATE / 2; lo *= 2) {
    let e = 1e-30;
    for (let k = 1; k < n / 2; k++) {
      const hz = (k * RATE) / n;
      if (hz >= lo && hz < 2 * lo) e += re[k];
    }
    out.push(10 * Math.log10(e));
  }
  return out;
}

/** The largest correlation of 80 ms windows of `a` with the same windows of `b` (the critic's short-window test). */
function windowCorrelation(a: Float32Array, b: Float32Array): number {
  const w = Math.round(0.08 * RATE);
  let worst = -1;
  for (let at = 0; at + w <= Math.min(a.length, b.length); at += w) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = at; i < at + w; i++) {
      ab += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    worst = Math.max(worst, ab / Math.sqrt(aa * bb + 1e-30));
  }
  return worst;
}

test("the names that are made fresh: the wind's four layers and the beds' noises and bubbles", () => {
  assert.deepEqual([...FRESH_NAMES].sort(), ["breeze", "brook", "brown0", "buffet", "drops", "flow", "hiss", "pink0", "plinks", "rush", "velvet", "white0"]);
});

test("generation 0 is the kit's own buffer, sample for sample", () => {
  const kit = kitBuffers();
  for (const name of FRESH_NAMES) {
    const r = remake(name, 0, 3, RATE);
    assert.equal(r.rate, kit[name].rate, name);
    assert.equal(r.channels.length, kit[name].channels.length, name);
    for (let c = 0; c < r.channels.length; c++) assert.deepEqual(r.channels[c], kit[name].channels[c], `${name} channel ${c}`);
  }
});

test("a later generation is the same sound and the same length, but none of it repeats the one before", () => {
  for (const name of FRESH_NAMES) {
    const g0 = remake(name, 0, 3, RATE), g1 = remake(name, 1, 3, RATE), g2 = remake(name, 2, 3, RATE);
    assert.deepEqual(remake(name, 1, 3, RATE).channels[0], g1.channels[0], `${name}: the same generation twice is the same`);
    for (const g of [g1, g2]) {
      assert.equal(g.channels.length, g0.channels.length, name);
      assert.equal(g.channels[0].length, g0.channels[0].length, name);
      for (let c = 0; c < g.channels.length; c++) {
        // The same level (within half a decibel) and the same colour (each octave band within 1.5 dB).
        const db = 20 * Math.log10(rms(g.channels[c]) / rms(g0.channels[c]));
        assert.ok(Math.abs(db) < 0.5, `${name} channel ${c}: ${db.toFixed(2)} dB from generation 0`);
        const b0 = bands(g0.channels[c]), b1 = bands(g.channels[c]);
        // (Sparse bubbles and drops vary more band by band: 3 dB.)
        const slack = ["brook", "drops", "flow", "plinks"].includes(name) ? 3 : 1.5;
        for (let k = 0; k < b0.length; k++) if (b0[k] > Math.max(...b0) - 40) assert.ok(Math.abs(b1[k] - b0[k]) < slack, `${name} channel ${c} band ${k}: ${(b1[k] - b0[k]).toFixed(1)} dB`);
      }
    }
    // Nothing of one generation is found in the next: no 80 ms window correlates above chance, at any of a few lags.
    for (const lag of [0, Math.round(0.37 * RATE), Math.round(1.91 * RATE)]) {
      const r = windowCorrelation(g0.channels[0], g1.channels[0].subarray(lag));
      assert.ok(r < 0.75, `${name}: generation 1 against 0 at lag ${lag}: ${r.toFixed(2)}`);
    }
  }
});

test("each generation loops seamlessly: its join is no bigger a step than its samples take", () => {
  for (const name of FRESH_NAMES) {
    const x = remake(name, 4, 3, RATE).channels[0];
    let sum = 0;
    for (let i = 1; i < x.length; i++) sum += Math.abs(x[i] - x[i - 1]);
    const typical = sum / (x.length - 1);
    const join = Math.abs(x[0] - x[x.length - 1]);
    assert.ok(join < 6 * typical + 1e-6, `${name}: the join ${join.toExponential(2)} against ${typical.toExponential(2)}`);
  }
});

test("an unknown name is refused", () => {
  assert.throws(() => remake("pink1", 1, 3, RATE));
});
