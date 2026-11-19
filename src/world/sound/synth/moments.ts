// The moments' one-shots (design §4.9, §4.10; Recipes §7), rendered once by plain arithmetic: the train's chuffs,
// wheel clicks, whistles and steam swell; the seaplane's splash and its engine's last pops.

import { rngFor } from "../../core/rng.ts";
import { coefficients, type Coefficients } from "./filters.ts";
import { gaussianInto } from "./noise.ts";

export const MOMENT_PAD = 0.02;
export const chuffName = (k: number) => `chuff${k}`;
export const clickName = (k: number) => `click${k}`;
/** The whistle's two tubes, Hz: a fourth apart. */
export const WHISTLE_HZ: readonly [number, number] = [740, 988];
export const WHISTLE_LONG_S = 1.2, WHISTLE_SHORT_S = 0.3;

/** A buffer of `seconds` with pads, filled by `fill(i, t)` and brought to a peak of 0.5. */
function shot(seconds: number, sampleRate: number, fill: (i: number, t: number) => number): Float32Array {
  const pad = Math.round(MOMENT_PAD * sampleRate), body = Math.round(seconds * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  let peak = 0;
  for (let i = 0; i < body; i++) {
    const v = fill(i, i / sampleRate);
    out[pad + i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < body; i++) out[pad + i] *= 0.5 / peak;
  return out;
}

/** A biquad as a function of one sample. */
function filter(c: Coefficients): (x: number) => number {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** A chuff: a puff of exhaust up the chimney. Noise through bands at 420 and 1100 Hz, pushed a little into a soft clip; up in 8 ms, gone at 37 ms. Four takes. */
export function chuff(seed: number, k: number, sampleRate: number): Float32Array {
  const seconds = 0.24;
  const x = gaussianInto(new Float32Array(Math.round(seconds * sampleRate)), rngFor(seed, `sound/chuff/${k}`));
  const low = filter(coefficients({ type: "bandpass", hz: 420 * (1 + 0.04 * (k - 1.5)), q: 1.2 }, sampleRate));
  const high = filter(coefficients({ type: "bandpass", hz: 1100, q: 0.9 }, sampleRate));
  return shot(seconds, sampleRate, (i, t) => {
    const v = (low(x[i]) + 0.5 * high(x[i])) * ease(t / 0.008) * Math.exp(-t / 0.037) * ease((seconds - t) / 0.03);
    return Math.tanh(2.2 * v);
  });
}

/** A wheel on a rail joint: 3 ms of noise ringing at 900 and 2300 Hz, gone in 40 ms. Four takes. */
export function click(seed: number, k: number, sampleRate: number): Float32Array {
  const burst = gaussianInto(new Float32Array(Math.round(0.003 * sampleRate)), rngFor(seed, `sound/click/${k}`));
  const ring = (hz: number, tau: number) => {
    const r = Math.exp(-1 / (tau * sampleRate)), w = (2 * Math.PI * hz) / sampleRate;
    const a1 = 2 * r * Math.cos(w), a2 = -r * r;
    let y1 = 0, y2 = 0;
    return (x: number) => {
      const y = x + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      return y * (1 - r);
    };
  };
  const a = ring(900 * (1 + 0.03 * (k - 1.5)), 0.04 / 3), b = ring(2300, 0.025 / 3);
  return shot(0.09, sampleRate, (i, t) => {
    const x = i < burst.length ? burst[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (burst.length - 1))) : 0;
    return (a(x) + 0.7 * b(x)) * ease((0.09 - t) / 0.02);
  });
}

/**
 * The whistle: two tubes a fourth apart, each its tone with a second and third harmonic (−10, −18 dB) and the breath
 * of steam through a narrow band at its pitch. It comes up 60 cents flat over 150 ms as the steam fills it, and
 * sags 40 cents over its last 200 ms.
 */
export function whistle(seed: number, seconds: number, sampleRate: number): Float32Array {
  const total = seconds + 0.1;
  const noise = gaussianInto(new Float32Array(Math.round(total * sampleRate)), rngFor(seed, `sound/whistle/${seconds}`));
  const breath = WHISTLE_HZ.map((hz) => filter(coefficients({ type: "bandpass", hz, q: 6 }, sampleRate)));
  const phase = [0, 0];
  return shot(total, sampleRate, (i, t) => {
    const cents = -60 * (1 - ease(t / 0.15)) - 40 * ease((t - (seconds - 0.2)) / 0.2);
    const env = ease(t / 0.06) * ease((total - t) / 0.12);
    let v = 0;
    for (let k = 0; k < 2; k++) {
      phase[k] += (2 * Math.PI * WHISTLE_HZ[k] * Math.pow(2, cents / 1200)) / sampleRate;
      const p = phase[k];
      v += (k === 0 ? 1 : 0.8) * (Math.sin(p) + 0.316 * Math.sin(2 * p + 1) + 0.126 * Math.sin(3 * p + 2)) + 1.6 * breath[k](noise[i]);
    }
    return v * env;
  });
}

/** The steam swell at the turn: 0.6 s of hiss above 3 kHz that swells and goes. */
export function swell(seed: number, sampleRate: number): Float32Array {
  const seconds = 0.6;
  const x = gaussianInto(new Float32Array(Math.round(seconds * sampleRate)), rngFor(seed, "sound/swell"));
  const high = filter(coefficients({ type: "highpass", hz: 3000, q: -3.01 }, sampleRate));
  return shot(seconds, sampleRate, (i, t) => high(x[i]) * Math.sin((Math.PI * t) / seconds) ** 2);
}

/** A float taking the water: a burst of noise whose top falls from 3 kHz to 600 Hz in half a second, then 1.5 s of settling spray. */
export function splash(seed: number, k: number, sampleRate: number): Float32Array {
  const seconds = 2;
  const x = gaussianInto(new Float32Array(Math.round(seconds * sampleRate)), rngFor(seed, `sound/splash/${k}`));
  // Pinkish: a gentle low-pass before the moving one.
  const tilt = filter(coefficients({ type: "lowpass", hz: 2500, q: -3.01 }, sampleRate));
  const spray = filter(coefficients({ type: "highpass", hz: 2500, q: -3.01 }, sampleRate));
  let y = 0;
  return shot(seconds, sampleRate, (i, t) => {
    const fc = 3000 * Math.pow(600 / 3000, Math.min(1, t / 0.5));
    const kk = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
    y += kk * (tilt(x[i]) - y);
    const burst = y * ease(t / 0.03) * Math.exp(-t / 0.22);
    const hiss = 0.12 * spray(x[i]) * ease(t / 0.15) * Math.exp(-t / 0.5);
    return (burst + hiss) * ease((seconds - t) / 0.2);
  });
}

/** One firing of an engine that is nearly stopped: a low, soft thump. Three takes, each a little lower. */
export function pop(seed: number, k: number, sampleRate: number): Float32Array {
  const seconds = 0.18;
  const x = gaussianInto(new Float32Array(Math.round(seconds * sampleRate)), rngFor(seed, `sound/pop/${k}`));
  const low = filter(coefficients({ type: "lowpass", hz: 420 - 50 * k, q: -3.01 }, sampleRate));
  const hz = 95 - 8 * k;
  return shot(seconds, sampleRate, (i, t) => (Math.sin(2 * Math.PI * hz * t) + 0.8 * low(x[i])) * ease(t / 0.006) * Math.exp(-t / 0.035) * ease((seconds - t) / 0.03));
}
