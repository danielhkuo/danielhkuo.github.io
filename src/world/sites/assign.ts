// Matching pinned projects to reserved landmark sites (design 5.6). Build-time
// only; never touches terrain.

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

/** Feature for an unoccupied site: jetty on lighthouse/town/bridge sites, sheepfold on windmill/yew, a wayside cross elsewhere. */
export function featureFor(type: LandmarkType): FeatureKind {
  throw new Error("not implemented");
}

export function assignSites(
  sites: readonly Site[],
  repos: readonly string[],
  config: Readonly<Record<string, LandmarkType>>,
  previous: Assignments | null,
  n: number,
): Assignments {
  throw new Error("not implemented");
}
