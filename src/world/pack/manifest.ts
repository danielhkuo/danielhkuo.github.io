// The manifest the page reads first: a format-2 world is a core plus one file per region.

import { torusDelta, wrap } from "../core/torus.ts";
import type { PlacedSite } from "../gen/sites.ts";

/** Where the flight begins: a point and the unit vector it heads along. */
export interface Start {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** One region file. The manifest lists them row-major (ry, then rx). */
export interface RegionFile {
  rx: number;
  ry: number;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: 2;
  worldId: string;
  n: number;
  seed: number;
  /** Cells a side of one region. */
  regionCells: number;
  core: { bytes: number; sha256: string };
  regions: RegionFile[];
  /** Cells per occlusion block. */
  block: number;
  sites: { id: string; type: string; x: number; y: number }[];
  start: Start;
}

/** How far out to sea from the home river's mouth the flight begins, in cells. */
export const START_OFFSHORE = 150;
/** Without a town, the flight begins this far south of the abbey. */
export const START_SOUTH = 300;

/** +0, never −0: JSON and deep equality both reject a signed zero. */
function plain(v: number): number {
  return v === 0 ? 0 : v;
}

function at(x: number, y: number, dx: number, dy: number): Start {
  return { x: plain(x), y: plain(y), dx: plain(dx), dy: plain(dy) };
}

/**
 * The start: START_OFFSHORE cells past the town's river mouth (`harbour.mouthX/mouthY`) along the line from the abbey
 * to the mouth, heading toward the abbey. Without a town with a harbour, START_SOUTH cells south of the abbey heading
 * north; without an abbey, the world's middle heading north. Positions wrap into [0, n); distances are torus distances.
 */
export function startOf(sites: readonly PlacedSite[], n: number): Start {
  let abbey: PlacedSite | undefined;
  let town: PlacedSite | undefined;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if (!abbey && s.type === "abbey") abbey = s;
    if (!town && s.type === "town" && s.harbour) town = s;
  }
  if (!abbey) return at(n / 2, n / 2, 0, -1);
  if (!town?.harbour) return at(wrap(abbey.x, n), wrap(abbey.y + START_SOUTH, n), 0, -1);

  const mouthX = town.harbour.mouthX;
  const mouthY = town.harbour.mouthY;
  const dx = torusDelta(abbey.x, mouthX, n);
  const dy = torusDelta(abbey.y, mouthY, n);
  const len = Math.sqrt(dx * dx + dy * dy);
  const x = len > 0 ? wrap(mouthX + (START_OFFSHORE * dx) / len, n) : wrap(mouthX, n);
  const y = len > 0 ? wrap(mouthY + (START_OFFSHORE * dy) / len, n) : wrap(mouthY, n);
  const hx = torusDelta(x, abbey.x, n);
  const hy = torusDelta(y, abbey.y, n);
  const hlen = Math.sqrt(hx * hx + hy * hy);
  if (!(hlen > 0)) return at(x, y, 0, -1);
  return at(x, y, hx / hlen, hy / hlen);
}
