// Seeded random numbers for world code: sfc32, one stream per stage.

import { hashString, mix32 } from "./hash.ts";

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
  a = a >>> 0;
  b = b >>> 0;
  c = c >>> 0;
  d = d >>> 0;

  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };

  return {
    next,
    float(): number {
      return next() / 4294967296;
    },
    int(n: number): number {
      return Math.floor(next() / 4294967296 * n);
    },
    range(lo: number, hi: number): number {
      return lo + (next() / 4294967296) * (hi - lo);
    },
  };
}

/** The stream for one stage of one world seed. */
export function rngFor(seed: number, stream: string): Rng {
  const s = mix32(seed >>> 0);
  const t = hashString(stream);
  const r = sfc32(s, t, mix32((s ^ t ^ 0x9e3779b9) >>> 0), 1);
  for (let i = 0; i < 12; i++) {
    r.next();
  }
  return r;
}