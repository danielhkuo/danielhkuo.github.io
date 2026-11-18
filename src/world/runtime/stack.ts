// Sprite stacks: a small model drawn as a pile of pixel slices, each turned to the model's heading and lifted one
// pixel above the one under it. The dragon (and later the landmarks) are drawn this way, depth-tested against the land.

import type { ViewRect } from "../render/compose.ts";
import type { WorldView } from "./view.ts";

/** `layers` slices of w × h, bottom first, authored facing east (+x); rgba and alpha are layers·w·h, slice-major. */
export interface Stack {
  w: number;
  h: number;
  layers: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
}

/** Of 256: how much of a pixel's colour a stack's shadow keeps. */
export const STACK_SHADOW_KEEP = 166;
/** Cells the shadow moves south-east per unit of height over the ground, as for the land. */
export const STACK_SHADOW_SLOPE = 0.354;

/** Screen position of the periodic image nearest the view, or the previous one when its box overhangs the view. */
function imageOn(world: number, origin: number, period: number, view: number, sprite: number): number {
  let s = world - origin;
  s %= period;
  if (s < 0) s += period;
  if (s >= view && s - period + sprite > 0) s -= period;
  return s;
}

/** cos/sin of `heading`, exact at quarter turns so nearest-neighbour sampling lands on whole pixels. */
let turnCos = 1;
let turnSin = 0;
function setTurn(heading: number): void {
  const q = Math.round(heading / (Math.PI * 0.5));
  if (Math.abs(heading - q * (Math.PI * 0.5)) < 1e-8) {
    const m = ((q % 4) + 4) % 4;
    turnCos = m === 0 ? 1 : m === 2 ? -1 : 0;
    turnSin = m === 1 ? 1 : m === 3 ? -1 : 0;
    return;
  }
  turnCos = Math.cos(heading);
  turnSin = Math.sin(heading);
}

/**
 * Draws `s` centred on world (x, y) at `alt` units up: slice k's centre is at screen
 * (x − rect.x, 0.8·y − alt − k − rect.y), using the torus image nearest the view (x every n, bake rows every 0.8·n).
 * Each slice is turned by `heading` (radians, 0 east, π/2 south) about its centre, sampled nearest-neighbour by
 * inverse rotation, and drawn bottom slice first so higher slices cover lower ones. A pixel draws where its alpha > 0 and
 * view.depthAt(px, py) ≤ y′ + 1 (y′ is y moved to the chosen image). Clipped at the frame's edges.
 */
export function drawStack(
  out: Uint32Array, rect: ViewRect, view: Pick<WorldView, "depthAt">, s: Stack, x: number, y: number, alt: number, heading: number, n: number,
): void {
  const w = s.w;
  const h = s.h;
  const layers = s.layers;
  if (w <= 0 || h <= 0 || layers <= 0) return;
  const fw = rect.w;
  const fh = rect.h;
  const rgba = s.rgba;
  const alpha = s.alpha;
  setTurn(heading);
  const cos = turnCos;
  const sin = turnSin;
  const absC = cos < 0 ? -cos : cos;
  const absS = sin < 0 ? -sin : sin;
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const extX = halfW * absC + halfH * absS;
  const extY = halfW * absS + halfH * absC;
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const yPeriod = n * 0.8;
  const bakeY = Math.round(y * 0.8 - alt);
  const scx = imageOn(Math.round(x), rect.x, n, fw, extX + 1);
  const baseSy = imageOn(bakeY, rect.y, yPeriod, fh, extY + 1);
  const yPrime = y + Math.round((rect.y + baseSy - bakeY) / yPeriod) * n;
  const depthCut = yPrime + 1;
  const stride = w * h;

  let px0 = Math.ceil(scx - extX - 1e-6);
  let px1 = Math.floor(scx + extX + 1e-6);
  if (px0 < 0) px0 = 0;
  if (px1 >= fw) px1 = fw - 1;
  if (px0 > px1) return;

  for (let k = 0; k < layers; k++) {
    const scy = baseSy - k;
    let py0 = Math.ceil(scy - extY - 1e-6);
    let py1 = Math.floor(scy + extY + 1e-6);
    if (py0 < 0) py0 = 0;
    if (py1 >= fh) py1 = fh - 1;
    if (py0 > py1) continue;
    const base = k * stride;
    for (let py = py0; py <= py1; py++) {
      const oy = py - scy;
      const row = py * fw;
      const oySin = oy * sin;
      const oyCos = oy * cos;
      for (let px = px0; px <= px1; px++) {
        const ox = px - scx;
        const ix = Math.round(ox * cos + oySin + cx);
        const iy = Math.round(-ox * sin + oyCos + cy);
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
        const sp = base + iy * w + ix;
        if (alpha[sp] === 0) continue;
        if (view.depthAt(px, py) > depthCut) continue;
        out[row + px] = rgba[sp];
      }
    }
  }
}

/**
 * The shadow of `s` on the ground: the union of all slices' footprints, turned by `heading`, centred on the ground point
 * (x, y) + STACK_SHADOW_SLOPE · (alt − ground) along both axes, where ground = view.groundHeight(x, y). Each shadow pixel
 * keeps STACK_SHADOW_KEEP / 256 of each colour channel and is drawn only where view.depthAt is within 3 rows of the
 * shadow's own row. Drawn before the stack.
 */
export function drawStackShadow(
  out: Uint32Array, rect: ViewRect, view: Pick<WorldView, "depthAt" | "groundHeight">, s: Stack, x: number, y: number, alt: number, heading: number, n: number,
): void {
  const w = s.w;
  const h = s.h;
  const layers = s.layers;
  if (w <= 0 || h <= 0 || layers <= 0) return;
  const fw = rect.w;
  const fh = rect.h;
  const alpha = s.alpha;
  setTurn(heading);
  const cos = turnCos;
  const sin = turnSin;
  const absC = cos < 0 ? -cos : cos;
  const absS = sin < 0 ? -sin : sin;
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const extX = halfW * absC + halfH * absS;
  const extY = halfW * absS + halfH * absC;
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const g = view.groundHeight(x, y);
  const lift = alt - g;
  const sx = x + STACK_SHADOW_SLOPE * lift;
  const sy = y + STACK_SHADOW_SLOPE * lift;
  const gPrime = view.groundHeight(sx, sy);
  const yPeriod = n * 0.8;
  const bakeY = Math.round(sy * 0.8 - gPrime);
  const scx = imageOn(Math.round(sx), rect.x, n, fw, extX + 1);
  const scy = imageOn(bakeY, rect.y, yPeriod, fh, extY + 1);
  const syPrime = sy + Math.round((rect.y + scy - bakeY) / yPeriod) * n;
  const stride = w * h;
  const keep = STACK_SHADOW_KEEP;

  let px0 = Math.ceil(scx - extX - 1e-6);
  let px1 = Math.floor(scx + extX + 1e-6);
  if (px0 < 0) px0 = 0;
  if (px1 >= fw) px1 = fw - 1;
  let py0 = Math.ceil(scy - extY - 1e-6);
  let py1 = Math.floor(scy + extY + 1e-6);
  if (py0 < 0) py0 = 0;
  if (py1 >= fh) py1 = fh - 1;
  if (px0 > px1 || py0 > py1) return;

  for (let py = py0; py <= py1; py++) {
    const oy = py - scy;
    const row = py * fw;
    const oySin = oy * sin;
    const oyCos = oy * cos;
    for (let px = px0; px <= px1; px++) {
      const ox = px - scx;
      const ix = Math.round(ox * cos + oySin + cx);
      const iy = Math.round(-ox * sin + oyCos + cy);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const sp = iy * w + ix;
      let covered = false;
      for (let k = 0; k < layers; k++) {
        if (alpha[k * stride + sp] !== 0) {
          covered = true;
          break;
        }
      }
      if (!covered) continue;
      if (Math.abs(view.depthAt(px, py) - syPrime) > 3) continue;
      const di = row + px;
      const dst = out[di];
      const r = ((dst & 255) * keep) >>> 8;
      const gch = (((dst >>> 8) & 255) * keep) >>> 8;
      const b = (((dst >>> 16) & 255) * keep) >>> 8;
      out[di] = (0xff000000 | (b << 16) | (gch << 8) | r) >>> 0;
    }
  }
}
