// The ear: what is in the land around the dragon, as a Hearing (design §2). It runs only while sound is on (or
// ?soundlog), a pass every 100 ms of page time whatever the frame rate.
//
// This is its shape only. Wind and whoosh need no Hearing, so until the surf's phase the ear reports open, silent
// land; the bake scan (§2.1) and the coast scan (§2.2) are built there, behind this same `step`.

import { emptyHearing, type Hearing, type Pose } from "./types.ts";

/** What the ear layer kept from the frame the live layers saw. */
export interface Seen {
  bake: Uint32Array | null;
  rect: { x: number; y: number; w: number; h: number } | null;
  t: number;
}

export interface Ear {
  /** One frame's share of a pass. Returns the Hearing in force (the same object until the next pass publishes). */
  step(pose: Pose, seen: Seen): Hearing;
  hearing(): Hearing;
}

export function createEar(): Ear {
  const hearing = emptyHearing();
  return {
    step(pose) {
      hearing.t = pose.t;
      return hearing;
    },
    hearing: () => hearing,
  };
}
