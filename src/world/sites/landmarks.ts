// The landmarks the flight page offers to land at, worked out at build time: which site holds which pinned project,
// kept sticky by a committed file (design 5.6), and the register that points from any landmark to the others.

import { torusDelta } from "../core/torus.ts";
import { CRUISE } from "../runtime/flight.ts";
import { assignSites, type Assignments, type LandmarkType } from "./assign.ts";

/** A pinned project as the Codex shows it. */
export interface ProjectEntry {
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
  language: string | null;
  stars: number;
  forks: number;
  /** ISO 8601. */
  updatedAt: string;
}

/** What a landmark holds: About Me (the abbey), a project, or nothing yet. */
export type Holding = { kind: "about" } | { kind: "project"; project: ProjectEntry } | { kind: "none" };

export interface Landmark {
  /** The site's id in the manifest. */
  id: string;
  type: LandmarkType;
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

/** The fields of a pinned repository (lib/github.ts) the Codex reads. */
export interface RepoLike {
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
  primaryLanguage: { name: string } | null;
  stargazerCount: number;
  forkCount: number;
  updatedAt: string;
}

const TYPES: readonly LandmarkType[] = ["abbey", "town", "lighthouse", "windmill", "bridge", "cathedral", "yew"];

function isLandmarkType(t: string): t is LandmarkType {
  return (TYPES as readonly string[]).includes(t);
}

/** A repository as the Codex shows it. GitHub reports "no homepage" as an empty string as well as null. */
export function entryOf(r: RepoLike): ProjectEntry {
  return {
    name: r.name,
    description: r.description,
    url: r.url,
    homepageUrl: r.homepageUrl ? r.homepageUrl : null,
    language: r.primaryLanguage?.name ?? null,
    stars: r.stargazerCount,
    forks: r.forkCount,
    updatedAt: r.updatedAt,
  };
}

/**
 * The sticky file's assignments when the file belongs to world `worldId`; null for another world or anything that is
 * not `{ worldId, bySite }`. Entries that are not strings are dropped.
 */
export function stickyFrom(file: unknown, worldId: string): Assignments | null {
  if (!file || typeof file !== "object") return null;
  const f = file as { worldId?: unknown; bySite?: unknown };
  if (f.worldId !== worldId) return null;
  if (!f.bySite || typeof f.bySite !== "object" || Array.isArray(f.bySite)) return null;
  const bySite: Record<string, string> = {};
  for (const [site, repo] of Object.entries(f.bySite)) if (typeof repo === "string") bySite[site] = repo;
  return { bySite, features: {} };
}

/** The sticky file's text for `bySite`: sites in code-unit order, so a change shows as a small diff. */
export function stickyText(worldId: string, bySite: Readonly<Record<string, string>>): string {
  const sorted: Record<string, string> = {};
  for (const site of Object.keys(bySite).sort()) sorted[site] = bySite[site];
  return `${JSON.stringify({ worldId, bySite: sorted }, null, 2)}\n`;
}

function sameAssignments(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/**
 * Matches `projects` to the manifest's sites (assign.ts), with the sticky file as the previous assignment when it
 * belongs to this world. `changed` is true when the file should be rewritten to the new `bySite`.
 */
export function landmarksFor(
  manifest: { worldId: string; n: number; sites: readonly { id: string; type: string; x: number; y: number }[] },
  projects: readonly ProjectEntry[],
  config: Readonly<Record<string, LandmarkType>>,
  sticky: unknown,
): { set: LandmarkSet; bySite: Record<string, string>; changed: boolean } {
  const sites = manifest.sites.flatMap((s) => (isLandmarkType(s.type) ? [{ id: s.id, type: s.type, x: s.x, y: s.y }] : []));
  const previous = stickyFrom(sticky, manifest.worldId);
  const { bySite } = assignSites(sites, projects.map((p) => p.name), config, previous, manifest.n);
  const byName = new Map(projects.map((p) => [p.name, p]));
  const landmarks: Landmark[] = sites.map((s) => {
    const name = bySite[s.id];
    const project = name === undefined ? undefined : byName.get(name);
    const holds: Holding = s.type === "abbey" ? { kind: "about" } : project ? { kind: "project", project } : { kind: "none" };
    return { ...s, holds };
  });
  return {
    set: { worldId: manifest.worldId, n: manifest.n, landmarks },
    bySite,
    changed: previous === null || !sameAssignments(previous.bySite, bySite),
  };
}

const KIND_NAMES: Record<LandmarkType, string> = {
  abbey: "abbey",
  town: "town",
  lighthouse: "lighthouse",
  windmill: "windmill",
  bridge: "bridge",
  cathedral: "ruined cathedral",
  yew: "churchyard yew",
};

/** The landmark's kind as the page names it. */
export function kindName(type: LandmarkType): string {
  return KIND_NAMES[type];
}

/**
 * The discovery a landing logs. A project is keyed by its repository (design 5.4), so a new world keeps it; the abbey
 * and an empty landmark by their own names.
 */
export function discoveryOf(l: Landmark): { id: string; label: string } {
  if (l.holds.kind === "project") return { id: `landmark:repo:${l.holds.project.name}`, label: `${l.holds.project.name}, at the ${kindName(l.type)}` };
  if (l.holds.kind === "about") return { id: "landmark:abbey", label: "The abbey: About me" };
  return { id: `landmark:site:${l.id}`, label: `The ${kindName(l.type)}` };
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"] as const;
export type Compass = (typeof COMPASS)[number];

export interface RegisterLine {
  id: string;
  type: LandmarkType;
  /** The project's name, or "About me" at the abbey. */
  title: string;
  compass: Compass;
  /** Seconds of flight at cruising speed, the short way round the world. */
  seconds: number;
}

/** Where the abbey and every project lie from `here`, nearest first; `here` itself is left out. */
export function registerFrom(here: { id: string; x: number; y: number }, set: LandmarkSet): RegisterLine[] {
  const lines: { line: RegisterLine; d: number }[] = [];
  for (const l of set.landmarks) {
    if (l.id === here.id || l.holds.kind === "none") continue;
    const dx = torusDelta(here.x, l.x, set.n), dy = torusDelta(here.y, l.y, set.n);
    const d = Math.hypot(dx, dy);
    // y grows southward, so the angle runs clockwise from east, as COMPASS does.
    const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    const title = l.holds.kind === "project" ? l.holds.project.name : "About me";
    lines.push({ line: { id: l.id, type: l.type, title, compass: COMPASS[sector], seconds: Math.round(d / CRUISE) }, d });
  }
  lines.sort((a, b) => a.d - b.d || (a.line.id < b.line.id ? -1 : 1));
  return lines.map((l) => l.line);
}
