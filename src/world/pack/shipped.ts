// Reading a shipped world from disk, whole, for the build-time tools and the tests (Node only: it reads files).
// It understands both layouts: format 1 (one world.bin) and format 2 (core.bin plus regions/, pack/regions.ts).
// The page never uses this; it streams regions instead.

import type { BakeWorld } from "../bake/world.ts";
import type { FlightData } from "./world.ts";

/** A shipped manifest of either format: the fields every tool reads. */
export interface ShippedManifest {
  format: 1 | 2;
  worldId: string;
  n: number;
  seed: number;
  block: number;
  sites: { id: string; type: string; x: number; y: number }[];
  start: { x: number; y: number; dx: number; dy: number };
  wonders?: unknown[];
  [key: string]: unknown;
}

export interface Shipped {
  manifest: ShippedManifest;
  /** The whole world, with every grid full size (no gWin or cWin), as decodeWorld gives it. */
  world: BakeWorld;
  /** The flight page's view of the ground and the occlusion floor, as decodeFlightData gives it. */
  flight: FlightData;
}

/**
 * Reads world `id` (default: the one `<worldRoot>/current.json` names) from `worldRoot`, in either format, and
 * returns it whole. Throws when the world or a file is missing or damaged.
 */
export async function readShipped(worldRoot: string, id?: string): Promise<Shipped> {
  void worldRoot, id;
  throw new Error("not implemented");
}
