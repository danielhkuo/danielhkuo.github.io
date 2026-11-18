// The placeholder painter: the lit colour everywhere, alpha from coverage.

import type { Painter } from "../sprite.ts";

export const paintPlain: Painter = (shape, inks) => {
  const n = shape.w * shape.h;
  const rgba = new Uint32Array(n);
  const alpha = new Uint8Array(n);
  rgba.fill(inks.lit);
  const cover = shape.cover;
  for (let i = 0; i < n; i++) alpha[i] = Math.round(255 * cover[i]);
  return { w: shape.w, h: shape.h, rgba, alpha };
};
