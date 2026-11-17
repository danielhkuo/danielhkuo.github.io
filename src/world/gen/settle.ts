// S10: what people built. Sites, pads, buildings, hamlets and roads, laid on
// the finished land.

import type { Terrain } from "./pipeline.ts";
import type { SiteFields } from "./sites.ts";

/** The fields siting reads, from the generator's stages. */
export function siteFieldsOf(t: Terrain): SiteFields {
  const { land, hydro, rivers, climate } = t;
  const stacks: { x: number; y: number; r: number; top: number }[] = [];
  for (const s of land.stamps) if (s.kind === "stack") stacks.push({ x: s.x, y: s.y, r: s.r, top: s.top });
  return {
    n: land.p.n, gN: land.p.gN, h: rivers.ground, isSea: land.isSea, lakeId: hydro.lakeId, hand: hydro.hand,
    exposure: land.exposure, shoreClass: land.shoreClass, debris: land.debris, rock: land.rock,
    moisture: climate.moisture, wind: climate.wind, regions: land.plan.regions,
    reaches: rivers.reaches, stacks,
  };
}
