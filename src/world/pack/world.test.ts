import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeChunk, tileCache } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import type { BakeWorld, RiverIndex } from "../bake/world.ts";
import { buildPalette } from "../render/palette.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import { readPack, sha256 } from "./codec.ts";
import {
  decodeFlightData, decodeWorld, encodeWorld, FIELD_SCALE, H_SCALE, WorldDecodeError, XY_SCALE, type WorldSection,
} from "./world.ts";

interface Fixture { w: BakeWorld; bin: Uint8Array; sections: WorldSection[]; d: BakeWorld }
let memo: Promise<Fixture> | null = null;
function fixture(): Promise<Fixture> {
  memo ??= (async () => {
    const w = generatedWorld();
    const { bin, sections } = await encodeWorld(w);
    return { w, bin, sections, d: await decodeWorld(bin, sections) };
  })();
  return memo;
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>, only?: (i: number) => boolean): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (!only || only(i)) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

/** Equal to f32 precision, recursively: numbers as Math.fround of the original, typed arrays of the same type. */
function assertF32Equal(a: unknown, b: unknown, path: string): void {
  if (typeof a === "number") {
    assert.equal(typeof b, "number", path);
    const want = Math.fround(a);
    assert.ok(b === want || Math.abs((b as number) - want) <= 1e-6 * Math.max(1, Math.abs(want)), `${path}: ${b} against ${a}`);
    return;
  }
  if (ArrayBuffer.isView(a)) {
    assert.ok(ArrayBuffer.isView(b) && b.constructor === a.constructor, `${path}: typed array type`);
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    assert.equal(y.length, x.length, `${path}: length`);
    for (let i = 0; i < x.length; i++) assertF32Equal(x[i], y[i], `${path}[${i}]`);
    return;
  }
  if (Array.isArray(a)) {
    assert.ok(Array.isArray(b), `${path}: array`);
    assert.equal(b.length, a.length, `${path}: length`);
    a.forEach((v, i) => assertF32Equal(v, b[i], `${path}[${i}]`));
    return;
  }
  if (a !== null && typeof a === "object") {
    assert.ok(b !== null && typeof b === "object", `${path}: object`);
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
    assert.deepEqual(kb, ka, `${path}: keys`);
    for (const k of ka) assertF32Equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  assert.equal(b, a, path);
}

/** Vertex indices that begin a segment, in order: they fix where each line breaks. */
const segmentFirsts = (ix: RiverIndex): number[] => Array.from(ix.segments).sort((p, q) => p - q);

test("every field comes back with the original's size and type", async () => {
  const { w, d } = await fixture();
  assert.deepEqual([d.n, d.gN, d.cN], [w.n, w.gN, w.cN]);
  const fields = ["ground", "base", "conform", "waterLevel", "waterKind", "hand", "shore", "falls", "moisture", "wind", "exposure", "debris", "rock", "regions"] as const;
  for (const k of fields) {
    const a = w[k] as ArrayLike<number> | undefined, b = d[k] as ArrayLike<number> | undefined;
    assert.ok(a && b, k);
    assert.equal(b.constructor, a.constructor, `${k} type`);
    assert.equal(b.length, a.length, `${k} length`);
  }
  assert.equal(d.stamps?.length, w.stamps?.length);
  assert.equal(d.ponds?.length, w.ponds?.length);
  assert.equal(d.bars?.length, w.bars?.length);
  assert.ok(w.built && w.roads, "the fixture is settled");
  assert.ok(d.built && d.roads, "buildings and roads come back");
});

test("heights come back within half a step", async () => {
  const { w, d } = await fixture();
  const half = 0.5 / H_SCALE + 1e-4;
  assert.ok(maxDiff(w.ground, d.ground) <= half, `ground ${maxDiff(w.ground, d.ground)}`);
  assert.ok(maxDiff(w.base!, d.base!) <= 2 * half, `base ${maxDiff(w.base!, d.base!)}`);
  assert.ok(maxDiff(w.conform!, d.conform!) <= half, `conform ${maxDiff(w.conform!, d.conform!)}`);
  const lake = (i: number) => w.waterKind[i] === 2;
  assert.ok(maxDiff(w.waterLevel, d.waterLevel, lake) <= half, "lake levels");
});

test("fields come back within half a step, and classes exactly", async () => {
  const { w, d } = await fixture();
  for (const k of ["moisture", "wind", "exposure", "debris"] as const) {
    assert.ok(maxDiff(w[k], d[k]) <= 0.5 / FIELD_SCALE + 1e-6, `${k} ${maxDiff(w[k], d[k])}`);
  }
  for (let i = 0; i < w.hand.length; i++) assert.ok(Math.abs(d.hand[i] - Math.min(255, w.hand[i])) <= 0.5 + 1e-6, `hand at ${i}`);
  assert.deepEqual(d.waterKind, w.waterKind);
  assert.deepEqual(d.shore, w.shore);
  assert.deepEqual(d.rock, w.rock);
});

test("region weights still sum to one and stay within a step", async () => {
  const { w, d } = await fixture();
  const c2 = w.cN * w.cN;
  for (let i = 0; i < c2; i++) {
    let s = 0;
    for (let k = 0; k < 6; k++) {
      s += d.regions[k * c2 + i];
      assert.ok(Math.abs(d.regions[k * c2 + i] - w.regions[k * c2 + i]) <= 1 / FIELD_SCALE + 1e-6, `plane ${k} at ${i}`);
    }
    assert.ok(Math.abs(s - 1) <= 1e-5, `sum ${s} at ${i}`);
  }
});

test("river and road lines keep their vertices and breaks", async () => {
  const { w, d } = await fixture();
  for (const k of ["rivers", "roads"] as const) {
    const a = w[k]!, b = d[k]!;
    assert.equal(b.bN, a.bN, `${k} buckets`);
    assert.equal(b.vertices.length, a.vertices.length, `${k} vertices`);
    assert.deepEqual(segmentFirsts(b), segmentFirsts(a), `${k} line breaks`);
    const tol = 0.5 / XY_SCALE + 1e-4;
    for (let v = 0; v < a.vertices.length; v += 4) {
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(b.vertices[v + c] - a.vertices[v + c]) <= tol, `${k} vertex ${v / 4} component ${c}`);
    }
  }
});

test("falls, stamps, ponds, bars and buildings come back to f32 precision", async () => {
  const { w, d } = await fixture();
  assertF32Equal(Array.from(w.falls), Array.from(d.falls), "falls");
  assertF32Equal(w.stamps, d.stamps, "stamps");
  assertF32Equal(w.ponds, d.ponds, "ponds");
  assertF32Equal(w.bars, d.bars, "bars");
  assertF32Equal(w.built!.built, d.built!.built, "built");
  assert.equal(d.built!.n, w.built!.n);
});

test("encoding a decoded world gives the same bytes", async () => {
  const { bin, d } = await fixture();
  const again = await encodeWorld(d);
  assert.equal(await sha256(again.bin), await sha256(bin));
});

test("a decoded world bakes nearly the same chunks", async () => {
  const { w, d } = await fixture();
  const look = worldLook(w.n, buildPalette({ time: 0.5, season: 0.25, overcast: 0 }));
  const mask = loadMask();
  const ta = tileCache(w, look, mask, 24), tb = tileCache(d, look, mask, 24);
  let total = 0, count = 0;
  for (const [cx, cy] of [[0, 0], [1, 1], [2, 2], [3, 1], [4, 3], [2, 0]]) {
    const a = bakeChunk(w, look, mask, ta, cx, cy), b = bakeChunk(d, look, mask, tb, cx, cy);
    let diff = 0;
    // Material and light; depth may move by an eighth of a row.
    for (let i = 0; i < a.length; i++) if ((a[i] & 0xffff) !== (b[i] & 0xffff)) diff++;
    const share = diff / a.length;
    assert.ok(share <= 0.05, `chunk ${cx},${cy}: ${(100 * share).toFixed(2)} % of pixels differ`);
    total += share;
    count++;
  }
  assert.ok(total / count <= 0.025, `${((100 * total) / count).toFixed(2)} % of pixels differ on average`);
});

test("the section list names each stored section with its length and hash", async () => {
  const { bin, sections } = await fixture();
  const stored = readPack(bin);
  assert.deepEqual(sections.map((s) => s.name), stored.map((s) => s.name));
  assert.equal(new Set(sections.map((s) => s.name)).size, sections.length, "names are unique");
  assert.ok(sections.some((s) => s.name === "ground"), "a ground section");
  for (let k = 0; k < sections.length; k++) {
    assert.equal(sections[k].bytes, stored[k].bytes.length);
    assert.equal(sections[k].sha256, await sha256(stored[k].bytes));
  }
});

test("a damaged section is refused", async () => {
  const { bin, sections } = await fixture();
  const ground = readPack(bin).find((s) => s.name === "ground")!;
  const bad = bin.slice();
  const at = ground.bytes.byteOffset - bin.byteOffset + (ground.bytes.length >> 1);
  bad[at] ^= 0x5a;
  await assert.rejects(decodeWorld(bad, sections), WorldDecodeError);
});

test("a file that is not a world is refused", async () => {
  const { bin } = await fixture();
  const bad = bin.slice();
  bad[0] ^= 0xff;
  await assert.rejects(decodeWorld(bad), WorldDecodeError);
  await assert.rejects(decodeFlightData(bad), WorldDecodeError);
  await assert.rejects(decodeWorld(new Uint8Array(3)), WorldDecodeError);
});

test("flight data decodes alone, with the occlusion floor when there is one", async () => {
  const { w, bin, d } = await fixture();
  const bare = await decodeFlightData(bin);
  assert.deepEqual([bare.n, bare.gN], [w.n, w.gN]);
  assert.deepEqual(bare.ground, d.ground);
  assert.deepEqual([bare.occlusion.length, bare.block], [0, 0]);
  const data = new Uint8Array((w.n / 16) ** 2);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 255;
  const withFloor = await encodeWorld(w, { occlusion: { block: 16, data } });
  const fd = await decodeFlightData(withFloor.bin);
  assert.equal(fd.block, 16);
  assert.deepEqual(fd.occlusion, data);
});

test("the file fits its budget", async () => {
  const { bin } = await fixture();
  // About 0.15 MB measured with these steps for the 1280 fixture; the 6400 world is gated at 3.5 MB by the build.
  assert.ok(bin.length <= 300_000, `${bin.length} bytes`);
});
