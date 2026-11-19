// The shipped world: one file of compressed sections that decodes back into the
// BakeWorld the browser bakes from. Built on the owner's machine, committed under
// public/world/<worldId>/, read by the bake workers.

import { riverIndex } from "../bake/world.ts";
import type { BakeWorld, RiverIndex, RiverLine } from "../bake/world.ts";
import { indexBuilt } from "../gen/built.ts";
import type { Built } from "../gen/built.ts";
import { decodeBytes, decodeHeights, encodeBytes, encodeHeights, readPack, sha256, writePack } from "./codec.ts";
import type { PackSection } from "./codec.ts";

export const WORLD_FORMAT = 1;
/** Height steps per unit: ground, base, conform and lake levels are stored to 1/16 of a unit. */
export const H_SCALE = 16;
/** Steps over [0, 1] for the C fields (moisture, wind, exposure, debris) and the region weights. */
export const FIELD_SCALE = 63;
/** Steps over [0, 1] for sea-level temperature: finer than the other fields, since the cover reads height off it (half a unit a step). */
export const TEMP_SCALE = 500;
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Section order in the file. Names are ASCII and at most 8 characters. */
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
const TEMP = "temp";
const RIVERS = "rivers";
const ROADS = "roads";
const STAMPS = "stamps";
const PONDS = "ponds";
const BARS = "bars";
const BUILT = "built";
const OCCL = "occl";

export interface Meta {
  format: number;
  n: number;
  gN: number;
  cN: number;
  /** Set on a tiled core or region file: cells a side of one region. */
  regionCells?: number;
  /** Set on a region file. */
  rx?: number;
  ry?: number;
  base?: boolean;
  conform?: boolean;
  stamps?: boolean;
  ponds?: boolean;
  bars?: boolean;
  built?: boolean;
  roads?: boolean;
  /** The world has climates: a temp plane on C. Absent: one temperate climate. */
  temp?: boolean;
  /** Occlusion cell size. Absent when the file has no occlusion section. */
  block?: number;
}

interface TypedSpec {
  bytes: number;
  make: (n: number) => ArrayBufferView;
}

const TYPED: Record<string, TypedSpec> = {
  Float32Array: { bytes: 4, make: (n) => new Float32Array(n) },
  Float64Array: { bytes: 8, make: (n) => new Float64Array(n) },
  Uint8Array: { bytes: 1, make: (n) => new Uint8Array(n) },
  Uint8ClampedArray: { bytes: 1, make: (n) => new Uint8ClampedArray(n) },
  Uint16Array: { bytes: 2, make: (n) => new Uint16Array(n) },
  Uint32Array: { bytes: 4, make: (n) => new Uint32Array(n) },
  Int8Array: { bytes: 1, make: (n) => new Int8Array(n) },
  Int16Array: { bytes: 2, make: (n) => new Int16Array(n) },
  Int32Array: { bytes: 4, make: (n) => new Int32Array(n) },
};

export function fail(message: string): never {
  throw new WorldDecodeError(message);
}

export function asDecodeError(e: unknown): WorldDecodeError {
  if (e instanceof WorldDecodeError) return e;
  return new WorldDecodeError(e instanceof Error ? e.message : "world decode failed");
}

function partMap(sections: PackSection[]): Map<string, Uint8Array> {
  const parts = new Map<string, Uint8Array>();
  for (let i = 0; i < sections.length; i++) parts.set(sections[i].name, sections[i].bytes);
  return parts;
}

export function requirePart(parts: Map<string, Uint8Array>, name: string): Uint8Array {
  const bytes = parts.get(name);
  if (!bytes) fail(`missing section ${name}`);
  return bytes;
}

export function parseMeta(bytes: Uint8Array): Meta {
  let meta: Meta;
  try {
    meta = JSON.parse(textDecoder.decode(bytes)) as Meta;
  } catch {
    fail("bad meta");
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || meta.format !== WORLD_FORMAT) fail("bad format");
  if (!Number.isInteger(meta.n) || !Number.isInteger(meta.gN) || !Number.isInteger(meta.cN)) fail("bad meta");
  if (meta.n <= 0 || meta.gN <= 0 || meta.cN <= 0) fail("bad meta");
  return meta;
}

function openPack(bin: Uint8Array): { parts: Map<string, Uint8Array>; meta: Meta } {
  let sections: PackSection[];
  try {
    sections = readPack(bin);
  } catch (e) {
    throw asDecodeError(e);
  }
  const parts = partMap(sections);
  const metaBytes = parts.get("meta");
  if (!metaBytes) fail("missing section meta");
  return { parts, meta: parseMeta(metaBytes) };
}

/** Checks that every listed section is in the file with its length and hash; throws WorldDecodeError if not. */
export async function verifyWorld(bin: Uint8Array, verify: readonly WorldSection[]): Promise<void> {
  let sections: PackSection[];
  try {
    sections = readPack(bin);
  } catch (e) {
    throw asDecodeError(e);
  }
  const parts = partMap(sections);
  for (let i = 0; i < verify.length; i++) {
    const want = verify[i];
    const got = parts.get(want.name);
    if (!got) fail(`missing section ${want.name}`);
    if (got.length !== want.bytes) fail(`section ${want.name} length`);
    const hash = await sha256(got);
    if (hash !== want.sha256) fail(`section ${want.name} hash`);
  }
}

export async function loadHeights(bytes: Uint8Array, w: number, h: number): Promise<ArrayLike<number>> {
  try {
    return await decodeHeights(bytes, w, h);
  } catch (e) {
    throw asDecodeError(e);
  }
}

export async function loadBytes(bytes: Uint8Array, length: number): Promise<Uint8Array> {
  try {
    return await decodeBytes(bytes, length);
  } catch (e) {
    throw asDecodeError(e);
  }
}

/** Uncompressed length, then deflate-raw. Variable sections have no size in the grid. */
export async function storeRaw(raw: Uint8Array): Promise<Uint8Array> {
  const z = await encodeBytes(raw);
  const out = new Uint8Array(4 + z.length);
  new DataView(out.buffer).setUint32(0, raw.length, true);
  out.set(z, 4);
  return out;
}

export async function loadRaw(stored: Uint8Array): Promise<Uint8Array> {
  if (stored.length < 4) fail("truncated section");
  const len = new DataView(stored.buffer, stored.byteOffset, stored.byteLength).getUint32(0, true);
  return loadBytes(stored.subarray(4), len);
}

export function quantised(h: ArrayLike<number>, scale: number): Float32Array {
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) out[i] = Math.round(h[i] * scale) / scale;
  return out;
}

export function fromQuantised(q: ArrayLike<number>, scale: number): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / scale;
  return out;
}

/**
 * Base minus the quantised ground. A residual that quantises to -0 is stored as +0: subtracting the quantised ground
 * again cannot bring the sign back, so base = groundQ + residualQ would not round-trip -0.
 */
export function baseResidual(base: ArrayLike<number>, ground: ArrayLike<number>): Float32Array {
  const groundQ = quantised(ground, H_SCALE);
  const residual = new Float32Array(base.length);
  for (let i = 0; i < residual.length; i++) {
    const r = base[i] - groundQ[i];
    residual[i] = Object.is(Math.round(r * H_SCALE), -0) ? 0 : r;
  }
  return residual;
}

/** Lake nodes keep their level; every other node is stored as zero. */
export function lakeLevels(level: ArrayLike<number>, kind: ArrayLike<number>): Float32Array {
  const out = new Float32Array(level.length);
  for (let i = 0; i < level.length; i++) if (kind[i] === 2) out[i] = level[i];
  return out;
}

export function handBytes(hand: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(hand.length);
  for (let i = 0; i < hand.length; i++) {
    const r = Math.round(hand[i]);
    out[i] = r <= 0 ? 0 : r >= 255 ? 255 : r;
  }
  return out;
}

export function bytesOf(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Integer weights summing to FIELD_SCALE, by largest remainder.
 * Ties keep the lower plane index. Already-exact integers (k / FIELD_SCALE) come back unchanged.
 */
export function regionWeights(src: ArrayLike<number>, cN: number): Float32Array {
  const c2 = cN * cN;
  const out = new Float32Array(6 * c2);
  const fl = new Int32Array(6);
  const rm = new Float64Array(6);
  for (let i = 0; i < c2; i++) {
    let sum = 0;
    for (let k = 0; k < 6; k++) {
      const raw = src[k * c2 + i] * FIELD_SCALE;
      const f = Math.floor(raw);
      fl[k] = f;
      rm[k] = raw - f;
      sum += f;
    }
    let need = FIELD_SCALE - sum;
    while (need > 0) {
      let best = 0;
      for (let k = 1; k < 6; k++) if (rm[k] > rm[best]) best = k;
      fl[best]++;
      rm[best] -= 1;
      need--;
    }
    while (need < 0) {
      let best = 0;
      for (let k = 1; k < 6; k++) if (rm[k] < rm[best]) best = k;
      fl[best]--;
      rm[best] += 1;
      need++;
    }
    for (let k = 0; k < 6; k++) out[k * c2 + i] = fl[k];
  }
  return out;
}

export function frameChunks(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (let i = 0; i < chunks.length; i++) n += 4 + chunks[i].length;
  const out = new Uint8Array(n);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < chunks.length; i++) {
    dv.setUint32(o, chunks[i].length, true);
    o += 4;
    out.set(chunks[i], o);
    o += chunks[i].length;
  }
  return out;
}

export function readFramed(bytes: Uint8Array, count: number): Uint8Array[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Uint8Array[] = [];
  let o = 0;
  for (let i = 0; i < count; i++) {
    if (o + 4 > bytes.length) fail("truncated section");
    const n = dv.getUint32(o, true);
    o += 4;
    if (o + n > bytes.length) fail("truncated section");
    out.push(bytes.subarray(o, o + n));
    o += n;
  }
  if (o !== bytes.length) fail("trailing section bytes");
  return out;
}

function zigzag32(d: number): number {
  return ((d << 1) ^ (d >> 31)) >>> 0;
}

function unzigzag32(z: number): number {
  return (z >>> 1) ^ -(z & 1);
}

/**
 * Lines recovered from the index. A vertex starts a line when it is the first
 * or the vertex before it does not begin a segment. Counts, then zigzag-delta
 * int32 x, y and width across the whole vertex array.
 */
export function encodeRiverBytes(ix: RiverIndex): Uint8Array {
  const nv = (ix.vertices.length / 4) | 0;
  const mark = new Uint8Array(nv);
  for (let i = 0; i < ix.segments.length; i++) {
    const s = ix.segments[i];
    if (s < nv) mark[s] = 1;
  }
  const counts: number[] = [];
  const x = new Int32Array(nv);
  const y = new Int32Array(nv);
  const w = new Int32Array(nv);
  let count = 0;
  for (let k = 0; k < nv; k++) {
    if (k === 0 || mark[k - 1] === 0) {
      if (k !== 0) counts.push(count);
      count = 0;
    }
    count++;
    x[k] = Math.round(ix.vertices[k * 4] * XY_SCALE);
    y[k] = Math.round(ix.vertices[k * 4 + 1] * XY_SCALE);
    w[k] = Math.round(ix.vertices[k * 4 + 2] * XY_SCALE);
  }
  if (nv > 0) counts.push(count);

  const body = nv * 4;
  const out = new Uint8Array(4 + counts.length * 4 + body * 3);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, counts.length, true);
  for (let i = 0; i < counts.length; i++) dv.setUint32(4 + i * 4, counts[i], true);
  writeDeltas(dv, 4 + counts.length * 4, x);
  writeDeltas(dv, 4 + counts.length * 4 + body, y);
  writeDeltas(dv, 4 + counts.length * 4 + body * 2, w);
  return out;
}

function writeDeltas(dv: DataView, offset: number, vals: Int32Array): void {
  let prev = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    dv.setUint32(offset + i * 4, zigzag32(v - prev), true);
    prev = v;
  }
}

function readDeltas(dv: DataView, offset: number, n: number): Int32Array {
  const out = new Int32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev += unzigzag32(dv.getUint32(offset + i * 4, true));
    out[i] = prev;
  }
  return out;
}

export function decodeLines(raw: Uint8Array): RiverLine[] {
  if (raw.length < 4) fail("bad lines");
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const lineCount = dv.getUint32(0, true);
  const head = 4 + lineCount * 4;
  if (lineCount > 0x1000000 || head > raw.length) fail("bad lines");
  let total = 0;
  const counts = new Uint32Array(lineCount);
  for (let i = 0; i < lineCount; i++) {
    const c = dv.getUint32(4 + i * 4, true);
    if (c === 0) fail("bad lines");
    counts[i] = c;
    total += c;
  }
  if (total > 0x1000000 || raw.length !== head + total * 12) fail("bad lines");
  const x = readDeltas(dv, head, total);
  const y = readDeltas(dv, head + total * 4, total);
  const w = readDeltas(dv, head + total * 8, total);
  const all = new Float32Array(total * 3);
  for (let i = 0; i < total; i++) {
    all[i * 3] = x[i] / XY_SCALE;
    all[i * 3 + 1] = y[i] / XY_SCALE;
    all[i * 3 + 2] = w[i] / XY_SCALE;
  }
  const lines: RiverLine[] = [];
  let off = 0;
  for (let i = 0; i < lineCount; i++) {
    const n = counts[i] * 3;
    lines.push({ vertices: all.subarray(off, off + n), stride: 3 });
    off += n;
  }
  return lines;
}

function planeF32(vals: ArrayLike<number>): Uint8Array {
  const n = vals.length;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = vals[i];
  const src = new Uint8Array(f.buffer);
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    out[i] = src[p];
    out[n + i] = src[p + 1];
    out[2 * n + i] = src[p + 2];
    out[3 * n + i] = src[p + 3];
  }
  return out;
}

function unplaneF32(src: Uint8Array, n: number): Float32Array {
  const b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    b[i * 4] = src[i];
    b[i * 4 + 1] = src[n + i];
    b[i * 4 + 2] = src[2 * n + i];
    b[i * 4 + 3] = src[3 * n + i];
  }
  return new Float32Array(b.buffer);
}

interface NumCol {
  values: number[];
}
interface TypCol {
  ctor: string;
  parts: Uint8Array[];
}

/**
 * JSON shape with numbers replaced by 0 and typed arrays by `{ $t, n }`,
 * plus one byte-planed f32 column per number path and one concatenated buffer per typed-array path.
 * Array indices are dropped from the path, so every stamp's `x` shares a column.
 */
export function encodeValue(value: unknown): Uint8Array {
  const numOrder: string[] = [];
  const nums = new Map<string, NumCol>();
  const typOrder: string[] = [];
  const typs = new Map<string, TypCol>();

  const takeNum = (path: string, v: number): void => {
    let col = nums.get(path);
    if (!col) {
      col = { values: [] };
      nums.set(path, col);
      numOrder.push(path);
    }
    col.values.push(v);
  };
  const takeTyped = (path: string, view: ArrayBufferView): void => {
    const ctor = view.constructor.name;
    if (!TYPED[ctor]) throw new Error(`unsupported typed array ${ctor}`);
    let col = typs.get(path);
    if (!col) {
      col = { ctor, parts: [] };
      typs.set(path, col);
      typOrder.push(path);
    } else if (col.ctor !== ctor) {
      throw new Error(`mixed typed arrays at ${path}`);
    }
    col.parts.push(bytesOf(view).slice());
  };

  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "number") {
      takeNum(path, v);
      return 0;
    }
    if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
    if (ArrayBuffer.isView(v)) {
      takeTyped(path, v);
      return { $t: v.constructor.name, n: (v as unknown as { length: number }).length };
    }
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i] === undefined ? null : walk(v[i], path);
      return out;
    }
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (obj[k] === undefined) continue;
        out[k] = walk(obj[k], path.length === 0 ? k : path + "." + k);
      }
      return out;
    }
    throw new Error("unsupported value");
  };

  const shape = walk(value, "");
  const json = textEncoder.encode(JSON.stringify(shape));
  const planed: Uint8Array[] = [];
  for (let i = 0; i < numOrder.length; i++) planed.push(planeF32(nums.get(numOrder[i])!.values));
  const typed: Uint8Array[] = [];
  for (let i = 0; i < typOrder.length; i++) {
    const parts = typs.get(typOrder[i])!.parts;
    let n = 0;
    for (let p = 0; p < parts.length; p++) n += parts[p].length;
    const buf = new Uint8Array(n);
    let o = 0;
    for (let p = 0; p < parts.length; p++) {
      buf.set(parts[p], o);
      o += parts[p].length;
    }
    typed.push(buf);
  }

  let size = 4 + json.length;
  for (let i = 0; i < planed.length; i++) size += planed[i].length;
  for (let i = 0; i < typed.length; i++) size += typed[i].length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, json.length, true);
  out.set(json, 4);
  let o = 4 + json.length;
  for (let i = 0; i < planed.length; i++) {
    out.set(planed[i], o);
    o += planed[i].length;
  }
  for (let i = 0; i < typed.length; i++) {
    out.set(typed[i], o);
    o += typed[i].length;
  }
  return out;
}

function isMarker(node: unknown): node is { $t: string; n: number } {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
  const o = node as Record<string, unknown>;
  return typeof o.$t === "string" && typeof o.n === "number";
}

export function decodeValue(raw: Uint8Array): unknown {
  if (raw.length < 4) fail("bad value");
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const jsonLen = dv.getUint32(0, true);
  if (4 + jsonLen > raw.length) fail("bad value");
  let shape: unknown;
  try {
    shape = JSON.parse(textDecoder.decode(raw.subarray(4, 4 + jsonLen)));
  } catch {
    fail("bad value");
  }

  const numOrder: string[] = [];
  const numCount = new Map<string, number>();
  const typOrder: string[] = [];
  const typInfo = new Map<string, { ctor: string; bytes: number }>();

  const scan = (node: unknown, path: string): void => {
    if (typeof node === "number") {
      const c = numCount.get(path);
      if (c === undefined) {
        numCount.set(path, 1);
        numOrder.push(path);
      } else numCount.set(path, c + 1);
      return;
    }
    if (typeof node === "string" || typeof node === "boolean" || node === null) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) scan(node[i], path);
      return;
    }
    if (isMarker(node)) {
      const spec = TYPED[node.$t];
      if (!spec || !Number.isInteger(node.n) || node.n < 0) fail("bad typed array");
      const add = node.n * spec.bytes;
      const prev = typInfo.get(path);
      if (!prev) {
        typInfo.set(path, { ctor: node.$t, bytes: add });
        typOrder.push(path);
      } else if (prev.ctor !== node.$t) {
        fail("mixed typed array");
      } else prev.bytes += add;
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        scan(obj[k], path.length === 0 ? k : path + "." + k);
      }
    }
  };
  scan(shape, "");

  let o = 4 + jsonLen;
  const numCols = new Map<string, { values: Float32Array; i: number }>();
  for (let i = 0; i < numOrder.length; i++) {
    const key = numOrder[i];
    const n = numCount.get(key)!;
    const nbytes = n * 4;
    if (o + nbytes > raw.length) fail("bad value");
    numCols.set(key, { values: unplaneF32(raw.subarray(o, o + nbytes), n), i: 0 });
    o += nbytes;
  }
  const typCols = new Map<string, { bytes: Uint8Array; o: number }>();
  for (let i = 0; i < typOrder.length; i++) {
    const key = typOrder[i];
    const info = typInfo.get(key)!;
    if (o + info.bytes > raw.length) fail("bad value");
    typCols.set(key, { bytes: raw.subarray(o, o + info.bytes), o: 0 });
    o += info.bytes;
  }
  if (o !== raw.length) fail("bad value");

  const rebuild = (node: unknown, path: string): unknown => {
    if (typeof node === "number") {
      const col = numCols.get(path);
      if (!col) fail("bad value");
      return col.values[col.i++];
    }
    if (typeof node === "string" || typeof node === "boolean" || node === null) return node;
    if (Array.isArray(node)) {
      const out = new Array(node.length);
      for (let i = 0; i < node.length; i++) out[i] = rebuild(node[i], path);
      return out;
    }
    if (isMarker(node)) {
      const spec = TYPED[node.$t];
      const col = typCols.get(path);
      if (!spec || !col) fail("bad typed array");
      const need = node.n * spec.bytes;
      const made = spec.make(node.n);
      new Uint8Array(made.buffer, made.byteOffset, need).set(col.bytes.subarray(col.o, col.o + need));
      col.o += need;
      return made;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        out[k] = rebuild(obj[k], path.length === 0 ? k : path + "." + k);
      }
      return out;
    }
    fail("bad value");
  };
  return rebuild(shape, "");
}

function buildMeta(w: BakeWorld, occlusion?: Occlusion): Uint8Array {
  const meta: Meta = { format: WORLD_FORMAT, n: w.n, gN: w.gN, cN: w.cN };
  if (w.base) meta.base = true;
  if (w.conform) meta.conform = true;
  if (w.stamps) meta.stamps = true;
  if (w.ponds) meta.ponds = true;
  if (w.bars) meta.bars = true;
  if (w.built) meta.built = true;
  if (w.roads) meta.roads = true;
  if (w.temp) meta.temp = true;
  if (occlusion) meta.block = occlusion.block;
  return textEncoder.encode(JSON.stringify(meta));
}

export function flagged(meta: Meta, key: "base" | "conform" | "stamps" | "ponds" | "bars" | "built" | "roads" | "temp"): boolean {
  return meta[key] === true;
}

async function loadGround(parts: Map<string, Uint8Array>, gN: number): Promise<Float32Array> {
  return fromQuantised(await loadHeights(requirePart(parts, GROUND), gN, gN), H_SCALE);
}

export async function loadOcclusion(parts: Map<string, Uint8Array>, meta: Meta): Promise<{ occlusion: Uint8Array; block: number }> {
  const block = meta.block;
  if (typeof block !== "number") {
    if (parts.has(OCCL)) fail("missing block");
    return { occlusion: new Uint8Array(0), block: 0 };
  }
  if (!Number.isInteger(block) || block <= 0) fail("bad block");
  const side = meta.n / block;
  if (!Number.isInteger(side) || side <= 0) fail("bad block");
  return { occlusion: await loadBytes(requirePart(parts, OCCL), side * side), block };
}

export async function encodeWorld(w: BakeWorld, extra?: { occlusion?: Occlusion }): Promise<{ bin: Uint8Array; sections: WorldSection[] }> {
  const { gN, cN } = w;
  const c2 = cN * cN;
  const jobs: { name: string; run: Promise<Uint8Array> }[] = [];
  const push = (name: string, run: Promise<Uint8Array>): void => {
    jobs.push({ name, run });
  };

  push(GROUND, encodeHeights(w.ground, gN, gN, H_SCALE));
  if (w.base) push(BASE, encodeHeights(baseResidual(w.base, w.ground), gN, gN, H_SCALE));
  if (w.conform) push(CONFORM, encodeHeights(w.conform, gN, gN, H_SCALE));
  push(WLEVEL, encodeHeights(lakeLevels(w.waterLevel, w.waterKind), gN, gN, H_SCALE));
  push(WKIND, encodeBytes(w.waterKind));
  push(HAND, encodeBytes(handBytes(w.hand)));
  push(SHORE, encodeBytes(w.shore));
  push(FALLS, storeRaw(bytesOf(w.falls).slice()));
  push(MOISTURE, encodeHeights(w.moisture, cN, cN, FIELD_SCALE));
  push(WIND, encodeHeights(w.wind, cN, cN, FIELD_SCALE));
  push(EXPOSURE, encodeHeights(w.exposure, cN, cN, FIELD_SCALE));
  push(DEBRIS, encodeHeights(w.debris, cN, cN, FIELD_SCALE));
  push(ROCK, encodeBytes(w.rock));
  if (w.temp) push(TEMP, encodeHeights(w.temp, cN, cN, TEMP_SCALE));

  const weights = regionWeights(w.regions, cN);
  push(REGIONS, Promise.all([0, 1, 2, 3, 4, 5].map((k) => encodeHeights(weights.subarray(k * c2, (k + 1) * c2), cN, cN, 1))).then(frameChunks));

  push(RIVERS, storeRaw(encodeRiverBytes(w.rivers)));
  if (w.roads) push(ROADS, storeRaw(encodeRiverBytes(w.roads)));
  if (w.stamps) push(STAMPS, storeRaw(encodeValue(w.stamps)));
  if (w.ponds) push(PONDS, storeRaw(encodeValue(w.ponds)));
  if (w.bars) push(BARS, storeRaw(encodeValue(w.bars)));
  if (w.built) push(BUILT, storeRaw(encodeValue(w.built.built)));
  if (extra?.occlusion) push(OCCL, encodeBytes(extra.occlusion.data));

  const bodies = await Promise.all(jobs.map((j) => j.run));
  const sections: PackSection[] = [{ name: "meta", bytes: buildMeta(w, extra?.occlusion) }];
  for (let i = 0; i < jobs.length; i++) sections.push({ name: jobs[i].name, bytes: bodies[i] });
  const bin = writePack(sections);
  const listed: WorldSection[] = [];
  for (let i = 0; i < sections.length; i++) {
    listed.push({ name: sections[i].name, bytes: sections[i].bytes.length, sha256: await sha256(sections[i].bytes) });
  }
  return { bin, sections: listed };
}

async function decodeWorldInner(bin: Uint8Array, verify?: readonly WorldSection[]): Promise<BakeWorld> {
  if (verify) await verifyWorld(bin, verify);
  const { parts, meta } = openPack(bin);
  const { n, gN, cN } = meta;
  const c2 = cN * cN;

  const ground = await loadGround(parts, gN);
  let base: Float32Array | undefined;
  if (flagged(meta, "base")) {
    const rq = await loadHeights(requirePart(parts, BASE), gN, gN);
    base = new Float32Array(ground.length);
    for (let i = 0; i < base.length; i++) base[i] = ground[i] + rq[i] / H_SCALE;
  }
  const conform = flagged(meta, "conform") ? fromQuantised(await loadHeights(requirePart(parts, CONFORM), gN, gN), H_SCALE) : undefined;
  const waterLevel = fromQuantised(await loadHeights(requirePart(parts, WLEVEL), gN, gN), H_SCALE);
  const waterKind = await loadBytes(requirePart(parts, WKIND), gN * gN);
  const handBytesOut = await loadBytes(requirePart(parts, HAND), gN * gN);
  const hand = new Float32Array(handBytesOut.length);
  for (let i = 0; i < hand.length; i++) hand[i] = handBytesOut[i];
  const shore = await loadBytes(requirePart(parts, SHORE), gN * gN);

  const fallsRaw = await loadRaw(requirePart(parts, FALLS));
  if (fallsRaw.length % 4 !== 0) fail("bad falls");
  const falls = new Float32Array(fallsRaw.length / 4);
  new Uint8Array(falls.buffer).set(fallsRaw);

  const moisture = fromQuantised(await loadHeights(requirePart(parts, MOISTURE), cN, cN), FIELD_SCALE);
  const wind = fromQuantised(await loadHeights(requirePart(parts, WIND), cN, cN), FIELD_SCALE);
  const exposure = fromQuantised(await loadHeights(requirePart(parts, EXPOSURE), cN, cN), FIELD_SCALE);
  const debris = fromQuantised(await loadHeights(requirePart(parts, DEBRIS), cN, cN), FIELD_SCALE);
  const rock = await loadBytes(requirePart(parts, ROCK), c2);

  const planes = readFramed(requirePart(parts, REGIONS), 6);
  const decodedPlanes = await Promise.all(planes.map((p) => loadHeights(p, cN, cN)));
  const regions = new Float32Array(6 * c2);
  for (let k = 0; k < 6; k++) {
    const q = decodedPlanes[k];
    const off = k * c2;
    for (let i = 0; i < c2; i++) regions[off + i] = q[i] / FIELD_SCALE;
  }

  const rivers = riverIndex(decodeLines(await loadRaw(requirePart(parts, RIVERS))), n);
  const roads = flagged(meta, "roads") ? riverIndex(decodeLines(await loadRaw(requirePart(parts, ROADS))), n) : undefined;

  const world: BakeWorld = {
    n, gN, cN, ground, waterLevel, waterKind, hand, shore, rivers, falls, moisture, wind, exposure, debris, rock, regions,
  };
  if (base) world.base = base;
  if (conform) world.conform = conform;
  if (flagged(meta, "stamps")) world.stamps = (await decodeValue(await loadRaw(requirePart(parts, STAMPS)))) as BakeWorld["stamps"];
  if (flagged(meta, "ponds")) world.ponds = (await decodeValue(await loadRaw(requirePart(parts, PONDS)))) as BakeWorld["ponds"];
  if (flagged(meta, "bars")) world.bars = (await decodeValue(await loadRaw(requirePart(parts, BARS)))) as BakeWorld["bars"];
  if (flagged(meta, "built")) world.built = indexBuilt((await decodeValue(await loadRaw(requirePart(parts, BUILT)))) as Built, n);
  if (roads) world.roads = roads;
  if (flagged(meta, "temp")) world.temp = fromQuantised(await loadHeights(requirePart(parts, TEMP), cN, cN), TEMP_SCALE);
  // The occlusion floor is for the flier on the main thread (decodeFlightData); the bake does not read it.
  return world;
}

export async function decodeWorld(bin: Uint8Array, verify?: readonly WorldSection[]): Promise<BakeWorld> {
  try {
    return await decodeWorldInner(bin, verify);
  } catch (e) {
    throw asDecodeError(e);
  }
}

export async function decodeFlightData(bin: Uint8Array): Promise<FlightData> {
  try {
    const { parts, meta } = openPack(bin);
    const ground = await loadGround(parts, meta.gN);
    const { occlusion, block } = await loadOcclusion(parts, meta);
    return { n: meta.n, gN: meta.gN, ground, occlusion, block };
  } catch (e) {
    throw asDecodeError(e);
  }
}
