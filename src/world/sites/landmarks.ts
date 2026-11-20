// The landmarks a flight can land at: the abbey, the hall, and one stop for each of the five.

import type { Project } from "../../lib/projects.ts";
import type { PlaceType } from "./assign.ts";
import { isStopKey, STOPS, type StopKey } from "../story/stops.ts";

/** A project as the hall shows it: one Markdown file in projects/, read at build time (src/lib/projects.ts). */
export type HallProject = Project;

/** What a landmark holds: About Me at the abbey, every project at the hall, or one stop. */
export type Holding = { kind: "about" } | { kind: "hall"; projects: HallProject[] } | { kind: "stop"; stop: StopKey };

export interface Landmark {
  /** The site's id in the manifest, or `curio-<key>` when the stop comes from the places file. */
  id: string;
  type: PlaceType;
  /** World cells. */
  x: number;
  y: number;
  holds: Holding;
}

/** Everything the page needs to offer landings, for one world. */
export interface LandmarkSet {
  worldId: string;
  n: number;
  landmarks: Landmark[];
}

const KINDS = ["abbey", "town", "lighthouse", "windmill", "bridge", "cathedral", "yew", "hall", "curio"] as const;

function kindOf(type: string): PlaceType | null {
  for (const kind of KINDS) if (kind === type) return kind;
  return null;
}

/** A copy of `items` in `order`, stable: an insertion sort (Array.prototype.sort is not the same in every engine). */
function sortedBy<T>(items: readonly T[], order: (a: T, b: T) => number): T[] {
  const out = items.slice();
  for (let i = 1; i < out.length; i++) {
    const v = out[i];
    let j = i - 1;
    while (j >= 0 && order(out[j], v) > 0) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = v;
  }
  return out;
}

/** Lowest `order` first; a tie goes by name, in code-unit order. */
function ordered(projects: readonly HallProject[]): HallProject[] {
  return sortedBy(projects, (a, b) => {
    if (a.order < b.order) return -1;
    if (a.order > b.order) return 1;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
}

interface ManifestSite {
  id: string;
  type: string;
  x: number;
  y: number;
}

function firstOf(sites: readonly ManifestSite[], type: string): ManifestSite | undefined {
  for (const s of sites) if (s.type === type) return s;
  return undefined;
}

function siteNamed(sites: readonly ManifestSite[], id: string): ManifestSite | undefined {
  for (const s of sites) if (s.id === id) return s;
  return undefined;
}

function located(site: ManifestSite | undefined): { id: string; type: PlaceType; x: number; y: number } | null {
  if (!site) return null;
  const type = kindOf(site.type);
  if (!type) return null;
  return { id: site.id, type, x: site.x, y: site.y };
}

/** The stop key of a curio site id `curio-<key>`, or null when the id names no stop. */
function curioKey(id: string): StopKey | null {
  const prefix = "curio-";
  if (!id.startsWith(prefix)) return null;
  const key = id.slice(prefix.length);
  return isStopKey(key) ? key : null;
}

/**
 * Stops from a places file for this world. Unknown input, a file for another world, unknown keys and
 * coordinates that are not finite numbers yield nothing, and never throw.
 */
function placedStops(places: unknown, worldId: string): Map<StopKey, { x: number; y: number }> {
  const out = new Map<StopKey, { x: number; y: number }>();
  if (typeof places !== "object" || places === null) return out;
  const file = places as { worldId?: unknown; stops?: unknown };
  if (file.worldId !== worldId) return out;
  if (typeof file.stops !== "object" || file.stops === null) return out;
  const stops = file.stops as Record<string, unknown>;
  for (const stop of STOPS) {
    const spot = stops[stop.key];
    if (typeof spot !== "object" || spot === null) continue;
    const point = spot as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number") continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    out.set(stop.key, { x: point.x, y: point.y });
  }
  return out;
}

/**
 * The abbey, the hall, and one landmark per stop. A site of type `hall` is the hall; otherwise `town-0`,
 * otherwise the first town. A manifest curio whose id is `curio-<key>` wins; once any stop has one, the
 * places file is not used.
 */
export function landmarksFor(
  manifest: { worldId: string; n: number; sites: readonly ManifestSite[] },
  projects: readonly HallProject[],
  places: unknown,
): { set: LandmarkSet } {
  const sites = manifest.sites;
  const landmarks: Landmark[] = [];
  const abbey = located(firstOf(sites, "abbey"));
  if (abbey) landmarks.push({ ...abbey, holds: { kind: "about" } });
  const hall = located(firstOf(sites, "hall")) ?? located(siteNamed(sites, "town-0")) ?? located(firstOf(sites, "town"));
  if (hall) landmarks.push({ ...hall, holds: { kind: "hall", projects: ordered(projects) } });

  const curios = new Map<StopKey, ManifestSite>();
  for (const s of sites) {
    if (s.type !== "curio") continue;
    const key = curioKey(s.id);
    if (!key || curios.has(key)) continue;
    curios.set(key, s);
  }
  if (curios.size > 0) {
    for (const stop of STOPS) {
      const s = curios.get(stop.key);
      if (!s) continue;
      landmarks.push({ id: s.id, type: "curio", x: s.x, y: s.y, holds: { kind: "stop", stop: stop.key } });
    }
  } else {
    const points = placedStops(places, manifest.worldId);
    for (const stop of STOPS) {
      const point = points.get(stop.key);
      if (!point) continue;
      landmarks.push({ id: `curio-${stop.key}`, type: "curio", x: point.x, y: point.y, holds: { kind: "stop", stop: stop.key } });
    }
  }

  return { set: { worldId: manifest.worldId, n: manifest.n, landmarks } };
}

const KIND_NAMES: Record<PlaceType, string> = {
  abbey: "abbey",
  town: "town",
  lighthouse: "lighthouse",
  windmill: "windmill",
  bridge: "bridge",
  cathedral: "ruined cathedral",
  yew: "churchyard yew",
  hall: "hall",
  curio: "curio",
};

/** The landmark's kind as the page names it. */
export function kindName(type: PlaceType): string {
  return KIND_NAMES[type];
}

/** The discovery a landing logs: the abbey, the hall, or the stop. */
export function discoveryOf(l: Landmark): { id: string; label: string } {
  if (l.holds.kind === "about") return { id: "landmark:abbey", label: "The abbey: About me" };
  if (l.holds.kind === "hall") return { id: "landmark:hall", label: "The hall: every project" };
  const key = l.holds.stop;
  const name = STOPS.find((s) => s.key === key)?.name ?? key;
  return { id: `story:${key}`, label: name.charAt(0).toUpperCase() + name.slice(1) };
}
