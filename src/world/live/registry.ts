// The live layers the world runs, in order: one list for the flight page and the frame-strip tool.

import type { Structure } from "../gen/built.ts";
import type { Manifest, ManifestWonder } from "../pack/manifest.ts";
import type { LiveLayer } from "./live.ts";
import { lifeLayer } from "./life.ts";
import { mistLayer } from "./mist.ts";
import { momentsLayer } from "./moments.ts";
import { nightLayer, nightLights } from "./night.ts";
import { splashLayer } from "../sky/rain.ts";
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
  /** Placed wonders, with the anchors their moments need. Without them, only the clock and the live-only wonders can show. */
  wonders?: readonly ManifestWonder[];
  /** Shows every rare sight all the time, near the view's centre where the land allows: a preview (?sights=all). */
  forceSights?: boolean;
  /** What people built (the core's structures): their windows and lamps light at night. Without them, only the stars. */
  structures?: readonly Structure[];
}

/** Every live layer, in drawing order. Add new layers here; the page and `npm run world:live` both use this list. */
export function makeLayers(ctx: LayerContext): LiveLayer[] {
  return [
    waterLayer(ctx.seed), windLayer(ctx.seed), splashLayer(ctx.seed), lifeLayer(ctx), sightsLayer(ctx), momentsLayer(ctx), rareLayer(ctx),
    wakeLayer(),
    // The mist's banks lie over what lives on the land, and the lamps shine through them.
    mistLayer(ctx.seed),
    nightLayer(ctx.seed, ctx.structures ? nightLights(ctx.structures, ctx.n) : undefined),
  ];
}
