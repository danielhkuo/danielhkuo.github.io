// The stand-in flier: a small vermilion kite and its shadow, depth-tested
// against the land so a hill to its south hides it. It holds the dragon's place
// until the dragon project.

import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "./flight.ts";
import type { WorldView } from "./view.ts";

/** Packed RGBA (ABGR in memory): the kite's fill and outline. */
export const FLIER_FILL = 0xff2b3fcf;
export const FLIER_INK = 0xff1d2228;
/** Side of the sprite's box, pixels. */
export const FLIER_SIZE = 11;
/** Cells the shadow moves south-east per unit of height over the ground (the sun's slope). */
export const SHADOW_SLOPE = 0.354;
/** Of 256: how much of a pixel's colour the shadow keeps. */
export const SHADOW_KEEP = 166;
/** A pixel of the flier shows unless the land drawn there lies more than this many rows nearer the viewer. */
export const DEPTH_SLACK = 1;

const HALF = (FLIER_SIZE - 1) / 2;

type SpriteCell = 0 | 1 | 2;

/** Diamond kite ~9 px along local x and ~5 px across local y (east-facing). */
function localKite(lx: number, ly: number): boolean {
  if (Math.abs(ly) > 2 + 1e-9) return false;
  const w = 4 - Math.abs(ly);
  return Math.abs(lx) <= w + 1e-9;
}

function buildSprite(heading: number): SpriteCell[] {
  const cells: SpriteCell[] = new Array(FLIER_SIZE * FLIER_SIZE).fill(0);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  for (let py = 0; py < FLIER_SIZE; py++) {
    for (let px = 0; px < FLIER_SIZE; px++) {
      const lx = px - HALF;
      const ly = py - HALF;
      const rx = lx * c - ly * s;
      const ry = lx * s + ly * c;
      if (!localKite(rx, ry)) continue;
      let ink = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nrx = (lx + dx) * c - (ly + dy) * s;
        const nry = (lx + dx) * s + (ly + dy) * c;
        if (!localKite(nrx, nry)) {
          ink = true;
          break;
        }
      }
      cells[py * FLIER_SIZE + px] = ink ? 2 : 1;
    }
  }
  return cells;
}

const SPRITES: readonly SpriteCell[][] = Array.from({ length: 16 }, (_, i) =>
  buildSprite((i * Math.PI * 2) / 16),
);

function dimColour(v: number): number {
  const a = v >>> 24;
  const r = ((v & 0xff) * SHADOW_KEEP) >> 8;
  const g = (((v >> 8) & 0xff) * SHADOW_KEEP) >> 8;
  const b = (((v >> 16) & 0xff) * SHADOW_KEEP) >> 8;
  return (a << 24) | (b << 16) | (g << 8) | r;
}

function putPixel(out: Uint32Array, rect: ViewRect, px: number, py: number, colour: number): void {
  if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) return;
  out[py * rect.w + px] = colour;
}

/**
 * Draws the shadow, then the kite. The kite is centred on the flier's screen position (x − rect.x,
 * 0.8·y − alt − rect.y), pointing along its heading in one of 16 directions, filled FLIER_FILL with a FLIER_INK
 * outline; each of its pixels is drawn only where `depthAt` ≤ y + DEPTH_SLACK. The shadow is a small dark ellipse on
 * the ground at (x, y) + SHADOW_SLOPE · (alt − ground) cells along both axes; each shadow pixel keeps SHADOW_KEEP/256
 * of the colour under it and is drawn only where `depthAt` is within 3 rows of the shadow's own row.
 */
export function drawFlier(out: Uint32Array, rect: ViewRect, s: FlightState, view: Pick<WorldView, "depthAt" | "groundHeight">): void {
  const g0 = view.groundHeight(s.x, s.y);
  const lift = s.alt - g0;
  const sx = s.x + SHADOW_SLOPE * lift;
  const sy = s.y + SHADOW_SLOPE * lift;
  const sg = view.groundHeight(sx, sy);
  const scx = Math.floor(sx - rect.x);
  const scy = Math.floor(0.8 * sy - sg - rect.y);
  const depthRow = sy;
  const shadowRx = 3.5;
  const shadowRy = 1.5;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if ((dx / shadowRx) ** 2 + (dy / shadowRy) ** 2 > 1) continue;
      const px = scx + dx;
      const py = scy + dy;
      if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) continue;
      const d = view.depthAt(px, py);
      if (Math.abs(d - depthRow) > 3) continue;
      const i = py * rect.w + px;
      out[i] = dimColour(out[i]!);
    }
  }

  const spriteIdx = ((Math.round(s.heading / (Math.PI / 8)) % 16) + 16) % 16;
  const sprite = SPRITES[spriteIdx]!;
  const fcx = Math.floor(s.x - rect.x);
  const fcy = Math.floor(0.8 * s.y - s.alt - rect.y);
  const depthCut = s.y + DEPTH_SLACK;
  for (let ly = 0; ly < FLIER_SIZE; ly++) {
    for (let lx = 0; lx < FLIER_SIZE; lx++) {
      const cell = sprite[ly * FLIER_SIZE + lx]!;
      if (cell === 0) continue;
      const px = fcx + lx - Math.floor(HALF);
      const py = fcy + ly - Math.floor(HALF);
      if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) continue;
      if (view.depthAt(px, py) > depthCut) continue;
      putPixel(out, rect, px, py, cell === 2 ? FLIER_INK : FLIER_FILL);
    }
  }
}