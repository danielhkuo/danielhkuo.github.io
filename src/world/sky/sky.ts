// The sky: shapes, sprites and the field made once, then drawn each frame in two
// passes around the flier: cloud shadows, low clouds and banks below it, then
// each bank again as a veil over it, so the flier shows faintly inside the bank.

import type { ViewRect } from "../render/compose.ts";
import { ALT, makeField, type CloudLayer, type SkyField } from "./field.ts";
import { makeShapes, SHADOW_SLOPE, SHAPE_COUNTS, type CloudShape } from "./shapes.ts";
import type { Sprite } from "./sprite.ts";
import type { CloudStyle } from "./styles.ts";

export interface Sky {
  /**
   * `below`: the shadows of low clouds and banks on the land, then the low clouds, then the banks. `above`: the
   * banks again at the style's veil, which changes nothing but what was drawn over them since: the flier.
   */
  draw(out: Uint32Array, rect: ViewRect, t: number, pass: "below" | "above"): void;
  /** The field and the shapes, for tools and tests. */
  field: SkyField;
  shapes: readonly CloudShape[];
}

function modPeriod(v: number, period: number): number {
  const m = v % period;
  return m < 0 ? m + period : m;
}

/** Screen position of the periodic image whose box lands nearest the view, or the one that overhangs it. */
function imageOn(world: number, origin: number, period: number, view: number, sprite: number): number {
  let s = modPeriod(world - origin, period);
  if (s >= view && s - period + sprite > 0) s -= period;
  return s;
}

/**
 * Draws every cloud of `layer` that touches `rect` at time `t`. A cloud's sprite has its top-left at screen
 * (round(x) − rect.x, round(0.8·y) − alt − rect.y), using the torus image nearest the view (x wraps every n,
 * bake rows every 0.8·n). Each channel: out += (sprite − out) · a, with a = alpha · layerAlpha / 255². Pixels
 * outside the frame are skipped, never wrapped onto its other side.
 */
export function drawClouds(
  out: Uint32Array, rect: ViewRect, field: SkyField, sprites: readonly Sprite[], t: number, layer: CloudLayer, layerAlpha: number,
): void {
  if (layerAlpha <= 0) return;
  const n = field.n;
  const yPeriod = n * 0.8;
  const alt = ALT[layer];
  const wind = field.wind;
  const scale = layerAlpha / (255 * 255);
  const clouds = field.clouds;
  const fw = rect.w;
  const fh = rect.h;

  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    if (c.layer !== layer) continue;
    const sprite = sprites[c.shape];
    const sw = sprite.w;
    const sh = sprite.h;
    const x = ((c.x + ((wind.x * t) % n)) % n + n) % n;
    const y = ((c.y + ((wind.y * t) % n)) % n + n) % n;
    const sx = Math.round(imageOn(Math.round(x), rect.x, n, fw, sw));
    const bake = Math.round(y * 0.8) - alt;
    const sy = Math.round(imageOn(bake, rect.y, yPeriod, fh, sh));
    if (sx >= fw || sy >= fh || sx + sw <= 0 || sy + sh <= 0) continue;

    const x0 = sx < 0 ? -sx : 0;
    const y0 = sy < 0 ? -sy : 0;
    const x1 = sx + sw > fw ? fw - sx : sw;
    const y1 = sy + sh > fh ? fh - sy : sh;
    const alpha = sprite.alpha;
    const rgba = sprite.rgba;

    for (let py = y0; py < y1; py++) {
      const di0 = (sy + py) * fw + sx;
      const si = py * sw;
      for (let px = x0; px < x1; px++) {
        const sp = si + px;
        const a8 = alpha[sp];
        if (a8 === 0) continue;
        const di = di0 + px;
        const src = rgba[sp];
        const a = a8 * scale;
        if (a >= 1) {
          out[di] = (src & 0x00ffffff) | 0xff000000;
          continue;
        }
        const dst = out[di];
        const dR = dst & 255;
        const dG = (dst >>> 8) & 255;
        const dB = (dst >>> 16) & 255;
        const r = (dR + ((src & 255) - dR) * a + 0.5) | 0;
        const g = (dG + (((src >>> 8) & 255) - dG) * a + 0.5) | 0;
        const b = (dB + (((src >>> 16) & 255) - dB) * a + 0.5) | 0;
        out[di] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  }
}

/**
 * Draws the shadow of every cloud of `layer` on level ground: the shape's shadow box, moved from the sprite's
 * top-left by (shadow.dx + round(SHADOW_SLOPE·alt), shadow.dy + round((1 + 0.8·SHADOW_SLOPE)·alt)), which is where the
 * sun (the flier's sun) throws it. A shaded pixel keeps keep[k]/256 of red, green and blue.
 */
export function drawShadows(
  out: Uint32Array, rect: ViewRect, field: SkyField, shapes: readonly CloudShape[], t: number, layer: CloudLayer, keep: readonly [number, number, number],
): void {
  const n = field.n;
  const yPeriod = n * 0.8;
  const alt = ALT[layer];
  const wind = field.wind;
  const clouds = field.clouds;
  const fw = rect.w;
  const fh = rect.h;
  const ax = Math.round(SHADOW_SLOPE * alt), ay = Math.round((1 + 0.8 * SHADOW_SLOPE) * alt) - alt;
  const kr = keep[0], kg = keep[1], kb = keep[2];

  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    if (c.layer !== layer) continue;
    const shadow = shapes[c.shape].shadow;
    const sw = shadow.w;
    const sh = shadow.h;
    const x = ((c.x + ((wind.x * t) % n)) % n + n) % n;
    const y = ((c.y + ((wind.y * t) % n)) % n + n) % n;
    const sx = Math.round(imageOn(Math.round(x) + shadow.dx + ax, rect.x, n, fw, sw));
    const sy = Math.round(imageOn(Math.round(y * 0.8) + shadow.dy + ay, rect.y, yPeriod, fh, sh));
    if (sx >= fw || sy >= fh || sx + sw <= 0 || sy + sh <= 0) continue;

    const x0 = sx < 0 ? -sx : 0;
    const y0 = sy < 0 ? -sy : 0;
    const x1 = sx + sw > fw ? fw - sx : sw;
    const y1 = sy + sh > fh ? fh - sy : sh;
    const mask = shadow.mask;
    for (let py = y0; py < y1; py++) {
      const di0 = (sy + py) * fw + sx;
      const si = py * sw;
      for (let px = x0; px < x1; px++) {
        if (mask[si + px] === 0) continue;
        const di = di0 + px;
        const dst = out[di];
        const r = ((dst & 255) * kr) >> 8;
        const g = (((dst >>> 8) & 255) * kg) >> 8;
        const b = (((dst >>> 16) & 255) * kb) >> 8;
        out[di] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  }
}

/**
 * Shapes from SHAPE_COUNTS, painted with the style's painter, and the field, all from `seed`. `opening` is the
 * flight's start: the field composes the first view round it.
 */
export function createSky(seed: number, n: number, style: CloudStyle, opening?: { x: number; y: number }): Sky {
  const shapes = makeShapes(seed, SHAPE_COUNTS);
  const sprites: Sprite[] = new Array(shapes.length);
  for (let i = 0; i < shapes.length; i++) sprites[i] = style.paint(shapes[i]);
  const field = makeField(seed, n, shapes, opening);
  const shadows = style.shadowKeep[0] < 256 || style.shadowKeep[1] < 256 || style.shadowKeep[2] < 256;
  return {
    field,
    shapes,
    draw(out, rect, t, pass) {
      if (pass === "below") {
        if (shadows) {
          drawShadows(out, rect, field, shapes, t, "bank", style.shadowKeep);
          drawShadows(out, rect, field, shapes, t, "low", style.shadowKeep);
        }
        drawClouds(out, rect, field, sprites, t, "low", 255);
        drawClouds(out, rect, field, sprites, t, "bank", 255);
        return;
      }
      drawClouds(out, rect, field, sprites, t, "bank", style.veil);
    },
  };
}
