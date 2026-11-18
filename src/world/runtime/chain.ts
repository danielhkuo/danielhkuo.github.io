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
}

/** A chain on a world `n` cells across that remembers at most `capacity` points (older ones are dropped). */
export function createChain(n: number, capacity: number): Chain {
  const cap = capacity;
  const xs = new Float64Array(cap);
  const ys = new Float64Array(cap);
  const alts = new Float64Array(cap);
  let start = 0;
  let size = 0;

  return {
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
