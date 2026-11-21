// The world held behind the title. Held, the dragon is asked for nothing and glides until it stops, and the camera
// eases down so its head sits under the window. Pure: the session applies one step of this each frame.

import type { FlightInput, FlightState } from "./flight.ts";

/** Held, the dragon is asked for nothing. */
export const HELD_INPUT: FlightInput = { turn: 0, boost: false, brake: false, pace: 0 };

/**
 * Held, the head is drawn this share of the frame's height below its centre: 80% of the way down the frame, under
 * the title's window. The title can name another place (HoldAt); this is where it is otherwise.
 */
export const HOLD_LOW = 0.3;

/** Where the held head is drawn, as shares of the frame's width and height from its top-left corner. */
export interface HoldAt {
  x: number;
  y: number;
}

export const HOLD_AT: HoldAt = { x: 0.5, y: 0.5 + HOLD_LOW };

/** Cells a second. Held, slower than this is stopped outright: the speed's ease never reaches 0 by itself. */
export const HOLD_STOP = 0.5;

/** Let go, the camera's share moves back at this rate per second: 1.25 s, as the dragon gathers speed. */
export const HOLD_RATE = 0.8;

/**
 * Held again (Back), the camera's share comes down at this rate per second: about as long as the window takes to come
 * back, so the dragon is in its place beside the button when it is.
 */
export const HOLD_IN_RATE = 1.6;

/**
 * Held, the dragon reins in at this rate per second on top of its own easing: stopped within about the window's return,
 * so the world is still when the title is back.
 */
export const HOLD_BRAKE = 6;

/**
 * Held, the dragon reins in over `dt` seconds, and slower than HOLD_STOP it is stopped outright. Not held, the state
 * itself, unchanged.
 */
export function holdStep(s: FlightState, held: boolean, dt = 0): FlightState {
  if (!held) return s;
  const speed = s.speed * Math.exp(-HOLD_BRAKE * Math.max(0, dt));
  return speed < HOLD_STOP ? { ...s, speed: 0 } : speed === s.speed ? s : { ...s, speed };
}

/**
 * The camera's held share, in [0, 1]. Reduced motion cuts to held or to flying; otherwise the share moves toward
 * 1 (held) at HOLD_IN_RATE per second, or toward 0 at HOLD_RATE.
 */
export function easeHold(share: number, held: boolean, dt: number, reduced: boolean): number {
  if (reduced) return held ? 1 : 0;
  const step = Math.max(0, dt) * (held ? HOLD_IN_RATE : HOLD_RATE);
  return Math.min(1, Math.max(0, share + (held ? step : -step)));
}

/** Smoothstep, so the shift eases off at each end instead of starting and stopping abruptly. */
function smooth(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/**
 * The flight's camera, moved while the world is held so the head is drawn at `at` in a frame fw × fh instead of at its
 * centre. A frame pixel across is a world cell; the view draws world y at 0.8 times y, so a frame pixel down is
 * 1 / 0.8 cells. Share 0 is the flight's own framing.
 */
export function holdCamera(
  camera: { x: number; y: number }, share: number, fw: number, fh: number, at: HoldAt = HOLD_AT,
): { x: number; y: number } {
  const k = smooth(share);
  return { x: camera.x - k * (at.x - 0.5) * fw, y: camera.y - (k * (at.y - 0.5) * fh) / 0.8 };
}
