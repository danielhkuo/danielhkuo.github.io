// Where the quest arrow sits on the frame. `target` is the stop in frame pixels, which may lie far
// off the frame. The angle is 0 east and π/2 south.

import { patan2, PI } from "../core/psin.ts";

type Arrow = { mode: "edge" | "over"; x: number; y: number; angle: number };

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function arrowAt(target: { x: number; y: number }, fw: number, fh: number, margin: number): Arrow {
  const left = margin;
  const right = fw - margin;
  const top = margin;
  const bottom = fh - margin;
  // On the inset frame, inclusive of its edge: float 14 px above the stop, pointing down.
  if (target.x >= left && target.x <= right && target.y >= top && target.y <= bottom) {
    return { mode: "over", x: target.x, y: target.y - 14, angle: PI / 2 };
  }

  const cx = fw / 2;
  const cy = fh / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const angle = patan2(dy, dx);
  // A target on the centre has no direction. Sit on the top edge rather than emit NaN.
  if (dx === 0 && dy === 0) {
    return { mode: "edge", x: clamp(Math.round(cx), left, right), y: top, angle };
  }

  // Scale the ray from the centre by the smaller factor, so it meets the inset rectangle.
  const hx = cx - left;
  const hy = cy - top;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const sx = ax === 0 ? Number.POSITIVE_INFINITY : hx / ax;
  const sy = ay === 0 ? Number.POSITIVE_INFINITY : hy / ay;
  const scale = sx < sy ? sx : sy;
  const x = clamp(Math.round(cx + dx * scale), left, right);
  const y = clamp(Math.round(cy + dy * scale), top, bottom);
  return { mode: "edge", x, y, angle };
}
