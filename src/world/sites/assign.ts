// Landmark kinds, and the small feature a free site holds. The generator imports these.

export type LandmarkType = "abbey" | "town" | "lighthouse" | "windmill" | "bridge" | "cathedral" | "yew";
/** What the flight can land at: the generator's kinds, and the hall and the quest's stops (curios), which it does not site yet. */
export type PlaceType = LandmarkType | "hall" | "curio";
export type FeatureKind = "wayside-cross" | "sheepfold" | "jetty";

export interface Site {
  id: string;
  type: LandmarkType;
  /** World cells. */
  x: number;
  y: number;
}

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
