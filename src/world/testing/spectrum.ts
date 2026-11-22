// Radially binned power spectrum of a square periodic field, by separable DFT.
// Returns the mean power below 0.125 and below 0.25 cycles per cell (DC
// excluded), each divided by the mean power over every non-DC frequency.
// White noise scores about 1 in both; good blue noise scores near 0.

export function radialPower(values: ArrayLike<number>, size: number): { below125: number; below25: number } {
  const n = size, N = n * n;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += values[i];
  mean /= N;
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let k = 0; k < n; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = Math.sin((2 * Math.PI * k) / n); }
  // Rows: tr/ti[y][kx]
  const tr = new Float64Array(N), ti = new Float64Array(N);
  for (let y = 0; y < n; y++) {
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0;
      for (let x = 0; x < n; x++) {
        const v = values[y * n + x] - mean, a = (k * x) % n;
        sr += v * cos[a];
        si -= v * sin[a];
      }
      tr[y * n + k] = sr; ti[y * n + k] = si;
    }
  }
  let all = 0, nAll = 0, lo1 = 0, n1 = 0, lo2 = 0, n2 = 0;
  for (let kx = 0; kx < n; kx++) {
    for (let ky = 0; ky < n; ky++) {
      let sr = 0, si = 0;
      for (let y = 0; y < n; y++) {
        const a = (ky * y) % n, c = cos[a], s = -sin[a];
        const r = tr[y * n + kx], i = ti[y * n + kx];
        sr += r * c - i * s;
        si += r * s + i * c;
      }
      if (kx === 0 && ky === 0) continue;
      const p = sr * sr + si * si;
      const fx = (kx <= n / 2 ? kx : kx - n) / n, fy = (ky <= n / 2 ? ky : ky - n) / n;
      const f = Math.sqrt(fx * fx + fy * fy);
      all += p; nAll++;
      if (f < 0.125) { lo1 += p; n1++; }
      if (f < 0.25) { lo2 += p; n2++; }
    }
  }
  const m = all / nAll;
  return { below125: lo1 / n1 / m, below25: lo2 / n2 / m };
}
