// Tiny sprites drawn as rows of characters and coloured from the palette, so small life takes the day's light with the
// land. Also the few helpers the life layers share: wrapping, where a point falls in the frame, and finding the ground.

import type { Palette } from "../look/contract.ts";
import type { LiveFrame } from "./live.ts";
import { worldRowAt, type LiveSprite } from "./sprites.ts";

/** A colour of the palette: material, tone, and coverage 0–255 (255 when left out). */
export type Ink = readonly [material: number, tone: number, alpha?: number];

interface Painted {
  sprite: LiveSprite;
  /** Palette index per pixel, −1 where nothing draws. */
  index: Int32Array;
}

export interface ArtSet {
  /** A sprite from `rows` ('.' is clear; every other character is looked up in `key`); (ax, ay) sits on the world point. */
  add(rows: readonly string[], ax: number, ay: number, key: Readonly<Record<string, Ink>>): LiveSprite;
  /** Recolours every sprite when the palette is a new one or has changed. Call once a frame. */
  sync(palette: Palette): void;
}

export function artSet(): ArtSet {
  const all: Painted[] = [];
  let last: Palette | null = null;
  let probe = -1;
  let probeAt = 0;
  return {
    add(rows, ax, ay, key) {
      const h = rows.length, w = rows[0].length;
      const sprite: LiveSprite = { w, h, rgba: new Uint32Array(w * h), alpha: new Uint8Array(w * h), ax, ay };
      const index = new Int32Array(w * h).fill(-1);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if (c === ".") continue;
        const ink = key[c];
        if (!ink) throw new Error(`no ink for '${c}'`);
        index[y * w + x] = (ink[0] << 8) | ink[1];
        sprite.alpha[y * w + x] = ink[2] ?? 255;
        probeAt = (ink[0] << 8) | ink[1];
      }
      all.push({ sprite, index });
      last = null;
      return sprite;
    },
    sync(palette) {
      if (palette === last && palette[probeAt] === probe) return;
      last = palette;
      probe = palette[probeAt];
      for (let s = 0; s < all.length; s++) {
        const { sprite, index } = all[s];
        for (let i = 0; i < index.length; i++) if (index[i] >= 0) sprite.rgba[i] = palette[index[i]];
      }
    },
  };
}

/** v wrapped into [0, period). */
export function modP(v: number, period: number): number {
  const m = v % period;
  return m < 0 ? m + period : m;
}

/** The shortest way from a to b round a ring of n. */
export function ringDelta(a: number, b: number, n: number): number {
  const d = modP(b - a, n);
  return d > n / 2 ? d - n : d;
}

/**
 * Frame column of world x, taking the image of the torus nearest the frame: in [−margin, w + margin) when it is in
 * reach, else a value outside that.
 */
export function frameX(f: LiveFrame, x: number, margin: number): number {
  return modP(Math.round(x) - f.rect.x + margin, f.n) - margin;
}

/** Frame row of bake row `by` (0.8·y − height), as frameX. */
export function frameY(f: LiveFrame, by: number, margin: number): number {
  return modP(Math.round(by) - f.rect.y + margin, f.n * 0.8) - margin;
}

/**
 * The frame row where the ground at world (column px, row y) is drawn, or −1 when it lies outside the frame or behind
 * nearer land. World rows fall as the frame's rows rise, so this is a bisection of the column.
 */
export function groundRow(f: LiveFrame, px: number, y: number): number {
  const h = f.rect.h;
  // y in the frame's own turn of the torus.
  const mid = (f.rect.y + h / 2) / 0.8;
  const yy = y + Math.round((mid - y) / f.n) * f.n;
  let lo = 0, hi = h - 1;
  if (worldRowAt(f, px, hi) < yy - 0.5) return -1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (worldRowAt(f, px, m) >= yy - 0.5) hi = m;
    else lo = m + 1;
  }
  return worldRowAt(f, px, lo) <= yy + 1.5 ? lo : -1;
}

/** Blends `rgb` over out[i] at `a` (0–255), keeping it opaque. */
export function blend(out: Uint32Array, i: number, rgb: number, a: number): void {
  const dst = out[i];
  const inv = 255 - a;
  const r = ((dst & 255) * inv + (rgb & 255) * a) / 255 | 0;
  const g = (((dst >>> 8) & 255) * inv + ((rgb >>> 8) & 255) * a) / 255 | 0;
  const b = (((dst >>> 16) & 255) * inv + ((rgb >>> 16) & 255) * a) / 255 | 0;
  out[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

export function smooth01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Draws `s` with its anchor on frame pixel (sx, sy), over whatever is there: for things high in the air. */
export function stamp(f: LiveFrame, s: LiveSprite, sx: number, sy: number, flip: boolean): void {
  const w = f.rect.w, h = f.rect.h;
  for (let y = 0; y < s.h; y++) {
    const py = sy - s.ay + y;
    if (py < 0 || py >= h) continue;
    for (let x = 0; x < s.w; x++) {
      const a = s.alpha[y * s.w + x];
      if (a === 0) continue;
      const px = sx - s.ax + (flip ? s.w - 1 - x : x);
      if (px < 0 || px >= w) continue;
      if (a === 255) f.out[py * w + px] = s.rgba[y * s.w + x];
      else blend(f.out, py * w + px, s.rgba[y * s.w + x], a);
    }
  }
}
