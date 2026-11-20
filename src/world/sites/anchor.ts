// A landmark's anchor: its own building, which the dragon coils round when it lands. Read from the structures the core
// carries (gen/built.ts), so it is the building as baked, wherever on its pad it stands. A town's anchor is its
// harbour: round its bell tower the coil would lie among the houses, which hide all but scraps of it.

import { torusDelta, wrap } from "../core/torus.ts";
import type { LandmarkType } from "./assign.ts";
import type { Target } from "./landing.ts";

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
  /** The coil lies inside it (a harbour's water), not round it. */
  inside?: boolean;
}

/** The parts of a conform (gen/built.ts) the harbour reads. */
export interface ConformLike {
  kind: string;
  /** Centre and half-sizes, cells. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** How far from the site's point its building may stand, cells. The town's point is its pad, not its bell tower. */
const SEARCH: Record<LandmarkType, number> = { abbey: 24, town: 48, lighthouse: 24, windmill: 24, bridge: 24, cathedral: 24, yew: 24 };

/** The coil's radius when nothing is known of the building, by kind (the sprite boxes of design 5.9). */
const FALLBACK: Record<LandmarkType, number> = { abbey: 21, town: 6, lighthouse: 6, windmill: 8.4, bridge: 18, cathedral: 21, yew: 20 };

/** The coil's radius: the body's own width clear of the walls. */
const CLEAR = 2;
export const REST_MIN = 6;
export const REST_MAX = 26;
/** A town's harbour lies within this of its point, cells; and the widest a coil lies on its water. */
const HARBOUR_REACH = 150;
const HARBOUR_MAX = 7;

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

/**
 * A town's harbour: the widest dredged basin (by area) whose centre lies within HARBOUR_REACH of the site, on the
 * torus. Null when none is.
 */
export function harbourOf(site: { x: number; y: number }, conforms: readonly ConformLike[], n: number): Anchor | null {
  let best: Anchor | null = null;
  let bestArea = 0;
  for (const c of conforms) {
    if (c.kind !== "dredge") continue;
    const dx = torusDelta(site.x, c.x, n), dy = torusDelta(site.y, c.y, n);
    if (Math.abs(dx) > HARBOUR_REACH || Math.abs(dy) > HARBOUR_REACH) continue;
    const area = c.rx * c.ry;
    if (area <= bestArea) continue;
    best = { x: wrap(site.x + dx, n), y: wrap(site.y + dy, n), halfW: c.rx, halfD: c.ry, height: 0, inside: true };
    bestArea = area;
  }
  return best;
}

/**
 * Where the coil comes to rest. Round a building: its half-diagonal plus the body's width, within [REST_MIN,
 * REST_MAX]. Inside a harbour: the body's width clear of its quays, within [REST_MIN, HARBOUR_MAX].
 */
export function restRadius(anchor: Anchor | null, type: LandmarkType): number {
  if (anchor?.inside) return Math.min(HARBOUR_MAX, Math.max(REST_MIN, Math.min(anchor.halfW, anchor.halfD) - CLEAR));
  const r = anchor ? Math.sqrt(anchor.halfW * anchor.halfW + anchor.halfD * anchor.halfD) + CLEAR : FALLBACK[type];
  return Math.min(REST_MAX, Math.max(REST_MIN, r));
}

/**
 * Every landmark's resting place: the target the landing aims at, and the anchor it was taken from (null when the
 * built world has nothing there, and the site's own point stands in). A town rests in its harbour when it has one.
 */
export function restingPlaces(
  landmarks: readonly { id: string; type: LandmarkType; x: number; y: number }[],
  built: { structures: readonly StructureLike[]; conforms: readonly ConformLike[] } | undefined,
  n: number,
): { targets: Target[]; anchors: Map<string, Anchor | null> } {
  const targets: Target[] = [];
  const anchors = new Map<string, Anchor | null>();
  for (const l of landmarks) {
    const harbour = built && l.type === "town" ? harbourOf(l, built.conforms, n) : null;
    const a = harbour ?? (built ? anchorOf(l, built.structures, n) : null);
    anchors.set(l.id, a);
    targets.push({ id: l.id, x: a?.x ?? l.x, y: a?.y ?? l.y, radius: restRadius(a, l.type) });
  }
  return { targets, anchors };
}
