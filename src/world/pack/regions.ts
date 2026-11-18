// The world in pieces: a core (meta, every vector, the falls, the occlusion floor and a haze overview) and one file
// per square region holding that region's G and C grids. A bake worker or the page fetches the core, then only the
// regions near the flier; a window of the grids cut from regions equals the same window cut from the whole decoded
// world (pack/world.ts), value for value.
//
// Each file is a pack whose last section, "sum", is the SHA-256 of the pack of the sections before it, so a flipped
// byte in a deflate stream is refused even when inflate itself succeeds. "fp" is a fingerprint of this world: the
// SHA-256 of the core sections, which include a digest of every region. A region carries those same bytes and is
// refused when they belong to another world.

import { riverIndex, type BakeWorld, type GridWindow } from "../bake/world.ts";
import { wrap } from "../core/torus.ts";
import { indexBuilt, type Built } from "../gen/built.ts";
import { encodeBytes, encodeHeights, readPack, sha256, writePack, type PackSection } from "./codec.ts";
import {
  FIELD_SCALE, H_SCALE, WORLD_FORMAT,
  asDecodeError, baseResidual, bytesOf, decodeLines, decodeValue, encodeRiverBytes, encodeValue,
  fail, flagged, frameChunks, fromQuantised, handBytes, lakeLevels, loadBytes, loadHeights, loadOcclusion, loadRaw,
  parseMeta, quantised, readFramed, regionWeights, requirePart, storeRaw,
  type Occlusion, type WorldSection,
} from "./world.ts";

/** Cells a side of one region in the shipped world. */
export const REGION_CELLS = 1280;

export interface TiledWorld {
  core: { bin: Uint8Array; sections: WorldSection[] };
  /** Every region, row-major (ry, then rx). */
  regions: { rx: number; ry: number; bin: Uint8Array; sections: WorldSection[] }[];
}

/** One region's grids, in the units decodeWorld gives: G arrays (regionCells / 4)², C arrays (regionCells / 8)². */
export interface RegionGrids {
  rx: number;
  ry: number;
  ground: Float32Array;
  base?: Float32Array;
  conform?: Float32Array;
  waterLevel: Float32Array;
  waterKind: Uint8Array;
  hand: Float32Array;
  shore: Uint8Array;
  moisture: Float32Array;
  wind: Float32Array;
  exposure: Float32Array;
  debris: Float32Array;
  rock: Uint8Array;
  /** Six planes, plane-major, each (regionCells / 8)². */
  regions: Float32Array;
}

export interface Core {
  /** The world with every grid empty (bake/window.ts strippedWorld) and every vector decoded. */
  world: BakeWorld;
  regionCells: number;
  /** Regions a side: n / regionCells. */
  side: number;
  /** The occlusion floor, as decodeFlightData gives it (block 0 and empty when absent). */
  occlusion: Uint8Array;
  block: number;
  /** Ground height at one sample per 8 cells, (n / 8)², for the haze: whole units, the sea as 0. */
  overview: Uint8Array;
}

const GROUND = "ground";
const BASE = "base";
const CONFORM = "conform";
const WLEVEL = "wlevel";
const WKIND = "wkind";
const HAND = "hand";
const SHORE = "shore";
const FALLS = "falls";
const MOISTURE = "moisture";
const WIND = "wind";
const EXPOSURE = "exposure";
const DEBRIS = "debris";
const ROCK = "rock";
const REGIONS = "regions";
const RIVERS = "rivers";
const ROADS = "roads";
const STAMPS = "stamps";
const PONDS = "ponds";
const BARS = "bars";
const BUILT = "built";
const OCCL = "occl";
const OVER = "over";
const RDIG = "rdig";
const FP = "fp";
const SUM = "sum";

const textEncoder = new TextEncoder();

/** Fingerprint bytes for a core this module decoded. A region from another world carries different bytes. */
const fingerprints = new WeakMap<Core, Uint8Array>();

interface Job {
  name: string;
  run: Promise<Uint8Array>;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function partMap(sections: PackSection[]): Map<string, Uint8Array> {
  const parts = new Map<string, Uint8Array>();
  for (let i = 0; i < sections.length; i++) parts.set(sections[i].name, sections[i].bytes);
  return parts;
}

function rect(src: ArrayLike<number>, n: number, x0: number, y0: number, side: number): Float32Array {
  const out = new Float32Array(side * side);
  for (let y = 0; y < side; y++) {
    const s = (y0 + y) * n + x0;
    const d = y * side;
    for (let x = 0; x < side; x++) out[d + x] = src[s + x];
  }
  return out;
}

function rectU8(src: ArrayLike<number>, n: number, x0: number, y0: number, side: number): Uint8Array {
  const out = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) {
    const s = (y0 + y) * n + x0;
    const d = y * side;
    for (let x = 0; x < side; x++) out[d + x] = src[s + x];
  }
  return out;
}

/** Whole units at G node (2·ox, 2·oy), clamped to [1, 255], with 0 where the quantised ground is ≤ 0. */
function overviewOf(ground: ArrayLike<number>, gN: number, n: number): Uint8Array {
  const oN = n / 8;
  const q = quantised(ground, H_SCALE);
  const out = new Uint8Array(oN * oN);
  for (let oy = 0; oy < oN; oy++) {
    const src = 2 * oy * gN;
    const dst = oy * oN;
    for (let ox = 0; ox < oN; ox++) {
      const h = q[src + 2 * ox];
      out[dst + ox] = h <= 0 ? 0 : Math.min(255, Math.max(1, Math.round(h)));
    }
  }
  return out;
}

function metaBytes(w: BakeWorld, regionCells: number, occlusion: Occlusion | undefined, at?: { rx: number; ry: number }): Uint8Array {
  const meta: Record<string, number | boolean> = { format: WORLD_FORMAT, n: w.n, gN: w.gN, cN: w.cN, regionCells };
  if (at) {
    meta.rx = at.rx;
    meta.ry = at.ry;
  }
  if (w.base) meta.base = true;
  if (w.conform) meta.conform = true;
  if (w.stamps) meta.stamps = true;
  if (w.ponds) meta.ponds = true;
  if (w.bars) meta.bars = true;
  if (w.built) meta.built = true;
  if (w.roads) meta.roads = true;
  if (occlusion) meta.block = occlusion.block;
  return textEncoder.encode(JSON.stringify(meta));
}

function assemble(meta: Uint8Array, jobs: readonly Job[], bodies: Uint8Array[]): PackSection[] {
  const sections: PackSection[] = [{ name: "meta", bytes: meta }];
  for (let i = 0; i < jobs.length; i++) sections.push({ name: jobs[i].name, bytes: bodies[i] });
  return sections;
}

/** SHA-256 of the concatenation of each part's SHA-256, so every region's bytes are in the fingerprint. */
async function chainDigest(parts: Uint8Array[]): Promise<Uint8Array> {
  const hashes = await Promise.all(parts.map((p) => sha256(p)));
  const buf = new Uint8Array(hashes.length * 32);
  for (let i = 0; i < hashes.length; i++) buf.set(fromHex(hashes[i]), i * 32);
  return fromHex(await sha256(buf));
}

async function finish(sections: PackSection[]): Promise<{ bin: Uint8Array; sections: WorldSection[] }> {
  const sum = fromHex(await sha256(writePack(sections)));
  const stored: PackSection[] = [...sections, { name: SUM, bytes: sum }];
  const bin = writePack(stored);
  const listed: WorldSection[] = [];
  for (let i = 0; i < stored.length; i++) {
    listed.push({ name: stored[i].name, bytes: stored[i].bytes.length, sha256: await sha256(stored[i].bytes) });
  }
  return { bin, sections: listed };
}

/** Sections before "sum", once the checksum of their pack matches and the file has no trailing bytes. */
async function unseal(bin: Uint8Array): Promise<PackSection[]> {
  let sections: PackSection[];
  try {
    sections = readPack(bin);
  } catch (e) {
    throw asDecodeError(e);
  }
  if (writePack(sections).length !== bin.length) fail("trailing section bytes");
  const sum = sections.length > 0 ? sections[sections.length - 1] : undefined;
  if (!sum || sum.name !== SUM || sum.bytes.length !== 32) fail("missing section sum");
  const content = sections.slice(0, -1);
  if (toHex(sum.bytes) !== await sha256(writePack(content))) fail("checksum");
  return content;
}

function take(sections: PackSection[], name: string): { rest: PackSection[]; bytes: Uint8Array } {
  const rest: PackSection[] = [];
  let bytes: Uint8Array | undefined;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].name === name) {
      if (bytes) fail(`duplicate section ${name}`);
      bytes = sections[i].bytes;
    } else rest.push(sections[i]);
  }
  if (!bytes) fail(`missing section ${name}`);
  return { rest, bytes };
}

function tileSize(w: BakeWorld, regionCells: number): { side: number; gS: number; cS: number } {
  const { n, gN, cN } = w;
  if (!Number.isInteger(n) || n <= 0 || gN * 4 !== n || cN * 8 !== n) throw new Error("bad world size");
  if (!Number.isInteger(regionCells) || regionCells < 8 || regionCells % 8 !== 0 || n % regionCells !== 0) {
    throw new Error("regionCells must divide n and be a multiple of 8");
  }
  return { side: n / regionCells, gS: regionCells / 4, cS: regionCells / 8 };
}

function coreJobs(w: BakeWorld, occlusion: Occlusion | undefined, overview: Uint8Array): Job[] {
  const jobs: Job[] = [];
  const push = (name: string, run: Promise<Uint8Array>): void => {
    jobs.push({ name, run });
  };
  push(FALLS, storeRaw(bytesOf(w.falls).slice()));
  push(RIVERS, storeRaw(encodeRiverBytes(w.rivers)));
  if (w.roads) push(ROADS, storeRaw(encodeRiverBytes(w.roads)));
  if (w.stamps) push(STAMPS, storeRaw(encodeValue(w.stamps)));
  if (w.ponds) push(PONDS, storeRaw(encodeValue(w.ponds)));
  if (w.bars) push(BARS, storeRaw(encodeValue(w.bars)));
  if (w.built) push(BUILT, storeRaw(encodeValue(w.built.built)));
  if (occlusion) push(OCCL, encodeBytes(occlusion.data));
  push(OVER, encodeBytes(overview));
  return jobs;
}

interface Prep {
  residual?: Float32Array;
  levels: Float32Array;
  hands: Uint8Array;
  weights: Float32Array;
}

function regionJobs(w: BakeWorld, prep: Prep, rx: number, ry: number, gS: number, cS: number): Job[] {
  const { gN, cN } = w;
  const gx = rx * gS, gy = ry * gS, cx = rx * cS, cy = ry * cS;
  const jobs: Job[] = [];
  const push = (name: string, run: Promise<Uint8Array>): void => {
    jobs.push({ name, run });
  };
  push(GROUND, encodeHeights(rect(w.ground, gN, gx, gy, gS), gS, gS, H_SCALE));
  if (prep.residual) push(BASE, encodeHeights(rect(prep.residual, gN, gx, gy, gS), gS, gS, H_SCALE));
  if (w.conform) push(CONFORM, encodeHeights(rect(w.conform, gN, gx, gy, gS), gS, gS, H_SCALE));
  push(WLEVEL, encodeHeights(rect(prep.levels, gN, gx, gy, gS), gS, gS, H_SCALE));
  push(WKIND, encodeBytes(rectU8(w.waterKind, gN, gx, gy, gS)));
  push(HAND, encodeBytes(rectU8(prep.hands, gN, gx, gy, gS)));
  push(SHORE, encodeBytes(rectU8(w.shore, gN, gx, gy, gS)));
  push(MOISTURE, encodeHeights(rect(w.moisture, cN, cx, cy, cS), cS, cS, FIELD_SCALE));
  push(WIND, encodeHeights(rect(w.wind, cN, cx, cy, cS), cS, cS, FIELD_SCALE));
  push(EXPOSURE, encodeHeights(rect(w.exposure, cN, cx, cy, cS), cS, cS, FIELD_SCALE));
  push(DEBRIS, encodeHeights(rect(w.debris, cN, cx, cy, cS), cS, cS, FIELD_SCALE));
  push(ROCK, encodeBytes(rectU8(w.rock, cN, cx, cy, cS)));
  const c2 = cN * cN;
  const planes = [0, 1, 2, 3, 4, 5].map((k) => encodeHeights(rect(prep.weights.subarray(k * c2, (k + 1) * c2), cN, cx, cy, cS), cS, cS, 1));
  push(REGIONS, Promise.all(planes).then(frameChunks));
  return jobs;
}

/**
 * Encodes `w` as a core and (n / regionCells)² regions. regionCells must divide n and be a multiple of 8. Grids are
 * quantised exactly as encodeWorld quantises them, so decoding gives the same values decodeWorld would.
 */
export async function encodeTiled(w: BakeWorld, opts: { regionCells: number; occlusion?: Occlusion }): Promise<TiledWorld> {
  const { regionCells, occlusion } = opts;
  const { side, gS, cS } = tileSize(w, regionCells);
  const prep: Prep = {
    residual: w.base ? baseResidual(w.base, w.ground) : undefined,
    levels: lakeLevels(w.waterLevel, w.waterKind),
    hands: handBytes(w.hand),
    weights: regionWeights(w.regions, w.cN),
  };
  const jobs = coreJobs(w, occlusion, overviewOf(w.ground, w.gN, w.n));
  const plans: { rx: number; ry: number; jobs: Job[] }[] = [];
  for (let ry = 0; ry < side; ry++) {
    for (let rx = 0; rx < side; rx++) plans.push({ rx, ry, jobs: regionJobs(w, prep, rx, ry, gS, cS) });
  }

  const [coreBodies, regionBodies] = await Promise.all([
    Promise.all(jobs.map((j) => j.run)),
    Promise.all(plans.map((p) => Promise.all(p.jobs.map((j) => j.run)))),
  ]);

  const regionSections = plans.map((p, i) => assemble(metaBytes(w, regionCells, occlusion, p), p.jobs, regionBodies[i]));
  const rdig = await chainDigest(regionSections.map((s) => writePack(s)));
  const coreSections = assemble(metaBytes(w, regionCells, occlusion), jobs, coreBodies);
  coreSections.push({ name: RDIG, bytes: rdig });
  const fp = fromHex(await sha256(writePack(coreSections)));

  const core = await finish([...coreSections, { name: FP, bytes: fp }]);
  const regions = await Promise.all(regionSections.map(async (sections, i) => {
    const sealed = await finish([...sections, { name: FP, bytes: fp }]);
    return { rx: plans[i].rx, ry: plans[i].ry, bin: sealed.bin, sections: sealed.sections };
  }));
  return { core, regions };
}

function checkRegionCells(n: number, gN: number, cN: number, regionCells: number): number {
  if (!Number.isInteger(regionCells) || regionCells < 8 || regionCells % 8 !== 0 || n % regionCells !== 0) fail("bad regionCells");
  const side = n / regionCells;
  if (gN !== side * (regionCells / 4) || cN !== side * (regionCells / 8)) fail("bad regionCells");
  return side;
}

async function decodeCoreInner(bin: Uint8Array): Promise<Core> {
  const content = await unseal(bin);
  const { rest, bytes: fp } = take(content, FP);
  if (fp.length !== 32 || toHex(fp) !== await sha256(writePack(rest))) fail("fingerprint");
  const parts = partMap(content);
  const meta = parseMeta(requirePart(parts, "meta"));
  const regionCells = meta.regionCells;
  if (typeof regionCells !== "number") fail("bad regionCells");
  const side = checkRegionCells(meta.n, meta.gN, meta.cN, regionCells);

  const fallsRaw = await loadRaw(requirePart(parts, FALLS));
  if (fallsRaw.length % 4 !== 0) fail("bad falls");
  const falls = new Float32Array(fallsRaw.length / 4);
  new Uint8Array(falls.buffer).set(fallsRaw);
  const { n } = meta;
  const rivers = riverIndex(decodeLines(await loadRaw(requirePart(parts, RIVERS))), n);
  const roads = flagged(meta, "roads") ? riverIndex(decodeLines(await loadRaw(requirePart(parts, ROADS))), n) : undefined;

  const world: BakeWorld = {
    n, gN: meta.gN, cN: meta.cN,
    ground: new Float32Array(0),
    waterLevel: new Float32Array(0),
    waterKind: new Uint8Array(0),
    hand: new Float32Array(0),
    shore: new Uint8Array(0),
    base: flagged(meta, "base") ? new Float32Array(0) : undefined,
    conform: flagged(meta, "conform") ? new Float32Array(0) : undefined,
    rivers, falls,
    moisture: new Float32Array(0),
    wind: new Float32Array(0),
    exposure: new Float32Array(0),
    debris: new Float32Array(0),
    rock: new Uint8Array(0),
    regions: new Float32Array(0),
  };
  if (flagged(meta, "stamps")) world.stamps = (await decodeValue(await loadRaw(requirePart(parts, STAMPS)))) as BakeWorld["stamps"];
  if (flagged(meta, "ponds")) world.ponds = (await decodeValue(await loadRaw(requirePart(parts, PONDS)))) as BakeWorld["ponds"];
  if (flagged(meta, "bars")) world.bars = (await decodeValue(await loadRaw(requirePart(parts, BARS)))) as BakeWorld["bars"];
  if (flagged(meta, "built")) world.built = indexBuilt((await decodeValue(await loadRaw(requirePart(parts, BUILT)))) as Built, n);
  if (roads) world.roads = roads;

  const { occlusion, block } = await loadOcclusion(parts, meta);
  const oN = n / 8;
  if (!Number.isInteger(oN)) fail("bad overview");
  const overview = await loadBytes(requirePart(parts, OVER), oN * oN);
  const core: Core = { world, regionCells, side, occlusion, block, overview };
  fingerprints.set(core, fp.slice());
  return core;
}

/** Decodes a core. Throws a decode error (as decodeWorld does) on a damaged file. */
export async function decodeCore(bin: Uint8Array): Promise<Core> {
  try {
    return await decodeCoreInner(bin);
  } catch (e) {
    throw asDecodeError(e);
  }
}

async function decodeGrids(parts: Map<string, Uint8Array>, core: Core): Promise<Omit<RegionGrids, "rx" | "ry">> {
  const gS = core.regionCells / 4;
  const cS = core.regionCells / 8;
  const g2 = gS * gS;
  const c2 = cS * cS;
  // Every section inflates on its own; start them all at once.
  const heights = (name: string, side: number) => loadHeights(requirePart(parts, name), side, side);
  const planes = readFramed(requirePart(parts, REGIONS), 6);
  const [groundQ, rq, conformQ, levelQ, waterKind, handRaw, shore, moistureQ, windQ, exposureQ, debrisQ, rock, decoded] = await Promise.all([
    heights(GROUND, gS),
    core.world.base ? heights(BASE, gS) : null,
    core.world.conform ? heights(CONFORM, gS) : null,
    heights(WLEVEL, gS),
    loadBytes(requirePart(parts, WKIND), g2),
    loadBytes(requirePart(parts, HAND), g2),
    loadBytes(requirePart(parts, SHORE), g2),
    heights(MOISTURE, cS),
    heights(WIND, cS),
    heights(EXPOSURE, cS),
    heights(DEBRIS, cS),
    loadBytes(requirePart(parts, ROCK), c2),
    Promise.all(planes.map((q) => loadHeights(q, cS, cS))),
  ]);
  const ground = fromQuantised(groundQ, H_SCALE);
  let base: Float32Array | undefined;
  if (rq) {
    base = new Float32Array(ground.length);
    for (let i = 0; i < base.length; i++) base[i] = ground[i] + rq[i] / H_SCALE;
  }
  const conform = conformQ ? fromQuantised(conformQ, H_SCALE) : undefined;
  const waterLevel = fromQuantised(levelQ, H_SCALE);
  const hand = new Float32Array(handRaw.length);
  for (let i = 0; i < hand.length; i++) hand[i] = handRaw[i];
  const moisture = fromQuantised(moistureQ, FIELD_SCALE);
  const wind = fromQuantised(windQ, FIELD_SCALE);
  const exposure = fromQuantised(exposureQ, FIELD_SCALE);
  const debris = fromQuantised(debrisQ, FIELD_SCALE);
  const regions = new Float32Array(6 * c2);
  for (let k = 0; k < 6; k++) {
    const q = decoded[k];
    const off = k * c2;
    for (let i = 0; i < c2; i++) regions[off + i] = q[i] / FIELD_SCALE;
  }
  return { ground, base, conform, waterLevel, waterKind, hand, shore, moisture, wind, exposure, debris, rock, regions };
}

async function decodeRegionInner(bin: Uint8Array, core: Core): Promise<RegionGrids> {
  const expectFp = fingerprints.get(core);
  if (!expectFp) fail("bad core");
  const content = await unseal(bin);
  const parts = partMap(content);
  const fp = parts.get(FP);
  if (!fp || !sameBytes(fp, expectFp)) fail("region from another world");
  const meta = parseMeta(requirePart(parts, "meta"));
  if (meta.n !== core.world.n || meta.gN !== core.world.gN || meta.cN !== core.world.cN || meta.regionCells !== core.regionCells) {
    fail("region from another world");
  }
  const rx = meta.rx;
  const ry = meta.ry;
  if (typeof rx !== "number" || typeof ry !== "number" || !Number.isInteger(rx) || !Number.isInteger(ry) || rx < 0 || ry < 0 || rx >= core.side || ry >= core.side) {
    fail("bad region");
  }
  return { rx, ry, ...await decodeGrids(parts, core) };
}

/** Decodes one region file for `core`. Throws a decode error on a damaged file or one from another world. */
export async function decodeRegion(bin: Uint8Array, core: Core): Promise<RegionGrids> {
  try {
    return await decodeRegionInner(bin, core);
  } catch (e) {
    throw asDecodeError(e);
  }
}

function place(i: number, n: number, rSize: number): { r: number; local: number } {
  const wrapped = wrap(i, n);
  const r = Math.floor(wrapped / rSize);
  return { r, local: wrapped - r * rSize };
}

function mark(seen: Uint8Array, side: number, n: number, win: GridWindow, rSize: number): void {
  for (let y = 0; y < win.h; y++) {
    const ry = Math.floor(wrap(win.y0 + y, n) / rSize);
    const row = ry * side;
    for (let x = 0; x < win.w; x++) seen[row + Math.floor(wrap(win.x0 + x, n) / rSize)] = 1;
  }
}

/** The regions (wrapped, each once, row-major order) that the windows g (G nodes) and c (C nodes) touch. */
export function regionsFor(core: Pick<Core, "regionCells" | "side"> & { world: Pick<BakeWorld, "gN" | "cN"> }, g: GridWindow, c: GridWindow): { rx: number; ry: number }[] {
  const { side, regionCells } = core;
  const seen = new Uint8Array(side * side);
  mark(seen, side, core.world.gN, g, regionCells / 4);
  mark(seen, side, core.world.cN, c, regionCells / 8);
  const out: { rx: number; ry: number }[] = [];
  for (let ry = 0; ry < side; ry++) for (let rx = 0; rx < side; rx++) if (seen[ry * side + rx]) out.push({ rx, ry });
  return out;
}

/**
 * The world cutWindow(whole, g, c) would give, cut from regions instead: `region(rx, ry)` returns a decoded region
 * (regionsFor lists the ones needed). Vectors and scalars are shared with core.world.
 */
export function cutFromRegions(core: Core, region: (rx: number, ry: number) => RegionGrids, g: GridWindow, c: GridWindow): BakeWorld {
  const have = new Map<number, RegionGrids>();
  const need = regionsFor(core, g, c);
  for (let i = 0; i < need.length; i++) have.set(need[i].ry * core.side + need[i].rx, region(need[i].rx, need[i].ry));
  const gS = core.regionCells / 4;
  const cS = core.regionCells / 8;
  const { gN, cN } = core.world;
  const hasBase = core.world.base !== undefined;
  const hasConform = core.world.conform !== undefined;
  const gw = g.w * g.h;
  const ground = new Float32Array(gw);
  const waterLevel = new Float32Array(gw);
  const waterKind = new Uint8Array(gw);
  const hand = new Float32Array(gw);
  const shore = new Uint8Array(gw);
  const base = hasBase ? new Float32Array(gw) : undefined;
  const conform = hasConform ? new Float32Array(gw) : undefined;
  for (let y = 0; y < g.h; y++) {
    const py = place(g.y0 + y, gN, gS);
    for (let x = 0; x < g.w; x++) {
      const px = place(g.x0 + x, gN, gS);
      const reg = have.get(py.r * core.side + px.r);
      if (!reg) throw new Error("missing region");
      const si = py.local * gS + px.local;
      const di = y * g.w + x;
      ground[di] = reg.ground[si];
      waterLevel[di] = reg.waterLevel[si];
      waterKind[di] = reg.waterKind[si];
      hand[di] = reg.hand[si];
      shore[di] = reg.shore[si];
      if (base && reg.base) base[di] = reg.base[si];
      if (conform && reg.conform) conform[di] = reg.conform[si];
    }
  }
  const cw = c.w * c.h;
  const moisture = new Float32Array(cw);
  const wind = new Float32Array(cw);
  const exposure = new Float32Array(cw);
  const debris = new Float32Array(cw);
  const rock = new Uint8Array(cw);
  const regions = new Float32Array(cw * 6);
  const plane = cS * cS;
  for (let y = 0; y < c.h; y++) {
    const py = place(c.y0 + y, cN, cS);
    for (let x = 0; x < c.w; x++) {
      const px = place(c.x0 + x, cN, cS);
      const reg = have.get(py.r * core.side + px.r);
      if (!reg) throw new Error("missing region");
      const si = py.local * cS + px.local;
      const di = y * c.w + x;
      moisture[di] = reg.moisture[si];
      wind[di] = reg.wind[si];
      exposure[di] = reg.exposure[si];
      debris[di] = reg.debris[si];
      rock[di] = reg.rock[si];
      const src = reg.regions;
      for (let p = 0; p < 6; p++) regions[p * cw + di] = src[p * plane + si];
    }
  }
  return {
    ...core.world,
    gWin: g,
    cWin: c,
    ground, waterLevel, waterKind, hand, shore, base, conform,
    moisture, wind, exposure, debris, rock, regions,
  };
}
