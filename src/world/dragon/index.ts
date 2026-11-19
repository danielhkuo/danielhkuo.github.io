// The dragon: the long, wingless river-dragon in vermilion lacquer with a gold belly and mane (study A, chosen by the
// owner on 2026-11-18). Its body follows the head's path through a chain; it is drawn as sprite stacks over the land.

import type { ViewRect } from "../render/compose.ts";
import { createChain } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { REST_HEIGHT, REST_SWING, SETTLE_RATE, SETTLE_SLOPE, smooth, SWING_EASE, VIGOUR_EASE, WAVE_PERIOD, waveRate, type Pose } from "./body.ts";
import { LACQUER } from "./look.ts";
import type { Land } from "./parts.ts";
import { drawRiver, RIVER_LENGTH } from "./river.ts";

export { WAVE_PERIOD };
/** Points of path remembered, at least PATH_STEP cells apart: 320 cells of it, however slowly the head moves. */
const PATH = 640;
/**
 * The least distance between two remembered points, cells. Without it a head that crawls or rests fills the memory with
 * one place in a few seconds, and the body, having no path left to lie along, straightens out behind it.
 */
const PATH_STEP = 0.5;
/** A settling step that moves no point of the body this far has finished the job, units. */
const LAIN = 0.002;

export interface Dragon {
  /**
   * Call once a frame, after the flight step: remembers the path and moves the body's clocks on by dt seconds. `rest`
   * (0 flying … 1 resting) settles the undulation's swing toward REST_SWING and, over its second half, has the body
   * sink onto the ground.
   */
  step(s: FlightState, dt: number, rest?: number): void;
  /**
   * Draws the dragon at the flier, with its shadow, depth-tested against the land. A body that is settling is first
   * lowered toward the land's ground: it lies REST_HEIGHT over it, bridging drops.
   */
  draw(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land): void;
  pose: Pose;
}

/** The dragon on a world n cells across. Its motion depends only on the states and times it is stepped with. */
export function createDragon(n: number): Dragon {
  const pose: Pose = { chain: createChain(n, PATH, PATH_STEP), n, time: 0, wave: 0, swing: 1, vigour: 1, settle: 0 };
  // The body has come to lie on the ground: nothing more to settle until it has flown again.
  let lying = false;
  return {
    pose,
    step(s, dt, rest = 0) {
      pose.chain.push(s.x, s.y, s.alt);
      pose.time += dt;
      // The wave quickens with speed, so a boost tightens the undulation.
      pose.wave += waveRate(s.speed) * dt;
      const swing = 1 - (1 - REST_SWING) * rest;
      pose.swing += (swing - pose.swing) * Math.min(1, SWING_EASE * dt);
      pose.vigour += (Math.min(1, s.speed / CRUISE) - pose.vigour) * Math.min(1, VIGOUR_EASE * dt);
      // Once it is more at rest than not, the body sinks: all of what this and any undrawn step ask for.
      const sink = SETTLE_RATE * smooth(2 * rest - 1) * dt;
      if (sink > 0) pose.settle = 1 - (1 - pose.settle) * Math.exp(-sink);
      else lying = false;
    },
    draw(out, rect, s, view) {
      if (pose.settle > 0 && !lying) {
        const moved = pose.chain.settle((x, y) => view.groundHeight(x, y) + REST_HEIGHT, pose.settle, RIVER_LENGTH, SETTLE_SLOPE);
        lying = moved < LAIN;
      }
      pose.settle = 0;
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
