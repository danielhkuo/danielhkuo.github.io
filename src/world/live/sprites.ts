// Small things that move over the land (gulls, boats, sheep, rare sights): a sprite drawn at a world point and height,
// hidden behind land nearer the viewer, wrapping with the world.

import { CHUNK, CHUNK_ROWS } from "../bake/chunk.ts";
import type { LiveFrame } from "./live.ts";
import { matOf } from "./pixel.ts";

/** Colour (packed RGBA) and coverage (0–255) per pixel, w·h row-major; (ax, ay) is the pixel that sits on the world point. */
export interface LiveSprite {
  w: number;
  h: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
  ax: number;
  ay: number;
}

function modPeriod(v: number, period: number): number {
  const m = v % period;
  return m < 0 ? m + period : m;
}

function imageOn(world: number, origin: number, period: number, view: number, sprite: number): number {
  let s = modPeriod(world - origin, period);
  if (s >= view && s - period + sprite > 0) s -= period;
  return s;
}

/**
 * The bake pixel under frame pixel (px, py), whole numbers, which may lie past the frame's edge: the frame's own on it,
 * the land's beyond it (f.bakeSpace; 0 where none is baked, or without one). Things are placed by the land under them
 * through this, so a thing is placed the same wherever the frame's edge falls.
 */
export function bakeAt(f: LiveFrame, px: number, py: number): number {
  const w = f.rect.w;
  if (px >= 0 && py >= 0 && px < w && py < f.rect.h) return f.bake[py * w + px];
  return f.bakeSpace ? f.bakeSpace(f.rect.x + px, f.rect.y + py) : 0;
}

/** The bake pixels of the bw × bh box whose top-left is frame pixel (x0, y0), row by row into `into`, as bakeAt reads them. */
export function bakeBox(f: LiveFrame, x0: number, y0: number, bw: number, bh: number, into: Uint32Array): void {
  const w = f.rect.w, h = f.rect.h;
  // The columns of the box that lie on the frame, copied from it a row at a time; the rest from the land.
  const c0 = x0 < 0 ? -x0 : 0, c1 = x0 + bw > w ? w - x0 : bw;
  for (let r = 0; r < bh; r++) {
    const py = y0 + r, row = r * bw;
    if (py < 0 || py >= h || c0 >= c1) {
      for (let c = 0; c < bw; c++) into[row + c] = bakeAt(f, x0 + c, py);
      continue;
    }
    for (let c = 0; c < c0; c++) into[row + c] = bakeAt(f, x0 + c, py);
    into.set(f.bake.subarray(py * w + x0 + c0, py * w + x0 + c1), row + c0);
    for (let c = c1; c < bw; c++) into[row + c] = bakeAt(f, x0 + c, py);
  }
}

/**
 * World row (fractional) of the land drawn at frame pixel (px, py), on the frame or past its edge (see bakeAt), as
 * WorldView.depthAt gives it: with by = rect.y + py and cy = floor(by / 256), cy · 320 + depth / 8 from the bake pixel.
 * Under haze (bake pixel 0), the sea-level row by / 0.8.
 */
export function worldRowAt(f: LiveFrame, px: number, py: number): number {
  const by = f.rect.y + py;
  const v = bakeAt(f, px, py);
  if (matOf(v) === 0) return by / 0.8;
  const cy = Math.floor(by / CHUNK);
  return cy * CHUNK_ROWS + (v >>> 16) / 8;
}

/**
 * Draws `s` with its anchor at world (x, y), `alt` units up: screen (round(x) − rect.x, round(0.8·y − alt) − rect.y), using
 * the torus image nearest the view (x every n, bake rows every 0.8·n, with y moved by the same whole number of n for the
 * depth test). A pixel draws where its alpha > 0 and worldRowAt(px, py) ≤ y′ + 1 (land nearer the viewer hides it), as
 * out += (rgba − out) · alpha / 255 per channel, keeping out opaque; mirrored left to right when `flip`. Clipped at the
 * frame's edges, never wrapped across them. `cover` (0–255) scales every pixel's alpha; 255 leaves it unchanged.
 */
export function drawSprite(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number, flip: boolean, cover = 255): void {
  if (cover <= 0) return;
  const fade = cover >= 255 ? 255 : cover;
  const { out, rect, n } = f;
  const fw = rect.w;
  const fh = rect.h;
  const sw = s.w;
  const sh = s.h;
  const yPeriod = n * 0.8;
  const wx = Math.round(x);
  const bakeY = Math.round(0.8 * y - alt);
  const anchorSx = Math.round(imageOn(wx, rect.x, n, fw, sw));
  const anchorSy = Math.round(imageOn(bakeY, rect.y, yPeriod, fh, sh));
  const k = Math.round((bakeY - (rect.y + anchorSy)) / yPeriod);
  const yPrime = y + k * n;
  const sx0 = anchorSx - s.ax;
  const sy0 = anchorSy - s.ay;
  const depthCut = yPrime + 1;
  const rgba = s.rgba;
  const alpha = s.alpha;

  const yEnd = sh < fh - sy0 ? sh : fh - sy0;
  const yStart = sy0 < 0 ? -sy0 : 0;
  for (let py = yStart; py < yEnd; py++) {
    const screenY = sy0 + py;
    const siRow = py * sw;
    const diRow = screenY * fw;
    for (let px = 0; px < sw; px++) {
      const screenX = sx0 + (flip ? sw - 1 - px : px);
      if (screenX < 0 || screenX >= fw) continue;
      const sp = siRow + px;
      let a8 = alpha[sp];
      if (a8 === 0) continue;
      if (fade < 255) {
        a8 = (a8 * fade) / 255 | 0;
        if (a8 === 0) continue;
      }
      if (worldRowAt(f, screenX, screenY) > depthCut) continue;
      const di = diRow + screenX;
      const src = rgba[sp];
      if (a8 === 255) {
        out[di] = (src & 0x00ffffff) | 0xff000000;
        continue;
      }
      const dst = out[di];
      const t = a8;
      const inv = 255 - t;
      const dR = dst & 255;
      const dG = (dst >>> 8) & 255;
      const dB = (dst >>> 16) & 255;
      const r = (dR * inv + (src & 255) * t) / 255 | 0;
      const g = (dG * inv + ((src >>> 8) & 255) * t) / 255 | 0;
      const b = (dB * inv + ((src >>> 16) & 255) * t) / 255 | 0;
      out[di] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
  }
}