// A flat stand-in world for the bench and the ear's tests: a material at every cell, drawn into bake frames the way
// the real bake lays them out (one pixel a cell east–west, 0.8 of a pixel a cell north–south, depth in eighths of a
// world row within the pixel's chunk) and into the land grid the coast scan reads. Sea level everywhere, so a frame
// pixel's place on the ground is exact.

import { wrap } from "../../core/torus.ts";
import { MATERIAL as M } from "../../look/materials.ts";
import type { Seen } from "../ear.ts";

export interface FlatWorld {
  n: number;
  /** The material at world cell (x, y), both already wrapped into [0, n). */
  at(x: number, y: number): number;
  /** The tone the bake gives the pixel there (0 … 15): for river water, under 8 a wide river, 8–13 a stream, 14 falling. 0 when absent. */
  tone?(x: number, y: number): number;
}

export const FRAME_W = 400, FRAME_H = 225;

/** The frame a camera centred on world (cx, cy) sees, written into `out` (made when absent). `haze` blanks pixels. */
export function frameOf(world: FlatWorld, cx: number, cy: number, out?: Uint32Array, haze?: (px: number, py: number) => boolean): Seen & { bake: Uint32Array; rect: { x: number; y: number; w: number; h: number } } {
  const w = FRAME_W, h = FRAME_H, n = world.n, rows = 0.8 * n;
  const bake = out ?? new Uint32Array(w * h);
  const rx = Math.round(cx) - (w >> 1), ry = Math.round(0.8 * cy) - (h >> 1);
  for (let py = 0; py < h; py++) {
    const by = wrap(ry + py, rows);
    const y = wrap(by / 0.8, n);
    const depth = 10 * (by & 255);
    for (let px = 0; px < w; px++) {
      const mat = haze && haze(px, py) ? 0 : world.at(wrap(rx + px, n), y);
      const tone = mat !== 0 && world.tone ? world.tone(wrap(rx + px, n), y) & 15 : 0;
      bake[py * w + px] = mat === 0 ? 0 : (mat | (tone << 8) | (depth << 16)) >>> 0;
    }
  }
  return { bake, rect: { x: rx, y: ry, w, h }, t: 0 };
}

const GRIDS = new WeakMap<FlatWorld, { gN: number; ground: Float32Array }>();

/** The land grid of a flat world, 8 cells a node: −1 where the node's middle is sea, 1 where it is anything else. */
export function gridOf(world: FlatWorld): { gN: number; ground: Float32Array } {
  const hit = GRIDS.get(world);
  if (hit) return hit;
  const gN = world.n / 8;
  const ground = new Float32Array(gN * gN);
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const m = world.at(gx * 8 + 4, gy * 8 + 4);
    ground[gy * gN + gx] = m === M.sea || m === M.seaClear ? -1 : 1;
  }
  const grid = { gN, ground };
  GRIDS.set(world, grid);
  return grid;
}

const N = 10240;

/** Sea to the west of x = `at`, `shore` for `depth` cells east of it, meadow beyond: a straight coast running north–south. */
export function coastEast(at: number, shore: number, depth = 12): FlatWorld {
  return { n: N, at: (x) => (x < at ? M.sea : x < at + depth ? shore : M.meadowMid) };
}

/** Land to the west of x = `at`, sea to the east. */
export function coastWest(at: number, shore: number, depth = 12): FlatWorld {
  return { n: N, at: (x) => (x >= at ? M.sea : x >= at - depth ? shore : M.meadowMid) };
}

/** Land south of y = `at`. */
export function coastSouth(at: number, shore: number, depth = 12): FlatWorld {
  return { n: N, at: (_x, y) => (y < at ? M.sea : y < at + depth ? shore : M.meadowMid) };
}

/** Land north of y = `at`. */
export function coastNorth(at: number, shore: number, depth = 12): FlatWorld {
  return { n: N, at: (_x, y) => (y >= at ? M.sea : y >= at - depth ? shore : M.meadowMid) };
}

/** A straight coast through (px, py) whose land lies toward the unit vector (ux, uy). */
export function coastToward(px: number, py: number, ux: number, uy: number, shore: number, depth = 12): FlatWorld {
  return {
    n: N,
    at(x, y) {
      const s = (x - px) * ux + (y - py) * uy;
      return s < 0 ? M.sea : s < depth ? shore : M.meadowMid;
    },
  };
}

/** A round bay of sea, radius r, centred on (cx, cy), in land whose rim is `shore`: shore on every side. */
export function cove(cx: number, cy: number, r: number, shore: number, depth = 12): FlatWorld {
  return {
    n: N,
    at(x, y) {
      const d = Math.hypot(x - cx, y - cy);
      return d < r ? M.sea : d < r + depth ? shore : M.meadowMid;
    },
  };
}

/** A coast running north–south at x = `at` whose shore changes kind every `each` cells going south: `kinds` in turn. */
export function coastOfKinds(at: number, kinds: readonly number[], y0: number, each: number, depth = 12): FlatWorld {
  return {
    n: N,
    at(x, y) {
      if (x < at) return M.sea;
      if (x >= at + depth) return M.meadowMid;
      const k = Math.min(kinds.length - 1, Math.max(0, Math.floor((y - y0) / each)));
      return kinds[k];
    },
  };
}

export const OPEN_SEA: FlatWorld = { n: N, at: () => M.sea };
export const MEADOW: FlatWorld = { n: N, at: () => M.meadowMid };
/** A lake to the west of x = `at` in grass. */
export function lakeShore(at: number): FlatWorld {
  return { n: N, at: (x) => (x < at ? M.lake : M.meadowMid) };
}

/** A small block of `shore` in open sea, its west face at x = `at`, `tall` cells from north to south about y = `mid`: one short shore. */
export function islet(at: number, mid: number, tall: number, shore: number, depth = 14): FlatWorld {
  return { n: N, at: (x, y) => (x >= at && x < at + depth && Math.abs(y - mid) <= tall / 2 ? shore : M.sea) };
}

/** One fall on a river: where its top is, how many frame rows it falls, and nothing else (it is as wide as its river). */
export interface FlatFall {
  y: number;
  run: number;
}

/**
 * A river running north–south through meadow, `width` cells wide about x = `at`, of tone `tone` (under 8 a wide
 * river, 8–13 a stream), with falls on it: each a stretch of falling water `run` frame rows long going south from
 * its `y` (a frame row is 1.25 cells of ground here, where the real bake stands a fall up on the screen).
 */
export function riverNS(at: number, width: number, tone: number, falls: readonly FlatFall[] = [], from = -Infinity, to = Infinity): FlatWorld {
  const inRiver = (x: number, y: number) => Math.abs(x - at) < width / 2 && y >= from && y < to;
  return {
    n: N,
    at: (x, y) => (inRiver(x, y) ? M.river : M.meadowMid),
    tone(x, y) {
      if (!inRiver(x, y)) return 0;
      for (const f of falls) if (y >= f.y && y < f.y + f.run / 0.8) return 14;
      return tone;
    },
  };
}

/** Two flat worlds as one: `b` wherever it is not meadow, else `a`. */
export function overlay(a: FlatWorld, b: FlatWorld): FlatWorld {
  const top = (x: number, y: number) => b.at(x, y) !== M.meadowMid;
  return { n: a.n, at: (x, y) => (top(x, y) ? b.at(x, y) : a.at(x, y)), tone: (x, y) => (top(x, y) ? (b.tone?.(x, y) ?? 0) : (a.tone?.(x, y) ?? 0)) };
}
