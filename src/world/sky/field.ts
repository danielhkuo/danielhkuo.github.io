// Where the clouds are: scattered over the torus from the seed, thinned by a broad
// weather pattern so some regions are clear and some overcast, drifting with one wind.

import type { CloudShape } from "./shapes.ts";

export type CloudLayer = "low" | "bank" | "high";

/** One cloud: its shape (index into the shapes), where it was at t = 0 (cells), its layer, and whether it is mirrored. */
export interface Cloud {
  shape: number;
  x: number;
  y: number;
  layer: CloudLayer;
  flip: boolean;
}

export interface SkyField {
  n: number;
  clouds: Cloud[];
  /** Cells a second; low clouds and banks drift with `wind`, high streaks with `highWind`. */
  wind: { x: number; y: number };
  highWind: { x: number; y: number };
}

/** Height of each layer, in units: it only lifts the sprite on screen (screenY = 0.8·y − alt). */
export const LOW_ALT = 40;
export const BANK_ALT = 60;
export const HIGH_ALT = 140;

/**
 * Low clouds use heap and wisp shapes, banks use bank shapes, high streaks (only when `high`) use streak shapes.
 * Low cloud covers 15–35 % of a view on average; banks stand at least 700 cells apart; wind is 2–4 cells a second.
 */
export function makeField(seed: number, n: number, shapes: readonly CloudShape[], high: boolean): SkyField {
  void seed;
  void n;
  void shapes;
  void high;
  throw new Error("not implemented");
}

/** Where cloud `c` is at time `t` seconds, wrapped into [0, n): exact however large t is. */
export function cloudAt(field: SkyField, c: Cloud, t: number): { x: number; y: number } {
  void field;
  void c;
  void t;
  throw new Error("not implemented");
}
