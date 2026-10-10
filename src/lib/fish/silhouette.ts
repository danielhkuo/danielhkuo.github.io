// One closed outer outline for a fish, from the closed polygons fishdraw clips
// its strokes against. The polygons overlap, abut and leave hairline slits, so
// rather than union them analytically they are painted into one bitmap, the
// slits welded shut, and the outer boundary walked.

import type { FishPolyName, Polyline } from "./fishdraw.mjs";
import { signedArea, simplifyClosed, smoothClosed, subdivide, type Pt } from "./geometry.ts";

type Polys = Partial<Record<FishPolyName, Polyline>>;

/** Bitmap cells per drawing unit. A card shows a fish at about 0.6px per unit, so ~7 cells per pixel. */
const CELLS = 4;
/** Closing radius in cells: about one screen pixel, enough to weld the slits between parts. */
const CLOSE = 5;
/** Binomial passes that melt the cell staircase back into a curve. */
const SMOOTH = 6;
/** Simplification tolerance, in drawing units (~0.12px on a card). */
const TOLERANCE = 0.2;
/** Longest edge kept, in drawing units: in-between shapes are curved, so long chords would facet them. */
const MAX_EDGE = 12;

interface Bitmap {
  cells: Uint8Array;
  w: number;
  h: number;
  /** Drawing-unit position of the bitmap's top-left corner. */
  x: number;
  y: number;
}

/** Paint each polygon even-odd into a fresh copy of `frame`; the results are OR-ed. */
function paint(frame: Bitmap, polys: (Polyline | undefined)[]): Uint8Array {
  const { w, h } = frame;
  const cells = new Uint8Array(w * h);
  const xs: number[] = [];
  for (const poly of polys) {
    if (!poly || poly.length < 3) continue;
    const n = poly.length;
    for (let row = 0; row < h; row++) {
      const y = frame.y + (row + 0.5) / CELLS;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % n];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k] - frame.x) * CELLS - 0.5));
        const to = Math.min(w - 1, Math.floor((xs[k + 1] - frame.x) * CELLS - 0.5));
        if (to >= from) cells.fill(1, row * w + from, row * w + to + 1);
      }
    }
  }
  return cells;
}

/** Grow the filled area by `r` cells along one axis: a cell is set if any within `r` of it was. */
function spread(src: Uint8Array, count: number, length: number, stride: number, step: number, r: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let line = 0; line < count; line++) {
    const base = line * stride;
    let since = r + 1;
    for (let i = 0; i < length; i++) {
      since = src[base + i * step] ? 0 : since + 1;
      if (since <= r) out[base + i * step] = 1;
    }
    since = r + 1;
    for (let i = length - 1; i >= 0; i--) {
      since = src[base + i * step] ? 0 : since + 1;
      if (since <= r) out[base + i * step] = 1;
    }
  }
  return out;
}

/** Dilate by a (2r+1)-cell square, as two one-dimensional passes. */
function dilate(cells: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return spread(spread(cells, h, w, w, 1, r), w, h, 1, w, r);
}

function invert(cells: Uint8Array): Uint8Array {
  return cells.map((c) => (c ? 0 : 1));
}

/** Keep the largest 4-connected blob and fill its holes. */
function solidify(cells: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let current = 0;
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || label[start]) continue;
    current++;
    let size = 0;
    label[start] = current;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const claim = (q: number) => {
        if (cells[q] && !label[q]) {
          label[q] = current;
          stack.push(q);
        }
      };
      if (x > 0) claim(p - 1);
      if (x < w - 1) claim(p + 1);
      if (p >= w) claim(p - w);
      if (p < cells.length - w) claim(p + w);
    }
    if (size > bestSize) {
      bestSize = size;
      best = current;
    }
  }
  // Flood the outside in from the edges; whatever it cannot reach is fish.
  const outside = new Uint8Array(w * h);
  const visit = (p: number) => {
    if (label[p] !== best && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < cells.length - w) visit(p + w);
  }
  return invert(outside);
}

/**
 * Walk the outer boundary of a hole-free blob along cell corners, keeping the
 * blob on the right. Turning right whenever the cell ahead-right is empty makes
 * a diagonal pinch a corner rather than a crossing, so the result is one simple loop.
 */
function boundary(frame: Bitmap): Pt[] {
  const { cells, w, h } = frame;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? cells[y * w + x] : 0);
  const first = cells.indexOf(1);
  if (first < 0) return [];
  const x0 = first % w;
  const y0 = (first - x0) / w;
  let x = x0;
  let y = y0;
  let dx = 1;
  let dy = 0;
  const pts: Pt[] = [];
  do {
    pts.push([frame.x + x / CELLS, frame.y + y / CELLS]);
    x += dx;
    y += dy;
    // The two cells ahead of this corner, to the left and right of the heading.
    const [left, right] =
      dx === 1
        ? [at(x, y - 1), at(x, y)]
        : dx === -1
          ? [at(x - 1, y), at(x - 1, y - 1)]
          : dy === 1
            ? [at(x, y), at(x - 1, y)]
            : [at(x - 1, y - 1), at(x, y - 1)];
    if (!right) [dx, dy] = [-dy, dx];
    else if (left) [dx, dy] = [dy, -dx];
    if (pts.length > 4 * (w + 1) * (h + 1)) throw new Error("fish silhouette: boundary walk did not close");
  } while (x !== x0 || y !== y0 || dx !== 1 || dy !== 0);
  return pts;
}

/**
 * The fish's outer outline: clockwise, simplified, with no edge longer than
 * MAX_EDGE. It lands on the drawn strokes to within a fraction of a pixel,
 * because it is built from the same polygons those strokes were clipped to.
 */
export function traceSilhouette(polys: Polys): Pt[] {
  // `cf`, the region the head cuts out of the body, runs far past the fish;
  // only what the other polygons cover matters, so it does not size the frame.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [name, poly] of Object.entries(polys)) {
    if (name === "cf") continue;
    for (const [x, y] of poly ?? []) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  const margin = (CLOSE + 2) / CELLS;
  const frame: Bitmap = {
    cells: new Uint8Array(0),
    x: x0 - margin,
    y: y0 - margin,
    w: Math.ceil((x1 - x0 + 2 * margin) * CELLS),
    h: Math.ceil((y1 - y0 + 2 * margin) * CELLS),
  };

  // The same clipping fish() applies to its strokes: the head region is cut
  // out of the body and pectoral fin, then the head and the other fins go on top.
  const cells = paint(frame, [polys.body, polys.c1]);
  const cut = paint(frame, [polys.cf]);
  const top = paint(frame, [polys.head, polys.lip0, polys.lip1, polys.jaw, polys.c0, polys.c2, polys.c3, polys.c4, polys.c5]);
  for (let i = 0; i < cells.length; i++) cells[i] = (cells[i] && !cut[i]) || top[i] ? 1 : 0;

  const { w, h } = frame;
  const closed = invert(dilate(invert(dilate(cells, w, h, CLOSE)), w, h, CLOSE));
  frame.cells = solidify(closed, w, h);

  const outline = simplifyClosed(smoothClosed(boundary(frame), SMOOTH), TOLERANCE);
  if (signedArea(outline) < 0) outline.reverse();
  return subdivide(outline, MAX_EDGE);
}
