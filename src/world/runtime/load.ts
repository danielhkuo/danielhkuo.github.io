// Loading the shipped world on the page: current.json names the world, its
// manifest says what to expect, and world.bin holds it. Any failure comes back
// as one error the page can show.

import type { Manifest } from "../pack/manifest.ts";
import type { FlightData } from "../pack/world.ts";

/** What the page shows when the world cannot be loaded. */
export const LOAD_FAILED = "The realm could not be loaded.";

export class WorldLoadError extends Error {
  constructor(cause: unknown) {
    super(LOAD_FAILED, { cause });
    this.name = "WorldLoadError";
  }
}

export interface LoadedWorld {
  manifest: Manifest;
  /** Absolute or root-relative URL of world.bin, for the workers to fetch. */
  binUrl: string;
  /** The ground and occlusion floor, decoded on this thread. */
  data: FlightData;
}

/**
 * Fetches `${base}/current.json`, then `${base}/<worldId>/manifest.json` and `${base}/<worldId>/world.bin`, checks
 * that the file is as long as the manifest says, and decodes the flight data. Throws WorldLoadError on a failed
 * request, a non-OK status, bad JSON, a length mismatch or a decode error.
 */
export async function loadWorld(fetchFn: (url: string) => Promise<Response>, base: string): Promise<LoadedWorld> {
  void fetchFn;
  void base;
  throw new Error("not implemented");
}
