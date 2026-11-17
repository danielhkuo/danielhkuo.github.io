// What the fixed camera can see. A node at row y with height h draws its top
// at screen row c·y − h (c = 0.8 · cells per node). A node further south whose
// top reaches that row or higher hides it. Rows wrap: the bake is a torus too.

export interface Visibility {
  /** Highest "h − c·k" over the nodes k = 1, 2, … south of each node: the height a node must exceed to be seen. */
  horizon: Float32Array;
  /** 1 where the node's top is visible (h > horizon), else 0. */
  visible: Uint8Array;
}

/**
 * @param c screen rows per node step south: 0.8 × cells per node (3.2 on G, 0.8 on cells).
 * @param reach how many nodes south can matter: ceil(HMAX_range / c) is enough.
 */
export function visibility(h: Float64Array | Float32Array, n: number, c: number, reach: number): Visibility {
  const nn = n * n;
  const horizon = new Float32Array(nn);
  const visible = new Uint8Array(nn);
  if (n < 1) return { horizon, visible };
  // Empty window: nothing stands south of a node, so the horizon is −∞ and every finite top shows.
  if (!(reach >= 1)) {
    horizon.fill(Number.NEGATIVE_INFINITY);
    for (let i = 0; i < nn; i++) visible[i] = h[i] > Number.NEGATIVE_INFINITY ? 1 : 0;
    return { horizon, visible };
  }

  // h(y+k) − c·k = (h(p) − c·p) + c·y for the unwrapped row p = y+k. The max of
  // those keys over the next `reach` rows south, read from a deque that stays
  // sorted high-to-low, is the horizon. Sweep northward from `reach` rows past
  // the seam so the ring's window is already full when y = n−1 is recorded.
  const idx = new Int32Array(n + reach);
  const key = new Float64Array(n + reach);

  for (let x = 0; x < n; x++) {
    let head = 0;
    let tail = 0;
    for (let y = n - 1 + reach; y >= 0; y--) {
      const far = y + reach;
      while (head < tail && idx[head] > far) head++;

      if (y <= n - 1) {
        const src = idx[head];
        const k = src - y;
        const m = h[(src % n) * n + x] - c * k;
        const i = y * n + x;
        horizon[i] = m;
        visible[i] = h[i] > m ? 1 : 0;
      }

      const ky = h[(y % n) * n + x] - c * y;
      while (tail > head && key[tail - 1] <= ky) tail--;
      idx[tail] = y;
      key[tail] = ky;
      tail++;
    }
  }

  return { horizon, visible };
}
