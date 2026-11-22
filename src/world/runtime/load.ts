// Loading the shipped world on the page: current.json names the world, its
// manifest says what to expect, and core.bin holds the core. Regions are fetched
// later, one file at a time. Any failure comes back as one error the page can show.

import { sha256 } from "../pack/codec.ts";
import type { Manifest } from "../pack/manifest.ts";
import { decodeCore, type Core } from "../pack/regions.ts";

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
  /** The core, decoded on this thread. */
  core: Core;
  /** Absolute or root-relative URL of core.bin, for the workers to fetch. */
  coreUrl: string;
  /** URL of one region file. */
  regionUrl(rx: number, ry: number): string;
  /** Fetches one region and checks its length and sha256 against the manifest. */
  fetchRegion(rx: number, ry: number): Promise<Uint8Array>;
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<Manifest>;
  return m.format === 2 && !!m.core && typeof m.core.bytes === "number" && typeof m.core.sha256 === "string" && Array.isArray(m.regions);
}

/**
 * Fetches `${base}/current.json`, then `${base}/<worldId>/manifest.json` and `${base}/<worldId>/core.bin`.
 * Format 2 only. Checks the core's length and sha256, and decodes it. Throws WorldLoadError on a failed
 * request, a non-OK status, bad JSON, another format, a length or checksum mismatch, or a decode error.
 */
export async function loadWorld(fetchFn: (url: string) => Promise<Response>, base: string): Promise<LoadedWorld> {
  try {
    const curRes = await fetchFn(`${base}/current.json`);
    if (!curRes.ok) throw new Error(`current.json ${curRes.status}`);
    const current: unknown = await curRes.json();
    const worldId = (current as { worldId?: unknown }).worldId;
    if (typeof worldId !== "string") throw new TypeError("worldId");

    const manifestRes = await fetchFn(`${base}/${worldId}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`);
    const parsed: unknown = await manifestRes.json();
    if (!isManifest(parsed)) throw new TypeError("manifest");
    const manifest = parsed;

    const listed = new Map<string, { bytes: number; sha256: string }>();
    for (let i = 0; i < manifest.regions.length; i++) {
      const r = manifest.regions[i];
      listed.set(`${r.rx},${r.ry}`, r);
    }

    const coreUrl = `${base}/${worldId}/core.bin`;
    const regionUrl = (rx: number, ry: number): string => `${base}/${worldId}/regions/${rx}-${ry}.bin`;

    const coreRes = await fetchFn(coreUrl);
    if (!coreRes.ok) throw new Error(`core.bin ${coreRes.status}`);
    const buf = new Uint8Array(await coreRes.arrayBuffer());
    if (buf.length !== manifest.core.bytes) throw new Error("length mismatch");
    if (await sha256(buf) !== manifest.core.sha256) throw new Error("checksum");
    const core = await decodeCore(buf);

    const fetchRegion = async (rx: number, ry: number): Promise<Uint8Array> => {
      try {
        const entry = listed.get(`${rx},${ry}`);
        if (!entry) throw new Error(`unknown region ${rx},${ry}`);
        const res = await fetchFn(regionUrl(rx, ry));
        if (!res.ok) throw new Error(`region ${res.status}`);
        const bin = new Uint8Array(await res.arrayBuffer());
        if (bin.length !== entry.bytes) throw new Error("length mismatch");
        if (await sha256(bin) !== entry.sha256) throw new Error("checksum");
        return bin;
      } catch (cause) {
        if (cause instanceof WorldLoadError) throw cause;
        throw new WorldLoadError(cause);
      }
    };

    return { manifest, core, coreUrl, regionUrl, fetchRegion };
  } catch (cause) {
    if (cause instanceof WorldLoadError) throw cause;
    throw new WorldLoadError(cause);
  }
}
