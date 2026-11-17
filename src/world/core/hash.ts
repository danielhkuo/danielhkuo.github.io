// Integer hashes for world code. All arithmetic is exact 32-bit integer work,
// so results match bit for bit in every engine.

/** lowbias32 finaliser (Wellons): a well-mixed u32 from any u32. */
export function mix32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x;
}

/** FNV-1a 32 over UTF-16 code units. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h ^= c;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash of an integer lattice point and a seed, as a u32. */
export function hash2(x: number, y: number, seed: number): number {
  return mix32(
    (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ mix32(seed >>> 0)) >>> 0,
  );
}