// Pixel chunks: the painter. Cells are projected to bake pixels
// (x, floor(4y/5) − height), nearest first, so each pixel is written once.
// Then rivers are drawn as lines in pixel space, ink is laid, rock faces are
// drawn in their beds, and tone is dithered per bake pixel.
//
// Bake pixel: material | light << 8 | depth << 16, with
// light = tone | shadow << 4 | ink << 6 and depth in eighths of a world row
// from the window's first row (depthBase).

import { wrap } from "../core/torus.ts";
import { LIGHT_INK_SHIFT, LIGHT_SHADOW_SHIFT } from "../look/contract.ts";
import { AUX_CREST_SHIFT, buildTile, F_CANOPY, F_CLIFF, F_QUIET, F_SHADOW, TILE, type Cells, type Look } from "./cells.ts";
import { SPAN_CAP, CANOPY_MIN_DROP, evenLines, hatch, inkCliffs, inkCrests, inkOcclusion, landBreaks, newPainted, rockFaces, type Painted } from "./ink.ts";
import { BASE_TONE } from "./light.ts";
import { imageOffset, structuresIn } from "../gen/built.ts";
import { forEachLinePoint } from "./lines.ts";
import type { RiverIndex } from "./world.ts";

/** The tone index flat, unshadowed ground takes (render/palette.ts FLAT_TONE). */
export const FLAT_TONE = 9;
import { HMAX, type BakeWorld } from "./world.ts";

export const CHUNK = 256;
/** World rows per chunk: 256 / 0.8. */
export const CHUNK_ROWS = 320;

// Margins painted round a window so that ink and lines inside it never depend on where it was cut.
const MX = 8;
const MT = 32;
// Below: a lip reads the wall LIP_FULL rows under it, is evened over LIP_SEEK rows and joined over as many again, and
// every cell in reach must be whole to SPAN_CAP.
const MB = 32;

/** Of 256: the share of a light wash's pixels, inside a patch of grain, where the paper shows through. */
export const PAPER_FLECK = 44;

/** The crest bits of a land cell's aux. */
const CREST_BITS = 3 << AUX_CREST_SHIFT;

/** A hidden cell projects at least this far below the top of what hides it. */
const HIDE_MARGIN = 1;

export type TileSource = (tx: number, ty: number) => Cells;

/** A tile source with a small most-recently-used cache. Tile indices are wrapped. */
export function tileCache(world: BakeWorld, look: Look, mask: Uint8Array, capacity: number): TileSource {
  const nT = world.n / TILE;
  const cache = new Map<number, Cells>();
  return (tx, ty) => {
    const key = wrap(ty, nT) * nT + wrap(tx, nT);
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const tile = buildTile(world, look, mask, wrap(tx, nT), wrap(ty, nT));
    cache.set(key, tile);
    if (cache.size > capacity) cache.delete(cache.keys().next().value as number);
    return tile;
  };
}

/** The world row that depth 0 of a window starting at bake row r0 stands for. */
export function depthBase(r0: number): number {
  return Math.ceil((5 * r0) / 4);
}

/** Paints the window [x0, x0 + w) × [r0, r0 + h) of bake space, nearest cells first. */
export function paint(world: BakeWorld, tiles: TileSource, x0: number, r0: number, w: number, h: number): Painted {
  const n = world.n;
  const p = newPainted(x0, r0, w, h);
  const yFirst = Math.ceil((5 * r0) / 4);
  const yLast = Math.ceil((5 * (r0 + h + HMAX)) / 4) - 1;
  for (let c = 0; c < w; c++) {
    const wx = wrap(x0 + c, n);
    const tx = wx >> 8, lx = wx & 255;
    let tile: Cells | null = null, tyNow = -1;
    let top = h;
    // The cell that owns row `top`: its height, its float projection, and the rows hidden behind it so far.
    let nearH = 0, nearF = Infinity, hid = 0, low = Infinity;
    for (let y = yLast; y >= yFirst && top > 0; y--) {
      const wy = wrap(y, n);
      const ty = wy >> 8;
      if (ty !== tyNow) { tile = tiles(tx, ty); tyNow = ty; }
      const ti = ((wy & 255) << 8) | lx;
      const H = (tile as Cells).surf[ti];
      const f = 0.8 * y - H;
      const t = Math.floor((4 * y) / 5) - r0 - Math.floor(H + 0.5);
      if (t >= top) {
        if (f > nearF + HIDE_MARGIN) {
          hid++;
          if (H < low) low = H;
        }
        continue;
      }
      if (top < h && hid > 0) {
        const k = top * w + c;
        let breaks: boolean;
        // A crown is small, so its edge needs a little less hidden behind it than a ridge does.
        if ((p.flags[k] & F_CANOPY) !== 0) breaks = nearH - H >= CANOPY_MIN_DROP;
        else {
          // A crest or a steep face at the pixel, or within two rows nearer the camera, makes the break a firm one.
          let firm = false;
          for (let q = 0; q < 3 && top + q < h && !firm; q++) {
            const j = k + q * w;
            firm = (p.flags[j] & F_QUIET) === 0 && ((p.flags[j] & F_CLIFF) !== 0 || (p.aux[j] & CREST_BITS) !== 0);
          }
          breaks = landBreaks(hid, nearH - H, nearH - low, firm);
        }
        if (breaks) p.hidden[k] = hid > 255 ? 255 : hid;
      }
      const from = t > 0 ? t : 0;
      const m = (tile as Cells).mat[ti], l = (tile as Cells).light[ti], fl = (tile as Cells).flags[ti], a = (tile as Cells).aux[ti];
      for (let r = from; r < top; r++) {
        const i = r * w + c;
        p.mat[i] = m;
        p.light[i] = l;
        p.flags[i] = fl;
        p.aux[i] = a;
        p.y[i] = y;
        p.height[i] = H;
        p.wall[i] = r - t > 255 ? 255 : r - t;
        p.span[i] = top - t > SPAN_CAP ? SPAN_CAP : top - t;
      }
      top = from;
      nearH = H;
      nearF = f;
      hid = 0;
      low = Infinity;
    }
  }
  return p;
}

/**
 * Draws the rivers onto visible ground. Each curve is projected point by
 * point; a point is plotted where the pixel it lands on shows its own cell or
 * a neighbour that does not hide it, and successive plotted points are joined
 * so the raster is 8-connected. A point behind a ridge is skipped and breaks
 * the line, so a river never crosses a ridge.
 */
export function drawRivers(world: BakeWorld, tiles: TileSource, p: Painted, isWater: Uint8Array): void {
  drawLines(world.rivers, world.n, tiles, p, isWater, 6);
}

/** Roads and paths, drawn the same way, one pixel wide, wherever the cells carry a road. */
export function drawRoads(world: BakeWorld, tiles: TileSource, p: Painted): void {
  if (!world.roads || !world.built || world.roads.segments.length === 0) return;
  const is = new Uint8Array(256);
  is[world.built.built.mats.path] = is[world.built.built.mats.road] = 1;
  is[0] = 0;
  drawLines(world.roads, world.n, tiles, p, is, 1);
}

/**
 * Marks on built faces: windows, doors, arches, clock faces, cross arms and sails. Each is one bake pixel at the
 * projection of (x, y, z), drawn unless something nearer the camera owns that pixel.
 */
export function drawMarks(world: BakeWorld, p: Painted): void {
  const bi = world.built;
  if (!bi) return;
  const { w, h, x0, r0 } = p;
  const yFirst = Math.ceil((5 * r0) / 4) - 2;
  const yLast = Math.ceil((5 * (r0 + h + HMAX)) / 4) + 2;
  for (const id of structuresIn(bi, x0, yFirst, x0 + w, yLast)) {
    const s = bi.built.structures[id];
    const marks = s.marks;
    if (marks.length === 0) continue;
    const ox = imageOffset(s.x, s.w, x0, world.n);
    const oy = imageOffset(s.y, s.h, yFirst, world.n) + yFirst;
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      const c = ox + marks[k], cy = oy + marks[k + 1];
      const top = s.base + marks[k + 2];
      const r = Math.floor((4 * cy) / 5) - r0 - Math.floor(top + 0.5);
      if (c < 0 || c >= w || r < 0 || r >= h) continue;
      const i = r * w + c;
      if (p.y[i] > cy) continue;
      p.mat[i] = marks[k + 3];
      p.light[i] = marks[k + 4];
      p.flags[i] = (p.flags[i] & F_SHADOW) | F_QUIET;
      p.aux[i] = 0;
      p.hidden[i] = 0;
      p.y[i] = cy;
      p.height[i] = top;
    }
  }
}

function drawLines(index: RiverIndex, n: number, tiles: TileSource, p: Painted, isWater: Uint8Array, maxWidth: number): void {
  const { w, h, x0, r0 } = p;
  const yFirst = Math.ceil((5 * r0) / 4) - 4;
  const yLast = Math.ceil((5 * (r0 + h + HMAX)) / 4) + 4;
  let px = 0, py = 0, prev = false;
  let tile: Cells | null = null, tKey = -1;

  const plot = (c: number, r: number, cy: number, slack: number, m: number, a: number): void => {
    if (c < 0 || r < 0 || c >= w || r >= h) return;
    const i = r * w + c;
    if ((p.flags[i] & F_CANOPY) !== 0) return;
    const dy = p.y[i] - cy;
    if (dy > slack || dy < -slack) return;
    p.mat[i] = m;
    p.aux[i] = a;
    p.flags[i] = (p.flags[i] & F_SHADOW) | F_QUIET;
    p.hidden[i] = 0;
    p.wall[i] = 0;
    p.span[i] = 1;
  };

  forEachLinePoint(index, x0, yFirst, x0 + w, yLast, (x, y, width0, _run, first) => {
    const width = width0 > maxWidth ? maxWidth : width0;
    if (first) prev = false;
    const cx = Math.floor(x), cy = Math.floor(y);
    const c = cx - x0;
    if (c < 0 || c >= w) { prev = false; return; }
    const wx = wrap(cx, n), wy = wrap(cy, n);
    const key = (wy >> 8) * 4096 + (wx >> 8);
    if (key !== tKey) { tile = tiles(wx >> 8, wy >> 8); tKey = key; }
    const ti = ((wy & 255) << 8) | (wx & 255);
    // The cells decide where a river runs (steep 1 px streams are left out); draw only where they did.
    if (isWater[(tile as Cells).mat[ti]] === 0) { prev = false; return; }
    const H = (tile as Cells).surf[ti];
    const r = Math.floor((4 * cy) / 5) - r0 - Math.floor(H + 0.5);
    if (r < 0 || r >= h) { prev = false; return; }
    const i = r * w + c;
    // Visible when the pixel's owner is this cell, or a nearer one whose top does not stand over it.
    const oy = p.y[i];
    const seen = oy >= cy - 1 && 0.8 * cy - H <= 0.8 * oy - p.height[i] + HIDE_MARGIN && (p.flags[i] & F_CANOPY) === 0;
    if (!seen) { prev = false; return; }
    const m = (tile as Cells).mat[ti], a = (tile as Cells).aux[ti];
    // Only the curve itself is drawn here, to keep a line whole where rows of cells fall on one row of pixels: a wide
    // river's banks are the cells' own, cut to the curve at cell size. (Discs stamped per point made stair-stepped banks.)
    const stamp = (sc: number, sr: number): void => plot(sc, sr, cy, 4 + (width > 1 ? width : 0), m, a);
    if (prev && (c !== px || r !== py)) {
      const dc = c - px, dr = r - py;
      const steps = Math.max(dc < 0 ? -dc : dc, dr < 0 ? -dr : dr);
      // Join over a short gap; a longer one is a fall or a ridge, and stays open.
      if (steps <= 3) for (let s = 1; s < steps; s++) stamp(px + Math.floor((dc * s) / steps + 0.5), py + Math.floor((dr * s) / steps + 0.5));
    }
    stamp(c, r);
    px = c;
    py = r;
    prev = true;
  });
}

/** Tone, dither and packing of the inner window [mx, mx + w) × [mt, mt + h) of a painted window. */
function pack(p: Painted, look: Look, mask: Uint8Array, mx: number, mt: number, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * h);
  const base = depthBase(p.r0 + mt);
  const wash = look.isWash;
  for (let r = 0; r < h; r++) {
    const R = p.r0 + mt + r;
    for (let c = 0; c < w; c++) {
      const i = (r + mt) * p.w + c + mx;
      const m = p.mat[i];
      const f = p.flags[i];
      let tone: number;
      if (look.isWater[m] === 1) {
        tone = p.aux[i] & 15;
        // A stream that drops down a wall is a fall: broken white water.
        if (tone >= 8 && tone < 15 && p.wall[i] >= 2 && (look.isStill === undefined || look.isStill[m] === 0)) {
          tone = mask[((R + 23) & 255) * 256 + ((p.x0 + mx + c + 71) & 255)] < 190 ? 15 : 14;
        }
      } else {
        const l = p.light[i];
        // Flat, unshaded ground sits at FLAT_TONE; darks have the longer run of the ramp.
        const d = (l - Math.floor(BASE_TONE * 255 + 0.5)) / 255;
        tone = Math.floor(FLAT_TONE + d * (d < 0 ? 2 * FLAT_TONE : 2 * (15 - FLAT_TONE)) + (mask[(R & 255) * 256 + ((p.x0 + mx + c) & 255)] + 0.5) / 256);
        tone = tone < 0 ? 0 : tone > 15 ? 15 : tone;
        // Paper through a light wash: where the brush skipped the paper's tooth, the wash is a tone or two thinner.
        // The flecks gather in loose patches (the mask read at a quarter scale), so they are grain and not stipple.
        if (wash !== undefined && wash[m] === 1 && tone >= FLAT_TONE - 2 && tone < 14 && (f & F_SHADOW) === 0 && p.ink[i] === 0) {
          const X = p.x0 + mx + c;
          if (mask[(((R >> 2) + 37) & 255) * 256 + (((X >> 2) + 201) & 255)] > 120) {
            const g = mask[((R + 61) & 255) * 256 + ((X + 113) & 255)];
            if (g < PAPER_FLECK) tone += g < PAPER_FLECK >> 1 ? 2 : 1;
          }
        }
      }
      const light = tone | ((f & F_SHADOW) << LIGHT_SHADOW_SHIFT) | (p.ink[i] << LIGHT_INK_SHIFT);
      const depth = (p.y[i] - base) * 8;
      out[r * w + c] = (m | (light << 8) | ((depth < 0 ? 0 : depth > 65535 ? 65535 : depth) << 16)) >>> 0;
    }
  }
  return out;
}

/** The finished bake pixels of the window [x0, x0 + w) × [r0, r0 + h) of bake space. */
export function bakeWindow(world: BakeWorld, look: Look, mask: Uint8Array, tiles: TileSource, x0: number, r0: number, w: number, h: number): Uint32Array {
  const p = paint(world, tiles, x0 - MX, r0 - MT, w + 2 * MX, h + MT + MB);
  drawRivers(world, tiles, p, look.isWater);
  drawRoads(world, tiles, p);
  drawMarks(world, p);
  inkOcclusion(p);
  inkCrests(p);
  evenLines(p);
  inkCliffs(p, look.isStill ?? look.isWater);
  rockFaces(p);
  hatch(p, mask);
  return pack(p, look, mask, MX, MT, w, h);
}

/** Chunk (cx, cy): bake pixels [256cx, 256cx + 256) × [256cy, 256cy + 256); its depth 0 is world row 320cy. */
export function bakeChunk(world: BakeWorld, look: Look, mask: Uint8Array, tiles: TileSource, cx: number, cy: number): Uint32Array {
  return bakeWindow(world, look, mask, tiles, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
}
