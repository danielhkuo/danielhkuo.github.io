// Minimal PNG writer: 8-bit RGBA, filter 0 on every row, one IDAT.

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(type: string, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < type.length; i++) {
    const b = type.charCodeAt(i);
    crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 255;
  buf[offset + 1] = (value >>> 16) & 255;
  buf[offset + 2] = (value >>> 8) & 255;
  buf[offset + 3] = value & 255;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeU32BE(out, 0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  writeU32BE(out, 8 + data.length, crc32(type, data));
  return out;
}

function ihdr(w: number, h: number): Uint8Array {
  const data = new Uint8Array(13);
  writeU32BE(data, 0, w);
  writeU32BE(data, 4, h);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function rawScanlines(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const rowBytes = w * 4 + 1;
  const raw = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), rowStart + 1);
  }
  return raw;
}

export function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    rgba.length !== w * h * 4
  ) {
    throw new RangeError("invalid rgba dimensions");
  }

  const deflated = deflateSync(Buffer.from(rawScanlines(rgba, w, h)));
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr(w, h)),
    chunk("IDAT", new Uint8Array(deflated)),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}