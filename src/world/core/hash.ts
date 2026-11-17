// Integer hashes for world code. All arithmetic is exact 32-bit integer work,
// so results match bit for bit in every engine.

/** lowbias32 finaliser (Wellons): a well-mixed u32 from any u32. */
export function mix32(x: number): number {
  throw new Error("not implemented");
}

/** FNV-1a 32 over UTF-16 code units. */
export function hashString(s: string): number {
  throw new Error("not implemented");
}

/** Hash of an integer lattice point and a seed, as a u32. */
export function hash2(x: number, y: number, seed: number): number {
  throw new Error("not implemented");
}
