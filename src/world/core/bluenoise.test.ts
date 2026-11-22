import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { radialPower } from "../testing/spectrum.ts";
import { ranksToU8, voidAndCluster } from "./bluenoise.ts";
import { torusDist } from "./torus.ts";

let memo: Uint16Array | null = null;
const r64 = () => (memo ??= voidAndCluster(64, 1));

test("each rank exactly once", () => {
  assert.deepEqual([...r64()].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, i) => i));
});

test("deterministic, and seeds differ", () => {
  assert.deepEqual(voidAndCluster(64, 1), r64());
  assert.notDeepEqual(voidAndCluster(64, 2), r64());
});

test("u8 histogram is flat", () => {
  const u = ranksToU8(r64()), h = new Array(256).fill(0);
  assert.equal(u.length, 4096);
  for (const v of u) h[v]++;
  assert.ok(h.every((c) => c === 16));
});

test("low frequencies suppressed", () => {
  const p = radialPower(r64(), 64);
  assert.ok(p.below125 <= 0.05 && p.below25 <= 0.2, JSON.stringify(p));
});

test("toroidal: the lowest 10 % keep 1.5 cells apart, across the seams too", () => {
  const pts: [number, number][] = [];
  r64().forEach((rank, i) => { if (rank < 410) pts.push([i % 64, Math.floor(i / 64)]); });
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    assert.ok(torusDist(pts[i][0], pts[i][1], pts[j][0], pts[j][1], 64) >= 1.5, `${pts[i]} ${pts[j]}`);
  }
});

test("committed bluenoise.bin is the 256² mask", () => {
  const path = fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url));
  assert.ok(existsSync(path), "public/world/bluenoise.bin missing");
  const bytes = new Uint8Array(readFileSync(path));
  assert.equal(bytes.length, 65536);
  const h = new Array(256).fill(0);
  for (const v of bytes) h[v]++;
  assert.ok(h.every((c) => c === 256));
  const p = radialPower(bytes, 256);
  assert.ok(p.below125 <= 0.05 && p.below25 <= 0.2, JSON.stringify(p));
});
