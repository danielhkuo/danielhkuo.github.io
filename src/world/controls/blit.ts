// Draws glyph sprites into the frame: each slot's colour over what is there, at the slot's own opacity times the
// sprite's. The frame is packed RGBA as the renderer writes it (red in the low byte).

import { COLOURS, type Sprite } from "./glyphs.ts";

const R = Uint8Array.from(COLOURS, (c) => c[0]);
const G = Uint8Array.from(COLOURS, (c) => c[1]);
const B = Uint8Array.from(COLOURS, (c) => c[2]);
const A = Uint8Array.from(COLOURS, (c) => c[3]);

/** Draws `s` with its top-left at (x, y) into the fw × fh frame `out`, at `alpha` (0–1); off-frame pixels are skipped. */
export function blit(out: Uint32Array, fw: number, fh: number, s: Sprite, x: number, y: number, alpha = 1): void {
  if (alpha <= 0) return;
  const k = Math.min(256, Math.round(alpha * 256));
  const j0 = Math.max(0, -y);
  const j1 = Math.min(s.h, fh - y);
  const i0 = Math.max(0, -x);
  const i1 = Math.min(s.w, fw - x);
  for (let j = j0; j < j1; j++) {
    const src = j * s.w;
    const dst = (y + j) * fw + x;
    for (let i = i0; i < i1; i++) {
      const c = s.px[src + i];
      if (c === 0) continue;
      const w = (A[c] * k) >> 8;
      const o = dst + i;
      if (w >= 255) {
        out[o] = (0xff000000 | (B[c] << 16) | (G[c] << 8) | R[c]) >>> 0;
        continue;
      }
      const p = out[o];
      const r = p & 255;
      const g = (p >>> 8) & 255;
      const b = (p >>> 16) & 255;
      out[o] = (0xff000000 | ((b + (((B[c] - b) * w) >> 8)) << 16) | ((g + (((G[c] - g) * w) >> 8)) << 8) | (r + (((R[c] - r) * w) >> 8))) >>> 0;
    }
  }
}
