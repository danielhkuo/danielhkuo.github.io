// A whole-world overview, for judging a seed's layout at a glance: sea and lakes, land shaded by height with a
// north-west light, rivers, and every site as a coloured square.
//
//   npm run world:map -- --seed 3 [--n 10240] [--step 8] [--view height|cover|climate] [--wild]
//
// Reads the land from .cache/world-gen/ (generating and caching it the first time) and writes
// .cache/world-map/<n>-<seed>.png, one pixel per `step` cells. `--view cover` paints each pixel as the cover the
// bake would give that cell, in the palette's own colours, so the map shows the climates; `--view climate` shows the
// fields behind them (red hot, blue cold, green wet). `--wild` skips siting: the land alone, in seconds.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cover } from "../cover.ts";
import { latitudeAt } from "../gen/climate.ts";
import { paramsFor } from "../gen/params.ts";
import { settleWorld, type Terrain, type World } from "../gen/pipeline.ts";
import type { CoverInput } from "../look/contract.ts";
import { isWater, MATERIAL as M } from "../look/materials.ts";
import { buildPalette, FLAT_TONE, MIDDAY } from "../render/palette.ts";
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

/**
 * The world as its cover: each pixel is the material the bake's cover gives the cell at its centre, in the palette's
 * colour for that material, shaded by a north-west light. Fields are read at the nearest node, and the borders are
 * dithered by the mask, as in the bake. With `climate`, the fields behind the cover instead: red hot, blue cold, green wet.
 */
export function coverOverview(t: Terrain, step: number, mask: Uint8Array, climate = false, ground: ArrayLike<number> = t.rivers.ground): { rgba: Uint8Array; size: number } {
  const p = t.land.p, n = p.n, gN = p.gN, cN = p.cN, c2 = cN * cN;
  const size = Math.floor(n / step);
  const rgba = new Uint8Array(size * size * 4);
  const pal = buildPalette(MIDDAY);
  const sea = t.land.isSea, lake = t.hydro.lakeId, hand = t.hydro.hand, temp = t.climate.temp;
  const G = (gx: number, gy: number): number => (((gy % gN) + gN) % gN) * gN + (((gx % gN) + gN) % gN);
  // River cells at map scale: the pixels a reach of two cells or wider passes through.
  const river = new Uint8Array(size * size);
  for (const r of t.rivers.reaches) {
    const v = r.vertices;
    for (let k = 0; k + 3 < v.length; k += 4) {
      if (v[k + 2] < 2) continue;
      river[(((Math.floor(v[k + 1] / step) % size) + size) % size) * size + (((Math.floor(v[k] / step) % size) + size) % size)] = 1;
    }
  }
  const region = new Float32Array(6);
  const c: CoverInput = { x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0, rock: 0, region, water: 0, shore: 0, westness: 0, temp: undefined };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = px * step + (step >> 1), y = py * step + (step >> 1);
    const gx = x >> 2, gy = y >> 2, i = gy * gN + gx, ci = (gy >> 1) * cN + (gx >> 1);
    const e = ground[i];
    const dx = (ground[G(gx + 1, gy)] - ground[G(gx - 1, gy)]) / 8, dy = (ground[G(gx, gy + 1)] - ground[G(gx, gy - 1)]) / 8;
    const s = Math.sqrt(dx * dx + dy * dy);
    const o = (py * size + px) * 4;
    if (climate) {
      const tv = temp ? temp[ci] : 0.5, m = t.climate.moisture[ci], k = sea[i] ? 0.55 : 1;
      rgba[o] = 255 * tv * k; rgba[o + 1] = 255 * m * k * 0.9; rgba[o + 2] = 255 * (1 - tv) * k; rgba[o + 3] = 255;
      continue;
    }
    c.x = x; c.y = y; c.e = e; c.slope = s;
    c.northness = s > 1e-6 ? dy / s : 0;
    c.westness = s > 1e-6 ? dx / s : 0;
    c.hand = hand[i];
    c.moisture = t.climate.moisture[ci]; c.wind = t.climate.wind[ci];
    c.exposure = t.land.exposure[i];
    const d = t.land.debris[i] / 3;
    c.debris = d > 1 ? 1 : d;
    c.rock = t.land.rock[i];
    for (let a = 0; a < 6; a++) region[a] = t.land.plan.regions[a * c2 + ci];
    c.water = sea[i] ? 1 : lake[i] >= 0 ? 2 : river[py * size + px] ? 3 : 0;
    c.shore = t.land.shoreClass[i];
    c.temp = temp ? temp[ci] : undefined;
    let m = cover(c, mask, n);
    // A wood is seen from above as its crowns, not its floor.
    const hsh = Math.imul(px + 1, 0x27d4eb2d) ^ Math.imul(py + 1, 0x165667b1);
    if (m === M.floorJungle) m = M.jungleCool + ((hsh >>> 9) % 3);
    else if (m === M.floorConifer) m = (temp && temp[ci] < 0.45 ? M.spruceCool : M.coniferCool) + ((hsh >>> 9) % 3);
    else if (m === M.floorBroadleaf) m = temp && temp[ci] > 0.56 ? M.maquis : M.broadleafCool + ((hsh >>> 9) % 3);
    let tone: number;
    if (isWater[m]) {
      const depth = sea[i] ? -e : 3;
      tone = m === M.river ? 4 : Math.max(1, Math.min(14, Math.floor(1 + (13.5 * depth) / (depth + 5))));
    } else {
      // A north-west light, as the bake's: lit faces a tone or three up, shaded ones down.
      const lit = -(dx + dy) * 2.2;
      tone = Math.max(1, Math.min(15, Math.floor(FLAT_TONE + (lit > 1 ? 1 : lit < -1 ? -1 : lit) * 4 + 0.5)));
    }
    const v = pal[(m << 8) | tone];
    rgba[o] = v & 255; rgba[o + 1] = (v >>> 8) & 255; rgba[o + 2] = (v >>> 16) & 255; rgba[o + 3] = 255;
  }
  // The equator and the pole: ticks in the margin, red and white.
  if (t.climate.equatorY !== undefined) {
    for (let py = 0; py < size; py++) {
      const lat = latitudeAt(py * step + step / 2, n, t.climate.equatorY);
      const tick = lat < 1.5 * step / (n / 2) ? [220, 60, 40] : lat > 1 - 1.5 * step / (n / 2) ? [255, 255, 255] : null;
      if (!tick) continue;
      for (const px of [0, 1, 2, 3, 4, 5, size - 6, size - 5, size - 4, size - 3, size - 2, size - 1]) {
        const o = (py * size + px) * 4;
        rgba[o] = tick[0]; rgba[o + 1] = tick[1]; rgba[o + 2] = tick[2];
      }
    }
  }
  return { rgba, size };
}

/** Site and wonder squares over an overview. */
function markSites(rgba: Uint8Array, size: number, step: number, w: World): void {
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
  for (const s of w.settlement.sites) dot(s.x, s.y, SITE_RGB[s.type] ?? [255, 255, 255], 4);
  for (const s of (w.settlement as { wonders?: readonly { x: number; y: number }[] }).wonders ?? []) dot(s.x, s.y, [0, 200, 200], 5);
}

export function main(argv: readonly string[]): number {
  let seed = 3, n = 6400, step = 8, view = "height", wild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--n") n = Number(argv[++i]);
    else if (a === "--step") step = Number(argv[++i]);
    else if (a === "--view") view = argv[++i];
    else if (a === "--wild") wild = true;
    else {
      console.error(`unknown argument ${a}`);
      return 1;
    }
  }
  if (view !== "height" && view !== "cover" && view !== "climate") {
    console.error(`unknown view ${view}`);
    return 1;
  }
  const t0 = performance.now();
  const terrain = cachedTerrain(paramsFor(n), seed);
  const world = wild && view !== "height" ? null : settleWorld(terrain);
  let out: { rgba: Uint8Array; size: number };
  if (view === "height") out = overview(world as World, step);
  else {
    const mask = new Uint8Array(readFileSync(join(process.cwd(), "public", "world", "bluenoise.bin")));
    out = coverOverview(terrain, step, mask, view === "climate", world ? world.settlement.ground : terrain.rivers.ground);
    if (world) markSites(out.rgba, out.size, step, world);
  }
  const { rgba, size } = out;
  const dir = join(process.cwd(), ".cache", "world-map");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${n}-${seed}${view === "height" ? "" : `-${view}`}.png`);
  writeFileSync(file, encodePng(rgba, size, size));
  let land = 0;
  for (let i = 0; i < terrain.land.isSea.length; i++) if (!terrain.land.isSea[i]) land++;
  console.log(`${file}  ${size}×${size}  land ${(land / terrain.land.isSea.length).toFixed(3)}  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (world) {
    const counts: Record<string, number> = {};
    for (const s of world.settlement.sites) counts[s.type] = (counts[s.type] ?? 0) + 1;
    console.log(`sites ${JSON.stringify(counts)}  shortfall ${JSON.stringify(world.settlement.shortfall)}`);
  }
  return 0;
}
