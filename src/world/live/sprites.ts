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
 * World row (fractional) of the land drawn at frame pixel (px, py), as WorldView.depthAt gives it: with by = rect.y + py
 * and cy = floor(by / 256), cy · 320 + depth / 8 from the bake pixel. Under haze (bake pixel 0), the sea-level row by / 0.8.
 */
export function worldRowAt(f: LiveFrame, px: number, py: number): number {
  const by = f.rect.y + py;
  const v = f.bake[py * f.rect.w + px];
  if (matOf(v) === 0) return by / 0.8;
  const cy = Math.floor(by / CHUNK);
  return cy * CHUNK_ROWS + (v >>> 16) / 8;
}

/**
 * Draws `s` with its anchor at world (x, y), `alt` units up: screen (round(x) − rect.x, round(0.8·y − alt) − rect.y), using
 * the torus image nearest the view (x every n, bake rows every 0.8·n, with y moved by the same whole number of n for the
 * depth test). A pixel draws where its alpha > 0 and worldRowAt(px, py) ≤ y′ + 1 (land nearer the viewer hides it), as
 * out += (rgba − out) · alpha / 255 per channel, keeping out opaque; mirrored left to right when `flip`. Clipped at the
 * frame's edges, never wrapped across them.
 */
export function drawSprite(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number, flip: boolean): void {
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
      const a8 = alpha[sp];
      if (a8 === 0) continue;
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