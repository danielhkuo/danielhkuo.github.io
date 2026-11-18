// The sky: shapes, sprites and the field made once, then drawn each frame in two
// passes around the flier: low clouds below it, banks and high streaks above it.

import type { ViewRect } from "../render/compose.ts";
import type { CloudLayer, SkyField } from "./field.ts";
import type { Sprite } from "./sprite.ts";
import type { CloudStyle } from "./styles.ts";

export interface Sky {
  /** `below`: low clouds at the style's lowAlpha. `above`: banks at bankAlpha, then high streaks if the style has them. */
  draw(out: Uint32Array, rect: ViewRect, t: number, pass: "below" | "above"): void;
  /** The field, for tools and tests. */
  field: SkyField;
}

/** Shapes from SHAPE_COUNTS, painted with the style's painter (MIDDAY_INKS), and the field, all from `seed`. */
export function createSky(seed: number, n: number, style: CloudStyle): Sky {
  void seed;
  void n;
  void style;
  throw new Error("not implemented");
}

/**
 * Draws every cloud of `layer` that touches `rect` at time `t`. A cloud's sprite has its top-left at screen
 * (round(x) − rect.x, round(0.8·y) − alt − rect.y), using the torus image nearest the view (x wraps every n,
 * bake rows every 0.8·n), mirrored left to right when `flip`. Each channel: out += (sprite − out) · a, with
 * a = alpha · layerAlpha / 255². Pixels outside the frame are skipped, never wrapped onto its other side.
 */
export function drawClouds(
  out: Uint32Array, rect: ViewRect, field: SkyField, sprites: readonly Sprite[], t: number, layer: CloudLayer, layerAlpha: number,
): void {
  void out;
  void rect;
  void field;
  void sprites;
  void t;
  void layer;
  void layerAlpha;
  throw new Error("not implemented");
}
