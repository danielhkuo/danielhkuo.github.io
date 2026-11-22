import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { rngFor } from "../core/rng.ts";
import { runSchedule } from "../gen/erode.ts";
import { paramsFor } from "../gen/params.ts";
import { planWorld } from "../gen/plan.ts";
import { decodeBytes, decodeHeights, encodeBytes, encodeHeights, readPack, sha256, writePack } from "./codec.ts";

test("heights round-trip exactly at 1/16 units, including negatives and edges", async () => {
  const w = 37, rows = 23, r = rngFor(1, "codec-test"), h = new Float64Array(w * rows);
  for (let i = 0; i < h.length; i++) h[i] = Math.round(r.range(-24, 160) * 16) / 16;
  const back = await decodeHeights(await encodeHeights(h, w, rows, 16), w, rows);
  assert.equal(back.length, w * rows);
  for (let i = 0; i < h.length; i++) assert.equal(back[i], Math.round(h[i] * 16));
});

test("heights quantise to the nearest step", async () => {
  const h = [0.03, 0.04, -0.03, 1.5, 130.97];
  const back = await decodeHeights(await encodeHeights(h, 5, 1, 16), 5, 1);
  assert.deepEqual([...back], h.map((v) => Math.round(v * 16)));
});

test("eroded terrain compresses well", async () => {
  const p = paramsFor(1024), r = runSchedule(planWorld(p, 42), p, 42);
  const bytes = await encodeHeights(r.g, r.gN, r.gN, 16);
  const back = await decodeHeights(bytes, r.gN, r.gN);
  for (let i = 0; i < r.g.length; i++) assert.ok(Math.abs(back[i] / 16 - r.g[i]) <= 1 / 32 + 1e-9);
  // 256² nodes at 1/16 unit: the design measured ~0.42 MB for 1024² — expect ≲ 40 KB here.
  assert.ok(bytes.length <= 40 * 1024, `${bytes.length} bytes`);
  // and better than plain deflate of the raw int16 grid
  const raw = new Int16Array(back);
  assert.ok(bytes.length < (await encodeBytes(new Uint8Array(raw.buffer))).length);
});

test("byte planes round-trip", async () => {
  const a = new Uint8Array(5000).map((_, i) => (i * 7919) % 251);
  assert.deepEqual(await decodeBytes(await encodeBytes(a), a.length), a);
  assert.deepEqual(await decodeBytes(await encodeBytes(new Uint8Array(0)), 0), new Uint8Array(0));
});

test("sha256 matches node:crypto", async () => {
  const a = new Float32Array([1, 2.5, -3, 1e9]);
  assert.equal(await sha256(a), createHash("sha256").update(new Uint8Array(a.buffer)).digest("hex"));
  const sub = new Uint8Array([9, 8, 7, 6, 5]).subarray(1, 4);
  assert.equal(await sha256(sub), createHash("sha256").update(Buffer.from([8, 7, 6])).digest("hex"));
});

test("packs round-trip their sections in order", () => {
  const sections = [
    { name: "h", bytes: new Uint8Array([1, 2, 3]) },
    { name: "hand", bytes: new Uint8Array(0) },
    { name: "fields01", bytes: new Uint8Array(300).fill(7) },
  ];
  const bytes = writePack(sections);
  assert.deepEqual([...bytes.subarray(0, 4)], [68, 87, 80, 75]);
  assert.equal(bytes[4], 1);
  const back = readPack(bytes);
  assert.equal(back.length, 3);
  back.forEach((s, i) => { assert.equal(s.name, sections[i].name); assert.deepEqual(s.bytes, sections[i].bytes); });
});

test("readPack rejects bad magic, version or truncation", () => {
  const good = writePack([{ name: "h", bytes: new Uint8Array([1, 2, 3]) }]);
  assert.throws(() => readPack(new Uint8Array([1, 2, 3, 4, 1, 0])));
  const v2 = good.slice(); v2[4] = 2;
  assert.throws(() => readPack(v2));
  assert.throws(() => readPack(good.subarray(0, good.length - 1)));
  assert.throws(() => writePack([{ name: "toolongname", bytes: new Uint8Array(0) }]));
});
