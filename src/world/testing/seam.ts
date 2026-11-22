// Seam check for torus fields: the largest step across the x and y wraps,
// divided by the largest step anywhere inside. A seamless field scores ≤ 1.

export function seamRatio(a: ArrayLike<number>, n: number): number {
  let seam = 0, inner = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = a[y * n + x];
      const dx = Math.abs(a[y * n + ((x + 1) % n)] - v);
      const dy = Math.abs(a[((y + 1) % n) * n + x] - v);
      if (x === n - 1) seam = Math.max(seam, dx); else inner = Math.max(inner, dx);
      if (y === n - 1) seam = Math.max(seam, dy); else inner = Math.max(inner, dy);
    }
  }
  return inner === 0 ? (seam === 0 ? 0 : Infinity) : seam / inner;
}
