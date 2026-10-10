// Build-time only: turns a repo name into the fish the browser will draw.
// fishdraw takes 40–400ms a fish (occasionally over a second) and the outline
// trace about as long again, so none of this may run in the page.

import { approx_poly_dp, fish, generate_params, reseed, type FishPartName, type Polyline } from "./fishdraw.mjs";
import { softened } from "./geometry.ts";
import { traceSilhouette } from "./silhouette.ts";
import type { FishData } from "./types.ts";

/** Body, fins and head: the lines that say "fish". */
const INK: FishPartName[] = ["bd", "f0", "f1", "f2", "f3", "f4", "f5", "fh"];
/** Shadow, pattern and speckle passes: drawn in the accent colour. */
const HATCH: FishPartName[] = ["sh", "sh2", "sh3"];

/** fishdraw's own clean-up tolerance, in drawing units. */
const STROKE_TOLERANCE = 0.1;
/**
 * How far the soft copy of the outline is blurred, and how finely it is
 * sampled to do it, in drawing units — about 10px and 1px on a card.
 */
const SOFT_SIGMA = 16;
const SOFT_SPACING = 1.5;

/**
 * Shipped coordinates are whole numbers of half a drawing unit — about an
 * eighth of a pixel on a card, finer than a 1px line can show — which keeps
 * every number in the file to a digit or two.
 */
const GRID = 2;
const snap = (v: number) => Math.round(v * GRID);

/**
 * Polylines as one SVG path: each starts with an absolute M and continues as
 * relative line-tos, which roughly halves the bytes of absolute coordinates.
 * Deltas are taken between already-snapped points, so rounding cannot drift.
 */
function pathData(strokes: Polyline[], ox: number, oy: number): string {
  let d = "";
  for (const stroke of strokes) {
    let px = snap(stroke[0][0] - ox);
    let py = snap(stroke[0][1] - oy);
    d += `M${px} ${py}l`;
    let first = true;
    for (let i = 1; i < stroke.length; i++) {
      const x = snap(stroke[i][0] - ox);
      const y = snap(stroke[i][1] - oy);
      if (x === px && y === py) continue;
      const dx = x - px;
      const dy = y - py;
      // A minus sign already separates two numbers; anything else needs a space.
      d += (first || dx < 0 ? "" : " ") + dx + (dy < 0 ? "" : " ") + dy;
      first = false;
      px = x;
      py = y;
    }
    // A stroke that snapped down to a single point: draw it as a dot, not a bare "l".
    if (first) d += "0 0";
  }
  return d;
}

/** Draw the fish for a name. The name is the seed, so a project always gets the same fish. */
export function drawFish(name: string): FishData {
  reseed(name);
  fish(generate_params());
  const { parts, polys } = fish;

  const tidy = (names: FishPartName[]) =>
    names
      .flatMap((part) => parts[part])
      .map((stroke) => approx_poly_dp(stroke, STROKE_TOLERANCE))
      .filter((stroke) => stroke.length >= 2);
  const ink = tidy(INK);
  const hatch = tidy(HATCH);

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of [...ink, ...hatch]) {
    for (const [x, y] of stroke) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  const outline = traceSilhouette(polys);
  const soft = softened(outline, SOFT_SIGMA, SOFT_SPACING);
  const flat = (pts: [number, number][]) => pts.flatMap(([x, y]) => [snap(x - x0), snap(y - y0)]);

  return {
    w: snap(x1 - x0),
    h: snap(y1 - y0),
    ink: pathData(ink, x0, y0),
    hatch: pathData(hatch, x0, y0),
    sil: flat(outline),
    soft: flat(soft),
  };
}

const cache = new Map<string, FishData>();

/** drawFish, remembered: the dev server asks for the same fish on every request. */
export function buildFish(name: string): FishData {
  let data = cache.get(name);
  if (!data) {
    data = drawFish(name);
    cache.set(name, data);
  }
  return data;
}
