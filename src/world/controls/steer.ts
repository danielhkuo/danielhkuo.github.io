// Point steering: the stick says where on screen to fly, and the dragon turns toward that heading at its own turn
// rate (spec 4.2). It is a turn request in [-1, 1], the same thing the keys and the pad send, so the flight model is
// unchanged. Heading is the flight's: 0 east, π/2 south (screen y down).

import type { StickRead } from "./stick.ts";

/** Radians of heading error that ask for a full bank: about 29°. Less error asks for less. */
export const STEER_GAIN = 0.5;
/** Past this much error the stick points almost straight back: keep turning the way the dragon already turns. */
export const FLICK = (170 * Math.PI) / 180;
/** Screen y is 0.8 of world y (screenY = 0.8·y − alt), so a direction on screen is stretched back to the world's. */
const FORESHORTEN = 0.8;

function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** The world heading a stick pointing along (x, y) on screen asks for. */
export function headingOf(x: number, y: number): number {
  return Math.atan2(y / FORESHORTEN, x);
}

/**
 * The turn that brings `heading` round to where the stick points. A stick at rest asks for none. Pointed nearly
 * straight back (past FLICK), the turn keeps the sign of `lastTurn` (right when there was none), so a flick behind
 * the dragon turns it one way instead of dithering between the two.
 */
export function pointTurn(stick: StickRead, heading: number, lastTurn: number): number {
  if (stick.mag <= 0) return 0;
  let error = wrapPi(headingOf(stick.x, stick.y) - heading);
  if (Math.abs(error) > FLICK) error = (lastTurn < 0 ? -1 : 1) * Math.abs(error);
  return Math.max(-1, Math.min(1, error / STEER_GAIN));
}
