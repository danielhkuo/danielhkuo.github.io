// The manifest beside world.bin: what the page reads first.

import type { PlacedSite } from "../gen/sites.ts";
import type { WorldSection } from "./world.ts";

/** Where the flight begins: a point and the unit vector it heads along. */
export interface Start {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface Manifest {
  format: 1;
  worldId: string;
  n: number;
  seed: number;
  /** Length of world.bin. */
  bytes: number;
  sections: WorldSection[];
  /** Cells per occlusion block. */
  block: number;
  sites: { id: string; type: string; x: number; y: number }[];
  start: Start;
}

/** How far out to sea from the home river's mouth the flight begins, in cells. */
export const START_OFFSHORE = 150;
/** Without a town, the flight begins this far south of the abbey. */
export const START_SOUTH = 300;

/**
 * The start: START_OFFSHORE cells past the town's river mouth (`harbour.mouthX/mouthY`) along the line from the abbey
 * to the mouth, heading toward the abbey. Without a town with a harbour, START_SOUTH cells south of the abbey heading
 * north; without an abbey, the world's middle heading north. Positions wrap into [0, n); distances are torus distances.
 */
export function startOf(sites: readonly PlacedSite[], n: number): Start {
  void sites;
  void n;
  throw new Error("not implemented");
}
