// A dragon is a list of placed pieces: sprite stacks with their inked skirts. They are drawn as one figure: one
// shadow for the lot (no double darkening where pieces overlap), then every skirt, then every stack, so the ink
// that survives is a single outline around the whole silhouette.

import type { ViewRect } from "../render/compose.ts";
import { drawStack, STACK_SHADOW_KEEP, STACK_SHADOW_SLOPE, type Stack } from "../runtime/stack.ts";
import type { WorldView } from "../runtime/view.ts";
import { footprintOf, skirtOf, toStack, type Vox } from "./vox.ts";

export type Land = Pick<WorldView, "depthAt" | "groundHeight">;

/** A built model: its stack, the skirt drawn under it, and its footprint for the shadow. */
export interface Piece {
  stack: Stack;
  skirt: Stack;
  foot: Uint8Array;
  /** Round seen from above: its skirt and shadow are the same at any heading, and are drawn unturned (the cheaper box). */
  round: boolean;
}

export function pieceOf(v: Vox, ink: number, round = false): Piece {
  const stack = toStack(v);
  return { stack, skirt: skirtOf(stack, ink), foot: footprintOf(stack), round };
}

/** Pieces placed in the world this frame, in drawing order. The slots are reused from frame to frame. */
export interface Figure {
  count: number;
  piece: Piece[];
  x: Float64Array;
  y: Float64Array;
  alt: Float64Array;
  heading: Float64Array;
}

export function figure(capacity: number): Figure {
  return {
    count: 0,
    piece: new Array<Piece>(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    alt: new Float64Array(capacity),
    heading: new Float64Array(capacity),
  };
}

export function place(f: Figure, piece: Piece, x: number, y: number, alt: number, heading: number): void {
  const i = f.count;
  if (i >= f.x.length) return;
  f.piece[i] = piece;
  f.x[i] = x;
  f.y[i] = y;
  f.alt[i] = alt;
  f.heading[i] = heading;
  f.count = i + 1;
}

/** Screen position of the periodic image nearest the view, or the previous one when its box overhangs the view. */
function imageOn(world: number, origin: number, period: number, view: number, sprite: number): number {
  let s = (world - origin) % period;
  if (s < 0) s += period;
  if (s >= view && s - period + sprite > 0) s -= period;
  return s;
}

let mask = new Uint8Array(0);
let touched = new Int32Array(0);

/**
 * One shadow for the whole figure: each piece's footprint, turned to its heading, falls on the ground at
 * (x, y) + STACK_SHADOW_SLOPE · (alt − ground) along both axes. A pixel under any number of pieces is darkened once,
 * keeping STACK_SHADOW_KEEP / 256 of its colour, and only where view.depthAt is within 3 rows of the shadow's row.
 */
export function castShadow(out: Uint32Array, rect: ViewRect, view: Land, f: Figure, n: number): void {
  const fw = rect.w, fh = rect.h;
  if (mask.length < fw * fh) {
    mask = new Uint8Array(fw * fh);
    touched = new Int32Array(fw * fh);
  }
  let hits = 0;
  const yPeriod = n * 0.8;
  for (let p = 0; p < f.count; p++) {
    const s = f.piece[p].stack, foot = f.piece[p].foot;
    const w = s.w, h = s.h;
    const round = f.piece[p].round;
    const cos = round ? 1 : Math.cos(f.heading[p]), sin = round ? 0 : Math.sin(f.heading[p]);
    const extX = (w * Math.abs(cos) + h * Math.abs(sin)) * 0.5, extY = (w * Math.abs(sin) + h * Math.abs(cos)) * 0.5;
    const cx = (w - 1) * 0.5, cy = (h - 1) * 0.5;
    const lift = f.alt[p] - view.groundHeight(f.x[p], f.y[p]);
    const sx = f.x[p] + STACK_SHADOW_SLOPE * lift, sy = f.y[p] + STACK_SHADOW_SLOPE * lift;
    const bakeY = Math.round(sy * 0.8 - view.groundHeight(sx, sy));
    const scx = imageOn(Math.round(sx), rect.x, n, fw, extX + 1);
    const scy = imageOn(bakeY, rect.y, yPeriod, fh, extY + 1);
    const row0 = sy + Math.round((rect.y + scy - bakeY) / yPeriod) * n;
    const px0 = Math.max(0, Math.ceil(scx - extX)), px1 = Math.min(fw - 1, Math.floor(scx + extX));
    const py0 = Math.max(0, Math.ceil(scy - extY)), py1 = Math.min(fh - 1, Math.floor(scy + extY));
    for (let py = py0; py <= py1; py++) {
      const oy = py - scy;
      for (let px = px0; px <= px1; px++) {
        const ox = px - scx;
        // floor(v + 0.5), not round(v): round gives −0 just under zero, which throws the optimised loop out every time.
        const ix = Math.floor(ox * cos + oy * sin + cx + 0.5), iy = Math.floor(-ox * sin + oy * cos + cy + 0.5);
        if (ix < 0 || iy < 0 || ix >= w || iy >= h || foot[iy * w + ix] === 0) continue;
        const di = py * fw + px;
        if (mask[di] !== 0) continue;
        if (Math.abs(view.depthAt(px, py) - row0) > 3) continue;
        mask[di] = 1;
        touched[hits++] = di;
      }
    }
  }
  const keep = STACK_SHADOW_KEEP;
  for (let i = 0; i < hits; i++) {
    const di = touched[i], dst = out[di];
    mask[di] = 0;
    const r = ((dst & 255) * keep) >>> 8, g = (((dst >>> 8) & 255) * keep) >>> 8, b = (((dst >>> 16) & 255) * keep) >>> 8;
    out[di] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
}

/** Draws pieces from … to − 1 as one inked group: all their skirts, then all their stacks, in order. */
export function drawGroup(out: Uint32Array, rect: ViewRect, view: Land, f: Figure, from: number, to: number, n: number): void {
  for (let p = from; p < to; p++) {
    drawStack(out, rect, view, f.piece[p].skirt, f.x[p], f.y[p], f.alt[p], f.piece[p].round ? 0 : f.heading[p], n);
  }
  for (let p = from; p < to; p++) drawStack(out, rect, view, f.piece[p].stack, f.x[p], f.y[p], f.alt[p], f.heading[p], n);
}

/**
 * A strand (a whisker): one-pixel lines through `count` world points (x, y, alt triples in `pts`), coloured
 * colours[i] from point i to point i + 1, each pixel depth-tested like a stack's.
 */
export function drawStrand(
  out: Uint32Array, rect: ViewRect, view: Land, pts: Float64Array, count: number, colours: readonly number[], n: number,
): void {
  const fw = rect.w, fh = rect.h, yPeriod = n * 0.8;
  if (count < 2) return;
  const bake0 = Math.round(pts[1] * 0.8 - pts[2]);
  const sx0 = imageOn(Math.round(pts[0]), rect.x, n, fw, 2), sy0 = imageOn(bake0, rect.y, yPeriod, fh, 2);
  const row0 = pts[1] + Math.round((rect.y + sy0 - bake0) / yPeriod) * n;
  let ax = sx0, ay = sy0;
  for (let i = 1; i < count; i++) {
    let dxw = (pts[i * 3] - pts[0]) % n;
    if (dxw > n / 2) dxw -= n;
    else if (dxw < -n / 2) dxw += n;
    let dyw = (pts[i * 3 + 1] - pts[1]) % n;
    if (dyw > n / 2) dyw -= n;
    else if (dyw < -n / 2) dyw += n;
    const bx = sx0 + Math.round(dxw), by = sy0 + Math.round(0.8 * dyw - (pts[i * 3 + 2] - pts[2]));
    const cut = row0 + dyw + 1, colour = colours[i - 1];
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let k = 1; k <= steps; k++) {
      const px = Math.round(ax + ((bx - ax) * k) / steps), py = Math.round(ay + ((by - ay) * k) / steps);
      if (px < 0 || py < 0 || px >= fw || py >= fh) continue;
      if (view.depthAt(px, py) > cut) continue;
      out[py * fw + px] = colour;
    }
    ax = bx;
    ay = by;
  }
}
