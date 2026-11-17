// Shipped geography codecs. Pure web APIs (CompressionStream, DecompressionStream,
// crypto.subtle), so the same code runs in Node and in a browser worker.

/** Heights in units → int16 at `scale` steps per unit, MED-predicted, zigzagged, byte-planed, deflate-raw. */
export async function encodeHeights(h: ArrayLike<number>, w: number, rows: number, scale: number): Promise<Uint8Array> {
  throw new Error("not implemented");
}

/** The quantised values back (Int16Array of w × rows). Divide by scale for units. */
export async function decodeHeights(bytes: Uint8Array, w: number, rows: number): Promise<Int16Array> {
  throw new Error("not implemented");
}

/** A plane of bytes, deflate-raw. */
export async function encodeBytes(a: Uint8Array): Promise<Uint8Array> {
  throw new Error("not implemented");
}

export async function decodeBytes(bytes: Uint8Array, length: number): Promise<Uint8Array> {
  throw new Error("not implemented");
}

/** SHA-256 hex of a typed array's bytes, via crypto.subtle. */
export async function sha256(view: ArrayBufferView): Promise<string> {
  throw new Error("not implemented");
}

/** A pack: a small binary container of named sections. */
export interface PackSection {
  /** ASCII, 1–8 characters. */
  name: string;
  bytes: Uint8Array;
}

/**
 * Layout: magic "DWPK", u8 version (1), u8 section count, then per section:
 * u8 name length, name bytes (ASCII), u32 LE byte length, bytes.
 */
export function writePack(sections: PackSection[]): Uint8Array {
  throw new Error("not implemented");
}

export function readPack(bytes: Uint8Array): PackSection[] {
  throw new Error("not implemented");
}
