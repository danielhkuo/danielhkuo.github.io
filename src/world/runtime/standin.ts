// The stand-in flier: a small vermilion kite and its shadow, depth-tested
// against the land so a hill to its south hides it. It holds the dragon's place
// until the dragon project.

import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "./flight.ts";
import type { WorldView } from "./view.ts";

/** Packed RGBA (ABGR in memory): the kite's fill and outline. */
export const FLIER_FILL = 0xff2b3fcf;
export const FLIER_INK = 0xff1d2228;
/** Side of the sprite's box, pixels. */
export const FLIER_SIZE = 11;
/** Cells the shadow moves south-east per unit of height over the ground (the sun's slope). */
export const SHADOW_SLOPE = 0.354;
/** Of 256: how much of a pixel's colour the shadow keeps. */
export const SHADOW_KEEP = 166;
/** A pixel of the flier shows unless the land drawn there lies more than this many rows nearer the viewer. */
export const DEPTH_SLACK = 1;

/**
 * Draws the shadow, then the kite. The kite is centred on the flier's screen position (x − rect.x,
 * 0.8·y − alt − rect.y), pointing along its heading in one of 16 directions, filled FLIER_FILL with a FLIER_INK
 * outline; each of its pixels is drawn only where `depthAt` ≤ y + DEPTH_SLACK. The shadow is a small dark ellipse on
 * the ground at (x, y) + SHADOW_SLOPE · (alt − ground) cells along both axes; each shadow pixel keeps SHADOW_KEEP/256
 * of the colour under it and is drawn only where `depthAt` is within 3 rows of the shadow's own row.
 */
export function drawFlier(out: Uint32Array, rect: ViewRect, s: FlightState, view: Pick<WorldView, "depthAt" | "groundHeight">): void {
  void out;
  void rect;
  void s;
  void view;
  throw new Error("not implemented");
}
