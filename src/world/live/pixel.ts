// Reading a bake pixel: material | light << 8 | depth << 16, with light = tone | shadow << 4 | ink << 6.
// Live layers use these to find sea, meadow or shore distance under each screen pixel.

import { LIGHT_INK_SHIFT, LIGHT_SHADOW_SHIFT, LIGHT_TONE_MASK } from "../look/contract.ts";

/** Material id (look/materials.ts); 0 where the frame shows haze. */
export const matOf = (v: number): number => v & 255;
/** The whole light byte, as the palette indexes it: PAL[(mat << 8) | light]. */
export const lightOf = (v: number): number => (v >>> 8) & 255;
/** Tone 0–15. On sea and lake pixels it holds the shore distance; on river pixels, the flow phase. */
export const toneOf = (v: number): number => (v >>> 8) & LIGHT_TONE_MASK;
export const shadowOf = (v: number): number => (v >>> (8 + LIGHT_SHADOW_SHIFT)) & 3;
export const inkOf = (v: number): number => (v >>> (8 + LIGHT_INK_SHIFT)) & 3;
/** Depth in eighths of a world row, relative to the pixel's chunk. */
export const depthOf = (v: number): number => v >>> 16;
