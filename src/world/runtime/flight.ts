// The flight model: a pure step from one state to the next. The camera follows
// whatever this says; the dragon will replace the numbers, not the shape.

import { wrap } from "../core/torus.ts";
import type { Start } from "../pack/manifest.ts";

/** Cruising speed, cells a second: a lap of the 6400 world in about 107 s. */
export const CRUISE = 60;
/** Speed multipliers while boosting and braking. */
export const BOOST = 1.8;
export const BRAKE = 0.5;
/** Turn rate at full bank, radians a second. */
export const TURN = 1.6;
/** Height kept over the ground, units. */
export const CLEARANCE = 18;
/** Kept this far over the occlusion floor, so land to the south never hides the flier. */
export const FLOOR_MARGIN = 4;
/** The flier is never closer to the ground than this, whatever the climb rate. */
export const MIN_GAP = 2;
/** Fastest climb or descent, units a second. */
export const CLIMB = 30;
/** Rates (per second) at which speed and bank ease toward their targets. */
export const SPEED_EASE = 2;
export const BANK_EASE = 6;
/** A longer frame is stepped as this long. */
export const DT_MAX = 0.1;

export interface FlightState {
  /** World cells, in [0, n). */
  x: number;
  y: number;
  /** Radians: 0 east, π/2 south. */
  heading: number;
  /** Cells a second. */
  speed: number;
  /** Units above sea level. */
  alt: number;
  /** −1 (left) … 1 (right). */
  bank: number;
}

export interface FlightInput {
  /** −1 turns left (anticlockwise on screen), 1 right. */
  turn: -1 | 0 | 1;
  boost: boolean;
  brake: boolean;
}

export interface Terrain {
  groundHeight(x: number, y: number): number;
  occlusionFloor(x: number, y: number): number;
}

/** At the start, cruising, level, at the height it will hold there. */
export function startState(start: Start, terrain: Terrain): FlightState {
  const x = start.x;
  const y = start.y;
  const ground = terrain.groundHeight(x, y);
  const floor = terrain.occlusionFloor(x, y);
  const alt = Math.max(ground + CLEARANCE, floor + FLOOR_MARGIN);
  return {
    x,
    y,
    heading: Math.atan2(start.dy, start.dx),
    speed: CRUISE,
    alt,
    bank: 0,
  };
}

/**
 * One step: dt is clamped to [0, DT_MAX]; bank eases toward `turn` and the heading turns by TURN · bank · dt; speed
 * eases toward CRUISE (× BOOST or × BRAKE); the flier moves along its heading and wraps into [0, n); its altitude moves
 * toward max(ground + CLEARANCE, occlusionFloor + FLOOR_MARGIN) by at most CLIMB · dt, and never ends below
 * ground + MIN_GAP. Pure: the input state is not changed.
 */
export function stepFlight(s: FlightState, input: FlightInput, dt: number, terrain: Terrain, n: number): FlightState {
  const step = Math.min(DT_MAX, Math.max(0, dt));
  const bank = s.bank + (input.turn - s.bank) * Math.min(1, BANK_EASE * step);
  const heading = s.heading + TURN * bank * step;
  const targetSpeed = CRUISE * (input.boost ? BOOST : input.brake ? BRAKE : 1);
  const speed = s.speed + (targetSpeed - s.speed) * Math.min(1, SPEED_EASE * step);
  let x = s.x + Math.cos(heading) * speed * step;
  let y = s.y + Math.sin(heading) * speed * step;
  x = wrap(x, n);
  y = wrap(y, n);
  const ground = terrain.groundHeight(x, y);
  const floor = terrain.occlusionFloor(x, y);
  const targetAlt = Math.max(ground + CLEARANCE, floor + FLOOR_MARGIN);
  let alt = s.alt;
  const delta = targetAlt - alt;
  if (delta > 0) alt += Math.min(delta, CLIMB * step);
  else if (delta < 0) alt += Math.max(delta, -CLIMB * step);
  alt = Math.max(alt, ground + MIN_GAP);
  return { x, y, heading, speed, alt, bank };
}