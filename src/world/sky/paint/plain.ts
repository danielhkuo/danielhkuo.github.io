// The placeholder painter: the lit colour everywhere, alpha from coverage.

import type { Painter } from "../sprite.ts";

export const paintPlain: Painter = (shape, inks, seed) => {
  void shape;
  void inks;
  void seed;
  throw new Error("not implemented");
};
