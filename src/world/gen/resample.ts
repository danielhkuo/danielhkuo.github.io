// Heights solved on jittered node positions, resampled onto the regular lattice.
import { wrap } from "../core/torus.ts";
import type { Jitter } from "./flood.ts";

/**
 * Inverse of P(s, t) = (1−s)(1−t) P00 + s(1−t) P10 + (1−s)t P01 + st P11.
 * Returns (s, t) when the query lies in the quad (a hair of slack for rounding),
 * otherwise null. s = t = 0 is returned exactly when the query is P00.
 */
function inverseBilinear(
  qx: number,
  qy: number,
  x00: number,
  y00: number,
  x10: number,
  y10: number,
  x01: number,
  y01: number,
  x11: number,
  y11: number,
): [number, number] | null {
  if (qx === x00 && qy === y00) return [0, 0];
  if (qx === x10 && qy === y10) return [1, 0];
  if (qx === x01 && qy === y01) return [0, 1];
  if (qx === x11 && qy === y11) return [1, 1];

  const bx = x10 - x00;
  const by = y10 - y00;
  const cx = x01 - x00;
  const cy = y01 - y00;
  const dx = x00 - x10 - x01 + x11;
  const dy = y00 - y10 - y01 + y11;
  const rx = qx - x00;
  const ry = qy - y00;

  // (bx + dx t) s + cx t = rx, same in y. Eliminate s → a t² + b t + c = 0.
  const a = cy * dx - cx * dy;
  const b = rx * dy - ry * dx + cy * bx - cx * by;
  const c = rx * by - ry * bx;

  let bestS = 0;
  let bestT = 0;
  let bestErr = Infinity;
  const consider = (s0: number, t0: number): void => {
    let s = s0;
    let t = t0;
    for (let iter = 0; iter < 8; iter++) {
      const st = s * t;
      const px = x00 + bx * s + cx * t + dx * st;
      const py = y00 + by * s + cy * t + dy * st;
      const ex = qx - px;
      const ey = qy - py;
      const j00 = bx + dx * t;
      const j01 = cx + dx * s;
      const j10 = by + dy * t;
      const j11 = cy + dy * s;
      const det = j00 * j11 - j01 * j10;
      if (det === 0) break;
      const ds = (ex * j11 - ey * j01) / det;
      const dt = (ey * j00 - ex * j10) / det;
      s += ds;
      t += dt;
      if (ds * ds + dt * dt <= 1e-28) break;
    }
    if (s < -1e-8 || s > 1 + 1e-8 || t < -1e-8 || t > 1 + 1e-8) return;
    const st = s * t;
    const px = x00 + bx * s + cx * t + dx * st;
    const py = y00 + by * s + cy * t + dy * st;
    const err = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (err < bestErr) {
      bestErr = err;
      bestS = s;
      bestT = t;
    }
  };

  const scale = Math.abs(b) + Math.abs(c) + 1;
  if (Math.abs(a) <= 1e-14 * scale) {
    if (b !== 0) {
      const t = -c / b;
      const denX = bx + dx * t;
      const denY = by + dy * t;
      if (denX !== 0 || denY !== 0) {
        const s = Math.abs(denX) >= Math.abs(denY) ? (rx - cx * t) / denX : (ry - cy * t) / denY;
        consider(s, t);
      }
    }
  } else {
    let disc = b * b - 4 * a * c;
    if (disc < 0 && disc > -1e-12 * scale * scale) disc = 0;
    if (disc >= 0) {
      const sd = Math.sqrt(disc);
      const q = -0.5 * (b + (b >= 0 ? sd : -sd));
      const t1 = q === 0 ? -b / (2 * a) : q / a;
      const t2 = q === 0 ? t1 : c / q;
      for (const t of [t1, t2]) {
        const denX = bx + dx * t;
        const denY = by + dy * t;
        if (denX === 0 && denY === 0) continue;
        const s = Math.abs(denX) >= Math.abs(denY) ? (rx - cx * t) / denX : (ry - cy * t) / denY;
        consider(s, t);
      }
    }
  }
  // Quadratic can miss a skewed quad; the lattice point sits near one corner.
  if (!(bestErr <= 1e-18)) {
    consider(0, 0);
    consider(1, 0);
    consider(0, 1);
    consider(1, 1);
  }

  if (!(bestErr <= 1e-18)) return null;
  if (bestS < 0) bestS = 0;
  else if (bestS > 1) bestS = 1;
  if (bestT < 0) bestT = 0;
  else if (bestT > 1) bestT = 1;
  return [bestS, bestT];
}

function bilinear(s: number, t: number, v00: number, v10: number, v01: number, v11: number): number {
  // s = t = 0 yields exactly v00; corners generally stay exact.
  const oms = 1 - s;
  const omt = 1 - t;
  return oms * omt * v00 + s * omt * v10 + oms * t * v01 + s * t * v11;
}

export function resampleToLattice(h: Float64Array, n: number, jitter: Jitter): Float64Array {
  if (jitter.amp === 0) return new Float64Array(h);
  const out = new Float64Array(n * n);
  const jx = jitter.jx;
  const jy = jitter.jy;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    for (let x = 0; x < n; x++) {
      let value = 0;
      let found = false;
      // The four quads that touch lattice point (x, y), starting at (x−1, y−1).
      for (let oj = -1; oj <= 0 && !found; oj++) {
        for (let oi = -1; oi <= 0; oi++) {
          const i = x + oi;
          const j = y + oj;
          const i00 = wrap(j, n) * n + wrap(i, n);
          const i10 = wrap(j, n) * n + wrap(i + 1, n);
          const i01 = wrap(j + 1, n) * n + wrap(i, n);
          const i11 = wrap(j + 1, n) * n + wrap(i + 1, n);
          const st = inverseBilinear(
            x,
            y,
            i + jx[i00]!,
            j + jy[i00]!,
            i + 1 + jx[i10]!,
            j + jy[i10]!,
            i + jx[i01]!,
            j + 1 + jy[i01]!,
            i + 1 + jx[i11]!,
            j + 1 + jy[i11]!,
          );
          if (st) {
            value = bilinear(st[0], st[1], h[i00]!, h[i10]!, h[i01]!, h[i11]!);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        let best = 0;
        let bestD = Infinity;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const idx = wrap(y + oy, n) * n + wrap(x + ox, n);
            const dx = x + ox + jx[idx]! - x;
            const dy = y + oy + jy[idx]! - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) {
              bestD = d2;
              best = idx;
            }
          }
        }
        value = h[best]!;
      }
      out[row + x] = value;
    }
  }
  return out;
}
