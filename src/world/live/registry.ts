// The live layers the world runs, in order: one list for the flight page and the frame-strip tool.

import type { Manifest } from "../pack/manifest.ts";
import type { LiveLayer } from "./live.ts";
import { lifeLayer } from "./life.ts";
import { rareLayer, wakeLayer } from "./rare.ts";
import type { Land } from "./routes.ts";
import { sightsLayer } from "./sights.ts";
import { waterLayer } from "./water.ts";
import { windLayer } from "./wind.ts";

export interface LayerContext {
  seed: number;
  n: number;
  sites: Manifest["sites"];
  /** The ground grid (the flight data has it): boats plan their routes round the land on it. Without it, all is sea. */
  land?: Land;
  /** Reports a rare sight the visitor has seen (a stable id and a short caption); the page remembers and shows it. */
  discover?: (id: string, label: string) => void;
  /** Shows every rare sight all the time, near the view's centre where the land allows: a preview (?sights=all). */
  forceSights?: boolean;
}

/** Every live layer, in drawing order. Add new layers here; the page and `npm run world:live` both use this list. */
export function makeLayers(ctx: LayerContext): LiveLayer[] {
  return [waterLayer(ctx.seed), windLayer(ctx.seed), lifeLayer(ctx), sightsLayer(ctx), rareLayer(ctx), wakeLayer()];
}
