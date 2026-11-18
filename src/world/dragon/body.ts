// What the three studies share: the pose a study is drawn in, the shading of a rounded body, and the body rings
// that are strung along the chain to make a neck, a serpentine body or a tail.

import type { Chain } from "../runtime/chain.ts";
import type { Look } from "./look.ts";
import { pieceOf, type Piece } from "./parts.ts";
import { ball, put, vox, type Shade } from "./vox.ts";

/** Where a study is in its motion this frame. */
export interface Pose {
  /** The head's remembered path. */
  chain: Chain;
  /** World size, cells. */
  n: number;
  /** Seconds, for wingbeats and small sways. */
  time: number;
  /** The undulation's phase, radians: it runs faster at speed. */
  wave: number;
}

/** A rounded body: shaded underside, lit top. */
export function skinOf(look: Look): Shade {
  return (_x, _y, _z, t) => (t < 0.3 ? look.bodyDark : t > 0.75 ? look.bodyLight : look.body);
}

/** 0 → 1 over 0 … 1, eased at both ends. */
export function smooth(u: number): number {
  const c = u < 0 ? 0 : u > 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** Radii are built in quarter-pixel steps. */
export const RING_STEP = 0.25;

/**
 * One ring of a body of radius r: a short stack with a belly-coloured bottom slice, shaded sides and a lit top.
 * `band` inks a scale edge along its rear rim; `spine` sets a mane-coloured stud on its back.
 */
export function ringPiece(look: Look, r: number, band: boolean, spine: boolean): Piece {
  const layers = Math.max(2, Math.round(r * 1.25));
  const half = Math.ceil(r) + 1;
  const v = vox(half, half, layers + (spine ? 1 : 0));
  for (let z = 0; z < layers; z++) {
    const t = layers > 1 ? z / (layers - 1) : 1;
    const dz = (z + 0.5) / layers * 2 - 1;
    const rr = r * Math.sqrt(1 - 0.55 * dz * dz);
    for (let y = -half; y <= half; y++) {
      for (let x = -half; x <= half; x++) {
        const d2 = x * x + y * y;
        if (d2 > rr * rr + 0.3) continue;
        let c = z === 0 ? (d2 > (rr - 1) * (rr - 1) ? look.bellyDark : look.belly) : t < 0.5 ? look.bodyDark : look.body;
        if (z === layers - 1 && z > 0) c = d2 <= (rr - 0.9) * (rr - 0.9) ? look.bodyLight : look.body;
        if (band && z > 0 && x < 0 && d2 > (rr - 1.1) * (rr - 1.1)) c = look.scale;
        put(v, x, y, z, c);
      }
    }
  }
  if (spine) put(v, 0, 0, layers, look.mane);
  return pieceOf(v, look.ink, true);
}

/** Rings by radius and kind, built once per look. */
export interface Rings {
  /** The ring nearest radius r. */
  get(r: number, band: boolean, spine: boolean): Piece;
}

export function ringsOf(look: Look): Rings {
  const made = new Map<number, Piece>();
  return {
    get(r, band, spine) {
      const q = Math.max(3, Math.round(r / RING_STEP));
      const key = q * 4 + (band ? 2 : 0) + (spine ? 1 : 0);
      let p = made.get(key);
      if (!p) {
        p = ringPiece(look, q * RING_STEP, band, spine);
        made.set(key, p);
      }
      return p;
    },
  };
}

/** A leaf-shaped tail tip, pointing back (west): gold with a pale end. */
export function leafPiece(look: Look, length: number, width: number): Piece {
  const hx = Math.ceil(length) + 1, hy = Math.ceil(width) + 1;
  const v = vox(hx, hy, 2);
  ball(v, -length * 0.35, 0, 0.5, length * 0.75, width, 0.6, (x) => (x < -length * 0.7 ? look.tip : x > 0 ? look.maneDark : look.mane));
  put(v, -length - 0.2, 0, 0, look.tip);
  return pieceOf(v, look.ink);
}
