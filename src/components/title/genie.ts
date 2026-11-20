// The macOS genie, as frames of a pure function. The window is cut into horizontal bands whose sides
// bend from its top corners down to a narrow neck: the bottom is drawn down first, then the rest
// flows through. A frame depends only on t, so the same moment is the same picture and it can run backwards.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GenieSetup {
  win: Rect;
  neckX: number;
  neckHalf: number;
  floorY: number;
}

/** One slice of the window. `from` and `to` are source rows `[from, to)`; `quad` is top-left, top-right, bottom-right, bottom-left, in page pixels. */
export interface Band {
  from: number;
  to: number;
  quad: [Point, Point, Point, Point];
}

/** The minimize's length: long enough to read as the Mac gesture, short enough that entering still feels quick. */
export const GENIE_MS = 620;

/** Shift plays the same minimize ten times slower, as it does on a Mac. */
export const GENIE_SLOW = 10;

/** The first part of the minimize draws the bottom down into the neck. The rest of the window follows after it. */
export const GENIE_SPLIT = 0.42;

// Slow at both ends, so the bottom leaves the window gently and settles into the neck gently.
function inOut(u: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

// Flat at the start, so the top stays put until the bottom has reached the neck, then follows it down.
function inQuad(u: number): number {
  return u * u * (1.6 - 0.6 * u);
}

// Zero slope at both ends: a side leaves its corner gently and meets the neck gently, which makes the S.
function smoothstep(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

export function genieBands(s: GenieSetup, t: number, bands: number): Band[] {
  const { win, neckX, neckHalf, floorY } = s;
  const x0 = win.x;
  const x1 = win.x + win.w;
  const y0 = win.y;
  const y1 = win.y + win.h;
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const p1 = inOut(Math.min(1, u / GENIE_SPLIT));
  const p2 = u <= GENIE_SPLIT ? 0 : inQuad((u - GENIE_SPLIT) / (1 - GENIE_SPLIT));
  const top = y0 + (floorY - y0) * p2;
  const bottom = y1 + (floorY - y1) * p1;
  // How far this row has been gathered into the neck. The whole curve runs from the window's top
  // to the floor; a floor already at the top is the end of that curve, not a division by zero.
  const span = floorY - y0;
  const intoNeck = (y: number): number => smoothstep(span === 0 ? 1 : (y - y0) / span) * p1;
  const left = (y: number): number => x0 + (neckX - neckHalf - x0) * intoNeck(y);
  const right = (y: number): number => x1 + (neckX + neckHalf - x1) * intoNeck(y);

  const out: Band[] = [];
  const rise = bottom - top;
  for (let k = 0; k < bands; k++) {
    const ya = top + rise * (k / bands);
    const yb = top + rise * ((k + 1) / bands);
    out.push({
      from: (k * win.h) / bands,
      to: ((k + 1) * win.h) / bands,
      quad: [
        { x: left(ya), y: ya },
        { x: right(ya), y: ya },
        { x: right(yb), y: yb },
        { x: left(yb), y: yb },
      ],
    });
  }
  return out;
}

/** A quad with no area has no homography. Land every corner on one finite point so the matrix never contains NaN. */
function collapse(quad: readonly Point[]): string {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of quad) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x += p.x;
    y += p.y;
    n += 1;
  }
  if (n > 0) {
    x /= n;
    y /= n;
  }
  return `matrix3d(0,0,0,0,0,0,0,0,0,0,1,0,${x},${y},0,1)`;
}

/**
 * CSS `matrix3d` that lays the rectangle `(0,0)-(w,h)` onto `quad`, for an element whose transform
 * origin is its top-left. The band is scaled into the unit square and that square is mapped onto the
 * quad; z is left alone. CSS lists the sixteen numbers down the columns, translation last.
 */
export function quadMatrix(w: number, h: number, quad: [Point, Point, Point, Point]): string {
  const [p0, p1, p2, p3] = quad;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w === 0 || h === 0) return collapse(quad);
  for (const p of quad) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return collapse(quad);
  }

  // Edges that meet at the bottom-right, and how far the fourth corner misses a parallelogram.
  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const span = Math.hypot(dx1, dy1) * Math.hypot(dx2, dy2);
  const singular = !(span > 0) || Math.abs(det) <= 1e-12 * span;

  let g = 0;
  let gy = 0;
  if (singular) {
    // A flat parallelogram still has an affine map. Anything else has no finite homography.
    const scale = Math.hypot(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y) + 1;
    if (Math.abs(dx3) > 1e-8 * scale || Math.abs(dy3) > 1e-8 * scale) return collapse(quad);
  } else {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    gy = (dx1 * dy3 - dx3 * dy1) / det;
  }

  const a = p1.x * (g + 1) - p0.x;
  const d = p1.y * (g + 1) - p0.y;
  const b = p3.x * (gy + 1) - p0.x;
  const e = p3.y * (gy + 1) - p0.y;
  const colX = [a / w, d / w, g / w];
  const colY = [b / h, e / h, gy / h];
  if (![...colX, ...colY, p0.x, p0.y].every(Number.isFinite)) return collapse(quad);

  // Column-major: x, y, z, translation. The z column and z row stay the identity.
  return `matrix3d(${colX[0]},${colX[1]},0,${colX[2]},${colY[0]},${colY[1]},0,${colY[2]},0,0,1,0,${p0.x},${p0.y},0,1)`;
}
