// The dragon: the long, wingless river-dragon in vermilion lacquer with a gold belly and mane (study A, chosen by the
// owner on 2026-11-18). Its body follows the head's path through a chain; it is drawn as sprite stacks over the land.

import type { ViewRect } from "../render/compose.ts";
import { createChain } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { REST_SWING, SWING_EASE, WAVE_PERIOD, waveRate, type Pose } from "./body.ts";
import { LACQUER } from "./look.ts";
import type { Land } from "./parts.ts";
import { drawRiver } from "./river.ts";

export { WAVE_PERIOD };
/** Points of path remembered: enough for the whole body at a crawl. */
const PATH = 640;

export interface Dragon {
  /**
   * Call once a frame, after the flight step: remembers the path and moves the body's clocks on by dt seconds. `rest`
   * (0 flying … 1 resting) settles the undulation's swing toward REST_SWING.
   */
  step(s: FlightState, dt: number, rest?: number): void;
  /** Draws the dragon at the flier, with its shadow, depth-tested against the land. */
  draw(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land): void;
  pose: Pose;
}

/** The dragon on a world n cells across. Its motion depends only on the states and times it is stepped with. */
export function createDragon(n: number): Dragon {
  const pose: Pose = { chain: createChain(n, PATH), n, time: 0, wave: 0, swing: 1 };
  return {
    pose,
    step(s, dt, rest = 0) {
      pose.chain.push(s.x, s.y, s.alt);
      pose.time += dt;
      // The wave quickens with speed, so a boost tightens the undulation.
      pose.wave += waveRate(s.speed) * dt;
      const swing = 1 - (1 - REST_SWING) * rest;
      pose.swing += (swing - pose.swing) * Math.min(1, SWING_EASE * dt);
    },
    draw(out, rect, s, view) {
      drawRiver(out, rect, s, view, pose, LACQUER);
    },
  };
}

/**
 * A dragon that has flown straight along `s.heading` for `distance` cells and arrived at `s`, with its body laid out
 * behind it and its undulation at time `time`: for tools that draw single frames.
 */
export function flownDragon(n: number, s: FlightState, time = 0, distance = 160): Dragon {
  const dragon = createDragon(n);
  const dx = Math.cos(s.heading), dy = Math.sin(s.heading);
  for (let k = distance; k >= 0; k--) {
    const x = (((s.x - dx * k) % n) + n) % n, y = (((s.y - dy * k) % n) + n) % n;
    dragon.step({ ...s, x, y }, 1 / CRUISE);
  }
  dragon.pose.time = time;
  dragon.pose.wave = (time * 2 * Math.PI) / WAVE_PERIOD;
  return dragon;
}
