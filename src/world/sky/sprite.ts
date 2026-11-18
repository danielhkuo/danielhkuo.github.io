// A painted cloud, and the painter that makes one from a shape.

import type { CloudShape } from "./shapes.ts";

/** Colour per pixel (packed RGBA, as the frame) and coverage per pixel (0–255), w·h row-major. */
export interface Sprite {
  w: number;
  h: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
}

/** Paints one shape. Pure and deterministic in the shape. */
export type Painter = (shape: CloudShape) => Sprite;
