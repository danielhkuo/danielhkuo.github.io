import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav, toBase64 } from "./wav.ts";

test("wav writes a correct 32-bit float header and interleaves the channels", () => {
  const l = Float32Array.from([0, 0.5, -0.5]), r = Float32Array.from([1, -1, 0.25]);
  const w = encodeWav([l, r], 48000);
  const v = new DataView(w.buffer);
  const tag = (at: number) => String.fromCharCode(...w.subarray(at, at + 4));
  assert.equal(w.length, 44 + 3 * 2 * 4);
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ["RIFF", "WAVE", "fmt ", "data"]);
  assert.equal(v.getUint32(4, true), w.length - 8);
  assert.equal(v.getUint16(20, true), 3, "IEEE float");
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 8);
  assert.equal(v.getUint16(32, true), 8);
  assert.equal(v.getUint16(34, true), 32);
  assert.equal(v.getUint32(40, true), 24);
  const samples = Array.from({ length: 6 }, (_, i) => v.getFloat32(44 + 4 * i, true));
  assert.deepEqual(samples, [0, 1, 0.5, -1, -0.5, 0.25]);
});

test("base64 round-trips past one chunk", () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 255);
  const back = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
  assert.deepEqual(back, bytes);
});
