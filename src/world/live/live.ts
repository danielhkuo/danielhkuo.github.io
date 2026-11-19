// Live layers: what moves each frame over the baked land (waves, river streaks, wind in the grass, small life).
// The stream view runs them after compositing and before the paper grain, so the grain lies over them too.

import type { Palette } from "../look/contract.ts";
import type { ViewRect } from "../render/compose.ts";
import type { Air } from "../sky/air.ts";

/** One frame, as the layers see it. `bake[i]` is the bake pixel under out[i] (see pixel.ts), 0 where haze shows. */
export interface LiveFrame {
  out: Uint32Array;
  bake: Uint32Array;
  rect: ViewRect;
  /** Seconds. */
  t: number;
  palette: Palette;
  /** World size in cells: positions wrap every n, bake rows every 0.8·n. */
  n: number;
  /** The flier this frame, when there is one: for layers that react to it (birds scattering, a bell as it passes). */
  flier?: Flier;
  /**
   * Changes whenever the land the view can draw changes (a chunk baked or dropped). While it stays the same, the land
   * under a moved camera is the land from before, shifted: layers that cache work from the land can trust it.
   */
  bakeVersion?: number;
  /** The light and weather (sky/air.ts): night, rain, mist. Absent is a clear noon. */
  air?: Air;
}

/** Where the flier is: world cells, units up, heading in radians (0 east, π/2 south), cells a second. */
export interface Flier {
  x: number;
  y: number;
  alt: number;
  heading: number;
  speed: number;
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
  for (const layer of layers) {
    if (disabled.has(layer.name)) continue;
    try {
      layer.draw(f);
    } catch (e) {
      disabled.add(layer.name);
      const message = e instanceof Error ? e.message : String(e);
      onError?.(layer.name, message);
    }
  }
}
