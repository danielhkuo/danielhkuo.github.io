// Where a sound is, as numbers for the graph: distance gain, air, pan, the north/south cue, reverb send, Doppler
// (design §3.1). Everything is measured from the dragon, never from the camera: landed, the camera sits beside the
// landmark to clear the Codex, and that move must be silent.

import { torusDelta } from "../core/torus.ts";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(a: number, b: number, x: number): number {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity;
}

/** A distance class: full level inside `ref` cells, falling as (ref / d)^p, faded to nothing over the last quarter before `max`. */
export interface DistanceClass {
  ref: number;
  max: number;
  p: number;
}

export const SMALL: DistanceClass = { ref: 25, max: 300, p: 1 };
export const MEDIUM: DistanceClass = { ref: 40, max: 450, p: 1 };
/** The abbey's bells carry: exponent 0.7 gives −18 dB at the start point (1150 cells) instead of −26 dB. */
export const BELLS: DistanceClass = { ref: 60, max: 1500, p: 0.7 };

/** A tall waterfall carries: the medium class with an exponent of 0.5 (−5.7 dB at 150 cells), so it is heard under cruise wind from the frame's edge in. */
export const TALL_FALL: DistanceClass = { ref: 40, max: 450, p: 0.5 };

/** Pan reach: a source due east at any distance sits at 0.85, never hard over. Halved under reduced motion. */
export const PAN = 0.85;
export const PAN_CALM = 0.42;
/** The listener's own size, cells: keeps pan and the north/south cue smooth as a source passes under the dragon. */
export const HEAD = 30;

export function distanceGain(c: DistanceClass, d: number): number {
  return Math.pow(c.ref / Math.max(d, c.ref), c.p) * (1 - smoothstep(0.75 * c.max, c.max, d));
}

/** A wave emitter: 1/d from 30 cells, gone between 80 and 130 (beyond that the surf bed speaks for the shore). */
export function waveGain(d: number): number {
  return (30 / Math.max(d, 30)) * (1 - smoothstep(80, 130, d));
}

/** The low-pass that stands for the air between: Hz, for a source d cells (metres) away. */
export function airCutoff(d: number): number {
  return clamp(1500 / Math.sqrt(Math.max(d, 1e-6) / 1000), 800, 18000);
}

/** A cutoff as the detune (cents) of a filter whose frequency is 1000 Hz: cutoffs move in log frequency. */
export function cutoffCents(hz: number): number {
  return 1200 * Math.log2(hz / 1000);
}

/** From the dragon to a source at world (sx, sy), height sh, on a torus of n cells: offsets and the 3D distance. */
export function offsetTo(x: number, y: number, alt: number, sx: number, sy: number, sh: number, n: number): { dx: number; dy: number; dz: number; d: number } {
  const dx = torusDelta(x, sx, n);
  const dy = torusDelta(y, sy, n);
  const dz = alt - sh;
  return { dx, dy, dz, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}

/** −P … P: east is right. 0 under the dragon. */
export function panOf(dx: number, dy: number, calm = false): number {
  return ((calm ? PAN_CALM : PAN) * dx) / Math.sqrt(dx * dx + dy * dy + HEAD * HEAD);
}

/** The north/south share b: 0 level with or north of the dragon, toward 1 far to the south (behind the listener). */
export function southOf(dx: number, dy: number): number {
  return Math.max(0, dy / Math.sqrt(dx * dx + dy * dy + HEAD * HEAD));
}

/** A source to the south is a little duller and quieter: the cutoff's factor and the gain's. */
export function southCutoff(b: number): number {
  return 1 - 0.35 * Math.max(0, b);
}

export function southGain(b: number): number {
  return dbToGain(-1.5 * Math.max(0, b));
}

/** The two gains of a pan: every pan in the engine is a gain pair into a merger (equal power). */
export function panPair(pan: number): [number, number] {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** Reverb send for a source d cells off whose send level is `s` (linear): it grows to three times as the source recedes. */
export function reverbSend(s: number, c: DistanceClass, d: number): number {
  return s * (1 + 2 * smoothstep(c.ref, c.max / 2, d));
}

/** The speed of sound, cells (metres) a second, and how much of a mover's closing speed the Doppler shift follows. */
export const SOUND_SPEED = 343;
export const DOPPLER_SCALE = 0.12;
export const DOPPLER_MAX = 45;

/** Doppler shift in cents for a closing speed v (cells a second, positive when approaching); 0 under reduced motion. */
export function dopplerCents(v: number, calm = false): number {
  if (calm) return 0;
  const closing = clamp(DOPPLER_SCALE * v, -SOUND_SPEED * 0.9, SOUND_SPEED * 0.9);
  return clamp(1200 * Math.log2(SOUND_SPEED / (SOUND_SPEED - closing)), -DOPPLER_MAX, DOPPLER_MAX);
}

/** One step of an eased value: toward `target` with time constant tau over dt. */
export function ease(value: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0)) return value;
  return target + (value - target) * Math.exp(-dt / tau);
}
