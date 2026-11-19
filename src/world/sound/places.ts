// The fixed sites and anchors the sound needs, from what the live layers are handed (design §1.3). Pure.

import type { LayerContext } from "../live/registry.ts";
import { wheelersOf } from "../live/life.ts";
import type { Places } from "./types.ts";

/**
 * Places from a LayerContext. The wheeling gulls are left empty here: they come from live/life.ts's `wheelersOf`,
 * which is exported with the gulls' phase.
 */
export function placesOf(ctx: LayerContext, worldId: string): Places {
  const at = (type: string) => ctx.sites.filter((s) => s.type === type).map((s) => ({ x: s.x, y: s.y }));
  return {
    worldId,
    seed: ctx.seed,
    n: ctx.n,
    forced: ctx.forceSights === true,
    abbeys: at("abbey"),
    towns: at("town"),
    lighthouses: at("lighthouse"),
    gulls: wheelersOf(ctx.sites, ctx.seed),
    wonders: (ctx.wonders ?? []).map((w) => ({ type: w.type, x: w.x, y: w.y, level: w.level, height: w.height, anchors: { ...w.anchors } })),
  };
}
