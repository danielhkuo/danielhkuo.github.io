// Times the bake's 256² cell tiles on a real world: cold (the first build of each tile) and warm (the same
// tiles built again, code already compiled). Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-tile-time.ts [--n 6400] [--seed 1] [--tiles 5]

import { buildTile, TILE } from "../src/world/bake/cells.ts";
import { bakeChunk, tileCache } from "../src/world/bake/chunk.ts";
import { worldLook } from "../src/world/bake/look.ts";
import { buildBakeWorld } from "../src/world/bake/world.ts";
import { autoViewpoints, loadBlueNoise } from "../src/world/cli/render.ts";
import { cachedTerrain } from "../src/world/cli/worldcache.ts";
import { paramsFor } from "../src/world/gen/params.ts";
import { settleWorld } from "../src/world/gen/pipeline.ts";
import { buildPalette } from "../src/world/render/palette.ts";

let n = 6400, seed = 1, side = 5;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--n") n = Number(argv[++i]);
  else if (argv[i] === "--seed") seed = Number(argv[++i]);
  else if (argv[i] === "--tiles") side = Number(argv[++i]);
}

const params = paramsFor(n);
const made = settleWorld(cachedTerrain(params, seed));
const world = buildBakeWorld({ params, seed, world: made });
const look = worldLook(n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
const mask = loadBlueNoise();
const nT = n / TILE;

function stats(ms: number[]): string {
  const s = Float64Array.from(ms).sort();
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return `mean ${mean.toFixed(1)} ms, median ${s[s.length >> 1].toFixed(1)}, worst ${s[s.length - 1].toFixed(1)} (${ms.length} tiles)`;
}

// A block of tiles round each of the render harness's viewpoints: peak, river, coast, lowland and the rest.
const cold: number[] = [], warm: number[] = [];
for (const vp of autoViewpoints(world, made.land.plan, seed)) {
  const tx0 = Math.floor(vp.x / TILE) - (side >> 1), ty0 = Math.floor(vp.y / TILE) - (side >> 1);
  const c: number[] = [], w: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      const tx = (((tx0 + i) % nT) + nT) % nT, ty = (((ty0 + j) % nT) + nT) % nT;
      const t = performance.now();
      buildTile(world, look, mask, tx, ty);
      (pass === 0 ? c : w).push(performance.now() - t);
    }
  }
  console.log(`${vp.name.padEnd(18)} cold ${stats(c)}; warm ${stats(w)}`);
  cold.push(...c);
  warm.push(...w);
}
console.log(`all tiles          cold ${stats(cold)}`);
console.log(`all tiles          warm ${stats(warm)}`);

// The painter on top of warm tiles: one 256² chunk of bake pixels.
const tiles = tileCache(world, look, mask, 64);
const vp = autoViewpoints(world, made.land.plan, seed)[0];
const cx0 = Math.floor(vp.x / 256) - 1, cy0 = Math.floor((0.8 * vp.y) / 256) - 1;
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) bakeChunk(world, look, mask, tiles, cx0 + i, cy0 + j);
const paint: number[] = [];
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
  const t = performance.now();
  bakeChunk(world, look, mask, tiles, cx0 + i, cy0 + j);
  paint.push(performance.now() - t);
}
console.log(`chunk paint + ink  ${stats(paint)} (tiles cached)`);
