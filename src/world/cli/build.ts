// Builds the shipped world: generates (or reads from the cache) the chosen seed,
// encodes it into world.bin with its occlusion floor, and writes the manifest.
//
//   npm run world:build -- --seed 3 [--n 6400] [--cache]
//
// Output: <out>/<worldId>/world.bin, <out>/<worldId>/manifest.json, <out>/current.json.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBakeWorld, type BakeWorld } from "../bake/world.ts";
import { worldLook } from "../bake/look.ts";
import { occlusionFloor } from "../gen/occlusion.ts";
import { paramsFor } from "../gen/params.ts";
import { makeWorld, settleWorld, type World } from "../gen/pipeline.ts";
import { sha256 } from "../pack/codec.ts";
import { startOf, type Manifest } from "../pack/manifest.ts";
import { decodeWorld, encodeWorld, WORLD_FORMAT } from "../pack/world.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { createView } from "../runtime/view.ts";
import { encodePng } from "./png.ts";
import { cachedTerrain } from "./worldcache.ts";

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
  /** Refuse, writing nothing, when world.bin would be larger than this. */
  maxBytes?: number;
}

const VIEW_W = 400;
const VIEW_H = 225;

/** Writes the world's files and returns its manifest. Older world folders under `out` are left in place. */
export async function buildWorld(opts: BuildOptions): Promise<Manifest> {
  const { n, seed, out } = opts;
  const params = paramsFor(n);
  const world = opts.world ?? (opts.cache ? settleWorld(cachedTerrain(params, seed)) : makeWorld(params, seed));
  const bw = buildBakeWorld({ params, seed, world });
  const occlusion = occlusionFloor(bw.ground, bw.gN, n / bw.gN, OCCLUSION_BLOCK);
  const { bin, sections } = await encodeWorld(bw, { occlusion: { block: OCCLUSION_BLOCK, data: occlusion } });
  if (opts.maxBytes !== undefined && bin.length > opts.maxBytes) {
    throw new Error(`world.bin would be ${bin.length} bytes, over the budget of ${opts.maxBytes}; nothing was written`);
  }
  const worldId = (await sha256(bin)).slice(0, 12);
  const sites = world.settlement.sites.map((s) => ({ id: s.id, type: s.type, x: s.x, y: s.y }));
  const manifest: Manifest = {
    format: WORLD_FORMAT,
    worldId,
    n,
    seed,
    bytes: bin.length,
    sections,
    block: OCCLUSION_BLOCK,
    sites,
    start: startOf(world.settlement.sites, n),
  };

  const dir = join(out, worldId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "world.bin"), bin);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(out, "current.json"), JSON.stringify({ worldId }) + "\n");

  const older: string[] = [];
  const entries = readdirSync(out, { withFileTypes: true });
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i].name;
    if (entries[i].isDirectory() && name !== worldId && /^[0-9a-f]{12}$/.test(name)) older.push(name);
  }
  older.sort();
  for (let i = 0; i < older.length; i++) console.log(`older world: ${older[i]}`);
  return manifest;
}

function rgba(px: Uint32Array): Uint8Array {
  return new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
}

function drawFrame(world: BakeWorld, look: ReturnType<typeof worldLook>, mask: Uint8Array, x: number, y: number): Uint32Array {
  const view = createView(world, look, mask, { width: VIEW_W, height: VIEW_H });
  view.setCamera(x, y);
  const frame = new Uint32Array(VIEW_W * VIEW_H);
  view.frame(frame);
  return frame;
}

function pixelShare(a: Uint32Array, b: Uint32Array): number {
  let differ = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
  return differ / a.length;
}

/** The command line: parses argv, builds into public/world, prints sizes, gates the budget and renders the check views. */
export async function main(argv: readonly string[]): Promise<number> {
  let seed: number | null = null;
  let n = 6400;
  let cache = false;
  let out = join(process.cwd(), "public", "world");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--n") n = Number(argv[++i]);
    else if (a === "--cache") cache = true;
    else if (a === "--out") out = argv[++i];
    else {
      console.error(`unknown argument ${a}`);
      return 1;
    }
  }
  if (seed === null || !Number.isInteger(seed)) {
    console.error("--seed is required");
    return 1;
  }
  if (!Number.isInteger(n)) {
    console.error("--n must be an integer");
    return 1;
  }

  const params = paramsFor(n);
  const world = cache ? settleWorld(cachedTerrain(params, seed)) : makeWorld(params, seed);
  let manifest: Manifest;
  try {
    manifest = await buildWorld({ n, seed, out, cache, world, maxBytes: n === 6400 ? BUDGET_BYTES : undefined });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  for (let i = 0; i < manifest.sections.length; i++) {
    const s = manifest.sections[i];
    console.log(`${s.name} ${(s.bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`total ${(manifest.bytes / 1024).toFixed(1)} KB`);

  const look = worldLook(n, buildPalette(MIDDAY));
  const mask = new Uint8Array(readFileSync(join(process.cwd(), "public", "world", "bluenoise.bin")));
  const original = buildBakeWorld({ params, seed, world });
  const decoded = await decodeWorld(new Uint8Array(readFileSync(join(out, manifest.worldId, "world.bin"))));
  const views: { name: string; x: number; y: number }[] = [
    { name: "start", x: manifest.start.x, y: manifest.start.y },
  ];
  for (let i = 0; i < manifest.sites.length; i++) {
    const s = manifest.sites[i];
    if (s.type === "abbey") {
      views.push({ name: "abbey", x: s.x, y: s.y });
      break;
    }
  }
  const cacheDir = join(process.cwd(), ".cache", "world-build");
  mkdirSync(cacheDir, { recursive: true });
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    const orig = drawFrame(original, look, mask, v.x, v.y);
    const dec = drawFrame(decoded, look, mask, v.x, v.y);
    writeFileSync(join(cacheDir, `${manifest.worldId}-${v.name}-orig.png`), encodePng(rgba(orig), VIEW_W, VIEW_H));
    writeFileSync(join(cacheDir, `${manifest.worldId}-${v.name}-decoded.png`), encodePng(rgba(dec), VIEW_W, VIEW_H));
    console.log(`${v.name}: ${pixelShare(orig, dec).toFixed(6)} of pixels differ`);
  }
  return 0;
}
