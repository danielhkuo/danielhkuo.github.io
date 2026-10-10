// The card's border flowing into a fish's outline. Pure maths, shared by the
// browser controller and the tests: this module knows nothing about the DOM.
//
// One closed path does the whole move. Its points sit on the card's border at
// rest (k0), pass through a blurred copy of the fish where the fins are soft
// bumps (k1), and land on the true silhouette (k2). Going by way of the soft
// copy keeps the in-between shapes smooth; tweening straight to the silhouette
// prints every fin-edge wiggle onto the straight border from the first frame.

import type { FishData } from "./types.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fish units → card pixels. */
export interface Fit {
  scale: number;
  dx: number;
  dy: number;
}

export interface Keyframes {
  /** Vertex count; every array holds n x,y pairs. */
  n: number;
  k0: Float32Array;
  k1: Float32Array;
  k2: Float32Array;
}

/** The whole card→fish move is one timeline from 0 to 1; these are its parts. */
export const TIMELINE = {
  /** Border → soft fish, and soft fish → crisp fish. The overlap is what makes it one motion. */
  soften: [0, 0.6],
  sharpen: [0.3, 0.7],
  /** The outline has landed; the rest of the timeline inks the fish in. */
  outlineEnd: 0.7,
  copyGone: 0.15,
  ink: [0.7, 0.9],
  hatch: [0.78, 1],
} as const;

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const within = (t: number, [from, to]: readonly [number, number]) => clamp((t - from) / (to - from));
export const easeInOutSine = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const frac = (v: number) => ((v % 1) + 1) % 1;

/** The largest centred copy of a w×h fish that fits the box. */
export function fitBox(w: number, h: number, box: Box): Fit {
  const scale = Math.min(box.w / w, box.h / h);
  return { scale, dx: box.x + (box.w - w * scale) / 2, dy: box.y + (box.h - h * scale) / 2 };
}

/**
 * The centre line of a 1px border on a w×h card, walked clockwise from the
 * top-left corner. `at(r)` takes a fraction of the perimeter.
 */
function borderLine(w: number, h: number) {
  const ew = w - 1;
  const eh = h - 1;
  const perimeter = 2 * (ew + eh);
  const corners = [0, ew / perimeter, (ew + eh) / perimeter, (2 * ew + eh) / perimeter];
  const cornerPoints = [0.5, 0.5, w - 0.5, 0.5, w - 0.5, h - 0.5, 0.5, h - 0.5];
  const at = (r: number, out: Float32Array | number[], i: number) => {
    let d = frac(r) * perimeter;
    if (d < ew) {
      out[i] = 0.5 + d;
      out[i + 1] = 0.5;
    } else if ((d -= ew) < eh) {
      out[i] = w - 0.5;
      out[i + 1] = 0.5 + d;
    } else if ((d -= eh) < ew) {
      out[i] = w - 0.5 - d;
      out[i + 1] = h - 0.5;
    } else {
      out[i] = 0.5;
      out[i + 1] = h - 0.5 - (d - ew);
    }
  };
  return { perimeter, corners, cornerPoints, at };
}

/**
 * Pair every silhouette vertex with a point on the card's border.
 *
 * Both loops run clockwise and are matched by arc length — a vertex 30% of the
 * way round the fish goes to the point 30% of the way round the border — which
 * leaves one free choice: where on the border the fish's first vertex starts.
 * Trying every offset and keeping the one with the least total travel is what
 * stops the shape twisting; it sends the nose to the left edge and the tail
 * tips to the right-hand corners without knowing what either is.
 *
 * The four border corners are then added as vertices of their own, so the
 * path at rest is exactly the rectangle rather than one with its corners cut.
 */
export function buildKeyframes(fish: Pick<FishData, "sil" | "soft">, fit: Fit, w: number, h: number): Keyframes {
  const count = fish.sil.length / 2;
  const sil = new Float32Array(count * 2);
  const soft = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    sil[2 * i] = fish.sil[2 * i] * fit.scale + fit.dx;
    sil[2 * i + 1] = fish.sil[2 * i + 1] * fit.scale + fit.dy;
    soft[2 * i] = fish.soft[2 * i] * fit.scale + fit.dx;
    soft[2 * i + 1] = fish.soft[2 * i + 1] * fit.scale + fit.dy;
  }

  // Each vertex's position round the fish, as a fraction of its perimeter.
  const along = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    along[i + 1] = along[i] + Math.hypot(sil[2 * j] - sil[2 * i], sil[2 * j + 1] - sil[2 * i + 1]);
  }
  const length = along[count];

  // Evenly spaced probes round the fish, to score an offset without bias
  // towards wherever the outline happens to have more vertices.
  const PROBES = 200;
  const probes = new Float32Array(PROBES * 2);
  for (let k = 0, i = 0; k < PROBES; k++) {
    const t = (k / PROBES) * length;
    while (i < count - 1 && along[i + 1] < t) i++;
    const f = (t - along[i]) / (along[i + 1] - along[i] || 1e-9);
    const j = (i + 1) % count;
    probes[2 * k] = sil[2 * i] + (sil[2 * j] - sil[2 * i]) * f;
    probes[2 * k + 1] = sil[2 * i + 1] + (sil[2 * j + 1] - sil[2 * i + 1]) * f;
  }

  const border = borderLine(w, h);
  const point = [0, 0];
  const cost = (offset: number) => {
    let sum = 0;
    for (let k = 0; k < PROBES; k++) {
      border.at(offset + k / PROBES, point, 0);
      sum += (probes[2 * k] - point[0]) ** 2 + (probes[2 * k + 1] - point[1]) ** 2;
    }
    return sum;
  };
  // Every 2px round the border, then to a quarter-pixel around the winner.
  let best = 0;
  let bestCost = Infinity;
  const search = (from: number, to: number, step: number) => {
    for (let px = from; px < to; px += step) {
      const c = cost(px / border.perimeter);
      if (c < bestCost) {
        bestCost = c;
        best = px;
      }
    }
  };
  search(0, border.perimeter, 2);
  search(best - 2, best + 2, 0.25);
  const offset = best / border.perimeter;

  const r = new Float64Array(count);
  for (let i = 0; i < count; i++) r[i] = frac(offset + along[i] / length);

  const k0: number[] = [];
  const k1: number[] = [];
  const k2: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    border.at(r[i], point, 0);
    k0.push(point[0], point[1]);
    k1.push(soft[2 * i], soft[2 * i + 1]);
    k2.push(sil[2 * i], sil[2 * i + 1]);

    // Border corners that fall between this vertex and the next become
    // vertices too, placed the same fraction of the way along the fish's edge.
    const span = frac(r[j] - r[i]);
    const inside: { corner: number; f: number }[] = [];
    for (let corner = 0; corner < 4; corner++) {
      const gap = frac(border.corners[corner] - r[i]);
      if (gap > 1e-9 && gap < span - 1e-9) inside.push({ corner, f: gap / span });
    }
    inside.sort((a, b) => a.f - b.f);
    for (const { corner, f } of inside) {
      k0.push(border.cornerPoints[2 * corner], border.cornerPoints[2 * corner + 1]);
      k1.push(soft[2 * i] + (soft[2 * j] - soft[2 * i]) * f, soft[2 * i + 1] + (soft[2 * j + 1] - soft[2 * i + 1]) * f);
      k2.push(sil[2 * i] + (sil[2 * j] - sil[2 * i]) * f, sil[2 * i + 1] + (sil[2 * j + 1] - sil[2 * i + 1]) * f);
    }
  }
  return { n: k0.length / 2, k0: Float32Array.from(k0), k1: Float32Array.from(k1), k2: Float32Array.from(k2) };
}

/** The outline at timeline position t, written into `out` (2n numbers). */
export function shapeAt(kf: Keyframes, t: number, out: Float32Array): void {
  const a = easeInOutSine(within(t, TIMELINE.soften));
  const b = easeInOutSine(within(t, TIMELINE.sharpen));
  const { k0, k1, k2 } = kf;
  for (let i = 0, len = kf.n * 2; i < len; i++) out[i] = k0[i] + (k1[i] - k0[i]) * a + (k2[i] - k1[i]) * b;
}

/** A closed SVG path through the points, to a tenth of a pixel. */
export function outlinePath(points: Float32Array, n: number): string {
  let d = `M${Math.round(points[0] * 10) / 10} ${Math.round(points[1] * 10) / 10}`;
  for (let i = 1; i < n; i++) d += `L${Math.round(points[2 * i] * 10) / 10} ${Math.round(points[2 * i + 1] * 10) / 10}`;
  return `${d}Z`;
}

/** Everything that is not the outline, as 0–1 amounts at timeline position t. */
export function layersAt(t: number) {
  const settle = easeInOutSine(clamp(t / TIMELINE.outlineEnd));
  return {
    /** The card's own text: gone early, so the border is not bending round words. */
    copy: 1 - clamp(t / TIMELINE.copyGone),
    /** Border grey → ink, and the project name moving down to its caption, with the outline. */
    settle,
    ink: within(t, TIMELINE.ink),
    hatch: within(t, TIMELINE.hatch),
  };
}
