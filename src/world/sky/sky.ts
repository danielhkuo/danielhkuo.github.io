// The sky: shapes, sprites and the field made once, then drawn each frame in two
// passes around the flier: cloud shadows, low clouds and banks below it, then
// each bank again as a veil over it, so the flier shows faintly inside the bank.

import type { ViewRect } from "../render/compose.ts";
import { gradeRgb } from "../render/palette.ts";
import type { Air } from "./air.ts";
import { ALT, makeField, weatherClouds, type CloudLayer, type Opening, type SkyField } from "./field.ts";
import { MIDDAY_RAMP, type Ramp } from "./paint/cumulus.ts";
import { makeShapes, SHADOW_SLOPE, SHAPE_COUNTS, type CloudShape } from "./shapes.ts";
import { RIM_TONE, type Sprite } from "./sprite.ts";
import type { CloudStyle } from "./styles.ts";

export interface Sky {
  /**
   * `below`: the shadows of low clouds and banks on the land, then the low clouds, then the banks. `above`: the
   * banks again at the style's veil, which changes nothing but what was drawn over them since: the flier.
   */
  draw(out: Uint32Array, rect: ViewRect, t: number, pass: "below" | "above"): void;
  /**
   * The light and the weather: clouds take the day's light (painted again only when it has moved a step), grey and
   * gather as the weather builds, and their shadows soften under overcast and at night.
   */
  setAir(air: Air): void;
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
 * Whether a box `sprite` wide whose near edge is about `u` past the view's origin (on a ring of `period`) could touch a
 * view `view` wide: a cheap test that never says no to a box imageOn would put on the frame. The exact place rounds
 * the position (half a pixel) and takes it round the ring with `%` (a hair of float error); the two-pixel margin
 * covers both, so only boxes well clear of the frame are passed over.
 */
function mayShow(u: number, period: number, view: number, sprite: number): boolean {
  const s = u - period * Math.floor(u / period);
  return s < view + 2 || s > period - sprite - 2;
}

/**
 * Draws every cloud of `layer` that touches `rect` at time `t`. A cloud's sprite has its top-left at screen
 * (round(x) − rect.x, round(0.8·y) − alt − rect.y), using the torus image nearest the view (x wraps every n,
 * bake rows every 0.8·n). Each channel: out += (sprite − out) · a, with a = alpha · layerAlpha / 255². Pixels
 * outside the frame are skipped, never wrapped onto its other side. `cull` (default) passes over clouds far from the
 * frame before placing them exactly; false places every cloud, the plain path the tests hold it to.
 */
export function drawClouds(
  out: Uint32Array, rect: ViewRect, field: SkyField, sprites: readonly Sprite[], t: number, layer: CloudLayer, layerAlpha: number,
  cull = true, cloudiness = 0,
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
  // The wind's drift, the same for every cloud.
  const wx = (wind.x * t) % n;
  const wy = (wind.y * t) % n;

  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    if (c.layer !== layer) continue;
    // A weather cloud shows once the weather has built past its need, condensing over a short span.
    let cover = scale;
    if (c.need !== undefined) {
      if (cloudiness <= c.need) continue;
      const k = (cloudiness - c.need) / CONDENSE;
      if (k < 1) cover = scale * k * k * (3 - 2 * k);
    }
    const sprite = sprites[c.shape];
    const sw = sprite.w;
    const sh = sprite.h;
    // Most clouds are far off: pass them over before the exact place, which takes six `%` of floats.
    if (cull && (!mayShow(c.x + wx - rect.x, n, fw, sw) || !mayShow(0.8 * (c.y + wy) - alt - rect.y, yPeriod, fh, sh))) continue;
    const x = ((c.x + wx) % n + n) % n;
    const y = ((c.y + wy) % n + n) % n;
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
        const a = a8 * cover;
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
 * sun (the flier's sun) throws it. A shaded pixel keeps keep[k]/256 of red, green and blue. `cull` as for drawClouds.
 */
export function drawShadows(
  out: Uint32Array, rect: ViewRect, field: SkyField, shapes: readonly CloudShape[], t: number, layer: CloudLayer, keep: readonly [number, number, number],
  cull = true, cloudiness = 0,
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
  const wx = (wind.x * t) % n;
  const wy = (wind.y * t) % n;

  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    if (c.layer !== layer) continue;
    if (c.need !== undefined && cloudiness < c.need + CONDENSE * 0.5) continue;
    const shadow = shapes[c.shape].shadow;
    const sw = shadow.w;
    const sh = shadow.h;
    if (cull && (!mayShow(c.x + wx + shadow.dx + ax - rect.x, n, fw, sw) || !mayShow(0.8 * (c.y + wy) + shadow.dy + ay - rect.y, yPeriod, fh, sh))) continue;
    const x = ((c.x + wx) % n + n) % n;
    const y = ((c.y + wy) % n + n) % n;
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

/** The span of cloudiness over which a weather cloud condenses from nothing to whole. */
const CONDENSE = 0.12;

/** Before rain the clouds go grey: the storm ramp each tone of the midday one goes toward, rim first. */
const STORM: readonly number[] = [0xffd6cec8, 0xffe4dcd6, 0xffd0c4bc, 0xffb8a8a0, 0xffa08e88, 0xff86746e];
/** How far toward the storm ramp a fully built sky goes. */
const STORM_SHARE = 0.85;

function mixRgb(a: number, b: number, t: number): number {
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
  const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
  return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** The cloud ramp in this air: the midday ramp greyed toward the storm by the built cloud, then graded with the light. */
export function rampIn(air: Air): Ramp {
  const o = { time: air.time, season: air.season, overcast: air.overcast * 0.5, mist: air.mist };
  const k = STORM_SHARE * air.cloud;
  const one = (c: number, storm: number): number => gradeRgb(k > 0 ? mixRgb(c, storm, k) : c, o);
  return { rim: one(MIDDAY_RAMP.rim, STORM[0]), tones: MIDDAY_RAMP.tones.map((c, i) => one(c, STORM[i + 1])), cuts: MIDDAY_RAMP.cuts };
}

/** Paints every sprite again in `ramp`, by the tone each pixel took. Sprites without tones are left as they are. */
function repaint(sprites: readonly Sprite[], ramp: Ramp): void {
  for (const s of sprites) {
    const tone = s.tone;
    if (!tone) continue;
    for (let i = 0; i < tone.length; i++) {
      if (s.alpha[i] === 0) continue;
      s.rgba[i] = tone[i] === RIM_TONE ? ramp.rim : ramp.tones[tone[i]];
    }
  }
}

/** Steps the air is cut into before the clouds are painted again: time, cloud, overcast and mist. */
const TIME_STEPS = 96;
const WEATHER_STEPS = 16;

/**
 * Shapes from SHAPE_COUNTS, painted with the style's painter, and the field, all from `seed`. `opening` is the
 * flight's start: the field composes the first view round it.
 */
export function createSky(seed: number, n: number, style: CloudStyle, opening?: Opening): Sky {
  const shapes = makeShapes(seed, SHAPE_COUNTS);
  const sprites: Sprite[] = new Array(shapes.length);
  for (let i = 0; i < shapes.length; i++) sprites[i] = style.paint(shapes[i]);
  const field = makeField(seed, n, shapes, opening);
  // Each layer's clouds on their own, in the field's order, so a pass over the few banks does not walk every low cloud.
  const low: SkyField = { ...field, clouds: field.clouds.filter((c) => c.layer === "low") };
  const banks: SkyField = { ...field, clouds: field.clouds.filter((c) => c.layer === "bank") };
  // With the weather's clouds among them, north to south, for when the weather has built.
  const gathered: SkyField = { ...field, clouds: [...low.clouds, ...weatherClouds(seed, n, shapes)].sort((a, b) => a.y - b.y || a.x - b.x) };
  let keep: readonly [number, number, number] = style.shadowKeep;
  let cloudiness = 0;
  let painted = "";
  return {
    field,
    shapes,
    setAir(air) {
      cloudiness = air.cloud;
      // Shadows soften as the sky greys over and as the light goes.
      const soft = (1 - 0.85 * Math.max(air.overcast, air.cloud)) * (1 - 0.8 * air.night);
      const sk = style.shadowKeep;
      keep = [Math.round(256 - (256 - sk[0]) * soft), Math.round(256 - (256 - sk[1]) * soft), Math.round(256 - (256 - sk[2]) * soft)];
      const key = `${Math.round(air.time * TIME_STEPS)} ${Math.round(air.cloud * WEATHER_STEPS)} ${Math.round(air.overcast * WEATHER_STEPS)} ${Math.round(air.mist * WEATHER_STEPS)}`;
      if (key === painted) return;
      // The first air seen is noon's plain light: the sprites are as the painter left them.
      const plain = air.cloud === 0 && air.overcast === 0 && air.mist === 0 && Math.abs(air.time - 0.5) < 0.14;
      if (plain && painted === "") {
        painted = key;
        return;
      }
      painted = key;
      repaint(sprites, rampIn({
        ...air,
        time: Math.round(air.time * TIME_STEPS) / TIME_STEPS,
        cloud: Math.round(air.cloud * WEATHER_STEPS) / WEATHER_STEPS,
        overcast: Math.round(air.overcast * WEATHER_STEPS) / WEATHER_STEPS,
        mist: Math.round(air.mist * WEATHER_STEPS) / WEATHER_STEPS,
      }));
    },
    draw(out, rect, t, pass) {
      const lows = cloudiness > 0 ? gathered : low;
      if (pass === "below") {
        if (keep[0] < 256 || keep[1] < 256 || keep[2] < 256) {
          drawShadows(out, rect, banks, shapes, t, "bank", keep);
          drawShadows(out, rect, lows, shapes, t, "low", keep, true, cloudiness);
        }
        drawClouds(out, rect, lows, sprites, t, "low", 255, true, cloudiness);
        drawClouds(out, rect, banks, sprites, t, "bank", 255);
        return;
      }
      drawClouds(out, rect, banks, sprites, t, "bank", style.veil);
    },
  };
}
