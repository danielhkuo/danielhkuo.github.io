// The manifest beside world.bin: what the page reads first.

import { torusDelta, wrap } from "../core/torus.ts";
import type { PlacedSite } from "../gen/sites.ts";
import type { PlacedWonder } from "../gen/wonders.ts";
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
  /** The wonders that stand in this world. Absent from a world built before there were any. */
  wonders?: ManifestWonder[];
  start: Start;
}

/** A wonder as the page reads it: where it stands and the points its moment needs. */
export interface ManifestWonder {
  id: string;
  type: string;
  /** Its focus, cells. */
  x: number;
  y: number;
  /** The height it stands on, and how far it stands above that. */
  level: number;
  height: number;
  /** Named points, cells: the quay, the track's ends, the pontoon. */
  anchors: Record<string, [number, number]>;
}

/** The manifest's entry for each placed wonder, every position wrapped into the world. */
export function manifestWonders(wonders: readonly PlacedWonder[], n: number): ManifestWonder[] {
  return wonders.map((w) => {
    const anchors: Record<string, [number, number]> = {};
    for (const [name, [x, y]] of Object.entries(w.anchors)) anchors[name] = [plain(wrap(x, n)), plain(wrap(y, n))];
    return { id: w.id, type: w.type, x: plain(wrap(w.x, n)), y: plain(wrap(w.y, n)), level: plain(w.level), height: w.height, anchors };
  });
}

/** The wonders a manifest lists: none for a world built before there were any, or when the field is malformed. */
export function wondersOf(m: Pick<Manifest, "wonders">): ManifestWonder[] {
  if (!Array.isArray(m.wonders)) return [];
  return m.wonders.filter((w) => w && typeof w.id === "string" && typeof w.type === "string" && Number.isFinite(w.x) && Number.isFinite(w.y));
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
