// Herring gulls (design §4.7; Recipes §6): a library of notes, rendered once by plain arithmetic. A note is a
// source–filter voice written out: twenty harmonics of a pitch that moves (a bright, pulse-like source), each weighed
// by where it falls among three formants (the bird's throat and bill), so the energy sits in harmonics 2–5, not in
// the fundamental; a rasp at the loudest moment only (every other pulse weaker: the subharmonic growl of a voice
// pushed hard); a little breath. Six birds, each with its own pitch and its own size (formants), and for each: three
// kyows (one with a break in it), two squeals, two keks, one mew. Also the three wingbeats (flaps).
//
// Gull notes are tonal, short and varied by bird, so frozen takes are safe here in a way a wave's noise is not.

import { hash2 } from "../../core/hash.ts";
import { rngFor, type Rng } from "../../core/rng.ts";
import { coefficients } from "./filters.ts";
import { gaussianInto } from "./noise.ts";

export const GULL_VOICES = 6;
/** The notes each voice has: kyows (the third breaks), squeals, keks, a mew. */
export const GULL_NOTES = ["k0", "k1", "k2", "s0", "s1", "e0", "e1", "m"] as const;
export type GullNote = (typeof GULL_NOTES)[number];
export const GULL_PAD = 0.02;
export const gullName = (voice: number, note: string) => `gull${voice}${note}`;
export const flapName = (k: number) => `flap${k}`;
export const FLAPS = 3;

const unit = (h: number) => h / 4294967296;

/** A bird: its base pitch (Hz) and how its formants are shifted (its size). */
export function gullVoice(seed: number, voice: number): { base: number; shift: number } {
  return { base: 620 + 200 * unit(hash2(voice, 1, seed ^ 0x9a11)), shift: 1 + 0.08 * (2 * unit(hash2(voice, 2, seed ^ 0x9a11)) - 1) };
}

/** The tract: three formants (Hz, Q, level) and a tenth of the source dry. */
const FORMANTS: readonly (readonly [number, number, number])[] = [[1700, 4, 1], [2900, 5, 0.708], [4600, 6, 0.316]];
const DRY = 0.1;
/** The rasp at its deepest: how much weaker every other pulse of the voice is. */
export const RASP = 0.5;
const HARMONICS = 20;

export interface NoteShape {
  /** Seconds the note sounds (pads apart). */
  seconds: number;
  /** Its pitch at time t (seconds), as a multiple of the bird's base. */
  pitch(t: number): number;
  /** Its level at time t, 0 … 1. */
  level(t: number): number;
  /** How deep the rasp is at time t, 0 … 1. */
  rasp(t: number): number;
  /** Formants lower by this factor (the mew's closed bill). */
  tract: number;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number, b: number, x: number) => a + (b - a) * (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** The shape of note `note` as bird `voice` sings it: the recipe's contours, each take a little its own. */
export function noteShape(seed: number, voice: number, note: GullNote): NoteShape {
  const h = (k: number) => unit(hash2(voice * 16 + GULL_NOTES.indexOf(note), k, seed ^ 0x607e));
  const vary = (k: number, by: number) => 1 + by * (2 * h(k) - 1);
  if (note[0] === "k") {
    // Kyow: up quickly, held, then falling away. 0.9B → 1.35B in 60 ms → hold 80 ms → 0.8B over 150 ms.
    const up = 0.06 * vary(1, 0.15), hold = 0.08 * vary(2, 0.2), down = 0.15 * vary(3, 0.15), top = 1.35 * vary(4, 0.03);
    const seconds = up + hold + down;
    const broken = note === "k2";
    return {
      seconds, tract: 1,
      pitch(t) {
        // The break: for 40 ms at the peak the voice jumps toward its octave and back.
        if (broken && t >= up + 0.01 && t < up + 0.05) return 1.9;
        return t < up ? lerp(0.9, top, ease(t / up)) : t < up + hold ? top : lerp(top, 0.8, (t - up - hold) / down);
      },
      level: (t) => ease(t / 0.025) * (0.8 + 0.2 * Math.sin((Math.PI * t) / seconds)) * ease((seconds - t) / 0.075),
      // Rough only round the peak: from the top of the rise through the hold.
      rasp: (t) => RASP * 0.9 * ease((t - up * 0.6) / 0.03) * ease((up + hold + 0.02 - t) / 0.04),
    };
  }
  if (note[0] === "s") {
    // Squeal: long, drawn out, rising slowly (0.8B → 1.45B over 0.9 s), the roughness growing as it goes: the loudest
    // and highest note of a long call.
    const seconds = 0.9 * vary(1, 0.12), top = 1.45 * vary(2, 0.03);
    return {
      seconds, tract: 1,
      pitch: (t) => lerp(0.8, top, t / (seconds - 0.08)),
      level: (t) => ease(t / 0.03) * (0.55 + 0.45 * (t / seconds)) * ease((seconds - t) / 0.09),
      rasp: (t) => RASP * ease((t / seconds - 0.6) / 0.3) * ease((seconds - t) / 0.06),
    };
  }
  if (note[0] === "e") {
    // Kek: a short bark, 0.75B falling a tenth, 100 ms.
    const seconds = 0.1 * vary(1, 0.15);
    return {
      seconds, tract: 1,
      pitch: (t) => 0.75 * (1 - 0.1 * (t / seconds)),
      level: (t) => ease(t / 0.02) * ease((seconds - t) / 0.06),
      rasp: (t) => RASP * 0.6 * ease((t - 0.02) / 0.02) * ease((seconds - 0.03 - t) / 0.03),
    };
  }
  // Mew: one long wail, 0.85B → 1.1B → 0.8B over 1.3 s, pure, the bill nearly shut.
  const seconds = 1.3 * vary(1, 0.1);
  return {
    seconds, tract: 0.9,
    pitch: (t) => (t < 0.45 * seconds ? lerp(0.85, 1.1, ease(t / (0.45 * seconds))) : lerp(1.1, 0.8, ease((t - 0.45 * seconds) / (0.55 * seconds)))),
    level: (t) => ease(t / 0.03) * (0.7 + 0.3 * Math.sin((Math.PI * t) / seconds)) * ease((seconds - t) / 0.09),
    rasp: () => 0,
  };
}

/** How much the tract passes at f Hz: the three formants (the first `open` times its place) and the dry tenth. */
function tract(f: number, shift: number, open: number): number {
  let g = DRY;
  for (let k = 0; k < FORMANTS.length; k++) {
    const fc = FORMANTS[k][0] * shift * (k === 0 ? open : 1), x = f / fc - fc / f;
    g += FORMANTS[k][2] / Math.sqrt(1 + FORMANTS[k][1] * FORMANTS[k][1] * x * x);
  }
  return g;
}

/** One note of one bird: peak 0.5, 20 ms of silence either side. */
export function gullNote(seed: number, voice: number, note: GullNote, sampleRate: number): Float32Array {
  const bird = gullVoice(seed, voice), shape = noteShape(seed, voice, note);
  const pad = Math.round(GULL_PAD * sampleRate), body = Math.round(shape.seconds * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  const rng = rngFor(seed, `sound/gull/${voice}/${note}`);
  // Pitch jitter: slow noise (a one-pole at 120 Hz), ±25 cents, to ±70 while the voice is rough.
  const wobble = gaussianInto(new Float32Array(body), rng);
  const k = 1 - Math.exp((-2 * Math.PI * 120) / sampleRate);
  let slow = 0;
  // Breath: noise through a band at 3 kHz, 22 dB under the voice.
  const air = gaussianInto(new Float32Array(body), rng);
  const c = coefficients({ type: "bandpass", hz: 3000, q: 1 }, sampleRate);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const BLOCK = 32;
  const amp = new Float64Array(HARMONICS + 1), next = new Float64Array(HARMONICS + 1);
  const weigh = (into: Float64Array, t: number, f0: number) => {
    // The bill opens over the attack: the first formant glides up 15 %.
    const open = 0.87 + 0.13 * ease(t / 0.05);
    for (let n = 1; n <= HARMONICS; n++) {
      const f = n * f0;
      into[n] = f < 0.45 * sampleRate ? (n === 1 ? 0.5 : Math.pow(n, -0.8)) * tract(f, bird.shift * shape.tract, open) : 0;
    }
  };
  // Each harmonic starts at its own phase. (All in step they add up to one sharp pulse a period, which is a click
  // train to anything that looks for clicks, and harsher than a gull; out of step the spectrum is the same.)
  const lead = new Float64Array(HARMONICS + 1);
  for (let n = 1; n <= HARMONICS; n++) lead[n] = 2 * Math.PI * rng.float();
  let phase = 0, peak = 0;
  weigh(next, 0, bird.base * shape.pitch(0));
  for (let i = 0; i < body; i++) {
    const t = i / sampleRate;
    const rasp = shape.rasp(t);
    slow += k * (wobble[i] - slow);
    // (The one-pole leaves the noise at about a tenth of its level: brought back up, then to cents.)
    const cents = slow * 9 * (25 + 45 * (rasp / RASP));
    const f0 = bird.base * shape.pitch(t) * Math.pow(2, cents / 1200);
    if (i % BLOCK === 0) {
      amp.set(next);
      weigh(next, (i + BLOCK) / sampleRate, bird.base * shape.pitch(Math.min(shape.seconds, (i + BLOCK) / sampleRate)));
    }
    phase += (2 * Math.PI * f0) / sampleRate;
    const u = (i % BLOCK) / BLOCK;
    let v = 0;
    for (let n = 1; n <= HARMONICS; n++) {
      const a = amp[n] + (next[n] - amp[n]) * u;
      if (a !== 0) v += a * Math.sin(n * phase + lead[n]);
    }
    // The rasp: every other pulse of the voice weaker, by a multiplier at half the pitch.
    v *= 1 - rasp * (0.5 - 0.5 * Math.cos(phase / 2));
    const y = c.b0 * air[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = air[i];
    y2 = y1;
    y1 = y;
    v = (v + 0.25 * y) * shape.level(t);
    out[pad + i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  for (let i = 0; i < body; i++) out[pad + i] *= 0.5 / peak;
  return out;
}

/** A wingbeat: the soft thump of a downstroke, 90 ms of low noise that swells and goes. Three takes. */
export function flap(seed: number, take: number, sampleRate: number): Float32Array {
  const pad = Math.round(GULL_PAD * sampleRate), body = Math.round(0.11 * sampleRate);
  const out = new Float32Array(body + 2 * pad);
  const rng: Rng = rngFor(seed, `sound/flap/${take}`);
  const x = gaussianInto(new Float32Array(body), rng);
  const c = coefficients({ type: "bandpass", hz: 420 + 90 * take, q: 0.8 }, sampleRate);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0;
  for (let i = 0; i < body; i++) {
    const y = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    const t = i / sampleRate;
    const v = y * ease(t / 0.03) * ease((0.11 - t) / 0.07);
    out[pad + i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  for (let i = 0; i < body; i++) out[pad + i] *= 0.5 / peak;
  return out;
}
