// Pictures: plants whose shape a column of ground cannot make. The painter draws each cell as one column in one
// material, so a tree stamped into the ground is a dome down to its roots. A palm, an umbrella acacia, an umbrella
// pine and a cactus are told by a crown standing over a thin stem, with the land behind showing under it. So they are
// small pictures, a few pixels each, drawn into the chunk after the painter: each pixel at the projection of its
// place (x, y, z), unless something nearer the camera owns that pixel, as the marks on a building are drawn.
//
// A tile lists the pictures rooted on its own cells (cells.ts), so a tile with none bakes exactly as it did.

import { SHAPE } from "../look/contract.ts";
import { F_CANOPY, F_QUIET, F_SHADOW, TILE, type Cells } from "./cells.ts";
import type { Painted } from "./ink.ts";

/** Values per picture in a tile's list: the root cell in the tile, the ground there, the shape, crown half-width, stem height, crown material, stem material, and a draw of its own. */
export const SPRITE_STRIDE = 9;

/** Tones of a crown's lit top, its body and its underside, and of a stem (128 is flat open ground). */
const T_TOP = 182, T_BODY = 140, T_UNDER = 96, T_STEM = 112, T_STEM_LIT = 150;

/** The pixels of one picture, as (dx, z, crown or stem, tone) from the root, z in pixels above the ground. */
type Put = (dx: number, z: number, stem: boolean, tone: number) => void;

/**
 * A palm: a thin stem that leans a pixel, and a star of fronds five pixels across.
 *
 *     # . # . #
 *     . # # # .
 *     # . | . #
 *         |
 */
function palm(put: Put, h: number, seed: number): void {
  const lean = (seed & 1) === 0 ? 1 : -1, bend = Math.floor(h / 2);
  for (let z = 0; z < h; z++) put(z >= bend ? 0 : -lean, z, true, z === h - 1 ? T_STEM_LIT : T_STEM);
  // Drooping tips below the head, the head, and the fronds that stand up from it.
  put(-2, h - 1, false, T_UNDER);
  put(2, h - 1, false, T_UNDER);
  for (let dx = -1; dx <= 1; dx++) put(dx, h, false, T_BODY);
  put(-2, h + 1, false, T_BODY);
  put(0, h + 1, false, T_TOP);
  put(2, h + 1, false, T_BODY);
  if ((seed & 6) !== 0) put((seed & 8) === 0 ? -1 : 1, h + 1, false, T_TOP);
}

/**
 * An umbrella acacia: a flat crown two rows thick, far wider than the tree is tall, on a stem that forks under it.
 *
 *     . # # # # # .
 *     # # # # # # #
 *         \ /
 *          |
 */
function acacia(put: Put, r: number, h: number): void {
  for (let z = 0; z < h - 1; z++) put(0, z, true, T_STEM);
  put(-1, h - 1, true, T_STEM);
  put(1, h - 1, true, T_STEM);
  for (let dx = -r; dx <= r; dx++) put(dx, h, false, dx === -r || dx === r ? T_UNDER : T_BODY);
  for (let dx = 1 - r; dx <= r - 1; dx++) put(dx, h + 1, false, T_TOP);
}

/**
 * An umbrella pine: a dark rounded crown three rows thick on a tall bare stem.
 *
 *     . # # # .
 *     # # # # #
 *     . # # # .
 *         |
 *         |
 */
function pine(put: Put, r: number, h: number): void {
  for (let z = 0; z < h; z++) put(0, z, true, T_STEM);
  for (let dx = 1 - r; dx <= r - 1; dx++) put(dx, h, false, T_UNDER);
  for (let dx = -r; dx <= r; dx++) put(dx, h + 1, false, T_BODY);
  for (let dx = 1 - r; dx <= r - 1; dx++) put(dx, h + 2, false, T_TOP);
}

/**
 * A columnar cactus: a column with an arm or two that turn up.
 *
 *       #
 *     # # #
 *     # # #
 *       #
 */
function cactus(put: Put, h: number, seed: number): void {
  for (let z = 0; z <= h; z++) put(0, z, false, z === h ? T_TOP : T_BODY);
  const left = 1 + (seed & 1), right = 1 + ((seed >> 1) & 1);
  if ((seed & 4) === 0 || h < 4) { put(-1, left, false, T_BODY); put(-1, left + 1, false, T_TOP); }
  if ((seed & 4) !== 0 || (seed & 8) === 0) { put(1, right + 1, false, T_UNDER); if (h >= 4) put(1, right + 2, false, T_BODY); }
}

/** Calls `put` with every pixel of the picture `shape`. */
export function spritePixels(shape: number, r: number, h: number, seed: number, put: Put): void {
  if (shape === SHAPE.palm) palm(put, h, seed);
  else if (shape === SHAPE.acacia) acacia(put, r, h);
  else if (shape === SHAPE.pine) pine(put, r, h);
  else if (shape === SHAPE.cactus) cactus(put, h, seed);
}

/**
 * The ground cells a picture's crown shades, as offsets from its root: the sun stands in the north-west, so the
 * shadow of a crown `h` up falls about a third of that to the south-east, and is as wide as the crown.
 */
export function spriteShadow(shape: number, r: number, h: number, mark: (dx: number, dy: number) => void): void {
  if (shape === SHAPE.cactus) { mark(1, 1); return; }
  const off = Math.floor(0.36 * (h + 1) + 0.5);
  const half = shape === SHAPE.acacia ? r - 1 : shape === SHAPE.pine ? r - 1 : 1;
  for (let dx = -half; dx <= half; dx++) mark(off + dx, off);
  if (shape === SHAPE.acacia) for (let dx = 1 - half; dx <= half - 1; dx++) mark(off + dx, off + 1);
}

/**
 * Draws the pictures of every tile the painter read. A picture's pixel is drawn unless what is there already stands
 * nearer the camera than the picture's root; of two pictures on one pixel the nearer wins, and of two rooted on one
 * row the one further east, so the result does not depend on the window.
 */
export function drawSprites(p: Painted): void {
  const used = p.tiles as Map<number, Cells> | undefined;
  if (!used) return;
  const { w, h, x0, r0 } = p;
  for (const [key, tile] of used) {
    const list = tile.sprites;
    if (!list) continue;
    const ty = Math.floor(key / 65536) - 32768, tx = (key % 65536) - 32768;
    for (let k = 0; k + SPRITE_STRIDE <= list.length; k += SPRITE_STRIDE) {
      const X = tx * TILE + list[k], Y = ty * TILE + list[k + 1];
      const c0 = X - x0;
      if (c0 < -6 || c0 >= w + 6) continue;
      const base = list[k + 2], row0 = Math.floor((4 * Y) / 5) - r0 - Math.floor(base + 0.5);
      if (row0 < 0 || row0 - 14 >= h) continue;
      const crown = list[k + 6], stem = list[k + 7];
      spritePixels(list[k + 3], list[k + 4], list[k + 5], list[k + 8], (dx, z, isStem, tone) => {
        const c = c0 + dx, r = row0 - z - 1;
        if (c < 0 || c >= w || r < 0 || r >= h) return;
        const i = r * w + c;
        if (p.y[i] > Y) return;
        p.mat[i] = isStem ? stem : crown;
        p.light[i] = tone;
        p.flags[i] = (p.flags[i] & F_SHADOW) | (isStem ? F_QUIET : F_CANOPY);
        p.aux[i] = 0;
        p.hidden[i] = 0;
        p.jump[i] = 0;
        p.wall[i] = 0;
        p.span[i] = 1;
        p.y[i] = Y;
        p.height[i] = base + z + 1;
      });
    }
  }
}
