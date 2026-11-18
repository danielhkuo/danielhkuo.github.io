// Live layers: what moves each frame over the baked land (waves, river streaks, wind in the grass, small life).
// The stream view runs them after compositing and before the paper grain, so the grain lies over them too.

import type { Palette } from "../look/contract.ts";
import type { ViewRect } from "../render/compose.ts";

/** One frame, as the layers see it. `bake[i]` is the bake pixel under out[i] (see pixel.ts), 0 where haze shows. */
export interface LiveFrame {
  out: Uint32Array;
  bake: Uint32Array;
  rect: ViewRect;
  /** Seconds. */
  t: number;
  palette: Palette;
}

export interface LiveLayer {
  name: string;
  draw(f: LiveFrame): void;
}

/**
 * Runs `layers` in order on `f`. A layer that throws is reported once through `onError` (its name and the message) and
 * skipped on every later call with the same `disabled` set; the others still run.
 */
export function runLayers(layers: readonly LiveLayer[], f: LiveFrame, disabled: Set<string>, onError?: (name: string, message: string) => void): void {
  void layers;
  void f;
  void disabled;
  void onError;
  throw new Error("not implemented");
}
