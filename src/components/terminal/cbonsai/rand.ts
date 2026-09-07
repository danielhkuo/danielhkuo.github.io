/**
 * glibc `random()` — the TYPE_3 additive feedback generator that `rand()`
 * resolves to on Linux. cbonsai seeds it once with `srand(seed)` and draws
 * every roll from it, so matching it bit for bit is what makes `cbonsai -s 42`
 * here grow the same tree as `cbonsai -s 42` in a Linux terminal of the same
 * size. Verified against glibc's known sequence (srand(1) → 1804289383, …).
 */
export class GlibcRandom {
  private readonly r = new Int32Array(34);
  private i = 0;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** `srand(seed)`. Seed 0 is treated as 1, as glibc does. */
  seed(seed: number): void {
    let s = seed >>> 0;
    if (s === 0) s = 1;
    const r = this.r;
    r[0] = s | 0;
    for (let k = 1; k < 31; k++) {
      // Schrage's method for 16807 * r[k-1] mod (2^31 - 1) on signed words.
      const prev = r[k - 1];
      const hi = Math.trunc(prev / 127773);
      const lo = prev % 127773;
      let word = 16807 * lo - 2836 * hi;
      if (word < 0) word += 2147483647;
      r[k] = word;
    }
    for (let k = 31; k < 34; k++) r[k] = r[k - 31];
    // glibc discards the first 310 outputs after seeding.
    for (let k = 34; k < 344; k++) {
      r[k % 34] = (r[(k - 31) % 34] + r[(k - 3) % 34]) | 0;
    }
    this.i = 344 % 34;
  }

  /** `rand()`: the next value in [0, 2^31). */
  next(): number {
    const r = this.r;
    const i = this.i;
    // r[k] = r[k-31] + r[k-3]; on a ring of 34, k-31 ≡ k+3 and k-3 ≡ k+31.
    const v = (r[(i + 3) % 34] + r[(i + 31) % 34]) | 0;
    r[i] = v;
    this.i = (i + 1) % 34;
    return v >>> 1;
  }
}
