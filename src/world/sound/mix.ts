// The mix: the dragon's pose, what the ear heard, the point sources alive and the listener's choices → one array of
// targets for the graph (design §3). Pure: the only state is the small `memory` handed in and out.
//
// This file holds the wind, the whoosh, the world bus and the volume. The beds, slots and the bell duck join it with
// their phases.

import {
  A_CUT_HZ, A_CUT_RANGE, A_EXP, A_TILT_DB, B_HZ, B_RANGE, C_FROM, C_LOW, C_PUSH, D_FROM, E_REST, K_WIND, W_GATE, W_HZ, W_PAN, WIND_FLOOR, WIND_SLEW,
  WORLD_BOOST_DB, WORLD_REST_DB,
} from "./levels.ts";
import { volumeGain } from "./prefs.ts";
import { clamp, dbToGain, ease, smoothstep } from "./space.ts";
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
  COUNT: 16,
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
  return r;
})();

/** Gains under this are silence: a target is sent once as it crosses, then left alone. */
const FLOOR = 1e-3;

/** True when target `i` has moved from `last` (the value last sent; NaN when none was) to `next` by enough to send. */
export function moved(i: number, last: number, next: number): boolean {
  if (last !== last) return true;
  const rule = SEND[i];
  if (rule.unit === "pan") return Math.abs(next - last) >= rule.by;
  if (rule.unit === "gain") {
    const a = Math.max(last, FLOOR), b = Math.max(next, FLOOR);
    if (a === b) return false;
    return Math.abs(20 * Math.log10(b / a)) >= rule.by;
  }
  if (!(last > 0) || !(next > 0)) return last !== next;
  return Math.abs(1200 * Math.log2(next / last)) >= rule.by;
}

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
}

export function newMemory(): MixMemory {
  return { t: NaN, s: 0, wind: 0, sDot: 0, bank: 0, roll: 0 };
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
  void hearing;
  void census;
  const calm = prefs.calm;
  const speed = windSpeed(pose.speed, calm);
  const first = memory.t !== memory.t;
  const dt = first ? 0 : pose.t - memory.t;
  // A stall or a jump of the clock says nothing about how fast speed and bank are changing.
  const usable = dt > 0 && dt <= 0.25;
  if (usable) {
    memory.sDot = ease(memory.sDot, (speed - memory.s) / dt, dt, 0.15);
    memory.roll = ease(memory.roll, Math.abs(pose.bank - memory.bank) / dt, dt, 0.06);
    // The wind's speed moves toward the dragon's by at most a fixed ratio a second, counted from the floor up.
    const k = Math.exp(WIND_SLEW * dt);
    const from = Math.max(memory.wind, WIND_FLOOR);
    memory.wind = speed > from ? Math.min(speed, from * k) : speed < memory.wind ? Math.max(speed, memory.wind / k < WIND_FLOOR ? 0 : memory.wind / k) : speed;
  } else if (dt !== 0 || first) {
    memory.sDot = 0;
    memory.roll = 0;
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
  targets[T.W_GAIN] = calm ? 0 : K_WIND.w * gate * (1 - rest) * (0.7 * Math.min(1, memory.roll / 4) + 0.3 * lean * s);
  targets[T.W_HZ] = W_HZ[0] + W_HZ[1] * Math.pow(lean, 0.7) * s;
  targets[T.W_PAN] = calm ? 0 : W_PAN * bank * side;

  return { targets, memory };
}
