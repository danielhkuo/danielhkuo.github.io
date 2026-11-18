// The live layers the world runs, in order: one list for the flight page and the frame-strip tool.

import type { Manifest } from "../pack/manifest.ts";
import type { LiveLayer } from "./live.ts";
import { lifeLayer } from "./life.ts";
import { sightsLayer } from "./sights.ts";
import { waterLayer } from "./water.ts";
import { windLayer } from "./wind.ts";

export interface LayerContext {
  seed: number;
  n: number;
  sites: Manifest["sites"];
}

/** Every live layer, in drawing order. Add new layers here; the page and `npm run world:live` both use this list. */
export function makeLayers(ctx: LayerContext): LiveLayer[] {
  return [waterLayer(ctx.seed), windLayer(ctx.seed), lifeLayer(ctx), sightsLayer(ctx)];
}
