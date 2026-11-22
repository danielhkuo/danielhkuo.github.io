// The repetition check (design §9.1): do two waves ever share a stretch of noise? Each wave is cut out at its start,
// divided by its own 20 ms RMS envelope (which leaves the noise without its shape), and every pair's normalised
// cross-correlation is taken over lags of ±2 s. `repeatMax` is the largest magnitude over all pairs: independent
// noise gives a few hundredths; a shared stretch gives nearly 1. Pure.
//
// The waves are compared at an eighth of the sample rate (after a low-pass), which keeps the hiss between about 1 and
// 3 kHz: 1.8 kHz of noise over four seconds is some seven thousand independent samples, plenty to tell.

const DECIMATE = 8;
/** Taps of the low-pass before decimation (windowed sinc, cutoff at 0.45 of the new rate). */
const TAPS = 95;

function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** `seconds` of `signal` from sample `from`, low-passed and decimated by 8, then divided by its own 20 ms RMS envelope. */
function shapeless(signal: Float32Array, sampleRate: number, from: number, seconds: number, taps: Float64Array): Float64Array {
  const n = Math.floor((seconds * sampleRate) / DECIMATE);
  const out = new Float64Array(n);
  const half = (TAPS - 1) >> 1;
  for (let i = 0; i < n; i++) {
    const c = from + i * DECIMATE;
    let s = 0;
    for (let k = 0; k < TAPS; k++) {
      const j = c + k - half;
      if (j >= 0 && j < signal.length) s += taps[k] * signal[j];
    }
    out[i] = s;
  }
  // The RMS envelope over 20 ms windows; where the wave is all but silent there is no noise to compare.
  const win = Math.max(1, Math.round((0.02 * sampleRate) / DECIMATE));
  const env = new Float64Array(n);
  let peak = 0;
  for (let a = 0; a < n; a += win) {
    let s2 = 0;
    const b = Math.min(n, a + win);
    for (let i = a; i < b; i++) s2 += out[i] * out[i];
    const r = Math.sqrt(s2 / (b - a));
    for (let i = a; i < b; i++) env[i] = r;
    if (r > peak) peak = r;
  }
  const floor = peak * 0.03;
  for (let i = 0; i < n; i++) out[i] = env[i] > floor && floor > 0 ? out[i] / env[i] : 0;
  return out;
}

export interface RepeatResult {
  /** The largest normalised cross-correlation between any two waves, over lags of ±2 s. */
  repeatMax: number;
  pairs: number;
  /** The two waves it was found between, and the lag, seconds. */
  worst: [number, number, number];
  waves: number;
}

/**
 * `starts` are the seconds at which each wave begins in `signal`; `seconds` is how much of each is compared.
 * Waves that run off the end of the signal are left out.
 */
export function repeatCheck(signal: Float32Array, sampleRate: number, starts: readonly number[], seconds = 4, lagSeconds = 2): RepeatResult {
  const taps = new Float64Array(TAPS);
  const fc = 0.45 / DECIMATE;
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const x = k - (TAPS - 1) / 2;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    taps[k] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (TAPS - 1)));
    sum += taps[k];
  }
  for (let k = 0; k < TAPS; k++) taps[k] /= sum;

  const len = Math.floor((seconds * sampleRate) / DECIMATE);
  const maxLag = Math.floor((lagSeconds * sampleRate) / DECIMATE);
  let size = 1;
  while (size < len + maxLag + 1) size <<= 1;
  const spectra: { re: Float32Array; im: Float32Array; energy: number }[] = [];
  const re = new Float64Array(size), im = new Float64Array(size);
  for (const start of starts) {
    const from = Math.round(start * sampleRate);
    if (from < 0 || from + seconds * sampleRate > signal.length) continue;
    const x = shapeless(signal, sampleRate, from, seconds, taps);
    re.fill(0);
    im.fill(0);
    let energy = 0;
    for (let i = 0; i < x.length; i++) {
      re[i] = x[i];
      energy += x[i] * x[i];
    }
    if (energy <= 0) continue;
    fft(re, im, false);
    spectra.push({ re: Float32Array.from(re.subarray(0, size / 2 + 1)), im: Float32Array.from(im.subarray(0, size / 2 + 1)), energy });
  }
  let repeatMax = 0, pairs = 0;
  const worst: [number, number, number] = [-1, -1, 0];
  for (let a = 0; a < spectra.length; a++) {
    const A = spectra[a];
    for (let b = a + 1; b < spectra.length; b++) {
      const B = spectra[b];
      // Cross-spectrum A · conj(B), filled out by its symmetry, back to lags.
      for (let k = 0; k <= size / 2; k++) {
        const r = A.re[k] * B.re[k] + A.im[k] * B.im[k], i = A.im[k] * B.re[k] - A.re[k] * B.im[k];
        re[k] = r;
        im[k] = i;
        if (k > 0 && k < size / 2) {
          re[size - k] = r;
          im[size - k] = -i;
        }
      }
      fft(re, im, true);
      const norm = size * Math.sqrt(A.energy * B.energy);
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        const v = Math.abs(re[lag < 0 ? size + lag : lag]) / norm;
        if (v > repeatMax) {
          repeatMax = v;
          worst[0] = a;
          worst[1] = b;
          worst[2] = (lag * DECIMATE) / sampleRate;
        }
      }
      pairs++;
    }
  }
  return { repeatMax, pairs, worst, waves: spectra.length };
}
