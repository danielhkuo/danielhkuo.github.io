// Cover preview on the real land: the generator's eroded heights, hydrology
// and climate, drawn two ways. `mapWindow` is a top-down map, one pixel per
// cell, straight from the bake's cell stage (cover, scatter, light, shadow).
// `cameraFrame` is the same land through the whole bake and the camera, which
// is where furrows and hedges meet the 0.8 row compression.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCells, F_SHADOW, type Look } from "../bake/cells.ts";
import { buildBakeWorld, type BakeWorld } from "../bake/world.ts";
import { climateFields } from "../gen/climate.ts";
import { hydrology } from "../gen/hydro.ts";
import { paramsFor } from "../gen/params.ts";
import { type Land, makeLand, makeWorld, rockOnG } from "../gen/pipeline.ts";
import { type Plan, planWorld } from "../gen/plan.ts";
import { rivers } from "../gen/rivers.ts";
import { LIGHT_SHADOW_SHIFT, type Palette } from "../look/contract.ts";
import { MATERIAL_COUNT, MATERIAL_NAMES } from "../look/materials.ts";
import { createView } from "../runtime/view.ts";

export const VIEW_W = 400;
export const VIEW_H = 225;

export interface PreviewWorld {
  world: BakeWorld;
  plan: Plan;
}

/**
 * The world the generator makes today (gen/pipeline.ts makeWorld), as the
 * bake reads it. Erosion takes a minute at full size, so the land is cached
 * under `cacheDir` when one is given; hydrology, rivers and climate always run.
 */
export function previewWorld(n: number, seed: number, _cacheDir?: string): PreviewWorld {
  // The land cache predated the coast stage's fields; build the whole world each time.
  const params = paramsFor(n);
  const made = makeWorld(params, seed);
  return { world: buildBakeWorld({ params, seed, world: made }), plan: made.land.plan };
}

export interface MapWindow {
  w: number;
  h: number;
  material: Uint8Array;
  /** Light bytes as the palette reads them: tone, shadow depth; no ink. */
  light: Uint8Array;
}

/** A top-down map of cells [x0, x0 + w) × [y0, y0 + h): the bake's cell stage, toned and dithered per cell. */
export function mapWindow(world: BakeWorld, look: Look, mask: Uint8Array, x0: number, y0: number, w: number, h: number): MapWindow {
  const material = new Uint8Array(w * h);
  const light = new Uint8Array(w * h);
  const step = 256;
  for (let ty = 0; ty < h; ty += step) {
    for (let tx = 0; tx < w; tx += step) {
      const tw = Math.min(step, w - tx);
      const th = Math.min(step, h - ty);
      const cells = buildCells(world, look, mask, x0 + tx, y0 + ty, tw, th);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const i = y * tw + x;
          const o = (ty + y) * w + tx + x;
          const m = cells.mat[i];
          material[o] = m;
          let tone: number;
          if (look.isWater[m] === 1) tone = cells.aux[i] & 15;
          else {
            const dither = (mask[(((y0 + ty + y) & 255) << 8) | ((x0 + tx + x) & 255)] + 0.5) / 256;
            tone = Math.floor((cells.light[i] * 15) / 255 + dither);
            tone = tone < 0 ? 0 : tone > 15 ? 15 : tone;
          }
          light[o] = tone | ((cells.flags[i] & F_SHADOW) << LIGHT_SHADOW_SHIFT);
        }
      }
    }
  }
  return { w, h, material, light };
}

/** Colour a map's material and light bytes through a palette. */
export function paint(m: MapWindow, palette: Palette): Uint8Array {
  const rgba = new Uint8Array(m.w * m.h * 4);
  const out = new Uint32Array(rgba.buffer);
  for (let i = 0; i < m.w * m.h; i++) out[i] = palette[(m.material[i] << 8) | m.light[i]];
  return rgba;
}

/** What the camera shows centred on the ground at cell (x, y): the full bake, 400 × 225. */
export function cameraFrame(world: BakeWorld, look: Look, mask: Uint8Array, x: number, y: number): Uint8Array {
  const view = createView(world, look, mask, { width: VIEW_W, height: VIEW_H, cacheChunks: 16 });
  const e = view.groundHeight(x, y);
  view.setCamera(x, y - e / 0.8);
  const out = new Uint32Array(VIEW_W * VIEW_H);
  view.frame(out);
  return new Uint8Array(out.buffer);
}

/** Share of the map's land under each material, largest first, as "name 12.3". */
export function coverShares(m: MapWindow, isWater: Uint8Array, least = 0.01): string[] {
  const counts = new Uint32Array(MATERIAL_COUNT);
  let land = 0;
  for (const id of m.material) {
    if (isWater[id] === 1) continue;
    counts[id]++;
    land++;
  }
  const order = [...counts.keys()].filter((id) => counts[id] / Math.max(1, land) >= least);
  // Largest first; ties by id.
  for (let a = 1; a < order.length; a++) {
    for (let b = a; b > 0 && counts[order[b]] > counts[order[b - 1]]; b--) [order[b], order[b - 1]] = [order[b - 1], order[b]];
  }
  return order.map((id) => `${MATERIAL_NAMES[id]} ${((100 * counts[id]) / land).toFixed(1)}`);
}

/** The cell of the map whose surrounding view-sized window holds the most cells that `want` accepts. */
export function busiest(m: MapWindow, want: Uint8Array): { x: number; y: number } {
  const step = 16;
  const cols = Math.floor(m.w / step);
  const rows = Math.floor(m.h / step);
  const block = new Uint32Array(cols * rows);
  for (let y = 0; y < rows * step; y++) {
    for (let x = 0; x < cols * step; x++) block[Math.floor(y / step) * cols + Math.floor(x / step)] += want[m.material[y * m.w + x]];
  }
  const bw = Math.floor(VIEW_W / step);
  const bh = Math.floor(VIEW_H / 0.8 / step);
  let best = -1;
  let at = { x: m.w >> 1, y: m.h >> 1 };
  for (let by = 0; by + bh <= rows; by++) {
    for (let bx = 0; bx + bw <= cols; bx++) {
      let sum = 0;
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) sum += block[(by + j) * cols + bx + i];
      if (sum > best) {
        best = sum;
        at = { x: (bx + bw / 2) * step, y: (by + bh / 2) * step };
      }
    }
  }
  return at;
}

/** Nearest-neighbour enlargement, hard pixels. */
export function upscale(rgba: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const out = new Uint8Array(w * k * h * k * 4);
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, w * h);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < h * k; y++) {
    const sy = Math.floor(y / k) * w;
    for (let x = 0; x < w * k; x++) dst[y * w * k + x] = src[sy + Math.floor(x / k)];
  }
  return out;
}
