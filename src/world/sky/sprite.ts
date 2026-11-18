// A painted cloud, and the painter that makes one from a shape.

import type { CloudShape } from "./shapes.ts";

/** Colour per pixel (packed RGBA, as the frame) and coverage per pixel (0–255), w·h row-major. */
export interface Sprite {
  w: number;
  h: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
}

/** The colours a painter may use, packed RGBA: sunlit tops, shaded bellies, and the ink. */
export interface CloudInks {
  lit: number;
  shade: number;
  ink: number;
}

/** Midday: cream tops, cool blue-grey bellies, the house ink (#2e2a24). */
export const MIDDAY_INKS: CloudInks = { lit: 0xffeaf4f8, shade: 0xffccc4b8, ink: 0xff242a2e };

/** Paints one shape. Pure and deterministic in (shape, inks, seed). */
export type Painter = (shape: CloudShape, inks: CloudInks, seed: number) => Sprite;
