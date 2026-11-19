// Touch flight, without the DOM: every finger on the game layer is one pointer, and this decides what each one holds
// (spec 4.3). A finger that lands on a button holds that button; one that lands in the stick zone while the stick is
// free puts the stick down; anything else is ignored. Boost and Brake are held, and a thumb can roll from one onto
// the other. Land acts when the finger lifts, and sliding off cancels it. The page feeds pointer events in, in CSS
// pixels of the game layer, and reads what is held each frame.

import { moveThumb, putDown, readStick, STICK, STILL, type Stick, type StickFeel, type StickRead } from "./stick.ts";

export type Pad = "boost" | "brake" | "land";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where the controls are, as hit areas (the drawn shape plus slop). Land is null while nothing is in reach. */
export interface TouchTargets {
  zone: Rect;
  boost: Circle;
  brake: Circle;
  land: Circle | null;
}

export interface TouchRead {
  stick: StickRead;
  boost: boolean;
  brake: boolean;
}

/** What a pointer event did: a button newly pressed (for toggle boost and a tick), or Land tapped. */
export interface TouchEffect {
  pressed: Pad | null;
  tapped: "land" | null;
}

/** A finger keeps the button it holds this far past the button's edge, px. */
export const HYSTERESIS = 14;

const NOTHING: TouchEffect = { pressed: null, tapped: null };

function inside(c: Circle | null, x: number, y: number, extra = 0): boolean {
  return c !== null && Math.hypot(x - c.x, y - c.y) <= c.r + extra;
}

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

type Holds = Pad | "stick" | "none";

export interface Touch {
  down(id: number, x: number, y: number, at: TouchTargets): TouchEffect;
  move(id: number, x: number, y: number, at: TouchTargets): TouchEffect;
  up(id: number, x: number, y: number, at: TouchTargets): TouchEffect;
  /** The browser took the pointer back: release it, with no tap. */
  cancel(id: number): void;
  /** Lets go of everything: a pause, a blur, the page hidden. */
  clear(): void;
  read(): TouchRead;
  /** The stick while a thumb holds it, for drawing. */
  stick(): Stick | null;
  holding(pad: Pad): boolean;
  /** Any finger down. */
  active(): boolean;
  /** The stick's feel from now on (its travel grows with the controls' size). */
  setFeel(f: StickFeel): void;
}

export function createTouch(initial: StickFeel = STICK): Touch {
  let feel = initial;
  const holds = new Map<number, Holds>();
  let stickId: number | null = null;
  let stick: Stick | null = null;

  const holding = (pad: Pad) => {
    for (const h of holds.values()) if (h === pad) return true;
    return false;
  };
  const release = (id: number) => {
    if (id === stickId) {
      stickId = null;
      stick = null;
    }
    holds.delete(id);
  };

  return {
    down(id, x, y, at) {
      release(id);
      if (inside(at.land, x, y)) {
        holds.set(id, "land");
        return { pressed: "land", tapped: null };
      }
      for (const pad of ["boost", "brake"] as const) {
        if (inside(at[pad], x, y)) {
          const was = holding(pad);
          holds.set(id, pad);
          return { pressed: was ? null : pad, tapped: null };
        }
      }
      if (stickId === null && inRect(at.zone, x, y)) {
        stickId = id;
        stick = putDown(x, y);
        holds.set(id, "stick");
        return NOTHING;
      }
      holds.set(id, "none");
      return NOTHING;
    },
    move(id, x, y, at) {
      const h = holds.get(id);
      if (h === undefined) return NOTHING;
      if (h === "stick") {
        if (stick) stick = moveThumb(stick, x, y, feel);
        return NOTHING;
      }
      if (h === "land") {
        // Sliding off Land cancels it for this press.
        if (!inside(at.land, x, y, HYSTERESIS)) holds.set(id, "none");
        return NOTHING;
      }
      if ((h === "boost" || h === "brake") && inside(at[h], x, y, HYSTERESIS)) return NOTHING;
      // Off its button, or holding nothing: a finger rolls onto Boost or Brake, never onto Land or the stick.
      for (const pad of ["boost", "brake"] as const) {
        if (pad !== h && inside(at[pad], x, y)) {
          const was = holding(pad);
          holds.set(id, pad);
          return { pressed: was ? null : pad, tapped: null };
        }
      }
      if (h !== "none") holds.set(id, "none");
      return NOTHING;
    },
    up(id, x, y, at) {
      const h = holds.get(id);
      release(id);
      return h === "land" && inside(at.land, x, y, HYSTERESIS) ? { pressed: null, tapped: "land" } : NOTHING;
    },
    cancel(id) {
      release(id);
    },
    clear() {
      holds.clear();
      stickId = null;
      stick = null;
    },
    read() {
      return { stick: stick ? readStick(stick, feel) : STILL, boost: holding("boost"), brake: holding("brake") };
    },
    stick() {
      return stick;
    },
    holding,
    active() {
      return holds.size > 0;
    },
    setFeel(f) {
      feel = f;
    },
  };
}
