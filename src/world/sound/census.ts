// The census (design §1.3, §5.3): which gulls the flier has just put up. The picture decides that from the flier's
// track alone (live/life.ts's `startledFor`), with no memory; this asks the same question of the same birds (the
// beaches' lattice of resting gulls, and the wheelers), so a bird sounds exactly when it is drawn taking off. Pure.

import { wrap } from "../core/torus.ts";
import { eachShoreGull, startledFor, wheeled, wheelerAt } from "../live/life.ts";
import type { LiveFrame } from "../live/live.ts";
import { worldRowAt } from "../live/sprites.ts";
import type { Pose, Startle, Wheeler } from "./types.ts";

/** A bird is reported while it has been up for less than this, seconds (the census runs several times in that). */
export const FRESH = 0.3;
/** Beach gulls are looked for within this many pixels of the flier's place in the frame; wheelers within this many cells. */
const SHORE_REACH = 64;
const WHEEL_REACH = 300;

export interface CensusFrame {
  bake: Uint32Array | null;
  rect: { x: number; y: number; w: number; h: number } | null;
}

/** Appends to `out` every gull startled within the last FRESH seconds. `out`'s objects are reused: `pool` holds them. */
export function censusStartles(frame: CensusFrame, pose: Pose, n: number, seed: number, wheelers: readonly Wheeler[], out: Startle[], pool: Startle[]): void {
  out.length = 0;
  const add = (key: number, x: number, y: number, tau: number, g: number) => {
    if (out.length >= 8) return;
    let s = pool[out.length];
    if (!s) s = pool[out.length] = { key: 0, x: 0, y: 0, t0: 0, g: 0 };
    s.key = key;
    s.x = x;
    s.y = y;
    s.t0 = pose.t - tau;
    s.g = g;
    out.push(s);
  };
  const bake = frame.bake, rect = frame.rect;
  // Low enough to startle anything at all? (Beaches are near sea level; the picture's LOW is 60.)
  if (bake && rect && pose.alt < 140 && bake.length >= rect.w * rect.h) {
    const f = { bake, rect } as unknown as LiveFrame;
    const px0 = Math.round(pose.x - rect.x), py0 = Math.round(0.8 * pose.y - pose.alt - rect.y);
    eachShoreGull(bake, rect, n, seed, px0, py0, SHORE_REACH, (px, py, g) => {
      const row = worldRowAt(f, px, py);
      const ground = 0.8 * row - (rect.y + py);
      const tau = startledFor(pose, n, rect.x + px, row, ground);
      if (tau >= 0 && tau < FRESH) add(g | 0, wrap(rect.x + px, n), wrap(row, n), tau, g);
    });
  }
  for (let k = 0; k < wheelers.length; k++) {
    const g = wheelers[k];
    const dx = g.x - pose.x, dy = g.y - pose.y;
    if (dx > WHEEL_REACH || dx < -WHEEL_REACH || dy > WHEEL_REACH || dy < -WHEEL_REACH) continue;
    wheelerAt(g, pose.t);
    const tau = startledFor(pose, n, wheeled.x, wheeled.y, wheeled.alt);
    if (tau >= 0 && tau < FRESH) add(g.h | 0, wheeled.x, wheeled.y, tau, g.h);
  }
}
