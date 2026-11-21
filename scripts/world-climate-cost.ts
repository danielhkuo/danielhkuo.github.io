// What the climates cost the bake: the same tiles and chunks of a real world built with its climates and again as
// a temperate world (no temperature, no dry side), in turn, warm. Tiles are sorted into those whose every climate
// node is on the temperate plateau and the rest. Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-climate-cost.ts [--n 10240] [--seed 3] [--tiles 60] [--rounds 3]

import { buildTile, TILE } from "../src/world/bake/cells.ts";
import { bakeChunk, tileCache } from "../src/world/bake/chunk.ts";
import { worldLook } from "../src/world/bake/look.ts";
import { type BakeWorld, buildBakeWorld } from "../src/world/bake/world.ts";
import { loadBlueNoise } from "../src/world/cli/render.ts";
import { cachedTerrain } from "../src/world/cli/worldcache.ts";
import { hash2 } from "../src/world/core/hash.ts";
import { paramsFor } from "../src/world/gen/params.ts";
import { settleWorld } from "../src/world/gen/pipeline.ts";
import { buildPalette } from "../src/world/render/palette.ts";

let n = 10240, seed = 3, count = 60, rounds = 3;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--n") n = Number(argv[++i]);
  else if (argv[i] === "--seed") seed = Number(argv[++i]);
  else if (argv[i] === "--tiles") count = Number(argv[++i]);
  else if (argv[i] === "--rounds") rounds = Number(argv[++i]);
}

const params = paramsFor(n);
const made = settleWorld(cachedTerrain(params, seed));
const world = buildBakeWorld({ params, seed, world: made });
const plain: BakeWorld = { ...world, temp: undefined, arid: undefined };
const look = worldLook(n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
const mask = loadBlueNoise();
const nT = n / TILE, cN = world.cN;

/** Whether a tile has land, and whether every climate node under it is on the wet side's plateau. */
function kind(tx: number, ty: number): { land: boolean; temperate: boolean } {
  let land = false, temperate = true;
  for (let cy = ty * 32; cy < ty * 32 + 32; cy++) for (let cx = tx * 32; cx < tx * 32 + 32; cx++) {
    const i = cy * cN + cx;
    if (world.temp && world.temp[i] !== 0.5) temperate = false;
    if (world.arid && world.arid[i] > 0) temperate = false;
    const g = 2 * cy * world.gN + 2 * cx;
    if (world.waterKind[g] === 0) land = true;
  }
  return { land, temperate };
}

// Tiles with land, drawn evenly over the world by a hash, sorted by kind.
const temperateTiles: [number, number][] = [], otherTiles: [number, number][] = [];
for (let k = 0; temperateTiles.length + otherTiles.length < 2 * count && k < 20000; k++) {
  const h = hash2(k, 7, seed);
  const tx = h % nT, ty = (h >>> 12) % nT, kd = kind(tx, ty);
  if (!kd.land) continue;
  if (kd.temperate) { if (temperateTiles.length < count / 3) temperateTiles.push([tx, ty]); }
  else if (otherTiles.length < count) otherTiles.push([tx, ty]);
  if (temperateTiles.length >= count / 3 && otherTiles.length >= count) break;
}

function time(w: BakeWorld, list: [number, number][]): number[] {
  const out: number[] = [];
  for (const [tx, ty] of list) {
    const t = performance.now();
    buildTile(w, look, mask, tx, ty);
    out.push(performance.now() - t);
  }
  return out;
}

function median(a: number[]): number {
  const s = Float64Array.from(a).sort();
  return s[s.length >> 1];
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// Warm both once, then alternate.
time(world, otherTiles.slice(0, 5));
time(plain, otherTiles.slice(0, 5));
for (const [name, list] of [["temperate tiles", temperateTiles], ["other tiles", otherTiles]] as const) {
  const a: number[] = [], b: number[] = [];
  for (let r = 0; r < rounds; r++) {
    a.push(sum(time(world, list)));
    b.push(sum(time(plain, list)));
  }
  const withC = median(a) / list.length, without = median(b) / list.length;
  console.log(`${name.padEnd(16)} ${list.length} tiles: with climates ${withC.toFixed(1)} ms a tile, as temperate ${without.toFixed(1)} ms; ${(100 * (withC / without - 1)).toFixed(1)} %`);
}

// The painter: whole chunks over the same tiles, with their own tile caches.
const chunks = otherTiles.slice(0, Math.min(16, otherTiles.length));
for (const [name, w] of [["with climates", world], ["as temperate", plain]] as const) {
  const tiles = tileCache(w, look, mask, 256);
  for (const [tx, ty] of chunks) bakeChunk(w, look, mask, tiles, tx, Math.floor(0.8 * ty));
  const t = performance.now();
  for (let r = 0; r < rounds; r++) for (const [tx, ty] of chunks) bakeChunk(w, look, mask, tiles, tx, Math.floor(0.8 * ty));
  console.log(`chunks ${name.padEnd(14)} ${((performance.now() - t) / (rounds * chunks.length)).toFixed(1)} ms a chunk (tiles cached)`);
}
