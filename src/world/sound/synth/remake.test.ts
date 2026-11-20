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

/**
 * Energy in octave bands from 62.5 Hz up to Nyquist, dB: a plain DFT averaged over windows the length of the loop
 * (one window alone varies by more than a decibel a band from draw to draw, and so does a window against another of the
 * same draw; sparse drops and bubbles need the whole loop).
 */
function bands(x: Float32Array): number[] {
  const n = 1024, sum: number[] = [];
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let at = 0; at + n <= x.length; at += n) {
    for (let i = 0; i < n; i++) {
      re[i] = (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)) * x[at + i];
      im[i] = 0;
    }
    fft(re, im);
    let band = 0;
    for (let lo = 62.5; lo < RATE / 2; lo *= 2, band++) {
      let e = 0;
      for (let f = 1; f < n / 2; f++) {
        const hz = (f * RATE) / n;
        if (hz >= lo && hz < 2 * lo) e += re[f] * re[f] + im[f] * im[f];
      }
      sum[band] = (sum[band] ?? 0) + e;
    }
  }
  return sum.map((e) => 10 * Math.log10(e + 1e-30));
}

/** An in-place radix-2 FFT (n a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const step = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(step * k), s = Math.sin(step * k);
        const a = i + k, b = a + len / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** How 80 ms windows of `a` correlate with the same windows of `b` (the critic's short-window test): median and worst. */
function windowCorrelation(a: Float32Array, b: Float32Array): { median: number; worst: number } {
  const w = Math.round(0.08 * RATE);
  const all: number[] = [];
  for (let at = 0; at + w <= Math.min(a.length, b.length); at += w) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = at; i < at + w; i++) {
      ab += a[i] * b[i];
      aa += a[i] * a[i];
      bb += b[i] * b[i];
    }
    all.push(Math.abs(ab) / Math.sqrt(aa * bb + 1e-30));
  }
  all.sort((x, y) => x - y);
  return { median: all[all.length >> 1], worst: all[all.length - 1] };
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
        // (Sparse bubbles and drops vary more band by band, far down their skirts most, as each draw picks its own: 3 dB, within 10 dB of the
        // loudest band.)
        const sparse = ["brook", "drops", "flow", "plinks"].includes(name);
        const slack = sparse ? 3 : 1.5;
        for (let k = 0; k < b0.length; k++) if (b0[k] > Math.max(...b0) - (sparse ? 10 : 40)) assert.ok(Math.abs(b1[k] - b0[k]) < slack, `${name} channel ${c} band ${k}: ${(b1[k] - b0[k]).toFixed(1)} dB`);
      }
    }
    // Nothing of one generation is found in the next: its 80 ms windows lie, in the median, no closer to the last
    // generation's than it lies to itself played backwards (chance, for a noise this smooth), at any of a few lags.
    const back = g0.channels[0].slice().reverse();
    for (const lag of [0, Math.round(0.37 * RATE), Math.round(1.91 * RATE)]) {
      const r = windowCorrelation(g0.channels[0], g1.channels[0].subarray(lag));
      const chance = windowCorrelation(g0.channels[0], back.subarray(lag));
      // (A loop come round scores 1 in every window; the worst of some forty windows of fresh noise is chance's tail.)
      assert.ok(r.median < chance.median + 0.1 && r.worst < Math.max(0.9, chance.worst + 0.05), `${name}: generation 1 against 0 at lag ${lag}: median ${r.median.toFixed(2)}, worst ${r.worst.toFixed(2)} (chance ${chance.median.toFixed(2)})`);
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
