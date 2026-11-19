// Gamepads, through the Gamepad API's standard mapping: the left stick or the d-pad steers, the right trigger or
// shoulder boosts, the left ones slow; the south face button lands and takes off, the east one pulls up and takes off,
// View leaves and Menu opens the options.

/** The part of a Gamepad this reads. */
export interface PadLike {
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Standard-mapping button indices. */
const SOUTH = 0;
const EAST = 1;
const LB = 4;
const RB = 5;
const LT = 6;
const RT = 7;
const VIEW = 8;
const MENU = 9;
const UP = 12;
const DOWN = 13;
const LEFT = 14;
const RIGHT = 15;

/** The stick reads as centred inside this. */
export const DEAD_ZONE = 0.2;
/** A trigger counts as pulled past this. */
const PULL = 0.3;

/** The buttons that act once a press. */
export interface PadPresses {
  land: boolean;
  back: boolean;
  leave: boolean;
  options: boolean;
}

export interface PadRead {
  /** −1 … 1: the stick past its dead zone, rescaled, or the d-pad. */
  turn: number;
  boost: boolean;
  slow: boolean;
  /** Held this frame: compare with the last frame's for presses. */
  down: PadPresses;
  /** Anything pressed or pushed: the pad is in use. */
  active: boolean;
}

function pressed(p: PadLike, i: number): boolean {
  const b = p.buttons[i];
  return b !== undefined && (b.pressed || b.value > PULL);
}

/** What the pad asks for this frame. */
export function readPad(p: PadLike): PadRead {
  const x = p.axes[0] ?? 0;
  const mag = Math.abs(x);
  let turn = mag <= DEAD_ZONE ? 0 : (Math.sign(x) * (mag - DEAD_ZONE)) / (1 - DEAD_ZONE);
  if (pressed(p, LEFT)) turn = -1;
  if (pressed(p, RIGHT)) turn = turn === -1 ? 0 : 1;
  const boost = pressed(p, RT) || pressed(p, RB) || pressed(p, UP);
  const slow = pressed(p, LT) || pressed(p, LB) || pressed(p, DOWN);
  const down = { land: pressed(p, SOUTH), back: pressed(p, EAST), leave: pressed(p, VIEW), options: pressed(p, MENU) };
  const stick = mag > 0.5 || Math.abs(p.axes[1] ?? 0) > 0.5;
  const active = stick || p.buttons.some((b) => b.pressed);
  return { turn, boost, slow, down, active };
}

/** The presses: what is down now and was not last frame. */
export function presses(now: PadPresses, before: PadPresses): PadPresses {
  return {
    land: now.land && !before.land,
    back: now.back && !before.back,
    leave: now.leave && !before.leave,
    options: now.options && !before.options,
  };
}

export const NO_PRESSES: PadPresses = { land: false, back: false, leave: false, options: false };

/** Whose pad it is, from its id, so the triggers carry the names on the pad. */
export type PadFamily = "xbox" | "playstation" | "nintendo" | "generic";

export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  // Xbox first: its pads call themselves "Xbox Wireless Controller", and a DualShock just "Wireless Controller".
  if (/045e|xbox|xinput/.test(s)) return "xbox";
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(s)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return "nintendo";
  return "generic";
}

/** The names the pad's own triggers and plates carry. */
export function padNames(family: PadFamily): { boost: string; slow: string; leave: string; options: string } {
  if (family === "playstation") return { boost: "R2", slow: "L2", leave: "create", options: "options" };
  if (family === "nintendo") return { boost: "ZR", slow: "ZL", leave: "-", options: "+" };
  if (family === "xbox") return { boost: "RT", slow: "LT", leave: "view", options: "menu" };
  return { boost: "RT", slow: "LT", leave: "back", options: "start" };
}

/** The first connected pad with the standard mapping, from navigator.getGamepads(). */
export function firstPad(pads: readonly (PadLike | null)[]): PadLike | null {
  for (const p of pads) if (p && p.mapping === "standard") return p;
  return null;
}
