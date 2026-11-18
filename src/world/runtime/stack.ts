// Sprite stacks: a small model drawn as a pile of pixel slices, each turned to the model's heading and lifted one
// pixel above the one under it. The dragon (and later the landmarks) are drawn this way, depth-tested against the land.

import type { ViewRect } from "../render/compose.ts";
import type { WorldView } from "./view.ts";

/** `layers` slices of w × h, bottom first, authored facing east (+x); rgba and alpha are layers·w·h, slice-major. */
export interface Stack {
  w: number;
  h: number;
  layers: number;
  rgba: Uint32Array;
  alpha: Uint8Array;
}

/** Of 256: how much of a pixel's colour a stack's shadow keeps. */
export const STACK_SHADOW_KEEP = 166;
/** Cells the shadow moves south-east per unit of height over the ground, as for the land. */
export const STACK_SHADOW_SLOPE = 0.354;

/**
 * Draws `s` centred on world (x, y) at `alt` units up: slice k's centre is at screen
 * (x − rect.x, 0.8·y − alt − k − rect.y), using the torus image nearest the view (x every n, bake rows every 0.8·n).
 * Each slice is turned by `heading` (radians, 0 east, π/2 south) about its centre, sampled nearest-neighbour by
 * inverse rotation, and drawn bottom slice first so higher slices cover lower ones. A pixel draws where its alpha > 0 and
 * view.depthAt(px, py) ≤ y′ + 1 (y′ is y moved to the chosen image). Clipped at the frame's edges.
 */
export function drawStack(
  out: Uint32Array, rect: ViewRect, view: Pick<WorldView, "depthAt">, s: Stack, x: number, y: number, alt: number, heading: number, n: number,
): void {
  void out; void rect; void view; void s; void x; void y; void alt; void heading; void n;
  throw new Error("not implemented");
}

/**
 * The shadow of `s` on the ground: the union of all slices' footprints, turned by `heading`, centred on the ground point
 * (x, y) + STACK_SHADOW_SLOPE · (alt − ground) along both axes, where ground = view.groundHeight(x, y). Each shadow pixel
 * keeps STACK_SHADOW_KEEP / 256 of each colour channel and is drawn only where view.depthAt is within 3 rows of the
 * shadow's own row. Drawn before the stack.
 */
export function drawStackShadow(
  out: Uint32Array, rect: ViewRect, view: Pick<WorldView, "depthAt" | "groundHeight">, s: Stack, x: number, y: number, alt: number, heading: number, n: number,
): void {
  void out; void rect; void view; void s; void x; void y; void alt; void heading; void n;
  throw new Error("not implemented");
}
