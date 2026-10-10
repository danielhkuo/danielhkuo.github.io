/**
 * One project's fish, as shipped to the browser in /fish.json. Coordinates are
 * whole numbers on a grid of half a fishdraw drawing unit, moved so the
 * strokes' bounding box starts at 0,0. Only proportions matter to the page: it
 * scales each fish to fit its card.
 */
export interface FishData {
  /** Width and height of the strokes' bounding box. */
  w: number;
  h: number;
  /** Outline and anatomy strokes, as SVG path data. */
  ink: string;
  /** Shading strokes — shadow, pattern, speckles — as SVG path data. */
  hatch: string;
  /** The closed outer silhouette, clockwise, as flat x,y pairs. */
  sil: number[];
  /** The same vertices on a low-passed copy of the silhouette: fins as soft bumps. */
  soft: number[];
}

/** Every pinned project's fish, keyed by repo name. */
export type FishSheet = Record<string, FishData>;
