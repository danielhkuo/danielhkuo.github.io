// Loading the shipped world on the page: current.json names the world, its
// manifest says what to expect, and world.bin holds it. Any failure comes back
// as one error the page can show.

import type { Manifest } from "../pack/manifest.ts";
import { decodeFlightData, type FlightData } from "../pack/world.ts";

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
  try {
    const curRes = await fetchFn(`${base}/current.json`);
    if (!curRes.ok) throw new Error(`current.json ${curRes.status}`);
    let current: unknown;
    try {
      current = await curRes.json();
    } catch (e) {
      throw e;
    }
    const worldId = (current as { worldId?: unknown }).worldId;
    if (typeof worldId !== "string") throw new TypeError("worldId");

    const manifestRes = await fetchFn(`${base}/${worldId}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`);
    let manifest: Manifest;
    try {
      manifest = (await manifestRes.json()) as Manifest;
    } catch (e) {
      throw e;
    }

    const binUrl = `${base}/${worldId}/world.bin`;
    const binRes = await fetchFn(binUrl);
    if (!binRes.ok) throw new Error(`world.bin ${binRes.status}`);
    const buf = new Uint8Array(await binRes.arrayBuffer());
    if (buf.length !== manifest.bytes) throw new Error("length mismatch");

    const data = await decodeFlightData(buf);
    return { manifest, binUrl, data };
  } catch (cause) {
    throw new WorldLoadError(cause);
  }
}