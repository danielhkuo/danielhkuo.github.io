// The Web Audio biquads, as arithmetic: the same coefficients a BiquadFilterNode computes (the "Audio EQ Cookbook"
// forms the Web Audio specification gives), run over a loop so the loop stays seamless. A layer's fixed filters are
// run here once, into its own noise buffer, instead of by the audio thread for every sample the layer ever plays:
// the sound is the same, and the thread has fewer filters to run.

export interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type FilterSpec =
  /** `q` in decibels, as the node's. */
  | { type: "lowpass" | "highpass"; hz: number; q: number }
  /** `q` linear. */
  | { type: "bandpass"; hz: number; q: number }
  | { type: "peaking"; hz: number; q: number; db: number }
  | { type: "highshelf"; hz: number; db: number };

export function coefficients(f: FilterSpec, sampleRate: number): Coefficients {
  const w = (2 * Math.PI * Math.min(f.hz, 0.49 * sampleRate)) / sampleRate;
  const cos = Math.cos(w), sin = Math.sin(w);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (f.type === "lowpass" || f.type === "highpass") {
    const alpha = sin / (2 * Math.pow(10, f.q / 20));
    if (f.type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = b0;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = b0;
    }
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (f.type === "bandpass") {
    const alpha = sin / (2 * f.q);
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (f.type === "peaking") {
    const A = Math.pow(10, f.db / 40), alpha = sin / (2 * f.q);
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else if (f.type === "highshelf") {
    const A = Math.pow(10, f.db / 40), k = 2 * (sin / 2) * Math.SQRT2 * Math.sqrt(A);
    b0 = A * (A + 1 + (A - 1) * cos + k);
    b1 = -2 * A * (A - 1 + (A + 1) * cos);
    b2 = A * (A + 1 + (A - 1) * cos - k);
    a0 = A + 1 - (A - 1) * cos + k;
    a1 = 2 * (A - 1 - (A + 1) * cos);
    a2 = A + 1 - (A - 1) * cos - k;
  } else throw new Error("no such filter");
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** How much a filter passes at `hz`, as a gain. */
export function response(c: Coefficients, hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  const re = (k: number) => Math.cos(k * w), im = (k: number) => -Math.sin(k * w);
  const nr = c.b0 + c.b1 * re(1) + c.b2 * re(2), ni = c.b1 * im(1) + c.b2 * im(2);
  const dr = 1 + c.a1 * re(1) + c.a2 * re(2), di = c.a1 * im(1) + c.a2 * im(2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** A copy of the loop `x` through the filters in turn: each is run round the loop twice and the second pass kept. */
export function filtered(x: Float32Array, filters: readonly FilterSpec[], sampleRate: number): Float32Array {
  const out = Float32Array.from(x);
  for (const f of filters) {
    const c = coefficients(f, sampleRate);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < out.length; i++) {
        const v = out[i];
        const y = c.b0 * v + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
        x2 = x1;
        x1 = v;
        y2 = y1;
        y1 = y;
        if (pass === 1) out[i] = y;
      }
    }
  }
  return out;
}
