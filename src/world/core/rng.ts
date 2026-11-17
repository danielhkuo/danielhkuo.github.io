// Seeded random numbers for world code: sfc32, one stream per stage.

export interface Rng {
  /** Next u32. */
  next(): number;
  /** next() / 2^32, in [0, 1). */
  float(): number;
  /** floor(float() * n), in [0, n). */
  int(n: number): number;
  /** lo + float() * (hi - lo), in [lo, hi). */
  range(lo: number, hi: number): number;
}

export function sfc32(a: number, b: number, c: number, d: number): Rng {
  throw new Error("not implemented");
}

/** The stream for one stage of one world seed. */
export function rngFor(seed: number, stream: string): Rng {
  throw new Error("not implemented");
}
