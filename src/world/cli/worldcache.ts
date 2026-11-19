// A disk cache of the generator's stages before siting (land, hydrology,
// rivers, climate), so tuning sites, buildings and renders does not wait a
// minute for the same 6400 world each run. Files live in .cache/world-gen/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import type { WorldParams } from "../gen/params.ts";
import { NATIVE_VERSION } from "../gen/native.ts";
import { climateStage, type Grown, growNative, growTerrain, nativeTerrain, type Terrain } from "../gen/pipeline.ts";

/**
 * Bump when a stage that grows the land changes what it returns. The climate and its landforms do not count: they
 * are worked out again on every read, over the grown land the file holds.
 */
const VERSION = 10;

/** A grown land from the cache, or grown and cached. The params travel with the call, not the file. */
function cached(p: WorldParams, file: string, grow: () => Grown): Grown {
  if (existsSync(file)) {
    const g = deserialize(readFileSync(file)) as Grown;
    g.land.p = p;
    return g;
  }
  const g = grow();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, serialize(g));
  return g;
}

export function cachedTerrain(p: WorldParams, seed: number, dir = join(process.cwd(), ".cache", "world-gen")): Terrain {
  // The climate is cheap and is tuned often, so the file's own is never trusted: it comes from the code as it stands.
  const g0 = cached(p, join(dir, `v${VERSION}-${p.n}-${seed}.bin`), () => growTerrain(p, seed));
  const t0 = climateStage(g0, seed);
  if (!p.native || !p.climate.zones) return t0;
  // The land grown for the climates (gen/native.ts) is kept apart, under its own version.
  const g1 = cached(p, join(dir, `v${VERSION}-native${NATIVE_VERSION}-${p.n}-${seed}.bin`), () => growNative(p, seed, t0));
  return nativeTerrain(p, seed, g0, g1);
}
