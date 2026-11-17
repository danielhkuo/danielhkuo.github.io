// Shipped geography codecs. Pure web APIs (CompressionStream, DecompressionStream,
// crypto.subtle), so the same code runs in Node and in a browser worker.

const INT16_MIN = -32768;
const INT16_MAX = 32767;

function medPredict(a: number, b: number, c: number): number {
  if (c >= Math.max(a, b)) return Math.min(a, b);
  if (c <= Math.min(a, b)) return Math.max(a, b);
  return a + b - c;
}

function predictorAt(q: ArrayLike<number>, i: number, w: number): number {
  const col = i % w;
  const row = (i / w) | 0;
  if (row === 0 && col === 0) return 0;
  if (row === 0) return q[i - 1];
  if (col === 0) return q[i - w];
  const a = q[i - 1];
  const b = q[i - w];
  const c = q[i - w - 1];
  return medPredict(a, b, c);
}

function zigzagEncode(d: number): number {
  return ((d << 1) ^ (d >> 31)) & 0xffff;
}

function zigzagDecode(z: number): number {
  return (z >>> 1) ^ -(z & 1);
}

async function deflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const buf = await new Response(
    new Blob([input]).stream().pipeThrough(new CompressionStream("deflate-raw")),
  ).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const buf = await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
  ).arrayBuffer();
  return new Uint8Array(buf);
}

/** Heights in units → int16 at `scale` steps per unit, MED-predicted, zigzagged, byte-planed, deflate-raw. */
export async function encodeHeights(h: ArrayLike<number>, w: number, rows: number, scale: number): Promise<Uint8Array> {
  const n = w * rows;
  const q = new Float64Array(n);
  const negZero = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) {
    const v = Math.round(h[i] * scale);
    if (v < INT16_MIN || v > INT16_MAX) {
      throw new RangeError(`quantised height out of int16 range at index ${i}`);
    }
    q[i] = v;
    if (Object.is(v, -0)) negZero[i >> 3] |= 1 << (i & 7);
  }

  const low = new Uint8Array(n);
  const high = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const pred = predictorAt(q, i, w);
    const d = q[i] - pred;
    const z = zigzagEncode(d);
    low[i] = z & 0xff;
    high[i] = (z >> 8) & 0xff;
  }

  const maskLen = negZero.length;
  const planed = new Uint8Array(2 * n + maskLen);
  planed.set(low, 0);
  planed.set(high, n);
  planed.set(negZero, 2 * n);
  return deflateRaw(planed);
}

/** The quantised values back (Int16Array of w × rows). Divide by scale for units. */
export async function decodeHeights(bytes: Uint8Array, w: number, rows: number): Promise<Int16Array> {
  const n = w * rows;
  const maskLen = Math.ceil(n / 8);
  const planed = await inflateRaw(bytes);
  if (planed.length !== 2 * n + maskLen) {
    throw new Error(`inflated height payload length mismatch: expected ${2 * n + maskLen}, got ${planed.length}`);
  }

  const negZero = planed.subarray(2 * n, 2 * n + maskLen);
  const q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const z = planed[i] | (planed[n + i] << 8);
    const d = zigzagDecode(z);
    const pred = predictorAt(q, i, w);
    let v = d + pred;
    if (v === 0 && (negZero[i >> 3] & (1 << (i & 7))) !== 0) v = -0;
    q[i] = v;
  }

  return q as unknown as Int16Array;
}

/** A plane of bytes, deflate-raw. */
export async function encodeBytes(a: Uint8Array): Promise<Uint8Array> {
  return deflateRaw(a);
}

export async function decodeBytes(bytes: Uint8Array, length: number): Promise<Uint8Array> {
  const out = await inflateRaw(bytes);
  if (out.length !== length) {
    throw new Error(`decoded byte length mismatch: expected ${length}, got ${out.length}`);
  }
  return out;
}

/** SHA-256 hex of a typed array's bytes, via crypto.subtle. */
export async function sha256(view: ArrayBufferView): Promise<string> {
  const slice = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", slice);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A pack: a small binary container of named sections. */
export interface PackSection {
  /** ASCII, 1–8 characters. */
  name: string;
  bytes: Uint8Array;
}

const PACK_MAGIC = new Uint8Array([68, 87, 80, 75]);
const PACK_VERSION = 1;

/**
 * Layout: magic "DWPK", u8 version (1), u8 section count, then per section:
 * u8 name length, name bytes (ASCII), u32 LE byte length, bytes.
 */
export function writePack(sections: PackSection[]): Uint8Array {
  let size = 4 + 1 + 1;
  for (const s of sections) {
    if (s.name.length < 1 || s.name.length > 8) {
      throw new Error(`section name length must be 1–8: ${s.name}`);
    }
    for (let i = 0; i < s.name.length; i++) {
      const c = s.name.charCodeAt(i);
      if (c > 0x7f) throw new Error(`section name must be ASCII: ${s.name}`);
    }
    size += 1 + s.name.length + 4 + s.bytes.length;
  }

  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(PACK_MAGIC, 0);
  out[4] = PACK_VERSION;
  out[5] = sections.length;
  let off = 6;
  for (const s of sections) {
    out[off++] = s.name.length;
    for (let i = 0; i < s.name.length; i++) {
      out[off++] = s.name.charCodeAt(i);
    }
    dv.setUint32(off, s.bytes.length, true);
    off += 4;
    out.set(s.bytes, off);
    off += s.bytes.length;
  }
  return out;
}

export function readPack(bytes: Uint8Array): PackSection[] {
  if (bytes.length < 6) throw new Error("pack truncated");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== PACK_MAGIC[i]) throw new Error("bad pack magic");
  }
  const version = bytes[4];
  if (version !== PACK_VERSION) throw new Error("unknown pack version");
  const count = bytes[5];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections: PackSection[] = [];
  let off = 6;
  for (let s = 0; s < count; s++) {
    if (off >= bytes.length) throw new Error("pack truncated");
    const nameLen = bytes[off++];
    if (nameLen < 1 || nameLen > 8) throw new Error("invalid section name length");
    if (off + nameLen + 4 > bytes.length) throw new Error("pack truncated");
    let name = "";
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(bytes[off++]);
    const dataLen = dv.getUint32(off, true);
    off += 4;
    if (off + dataLen > bytes.length) throw new Error("pack truncated");
    sections.push({ name, bytes: bytes.subarray(off, off + dataLen) });
    off += dataLen;
  }
  return sections;
}