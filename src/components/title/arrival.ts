// The order the world's pixels switch on behind the title. The frame starts as blank paper and fills
// outward from the dragon; an ordered dither breaks the ring into hard steps, so the world never fades.

/** Slow enough to watch the world arrive, one pixel step at a time. */
export const ARRIVAL_MS = 2800;

// The standard 8x8 Bayer matrix, values 0..63, read at (y & 7) * 8 + (x & 7). The same tile everywhere,
// so pixels at one distance do not all switch on together.
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** One threshold in [0, 1] per pixel, row-major. A smaller value arrives sooner. */
export function arrivalOrder(w: number, h: number, cx: number, cy: number): Float32Array {
  const order = new Float32Array(w * h);
  // A fraction of the frame's diagonal: on a centred dragon the wave passes the far corners while the
  // dither is still playing. Vertical distance counts a little extra, so the front stays wide.
  const reach = Math.hypot(w, h) * 0.62;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) * 1.25;
    const row = y * w;
    const bayerRow = (y & 7) * 8;
    for (let x = 0; x < w; x++) {
      const d = Math.min(1, Math.hypot(x - cx, dy) / reach);
      const raw = d * 0.8 + (BAYER8[bayerRow + (x & 7)] / 64) * 0.2;
      order[row + x] = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    }
  }
  return order;
}

/**
 * Paper (opaque) where the world has not arrived, and fully clear where it has. Nothing in between,
 * so a pixel never fades. One loop and no allocation: this repaints the whole frame every frame.
 */
export function paperOver(order: Float32Array, p: number, out: Uint8ClampedArray, paper: [number, number, number]): void {
  const r = paper[0];
  const g = paper[1];
  const b = paper[2];
  for (let i = 0; i < order.length; i++) {
    const o = i * 4;
    if (order[i] > p) {
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    } else {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }
}
