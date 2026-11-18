// Frame strips: a view of the shipped world drawn at several moments, with the live layers, the clouds and the
// stand-in kite, to judge motion.
//
//   npm run world:live -- [--view start|town|abbey|falls|river|peak|sea|all] [--at x,y] [--frames 6] [--dt 0.25]
//                         [--t 0] [--clouds <style>|none]
//
// Writes .cache/world-live/<view>.png (the frames side by side at 2×) and <view>-<k>.png for each frame.

import type { LiveLayer } from "../live/live.ts";
import type { Manifest } from "../pack/manifest.ts";
import type { CloudStyle } from "../sky/styles.ts";

export interface StripOptions {
  bin: Uint8Array;
  manifest: Manifest;
  mask: Uint8Array;
  /** The camera's world point (the kite flies here, heading north, 18 units over the ground). */
  x: number;
  y: number;
  /** Seconds, one frame each. */
  times: readonly number[];
  layers: readonly LiveLayer[];
  /** The cloud style to draw, or null for none. */
  clouds: CloudStyle | null;
  width?: number;
  height?: number;
}

/**
 * Draws one 400×225 frame (or width × height) per time: the stream view over the decoded world with every chunk baked
 * in-process (createBakeHost) before drawing, the layers run by the view, then sky below, the kite, sky above.
 */
export async function renderStrip(o: StripOptions): Promise<Uint32Array[]> {
  void o;
  throw new Error("not implemented");
}

/**
 * Named views on the shipped world: start (the manifest start), town and abbey (their sites), falls (the tallest
 * waterfall, from the decoded world's `falls`), river (the abbey site's river point, else a river vertex near the start),
 * peak (the highest ground), sea (600 cells off the start along −(dx, dy)).
 */
export async function namedViews(bin: Uint8Array, manifest: Manifest): Promise<Record<string, { x: number; y: number }>> {
  void bin;
  void manifest;
  throw new Error("not implemented");
}

/** The command line; 0 on success. */
export async function main(argv: readonly string[]): Promise<number> {
  void argv;
  throw new Error("not implemented");
}
