import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { encodePng } from "./png.ts";

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function chunks(png: Uint8Array) {
  const out: { type: string; data: Uint8Array; crc: number }[] = [];
  let o = 8;
  while (o < png.length) {
    const len = be32(png, o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    out.push({ type, data: png.subarray(o + 8, o + 8 + len), crc: be32(png, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

function decode(png: Uint8Array): { w: number; h: number; px: Uint8Array } {
  const cs = chunks(png), ihdr = cs[0].data, w = be32(ihdr, 0), h = be32(ihdr, 4);
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 0, "filter byte");
    px.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, px };
}

test("signature and IHDR", () => {
  const png = encodePng(new Uint8Array(5 * 3 * 4), 5, 3);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const cs = chunks(png);
  assert.equal(cs[0].type, "IHDR");
  assert.equal(be32(cs[0].data, 0), 5);
  assert.equal(be32(cs[0].data, 4), 3);
  assert.deepEqual([...cs[0].data.subarray(8)], [8, 6, 0, 0, 0]);
  assert.equal(cs[cs.length - 1].type, "IEND");
});

test("round-trips a 37×23 random image", () => {
  const px = new Uint8Array(37 * 23 * 4);
  let s = 7;
  for (let i = 0; i < px.length; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; px[i] = s >>> 24; }
  const d = decode(encodePng(px, 37, 23));
  assert.equal(d.w, 37);
  assert.equal(d.h, 23);
  assert.deepEqual(d.px, px);
});

test("chunk CRCs are CRC-32; IEND's is ae426082", () => {
  const png = encodePng(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
  const iend = chunks(png).at(-1)!;
  assert.equal(iend.crc, 0xae426082);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  for (const c of chunks(png)) {
    let crc = 0xffffffff;
    for (const b of [...Buffer.from(c.type, "latin1"), ...c.data]) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
    assert.equal(c.crc, (crc ^ 0xffffffff) >>> 0, c.type);
  }
});

test("rejects a buffer of the wrong length", () => {
  assert.throws(() => encodePng(new Uint8Array(10), 2, 2), RangeError);
});
