// A disk cache of the generator's stages before siting (land, hydrology,
// rivers, climate), so tuning sites, buildings and renders does not wait a
// minute for the same 6400 world each run. Files live in .cache/world-gen/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { WorldParams } from "../gen/params.ts";
import { makeTerrain, type Terrain } from "../gen/pipeline.ts";

/** Bump when a stage before siting changes what it returns. */
const VERSION = 9;

export function cachedTerrain(p: WorldParams, seed: number, dir = join(process.cwd(), ".cache", "world-gen")): Terrain {
  const file = join(dir, `v${VERSION}-${p.n}-${seed}.bin`);
  if (existsSync(file)) return deserialize(readFileSync(file)) as Terrain;
  const t = makeTerrain(p, seed);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, serialize(t));
  return t;
}
