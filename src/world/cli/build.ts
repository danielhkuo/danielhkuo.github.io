// Builds the shipped world: generates (or reads from the cache) the chosen seed,
// encodes it into world.bin with its occlusion floor, and writes the manifest.
//
//   npm run world:build -- --seed 3 [--n 6400] [--cache]
//
// Output: <out>/<worldId>/world.bin, <out>/<worldId>/manifest.json, <out>/current.json.

import type { World } from "../gen/pipeline.ts";
import type { Manifest } from "../pack/manifest.ts";

/** world.bin may not be larger than this for the 6400 world. */
export const BUDGET_BYTES = 3_670_016;
/** Cells per occlusion block. */
export const OCCLUSION_BLOCK = 16;

export interface BuildOptions {
  n: number;
  seed: number;
  /** Folder that holds the world folders and current.json (public/world in the site). */
  out: string;
  /** Read the land from .cache/world-gen/ instead of generating it. */
  cache?: boolean;
  /** A world already made for (n, seed): used instead of generating. */
  world?: World;
}

/** Writes the world's files and returns its manifest. Older world folders under `out` are left in place. */
export async function buildWorld(opts: BuildOptions): Promise<Manifest> {
  void opts;
  throw new Error("not implemented");
}

/** The command line: parses argv, builds into public/world, prints sizes, gates the budget and renders the check views. */
export async function main(argv: readonly string[]): Promise<number> {
  void argv;
  throw new Error("not implemented");
}
