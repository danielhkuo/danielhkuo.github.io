// The shipped world: one file of compressed sections that decodes back into the
// BakeWorld the browser bakes from. Built on the owner's machine, committed under
// public/world/<worldId>/, read by the bake workers.

import type { BakeWorld } from "../bake/world.ts";

export const WORLD_FORMAT = 1;
/** Height steps per unit: ground, base, conform and lake levels are stored to 1/16 of a unit. */
export const H_SCALE = 16;
/** Steps over [0, 1] for the C fields (moisture, wind, exposure, debris) and the region weights. */
export const FIELD_SCALE = 63;
/** Steps per cell for river and road vertices (x, y and width). */
export const XY_SCALE = 16;

/** One section of world.bin: its name, stored length and the SHA-256 (hex) of its stored bytes. */
export interface WorldSection {
  name: string;
  bytes: number;
  sha256: string;
}

/** The occlusion floor: one byte per `block`-cell square, row-major over (n / block)². */
export interface Occlusion {
  block: number;
  data: Uint8Array;
}

/** What the main thread needs to fly: the ground on G and the occlusion floor. */
export interface FlightData {
  n: number;
  gN: number;
  ground: Float32Array;
  /** Empty, with block 0, when the file has no occlusion section. */
  occlusion: Uint8Array;
  block: number;
}

/** The file is not a world, is of another format, or a section is damaged. */
export class WorldDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldDecodeError";
  }
}

export async function encodeWorld(w: BakeWorld, extra?: { occlusion?: Occlusion }): Promise<{ bin: Uint8Array; sections: WorldSection[] }> {
  void w;
  void extra;
  throw new Error("not implemented");
}

export async function decodeWorld(bin: Uint8Array, verify?: readonly WorldSection[]): Promise<BakeWorld> {
  void bin;
  void verify;
  throw new Error("not implemented");
}

export async function decodeFlightData(bin: Uint8Array): Promise<FlightData> {
  void bin;
  throw new Error("not implemented");
}
