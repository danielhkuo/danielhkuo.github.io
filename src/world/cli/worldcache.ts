// A disk cache of the generator's stages before siting (land, hydrology,
// rivers, climate), so tuning sites, buildings and renders does not wait a
// minute for the same 6400 world each run. Files live in .cache/world-gen/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { WorldParams } from "../gen/params.ts";
import { climateStage, type Grown, growTerrain, type Terrain } from "../gen/pipeline.ts";

/**
 * Bump when a stage that grows the land changes what it returns. The climate and its landforms do not count: they
 * are worked out again on every read, over the grown land the file holds.
 */
const VERSION = 10;

export function cachedTerrain(p: WorldParams, seed: number, dir = join(process.cwd(), ".cache", "world-gen")): Terrain {
  const file = join(dir, `v${VERSION}-${p.n}-${seed}.bin`);
  if (existsSync(file)) {
    // The climate is cheap and is tuned often, so the file's own is never trusted: it comes from the code as it stands.
    const t = deserialize(readFileSync(file)) as Grown;
    // The params travel with the call, not the file: the zones are tuned without growing the land again.
    t.land.p = p;
    return climateStage({ land: t.land, hydro: t.hydro, rivers: t.rivers }, seed);
  }
  const g = growTerrain(p, seed);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serialize(g));
  return climateStage(g, seed);
}
