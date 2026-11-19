// A whole-world overview, for judging a seed's layout at a glance: sea and lakes, land shaded by height with a
// north-west light, rivers, and every site as a coloured square.
//
//   npm run world:map -- --seed 3 [--n 10240] [--step 8]
//
// Reads the land from .cache/world-gen/ (generating and caching it the first time) and writes
// .cache/world-map/<n>-<seed>.png, one pixel per `step` cells.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paramsFor } from "../gen/params.ts";
import { settleWorld, type World } from "../gen/pipeline.ts";
import { encodePng } from "./png.ts";
import { cachedTerrain } from "./worldcache.ts";

/** Square colour per site type; anything unlisted is white. */
const SITE_RGB: Record<string, [number, number, number]> = {
  abbey: [200, 40, 30],
  town: [240, 140, 20],
  lighthouse: [250, 250, 250],
  bridge: [150, 90, 40],
  cathedral: [120, 40, 160],
  windmill: [230, 220, 60],
  yew: [20, 90, 30],
};

/** The overview's RGBA pixels, `size` a side, one pixel per `step` cells. */
export function overview(w: World, step: number): { rgba: Uint8Array; size: number } {
  const n = w.land.p.n, gN = w.land.p.gN, cpn = n / gN;
  const size = Math.floor(n / step);
  const rgba = new Uint8Array(size * size * 4);
  const g = w.settlement.ground, sea = w.land.isSea, lake = w.hydro.lakeId;
  const at = (gx: number, gy: number): number => g[(((gy % gN) + gN) % gN) * gN + (((gx % gN) + gN) % gN)];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const gx = Math.floor((px * step) / cpn), gy = Math.floor((py * step) / cpn), i = gy * gN + gx;
    const h = g[i];
    let r: number, gr: number, b: number;
    if (sea[i]) {
      const d = Math.min(1, Math.max(0, -h / 30));
      r = 120 - 70 * d; gr = 190 - 80 * d; b = 210 - 40 * d;
    } else if (lake[i] >= 0) {
      r = 90; gr = 160; b = 200;
    } else {
      const shade = Math.max(-1, Math.min(1, (at(gx - 1, gy - 1) - at(gx + 1, gy + 1)) * 0.25));
      const t = Math.min(1, h / 130);
      r = 120 + 110 * t; gr = 160 + 50 * t - 40 * t * t; b = 90 + 120 * t * t;
      const k = 1 + 0.35 * shade;
      r *= k; gr *= k; b *= k;
    }
    const o = (py * size + px) * 4;
    rgba[o] = Math.max(0, Math.min(255, r));
    rgba[o + 1] = Math.max(0, Math.min(255, gr));
    rgba[o + 2] = Math.max(0, Math.min(255, b));
    rgba[o + 3] = 255;
  }
  const dot = (x: number, y: number, rgb: [number, number, number], half: number): void => {
    const cx = Math.floor(x / step), cy = Math.floor(y / step);
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const px = (((cx + dx) % size) + size) % size, py = (((cy + dy) % size) + size) % size;
      const o = (py * size + px) * 4;
      const edge = Math.abs(dx) === half || Math.abs(dy) === half;
      rgba[o] = edge ? 20 : rgb[0];
      rgba[o + 1] = edge ? 20 : rgb[1];
      rgba[o + 2] = edge ? 20 : rgb[2];
    }
  };
  for (const r of w.rivers.reaches) {
    const v = r.vertices;
    for (let k = 0; k + 3 < v.length; k += 4) {
      const px = ((Math.floor(v[k] / step) % size) + size) % size, py = ((Math.floor(v[k + 1] / step) % size) + size) % size;
      const o = (py * size + px) * 4;
      rgba[o] = 50; rgba[o + 1] = 110; rgba[o + 2] = 190;
    }
  }
  for (const s of w.settlement.sites) dot(s.x, s.y, SITE_RGB[s.type] ?? [255, 255, 255], 4);
  for (const s of (w.settlement as { wonders?: readonly { x: number; y: number }[] }).wonders ?? []) dot(s.x, s.y, [0, 200, 200], 5);
  return { rgba, size };
}

export function main(argv: readonly string[]): number {
  let seed = 3, n = 6400, step = 8;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--n") n = Number(argv[++i]);
    else if (a === "--step") step = Number(argv[++i]);
    else {
      console.error(`unknown argument ${a}`);
      return 1;
    }
  }
  const t0 = performance.now();
  const world = settleWorld(cachedTerrain(paramsFor(n), seed));
  const { rgba, size } = overview(world, step);
  const dir = join(process.cwd(), ".cache", "world-map");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${n}-${seed}.png`);
  writeFileSync(file, encodePng(rgba, size, size));
  let land = 0;
  for (let i = 0; i < world.land.isSea.length; i++) if (!world.land.isSea[i]) land++;
  const counts: Record<string, number> = {};
  for (const s of world.settlement.sites) counts[s.type] = (counts[s.type] ?? 0) + 1;
  console.log(`${file}  ${size}×${size}  land ${(land / world.land.isSea.length).toFixed(3)}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`sites ${JSON.stringify(counts)}  shortfall ${JSON.stringify(world.settlement.shortfall)}`);
  return 0;
}
