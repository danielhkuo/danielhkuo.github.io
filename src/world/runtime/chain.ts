// The body chain: the head's path remembered, and points spaced along it behind the head, so a long body follows
// exactly where the head has been, turns and all. Positions wrap with the world.

import { torusDelta, wrap } from "../core/torus.ts";

export interface Joint {
  x: number;
  y: number;
  alt: number;
  /** Direction of travel there, radians (0 east, π/2 south). */
  heading: number;
}

export interface Chain {
  /** Records the head's position this frame (world cells, wrapped into [0, n)). */
  push(x: number, y: number, alt: number): void;
  /**
   * `count` joints, the first at the head, each `spacing` cells of path behind the last, positions wrapped into [0, n).
   * Joints past the start of the remembered path continue straight back along the path's first heading.
   */
  joints(count: number, spacing: number): Joint[];
  /**
   * Lays the body down: moves the height of each remembered point within `back` cells of path behind the head `share`
   * (0–1) of the way to where it would lie. That is `to(x, y)` under it, or higher where that would bend the body
   * steeper than `slope` (height per cell of path) between its neighbours: so it ramps down from the head, which
   * keeps its own height, and bridges a drop instead of stepping down it. Returns the most it moved any point: 0 once
   * the body lies where it would.
   */
  settle(to: (x: number, y: number) => number, share: number, back: number, slope: number): number;
}

/**
 * A chain on a world `n` cells across that remembers at most `capacity` points (older ones are dropped). With a
 * `minStep`, a push less than that far from the point before the newest moves the newest point instead of adding one:
 * the head is always the first joint, and a head that crawls or stops cannot fill the memory with one place and lose
 * the path it came by. The chain then remembers at least capacity × minStep cells of path.
 */
export function createChain(n: number, capacity: number, minStep = 0): Chain {
  const cap = capacity;
  const xs = new Float64Array(cap);
  const ys = new Float64Array(cap);
  const alts = new Float64Array(cap);
  let start = 0;
  let size = 0;
  // settle's scratch: each point's slot, its distance behind the head, and the height it would lie at.
  const slot = new Int32Array(cap);
  const far = new Float64Array(cap);
  const lie = new Float64Array(cap);

  return {
    settle(to, share, back, slope): number {
      if (size < 2 || !(share > 0)) return 0;
      const head = (start + size - 1) % cap;
      slot[0] = head;
      far[0] = 0;
      lie[0] = alts[head];
      let count = 1;
      let d = 0;
      for (let i = size - 1; i > 0; i--) {
        const a = (start + i) % cap, b = (start + i - 1) % cap;
        d += Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
        if (d > back) break;
        slot[count] = b;
        far[count] = d;
        lie[count] = to(wrap(xs[b], n), wrap(ys[b], n));
        count++;
      }
      // The upper envelope of the ground with the slope: once from the head back, once from the tail forward.
      for (let k = 1; k < count; k++) {
        const least = lie[k - 1] - slope * (far[k] - far[k - 1]);
        if (lie[k] < least) lie[k] = least;
      }
      for (let k = count - 2; k >= 1; k--) {
        const least = lie[k + 1] - slope * (far[k + 1] - far[k]);
        if (lie[k] < least) lie[k] = least;
      }
      const by = share < 1 ? share : 1;
      let most = 0;
      for (let k = 1; k < count; k++) {
        const move = (lie[k] - alts[slot[k]]) * by;
        alts[slot[k]] += move;
        if (move > most) most = move;
        else if (-move > most) most = -move;
      }
      return most;
    },

    push(x: number, y: number, alt: number): void {
      if (cap <= 0) return;
      const wx = wrap(x, n);
      const wy = wrap(y, n);
      let ux = wx;
      let uy = wy;
      if (size > 0) {
        const last = (start + size - 1) % cap;
        ux = xs[last] + torusDelta(wrap(xs[last], n), wx, n);
        uy = ys[last] + torusDelta(wrap(ys[last], n), wy, n);
        if (minStep > 0 && size > 1) {
          const prev = (start + size - 2) % cap;
          const dx = ux - xs[prev], dy = uy - ys[prev];
          if (dx * dx + dy * dy < minStep * minStep) {
            xs[last] = ux;
            ys[last] = uy;
            alts[last] = alt;
            return;
          }
        }
      }
      if (size < cap) {
        const i = (start + size) % cap;
        xs[i] = ux;
        ys[i] = uy;
        alts[i] = alt;
        size += 1;
      } else {
        xs[start] = ux;
        ys[start] = uy;
        alts[start] = alt;
        start = (start + 1) % cap;
      }
    },

    joints(count: number, spacing: number): Joint[] {
      const result: Joint[] = new Array(count);
      if (size === 0) {
        for (let j = 0; j < count; j++) result[j] = { x: 0, y: 0, alt: 0, heading: 0 };
        return result;
      }

      let idx = size - 1;
      let distAt = 0;
      let hx = 1;
      let hy = 0;
      let hz = 0;
      let heading = 0;

      for (let j = 0; j < count; j++) {
        const target = j * spacing;
        let placed = false;
        while (idx > 0) {
          const newerI = (start + idx) % cap;
          const olderI = (start + idx - 1) % cap;
          const dx = xs[newerI] - xs[olderI];
          const dy = ys[newerI] - ys[olderI];
          const dz = alts[newerI] - alts[olderI];
          const len = Math.hypot(dx, dy);
          if (!(len > 0)) {
            idx -= 1;
            continue;
          }
          if (target <= distAt + len) {
            const frac = (target - distAt) / len;
            result[j] = {
              x: wrap(xs[newerI] - dx * frac, n),
              y: wrap(ys[newerI] - dy * frac, n),
              alt: alts[newerI] - dz * frac,
              heading: Math.atan2(dy, dx),
            };
            placed = true;
            break;
          }
          distAt += len;
          idx -= 1;
          hx = dx / len;
          hy = dy / len;
          hz = dz / len;
          heading = Math.atan2(dy, dx);
        }
        if (!placed) {
          const p = start % cap;
          const extra = target - distAt;
          result[j] = {
            x: wrap(xs[p] - hx * extra, n),
            y: wrap(ys[p] - hy * extra, n),
            alt: alts[p] - hz * extra,
            heading,
          };
        }
      }
      return result;
    },
  };
}
