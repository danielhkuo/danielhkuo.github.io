// A landmark's anchor: its own building, which the dragon coils round when it lands. Read from the structures the core
// carries (gen/built.ts), so it is the building as baked, wherever on its pad it stands.

import { torusDelta, wrap } from "../core/torus.ts";
import type { LandmarkType } from "./assign.ts";

/** The parts of a structure (gen/built.ts) the anchor reads. */
export interface StructureLike {
  /** North-west corner cell and size in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  base: number;
  /** Planted things (groves, orchards) are never an anchor. */
  onGround?: boolean;
  /** Per cell: height over `base`. */
  top: ArrayLike<number>;
}

export interface Anchor {
  /** Centre of the building's footprint, world cells in [0, n). */
  x: number;
  y: number;
  /** Half the footprint, east–west and north–south, cells. */
  halfW: number;
  halfD: number;
  /** Its tallest cell over its own base. */
  height: number;
}

/** How far from the site's point its building may stand, cells. The town's point is its pad, not its bell tower. */
const SEARCH: Record<LandmarkType, number> = {
  abbey: 24, town: 48, lighthouse: 24, windmill: 24, bridge: 24, cathedral: 24, yew: 24,
  hospice: 24, stave: 24, hermitage: 24, monastery: 24, roundchurch: 24, chapel: 24,
};

/** The coil's radius when nothing is known of the building, by kind (the sprite boxes of design 5.9). */
const FALLBACK: Record<LandmarkType, number> = {
  abbey: 23, town: 9, lighthouse: 9, windmill: 10.4, bridge: 20, cathedral: 23, yew: 22,
  hospice: 14.3, stave: 15.4, hermitage: 10.7, monastery: 21.2, roundchurch: 12.5, chapel: 11.5,
};

/** The coil's radius: the body's own width clear of the walls. */
const CLEAR = 4;
export const REST_MIN = 9;
export const REST_MAX = 26;

/**
 * The tallest standing structure (its tallest cell over its own base) whose footprint centre lies within the site's
 * search square, on the torus; of two as tall, the nearer. Null when nothing stands there.
 */
export function anchorOf(site: { x: number; y: number; type: LandmarkType }, structures: readonly StructureLike[], n: number): Anchor | null {
  const reach = SEARCH[site.type];
  let best: Anchor | null = null;
  let bestD = Infinity;
  for (const s of structures) {
    if (s.onGround) continue;
    const dx = torusDelta(site.x, s.x + s.w / 2, n), dy = torusDelta(site.y, s.y + s.h / 2, n);
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    let height = 0;
    for (let i = 0; i < s.top.length; i++) if (s.top[i] > height) height = s.top[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (best && (height < best.height || (height === best.height && d >= bestD))) continue;
    best = { x: wrap(site.x + dx, n), y: wrap(site.y + dy, n), halfW: s.w / 2, halfD: s.h / 2, height };
    bestD = d;
  }
  return best;
}

/** Where the coil comes to rest: the building's half-diagonal plus the body's width, within [REST_MIN, REST_MAX]. */
export function restRadius(anchor: Anchor | null, type: LandmarkType): number {
  const r = anchor ? Math.sqrt(anchor.halfW * anchor.halfW + anchor.halfD * anchor.halfD) + CLEAR : FALLBACK[type];
  return Math.min(REST_MAX, Math.max(REST_MIN, r));
}
