// The dragon's pose and the shading of its rounded body.

import type { Chain } from "../runtime/chain.ts";
import { CRUISE } from "../runtime/flight.ts";
import type { Look } from "./look.ts";
import type { Shade } from "./vox.ts";

/** Where the dragon is in its motion this frame. */
export interface Pose {
  /** The head's remembered path. */
  chain: Chain;
  /** World size, cells. */
  n: number;
  /** Seconds, for small sways and flutters. */
  time: number;
  /** The undulation's phase, radians: it runs faster at speed. */
  wave: number;
  /** Width of the undulation's swing: 1 in flight, settling to REST_SWING while the dragon rests. */
  swing: number;
  /**
   * How hard its own speed throws it about: 1 at cruising speed and above, 0 at rest. A turn rolls the body and flings
   * the mane, the whiskers and the fin wide only as far as it is moving; at rest it lies flat and they hang.
   */
  vigour: number;
  /** The share of the way to the ground the body is to sink before it is next drawn (the draw knows the land). */
  settle: number;
}

/** Resting, a point of the body's path lies this far over the ground: the body's own half-height. */
export const REST_HEIGHT = 1.4;
/** The swing at rest: the coil only breathes. */
export const REST_SWING = 0.2;
/** Rate (per second) at which the swing settles or widens. */
export const SWING_EASE = 2;
/** Rate (per second) at which the vigour follows the speed. */
export const VIGOUR_EASE = 5;
/** Rate (per second) at which a resting body sinks onto the ground, and the steepest it bends over a drop (height per cell). */
export const SETTLE_RATE = 6;
export const SETTLE_SLOPE = 0.8;

/** A rounded body: shaded underside, lit top. */
export function skinOf(look: Look): Shade {
  return (_x, _y, _z, t) => (t < 0.3 ? look.bodyDark : t > 0.75 ? look.bodyLight : look.body);
}

/** 0 → 1 over 0 … 1, eased at both ends. */
export function smooth(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** Radii are built in quarter-pixel steps. */
export const RING_STEP = 0.25;

/** Seconds for one wave to pass down the body at cruising speed. */
export const WAVE_PERIOD = 2.4;

/** The wave's speed at flying speed `speed`, radians a second: it quickens with speed, so a boost tightens the undulation. */
export function waveRate(speed: number): number {
  return ((2 * Math.PI) / WAVE_PERIOD) * (0.5 + (0.5 * speed) / CRUISE);
}
