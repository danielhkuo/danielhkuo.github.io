// A painted cloud, and the painter that makes one from a shape.

import type { CloudShape } from "./shapes.ts";

/** Colour per pixel (packed RGBA, as the frame) and coverage per pixel (0–255), w·h row-major. */
export interface Sprite {
  w: number;
  h: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
  /** Per pixel, which colour of its painter's ramp it took (RIM_TONE for the rim): to paint it again in other light. */
  tone?: Uint8Array;
}

/** A sprite's `tone` for a pixel on the rim. */
export const RIM_TONE = 254;

/** Paints one shape. Pure and deterministic in the shape. */
export type Painter = (shape: CloudShape) => Sprite;
