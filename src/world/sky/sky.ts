// The sky: shapes, sprites and the field made once, then drawn each frame in two
// passes around the flier: low clouds below it, banks and high streaks above it.

import type { ViewRect } from "../render/compose.ts";
import { BANK_ALT, HIGH_ALT, LOW_ALT, makeField, type CloudLayer, type SkyField } from "./field.ts";
import { makeShapes, SHAPE_COUNTS } from "./shapes.ts";
import { MIDDAY_INKS, type Sprite } from "./sprite.ts";
import type { CloudStyle } from "./styles.ts";

export interface Sky {
  /** `below`: low clouds at the style's lowAlpha. `above`: banks at bankAlpha, then high streaks if the style has them. */
  draw(out: Uint32Array, rect: ViewRect, t: number, pass: "below" | "above"): void;
  /** The field, for tools and tests. */
  field: SkyField;
}

const ALT: Readonly<Record<CloudLayer, number>> = { low: LOW_ALT, bank: BANK_ALT, high: HIGH_ALT };

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
 * bake rows every 0.8·n), mirrored left to right when `flip`. Each channel: out += (sprite − out) · a, with
 * a = alpha · layerAlpha / 255². Pixels outside the frame are skipped, never wrapped onto its other side.
 */
export function drawClouds(
  out: Uint32Array, rect: ViewRect, field: SkyField, sprites: readonly Sprite[], t: number, layer: CloudLayer, layerAlpha: number,
): void {
  if (layerAlpha <= 0) return;
  const n = field.n;
  const yPeriod = n * 0.8;
  const alt = ALT[layer];
  const wind = layer === "high" ? field.highWind : field.wind;
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
    const flip = c.flip;

    for (let py = y0; py < y1; py++) {
      const di0 = (sy + py) * fw + sx;
      const si = py * sw;
      for (let px = x0; px < x1; px++) {
        const sp = si + (flip ? sw - 1 - px : px);
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

/** Shapes from SHAPE_COUNTS, painted with the style's painter (MIDDAY_INKS), and the field, all from `seed`. */
export function createSky(seed: number, n: number, style: CloudStyle): Sky {
  const shapes = makeShapes(seed, SHAPE_COUNTS);
  const sprites: Sprite[] = new Array(shapes.length);
  for (let i = 0; i < shapes.length; i++) sprites[i] = style.paint(shapes[i], MIDDAY_INKS, seed + i);
  const field = makeField(seed, n, shapes, style.high);
  return {
    field,
    draw(out, rect, t, pass) {
      if (pass === "below") {
        drawClouds(out, rect, field, sprites, t, "low", style.lowAlpha);
        return;
      }
      drawClouds(out, rect, field, sprites, t, "bank", style.bankAlpha);
      if (style.high) drawClouds(out, rect, field, sprites, t, "high", 200);
    },
  };
}
