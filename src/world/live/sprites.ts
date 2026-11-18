// Small things that move over the land (gulls, boats, sheep, rare sights): a sprite drawn at a world point and height,
// hidden behind land nearer the viewer, wrapping with the world.

import type { LiveFrame } from "./live.ts";

/** Colour (packed RGBA) and coverage (0–255) per pixel, w·h row-major; (ax, ay) is the pixel that sits on the world point. */
export interface LiveSprite {
  w: number;
  h: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
  ax: number;
  ay: number;
}

/**
 * World row (fractional) of the land drawn at frame pixel (px, py), as WorldView.depthAt gives it: with by = rect.y + py
 * and cy = floor(by / 256), cy · 320 + depth / 8 from the bake pixel. Under haze (bake pixel 0), the sea-level row by / 0.8.
 */
export function worldRowAt(f: LiveFrame, px: number, py: number): number {
  void f;
  void px;
  void py;
  throw new Error("not implemented");
}

/**
 * Draws `s` with its anchor at world (x, y), `alt` units up: screen (round(x) − rect.x, round(0.8·y − alt) − rect.y), using
 * the torus image nearest the view (x every n, bake rows every 0.8·n, with y moved by the same whole number of n for the
 * depth test). A pixel draws where its alpha > 0 and worldRowAt(px, py) ≤ y′ + 1 (land nearer the viewer hides it), as
 * out += (rgba − out) · alpha / 255 per channel, keeping out opaque; mirrored left to right when `flip`. Clipped at the
 * frame's edges, never wrapped across them.
 */
export function drawSprite(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number, flip: boolean): void {
  void f;
  void s;
  void x;
  void y;
  void alt;
  void flip;
  throw new Error("not implemented");
}
