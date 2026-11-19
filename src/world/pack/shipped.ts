// Reading a shipped world from disk, whole, for the build-time tools and the tests (Node only: it reads files).
// It understands both layouts: format 1 (one world.bin) and format 2 (core.bin plus regions/, pack/regions.ts).
// The page never uses this; it streams regions instead.

import type { BakeWorld } from "../bake/world.ts";
import { cutFromRegions, decodeCore, decodeRegion, type Core, type RegionGrids } from "./regions.ts";
import { decodeFlightData, decodeWorld, type FlightData } from "./world.ts";

/** Node's file helpers, loaded when a tool asks. The page never imports this module. */
interface Io {
  readFileSync: typeof import("node:fs").readFileSync;
  join: typeof import("node:path").join;
}

async function io(): Promise<Io> {
  const [fs, path] = await Promise.all([import("node:fs"), import("node:path")]);
  return { readFileSync: fs.readFileSync, join: path.join };
}

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
  const files = await io();
  const worldId = id ?? currentId(files, worldRoot);
  const dir = files.join(worldRoot, worldId);
  const manifest = JSON.parse(files.readFileSync(files.join(dir, "manifest.json"), "utf8")) as ShippedManifest;
  if (manifest.format === 1) return readWhole(files, dir, manifest);
  if (manifest.format === 2) return readTiled(files, dir, manifest);
  throw new Error("bad world format");
}

function currentId(files: Io, worldRoot: string): string {
  const current = JSON.parse(files.readFileSync(files.join(worldRoot, "current.json"), "utf8")) as { worldId?: unknown };
  if (typeof current.worldId !== "string" || current.worldId === "") throw new Error("missing world");
  return current.worldId;
}

function readBytes(files: Io, file: string): Uint8Array {
  return new Uint8Array(files.readFileSync(file));
}

async function readWhole(files: Io, dir: string, manifest: ShippedManifest): Promise<Shipped> {
  const bin = readBytes(files, files.join(dir, "world.bin"));
  const [world, flight] = await Promise.all([decodeWorld(bin), decodeFlightData(bin)]);
  return { manifest, world, flight };
}

async function readRegion(files: Io, dir: string, core: Core, rx: number, ry: number): Promise<RegionGrids> {
  const region = await decodeRegion(readBytes(files, files.join(dir, "regions", `${rx}-${ry}.bin`)), core);
  if (region.rx !== rx || region.ry !== ry) throw new Error(`region ${rx}-${ry} is ${region.rx}-${region.ry}`);
  return region;
}

/** cutFromRegions of the whole grids, copied into plain arrays so the world carries no window. */
function plainWorld(cut: BakeWorld): BakeWorld {
  const world: BakeWorld = {
    n: cut.n,
    gN: cut.gN,
    cN: cut.cN,
    ground: new Float32Array(cut.ground),
    waterLevel: new Float32Array(cut.waterLevel),
    waterKind: new Uint8Array(cut.waterKind),
    hand: new Float32Array(cut.hand),
    shore: new Uint8Array(cut.shore),
    rivers: cut.rivers,
    falls: cut.falls,
    moisture: new Float32Array(cut.moisture),
    wind: new Float32Array(cut.wind),
    exposure: new Float32Array(cut.exposure),
    debris: new Float32Array(cut.debris),
    rock: new Uint8Array(cut.rock),
    regions: new Float32Array(cut.regions),
  };
  if (cut.base) world.base = new Float32Array(cut.base);
  if (cut.conform) world.conform = new Float32Array(cut.conform);
  if (cut.stamps) world.stamps = cut.stamps;
  if (cut.ponds) world.ponds = cut.ponds;
  if (cut.bars) world.bars = cut.bars;
  if (cut.built) world.built = cut.built;
  if (cut.roads) world.roads = cut.roads;
  return world;
}

async function readTiled(files: Io, dir: string, manifest: ShippedManifest): Promise<Shipped> {
  const core = await decodeCore(readBytes(files, files.join(dir, "core.bin")));
  const side = core.side;
  const jobs: Promise<RegionGrids>[] = [];
  for (let ry = 0; ry < side; ry++) {
    for (let rx = 0; rx < side; rx++) jobs.push(readRegion(files, dir, core, rx, ry));
  }
  const regions = await Promise.all(jobs);
  const have = new Map<number, RegionGrids>();
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    have.set(region.ry * side + region.rx, region);
  }
  const { gN, cN } = core.world;
  const world = plainWorld(cutFromRegions(core, (rx, ry) => {
    const region = have.get(ry * side + rx);
    if (!region) throw new Error(`missing region ${rx}-${ry}`);
    return region;
  }, { x0: 0, y0: 0, w: gN, h: gN }, { x0: 0, y0: 0, w: cN, h: cN }));
  const flight: FlightData = { n: world.n, gN: world.gN, ground: world.ground, occlusion: core.occlusion, block: core.block };
  return { manifest, world, flight };
}
