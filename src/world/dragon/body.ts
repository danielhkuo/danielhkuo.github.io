// The dragon's pose and the shading of its rounded body.

import type { Chain } from "../runtime/chain.ts";
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
}

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
