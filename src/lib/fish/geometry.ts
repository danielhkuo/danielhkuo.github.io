// Closed-polygon helpers for building a fish's silhouette. Pure, no DOM.

export type Pt = [number, number];

/** Shoelace area. Positive when the loop runs clockwise on screen (y down). */
export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Cumulative edge lengths of a closed loop: n + 1 entries, the last is the perimeter. */
export function cumulativeLength(p: Pt[]): number[] {
  const cum = [0];
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

/** Binomial (1-2-1) smoothing round a closed loop. Keeps the point count. */
export function smoothClosed(p: Pt[], passes: number): Pt[] {
  const n = p.length;
  let x = Float64Array.from(p, (q) => q[0]);
  let y = Float64Array.from(p, (q) => q[1]);
  let nx = new Float64Array(n);
  let ny = new Float64Array(n);
  for (let k = 0; k < passes; k++) {
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? n - 1 : i - 1;
      const b = i === n - 1 ? 0 : i + 1;
      nx[i] = (x[a] + 2 * x[i] + x[b]) / 4;
      ny[i] = (y[a] + 2 * y[i] + y[b]) / 4;
    }
    [x, nx] = [nx, x];
    [y, ny] = [ny, y];
  }
  return Array.from(x, (v, i): Pt => [v, y[i]]);
}

function simplifyOpen(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = p[a];
    const [bx, by] = p[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const t = ((p[i][0] - ax) * dx + (p[i][1] - ay) * dy) / (len * len);
      const d =
        t <= 0
          ? Math.hypot(p[i][0] - ax, p[i][1] - ay)
          : t >= 1
            ? Math.hypot(p[i][0] - bx, p[i][1] - by)
            : Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > eps) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

/** Douglas–Peucker on a closed loop, split at its leftmost point and the point farthest from it. */
export function simplifyClosed(p: Pt[], eps: number): Pt[] {
  const n = p.length;
  let i0 = 0;
  for (let i = 1; i < n; i++) if (p[i][0] < p[i0][0]) i0 = i;
  let i1 = 0;
  let far = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(p[i][0] - p[i0][0], p[i][1] - p[i0][1]);
    if (d > far) {
      far = d;
      i1 = i;
    }
  }
  const loop = p.slice(i0).concat(p.slice(0, i0));
  const j = (i1 - i0 + n) % n;
  const a = simplifyOpen(loop.slice(0, j + 1), eps);
  const b = simplifyOpen(loop.slice(j).concat([loop[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Split every edge longer than `maxLength` into equal pieces. */
export function subdivide(p: Pt[], maxLength: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLength));
    for (let j = 0; j < pieces; j++) {
      out.push([a[0] + ((b[0] - a[0]) * j) / pieces, a[1] + ((b[1] - a[1]) * j) / pieces]);
    }
  }
  return out;
}

/**
 * A copy of the loop low-passed along its length, sampled back at the original
 * vertices so the two stay index-aligned. `sigma` and `spacing` are in the
 * loop's own units.
 */
export function softened(p: Pt[], sigma: number, spacing: number): Pt[] {
  const cum = cumulativeLength(p);
  const total = cum[p.length];
  const m = Math.max(8, Math.round(total / spacing));
  const dense: Pt[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const t = (k / m) * total;
    while (j < p.length - 1 && cum[j + 1] < t) j++;
    const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1e-9);
    const a = p[j];
    const b = p[(j + 1) % p.length];
    dense.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  // n binomial passes have variance n/2 samples², so this is a Gaussian of `sigma`.
  const samples = sigma / (total / m);
  const smooth = smoothClosed(dense, Math.round(2 * samples * samples));
  return p.map((_, i): Pt => {
    const x = (cum[i] / total) * m;
    const k = Math.floor(x) % m;
    const f = x - Math.floor(x);
    const a = smooth[k];
    const b = smooth[(k + 1) % m];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  });
}

/** How many pairs of non-adjacent edges of a closed polygon properly cross. */
export function selfIntersections(p: Pt[]): number {
  const n = p.length;
  const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])) continue;
      if (Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) count++;
    }
  }
  return count;
}
