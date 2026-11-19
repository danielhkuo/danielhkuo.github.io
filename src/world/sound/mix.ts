// The mix: the dragon's pose, what the ear heard, the point sources alive and the listener's choices → one array of
// targets for the graph (design §3). Pure: the only state is the small `memory` handed in and out.
//
// This file holds the wind, the whoosh, the world bus and the volume. The beds, slots and the bell duck join it with
// their phases.

import {
  A_CUT_HZ, A_CUT_RANGE, A_EXP, A_TILT_DB, B_HZ, B_RANGE, C_FROM, C_LOW, C_PUSH, D_FROM, E_REST, BED_SPREAD, K_SURF, K_WIND, W_BLOOM_FULL, W_BLOOM_TAU, W_FLOOR, W_GATE, W_HOLD, W_HZ, W_PAN, W_RISE, WIND_FLOOR, WIND_SLEW,
  WORLD_BOOST_DB, WORLD_REST_DB,
} from "./levels.ts";
import { volumeGain } from "./prefs.ts";
import { airCutoff, clamp, dbToGain, ease, PAN, smoothstep } from "./space.ts";
import type { Census, Hearing, Pose, Prefs } from "./types.ts";

/** Cruise speed, cells a second: s = speed / CRUISE. */
const CRUISE = 60;

/** Indices into the targets array. */
export const T = {
  /** The volume: the slider squared. */
  MASTER: 0,
  /** The world bus: it yields to the wind at boost and drops under the Codex. */
  WORLD: 1,
  /** Wind and water under the bells (1 until the bells exist). */
  DUCK: 2,
  A_L: 3,
  A_R: 4,
  A_HZ: 5,
  B_GAIN: 6,
  B_HZ: 7,
  C_GAIN: 8,
  C_HZ: 9,
  D_GAIN: 10,
  /** What the whistles' centres are multiplied by. */
  D_RATIO: 11,
  E_GAIN: 12,
  W_GAIN: 13,
  W_HZ: 14,
  W_PAN: 15,
  /** The surf bed: the surf that cannot be resolved into waves. Gains, the hiss band's air (Hz), and its two halves' pans. */
  BED_HISS: 16,
  BED_BODY: 17,
  BED_RUMBLE: 18,
  BED_RATTLE: 19,
  BED_AIR_HZ: 20,
  BED_PAN_A: 21,
  BED_PAN_B: 22,
  /** The open sea's wash. */
  OPEN: 23,
  COUNT: 24,
} as const;

/** How a target is sent: its unit decides how "moved" is measured (§3.5). */
export interface SendRule {
  unit: "gain" | "hz" | "ratio" | "pan";
  /** Sent when it has moved by this: dB for a gain, cents for hz and ratio, plain for a pan. */
  by: number;
  /** Time constants, seconds, when the target rises and when it falls. */
  up: number;
  down: number;
}

const gain = (by: number, up: number, down = up): SendRule => ({ unit: "gain", by, up, down });
const cents = (unit: "hz" | "ratio"): SendRule => ({ unit, by: 4, up: 0.15, down: 0.15 });

export const SEND: readonly SendRule[] = (() => {
  const r: SendRule[] = [];
  r[T.MASTER] = gain(0.2, 0.06);
  r[T.WORLD] = gain(0.2, 0.8, 0.13);
  r[T.DUCK] = gain(0.2, 0.8, 0.13);
  r[T.A_L] = gain(0.3, 0.3, 0.25);
  r[T.A_R] = gain(0.3, 0.3, 0.25);
  r[T.A_HZ] = cents("hz");
  r[T.B_GAIN] = gain(0.3, 0.3);
  r[T.B_HZ] = cents("hz");
  r[T.C_GAIN] = gain(0.3, 0.3);
  r[T.C_HZ] = cents("hz");
  r[T.D_GAIN] = gain(0.3, 0.3);
  r[T.D_RATIO] = cents("ratio");
  r[T.E_GAIN] = gain(0.3, 0.3);
  r[T.W_GAIN] = gain(0.5, 0.07, 0.22);
  r[T.W_HZ] = cents("hz");
  r[T.W_PAN] = { unit: "pan", by: 0.02, up: 0.06, down: 0.06 };
  // Beds: the scan behind them is sampled and noisy, so they move slowly.
  for (const i of [T.BED_HISS, T.BED_BODY, T.BED_RUMBLE, T.BED_RATTLE, T.OPEN]) r[i] = gain(0.5, 0.25);
  r[T.BED_AIR_HZ] = { unit: "hz", by: 50, up: 0.1, down: 0.1 };
  r[T.BED_PAN_A] = { unit: "pan", by: 0.02, up: 0.25, down: 0.25 };
  r[T.BED_PAN_B] = { unit: "pan", by: 0.02, up: 0.25, down: 0.25 };
  return r;
})();

/** Gains under this are silence: a target is sent once as it crosses, then left alone. */
const FLOOR = 1e-3;

/** True when target `i` has moved from `last` (the value last sent; NaN when none was) to `next` by enough to send. */
export function moved(i: number, last: number, next: number): boolean {
  if (last !== last) return true;
  const rule = SEND[i];
  if (rule.unit === "pan") return Math.abs(next - last) >= rule.by;
  // Decibels and cents are both ratios: compared as ratios, with no logarithm in the frame loop.
  const k = RATIO[i];
  if (rule.unit === "gain") {
    const a = Math.max(last, FLOOR), b = Math.max(next, FLOOR);
    return b >= a * k || a >= b * k;
  }
  if (!(last > 0) || !(next > 0)) return last !== next;
  return next >= last * k || last >= next * k;
}

/** Each rule's threshold as a ratio: 10^(dB / 20) for gains, 2^(cents / 1200) for frequencies. */
const RATIO: readonly number[] = SEND.map((r) => (r.unit === "gain" ? Math.pow(10, r.by / 20) : r.unit === "pan" ? 1 : Math.pow(2, r.by / 1200)));

/** The few eased values the mix carries from one run to the next. */
export interface MixMemory {
  /** World time of the last mix; NaN before the first. */
  t: number;
  /** The dragon's speed over cruise, and the speed the wind hears (the same, slew-limited). */
  s: number;
  wind: number;
  /** ds/dt, eased (τ 150 ms). */
  sDot: number;
  bank: number;
  /** |d bank/dt|, eased (τ 60 ms). */
  roll: number;
  /** The whoosh's bloom: the roll rate smoothed once and twice. */
  bloom1: number;
  bloom2: number;
  /** The whoosh's level as last given (its rise is limited). */
  whoosh: number;
}

export function newMemory(): MixMemory {
  return { t: NaN, s: 0, wind: 0, sDot: 0, bank: 0, roll: 0, bloom1: 0, bloom2: 0, whoosh: 0 };
}

export function newTargets(): Float32Array {
  return new Float32Array(T.COUNT);
}

/**
 * The speed the wind hears: speed / cruise. Under reduced motion the flying range is halved about cruise (0.75 at
 * brake, 1.4 at boost) and, below brake speed, falls in a straight line to 0, so the wind still drains on landing.
 */
export function windSpeed(speed: number, calm: boolean): number {
  const s = speed / CRUISE;
  if (!calm) return s;
  return s < 0.5 ? 1.5 * s : 1 + 0.5 * (s - 1);
}

/**
 * One mix. Writes into `targets` and `memory` when they are given (the frame loop reuses both, so nothing is
 * allocated); otherwise makes new ones. `hearing` and `census` feed the beds and slots, which arrive with their phases.
 */
export function mix(
  pose: Pose, hearing: Hearing, census: Census, prefs: Prefs, memory: MixMemory = newMemory(), targets: Float32Array = newTargets(),
): { targets: Float32Array; memory: MixMemory } {
  void census;
  const calm = prefs.calm;
  const speed = windSpeed(pose.speed, calm);
  const first = memory.t !== memory.t;
  const dt = first ? 0 : pose.t - memory.t;
  // A stall or a jump of the clock says nothing about how fast speed and bank are changing.
  const usable = dt > 0 && dt <= 0.25;
  if (usable) {
    memory.sDot = ease(memory.sDot, (speed - memory.s) / dt, dt, 0.15);
    const rolling = Math.abs(pose.bank - memory.bank) / dt;
    memory.roll = ease(memory.roll, rolling, dt, 0.06);
    memory.bloom1 = ease(memory.bloom1, rolling, dt, W_BLOOM_TAU);
    memory.bloom2 = ease(memory.bloom2, memory.bloom1, dt, W_BLOOM_TAU);
    // The wind's speed moves toward the dragon's by at most a fixed ratio a second, counted from the floor up.
    const k = Math.exp(WIND_SLEW * dt);
    const from = Math.max(memory.wind, WIND_FLOOR);
    memory.wind = speed > from ? Math.min(speed, from * k) : speed < memory.wind ? Math.max(speed, memory.wind / k < WIND_FLOOR ? 0 : memory.wind / k) : speed;
  } else if (dt !== 0 || first) {
    memory.sDot = 0;
    memory.roll = 0;
    memory.bloom1 = 0;
    memory.bloom2 = 0;
    memory.wind = speed;
  }
  memory.t = pose.t;
  memory.s = speed;
  memory.bank = pose.bank;
  const s = memory.wind;

  const push = calm ? 0 : clamp(memory.sDot / 1.6, 0, 1);
  // The listener faces up the screen, so a bank's outside wing is on the left flying north and on the right flying south.
  const side = Math.sin(pose.heading);
  const bank = pose.bank;
  const lean = Math.abs(bank);
  const rest = clamp(pose.rest, 0, 1);

  targets[T.MASTER] = volumeGain(prefs.volume);
  targets[T.WORLD] = dbToGain(WORLD_BOOST_DB * clamp((speed - 1) / 0.8, 0, 1)) * dbToGain(WORLD_REST_DB * rest);
  targets[T.DUCK] = 1;

  const a = K_WIND.a * Math.pow(s, A_EXP);
  const tilt = calm ? 0 : A_TILT_DB * bank * side;
  targets[T.A_L] = a * dbToGain(-tilt);
  targets[T.A_R] = a * dbToGain(tilt);
  targets[T.A_HZ] = clamp(A_CUT_HZ * s, A_CUT_RANGE[0], A_CUT_RANGE[1]);

  targets[T.B_GAIN] = K_WIND.b * s;
  targets[T.B_HZ] = clamp(B_HZ * s, B_RANGE[0], B_RANGE[1]);

  targets[T.C_GAIN] = K_WIND.c * Math.max(0, s - C_FROM) * (1 + C_PUSH * push);
  targets[T.C_HZ] = C_LOW[0] + C_LOW[1] * s;

  // Whistles are left out on touch devices (the graph has none there).
  targets[T.D_GAIN] = prefs.touch ? 0 : K_WIND.d * Math.max(0, s - D_FROM);
  targets[T.D_RATIO] = Math.max(0.05, s * (1 + 0.03 * lean + 0.05 * push));

  targets[T.E_GAIN] = K_WIND.e * (1 + E_REST * rest);

  const gate = smoothstep(W_GATE[0], W_GATE[1], lean);
  const wanted = calm ? 0 : K_WIND.w * gate * (1 - rest) * (Math.min(1, memory.bloom2 / W_BLOOM_FULL) + W_HOLD * lean * s);
  // Up in a straight line in decibels from the floor; down at once (the send's own time constant is its tail).
  const from = Math.max(memory.whoosh, K_WIND.w * W_FLOOR);
  memory.whoosh = wanted > from && usable ? Math.min(wanted, from * Math.exp(W_RISE * dt)) : Math.min(wanted, usable || wanted === 0 ? wanted : from);
  targets[T.W_GAIN] = memory.whoosh;
  targets[T.W_HZ] = W_HZ[0] + W_HZ[1] * Math.pow(lean, 0.7) * s;
  targets[T.W_PAN] = calm ? 0 : W_PAN * bank * side;

  // The surf bed (§3.2): energies by kind → the four bands; direction and spread from every Area, far surf included.
  const eb = hearing.surf[0].e, es = hearing.surf[1].e, er = hearing.surf[2].e, ef = hearing.far.e;
  targets[T.BED_HISS] = K_SURF.bedHiss * Math.sqrt(eb + 0.6 * es + 0.35 * er);
  targets[T.BED_BODY] = K_SURF.bedBody * Math.sqrt(eb + es + er + 0.25 * ef);
  targets[T.BED_RUMBLE] = K_SURF.bedRumble * Math.sqrt(0.6 * eb + 0.6 * es + er + ef);
  targets[T.BED_RATTLE] = K_SURF.bedRattle * Math.sqrt(es);
  const e = eb + es + er + 0.25 * ef;
  let p = 0, half = BED_SPREAD;
  if (e > 0) {
    const dx = hearing.surf[0].dx + hearing.surf[1].dx + hearing.surf[2].dx + 0.25 * hearing.far.dx;
    const dy = hearing.surf[0].dy + hearing.surf[1].dy + hearing.surf[2].dy + 0.25 * hearing.far.dy;
    p = (PAN * dx) / e;
    // Eased between 0.4 and 0.85: a coast on one side stays together, a cove opens right out.
    half = BED_SPREAD * smoothstep(0.4, 0.85, 1 - Math.sqrt(dx * dx + dy * dy) / e);
  }
  targets[T.BED_PAN_A] = clamp(p - half, -1, 1);
  targets[T.BED_PAN_B] = clamp(p + half, -1, 1);
  // The hiss comes through the air between: the mean distance of the surf that hisses.
  const near = eb + es + er;
  const dMean = near > 0 ? (eb * hearing.surf[0].d + es * hearing.surf[1].d + er * hearing.surf[2].d) / near : 1000;
  targets[T.BED_AIR_HZ] = airCutoff(dMean);
  targets[T.OPEN] = K_SURF.open * smoothstep(0.3, 0.9, hearing.sea);

  return { targets, memory };
}
