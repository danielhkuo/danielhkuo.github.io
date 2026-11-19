// Matching pinned projects to reserved landmark sites (design 5.6). Build-time
// only; never touches terrain.

import { hashString } from "../core/hash.ts";
import { torusDist } from "../core/torus.ts";

export type LandmarkType = "abbey" | "town" | "lighthouse" | "windmill" | "bridge" | "cathedral" | "yew";
export type FeatureKind = "wayside-cross" | "sheepfold" | "jetty";

export interface Site {
  id: string;
  type: LandmarkType;
  /** World cells. */
  x: number;
  y: number;
}

export interface Assignments {
  /** site id → repository name. The abbey is never listed: it holds the terminal. */
  bySite: Record<string, string>;
  /** Free site id → the small unnamed feature it holds. */
  features: Record<string, FeatureKind>;
}

const NON_ABBEY_TYPE_ORDER: readonly LandmarkType[] = [
  "town",
  "lighthouse",
  "windmill",
  "bridge",
  "cathedral",
  "yew",
];

/** Feature for an unoccupied site: jetty on lighthouse/town/bridge sites, sheepfold on windmill/yew, a wayside cross elsewhere. */
export function featureFor(type: LandmarkType): FeatureKind {
  switch (type) {
    case "lighthouse":
    case "town":
    case "bridge":
      return "jetty";
    case "windmill":
    case "yew":
      return "sheepfold";
    case "cathedral":
    case "abbey":
      return "wayside-cross";
  }
}

function insertionSortStrings(items: readonly string[]): string[] {
  const out = items.slice();
  for (let i = 1; i < out.length; i++) {
    const key = out[i];
    let j = i - 1;
    while (j >= 0 && out[j] > key) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = key;
  }
  return out;
}

function siteById(sites: readonly Site[]): Map<string, Site> {
  const m = new Map<string, Site>();
  for (const s of sites) m.set(s.id, s);
  return m;
}

function typesWithFreeSites(sites: readonly Site[], occupied: ReadonlySet<string>): LandmarkType[] {
  const hasFree = new Map<LandmarkType, boolean>();
  for (const t of NON_ABBEY_TYPE_ORDER) hasFree.set(t, false);
  for (const s of sites) {
    if (s.type === "abbey") continue;
    if (!occupied.has(s.id)) hasFree.set(s.type, true);
  }
  const out: LandmarkType[] = [];
  for (const t of NON_ABBEY_TYPE_ORDER) {
    if (hasFree.get(t)) out.push(t);
  }
  return out;
}

function hashTypeChoice(repo: string, available: readonly LandmarkType[]): LandmarkType {
  const idx = hashString(repo) % available.length;
  return available[idx]!;
}

function resolveWantedType(
  repo: string,
  config: Readonly<Record<string, LandmarkType>>,
  available: readonly LandmarkType[],
  freeOfType: (t: LandmarkType) => boolean,
): LandmarkType | null {
  if (available.length === 0) return null;
  const fromConfig = config[repo];
  if (fromConfig !== undefined && freeOfType(fromConfig)) return fromConfig;
  return hashTypeChoice(repo, available);
}

function freeSitesOfType(
  sites: readonly Site[],
  occupied: ReadonlySet<string>,
  type: LandmarkType,
): Site[] {
  const out: Site[] = [];
  for (const s of sites) {
    if (s.type !== type) continue;
    if (occupied.has(s.id)) continue;
    out.push(s);
  }
  for (let i = 1; i < out.length; i++) {
    const key = out[i];
    let j = i - 1;
    while (j >= 0 && out[j].id > key.id) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = key;
  }
  return out;
}

function minDistToOccupied(
  site: Site,
  occupiedSites: readonly Site[],
  n: number,
): number {
  let minD = Infinity;
  for (const o of occupiedSites) {
    const d = torusDist(site.x, site.y, o.x, o.y, n);
    if (d < minD) minD = d;
  }
  return minD;
}

function pickFarthestSite(
  candidates: readonly Site[],
  occupiedSites: readonly Site[],
  n: number,
): Site | null {
  if (candidates.length === 0) return null;
  let best: Site | null = null;
  let bestMin = -Infinity;
  for (const site of candidates) {
    const minD = minDistToOccupied(site, occupiedSites, n);
    if (best === null || minD > bestMin || (minD === bestMin && site.id < best.id)) {
      best = site;
      bestMin = minD;
    }
  }
  return best;
}

/** Indices of repos not yet assigned, in code-unit order. */
function unassignedReposSorted(repos: readonly string[], assignedRepos: ReadonlySet<string>): string[] {
  const rest: string[] = [];
  for (const r of repos) {
    if (!assignedRepos.has(r)) rest.push(r);
  }
  return insertionSortStrings(rest);
}

export function assignSites(
  sites: readonly Site[],
  repos: readonly string[],
  config: Readonly<Record<string, LandmarkType>>,
  previous: Assignments | null,
  n: number,
): Assignments {
  const byId = siteById(sites);
  const repoSet = new Set(repos);

  const bySite: Record<string, string> = {};
  const occupied = new Set<string>();

  if (previous) {
    for (const [siteId, repo] of Object.entries(previous.bySite)) {
      const site = byId.get(siteId);
      if (site === undefined) continue;
      if (site.type === "abbey") continue;
      if (!repoSet.has(repo)) continue;
      bySite[siteId] = repo;
      occupied.add(siteId);
    }
  }

  const assignedRepos = new Set(Object.values(bySite));
  const abbey = sites.find((s) => s.type === "abbey");

  const occupiedForDist = (): Site[] => {
    const list: Site[] = [];
    if (abbey !== undefined) list.push(abbey);
    for (const id of occupied) {
      const s = byId.get(id);
      if (s !== undefined) list.push(s);
    }
    return list;
  };

  const freeOfType = (t: LandmarkType): boolean => {
    for (const s of sites) {
      if (s.type === t && !occupied.has(s.id)) return true;
    }
    return false;
  };

  for (const repo of unassignedReposSorted(repos, assignedRepos)) {
    const available = typesWithFreeSites(sites, occupied);
    const wanted = resolveWantedType(repo, config, available, freeOfType);
    if (wanted === null) continue;

    const candidates = freeSitesOfType(sites, occupied, wanted);
    const chosen = pickFarthestSite(candidates, occupiedForDist(), n);
    if (chosen === null) continue;

    bySite[chosen.id] = repo;
    occupied.add(chosen.id);
    assignedRepos.add(repo);
  }

  const features: Record<string, FeatureKind> = {};
  for (const s of sites) {
    if (s.type === "abbey") continue;
    if (s.id in bySite) continue;
    features[s.id] = featureFor(s.type);
  }

  return { bySite, features };
}