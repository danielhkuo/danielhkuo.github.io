// The dragon studies, for the owner to choose between: A the river-dragon (and its ivory colouring), B the winged
// dragon, C the small wyrm. Each is drawn in place of the stand-in kite on the flight page with ?dragon=<id>.

import type { ViewRect } from "../render/compose.ts";
import { createChain } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import type { Pose } from "./body.ts";
import { IVORY, LACQUER } from "./look.ts";
import type { Land } from "./parts.ts";
import { drawRiver } from "./river.ts";
import { drawWinged } from "./winged.ts";
import { drawWyrm } from "./wyrm.ts";

export const DRAGON_IDS = ["a", "a-ivory", "b", "c"] as const;
export type DragonId = (typeof DRAGON_IDS)[number];

export const DRAGON_NAMES: Record<DragonId, string> = {
  a: "A RIVER-DRAGON",
  "a-ivory": "A IN IVORY",
  b: "B WINGED DRAGON",
  c: "C STORYBOOK WYRM",
};

/** Seconds for one wave to pass down the body at cruising speed. */
export const WAVE_PERIOD = 2.4;
/** Points of path remembered: enough for the longest body at a crawl. */
const PATH = 640;

/** The study named by the page's ?dragon= value, or null for the kite. */
export function dragonFrom(value: string | null | undefined): DragonId | null {
  for (const id of DRAGON_IDS) if (value === id) return id;
  return null;
}

export interface Dragon {
  id: DragonId;
  /** Call once a frame, after the flight step: remembers the path and moves the body's clocks on by dt seconds. */
  step(s: FlightState, dt: number): void;
  /** Draws the study at the flier, shaped like drawFlier. */
  draw(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land): void;
  pose: Pose;
}

/** A study on a world n cells across. Its motion depends only on the states and times it is stepped with. */
export function createDragon(id: DragonId, n: number): Dragon {
  const pose: Pose = { chain: createChain(n, PATH), n, time: 0, wave: 0 };
  return {
    id,
    pose,
    step(s, dt) {
      pose.chain.push(s.x, s.y, s.alt);
      pose.time += dt;
      // The wave quickens with speed, so a boost tightens the undulation.
      pose.wave += ((2 * Math.PI * dt) / WAVE_PERIOD) * (0.5 + (0.5 * s.speed) / CRUISE);
    },
    draw(out, rect, s, view) {
      if (id === "a") drawRiver(out, rect, s, view, pose, LACQUER);
      else if (id === "a-ivory") drawRiver(out, rect, s, view, pose, IVORY);
      else if (id === "b") drawWinged(out, rect, s, view, pose, LACQUER);
      else drawWyrm(out, rect, s, view, pose, LACQUER);
    },
  };
}
