// The live layers the world runs, in order: one list for the flight page and the frame-strip tool.

import type { Manifest } from "../pack/manifest.ts";
import type { LiveLayer } from "./live.ts";
import { waterLayer } from "./water.ts";

export interface LayerContext {
  seed: number;
  n: number;
  sites: Manifest["sites"];
}

/** Every live layer, in drawing order. Add new layers here; the page and `npm run world:live` both use this list. */
export function makeLayers(ctx: LayerContext): LiveLayer[] {
  return [waterLayer(ctx.seed)];
}
