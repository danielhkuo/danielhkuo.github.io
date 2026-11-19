// The flight's controls in the browser: keys, the pointer and gamepads, turned into what the dragon is asked each
// frame, and which device the guides should be drawn for. Plain TypeScript: the session owns one.

import { actionOf, familyOf, heldFrom, NONE_HELD, normalKey, type Held, type KeyFamily } from "../../world/controls/bindings";
import { firstPad, NO_PRESSES, padFamily, presses, readPad, type PadFamily, type PadPresses, type PadRead } from "../../world/controls/gamepad";
import type { Device, Lit, Tap } from "../../world/controls/guides";
import { paceOf, type Options } from "../../world/controls/options";
import type { FlightInput } from "../../world/runtime/flight";
import { pointTurn } from "../../world/controls/steer";
import type { PhaseKind } from "./session";
import type { TouchFrame } from "./touchLayer";

export interface ControlsHooks {
  /** What holds the keys instead of the flight: the abbey's terminal, the options panel, or nothing. */
  busy(): "terminal" | "options" | null;
  closeTerminal(): void;
  phase(): PhaseKind;
  options(): Options;
  /** Each is safe to call in any phase: it does nothing where it does not apply. */
  land(): void;
  takeOff(): void;
  pullUp(): void;
  leave(): void;
  /** The options key, or the pad's Menu. */
  toggleOptions(): void;
  /** The device the guides are drawn for has changed. */
  device(d: Device): void;
  /** Touch flight this frame (the stick, Boost and Brake, Land taps), when the page has touch controls. */
  touch?(): TouchFrame | null;
  /** The dragon's heading, which the touch stick steers toward. */
  heading?(): number;
}

/** What the controls ask of the flight this frame. */
export interface ControlRead {
  input: FlightInput;
  /** Steering and speed held, for the lesson: the stick past half-way counts. */
  held: Held;
  lit: Lit;
  pad: PadFamily;
  device: Device;
  family: KeyFamily | null;
}

/** A guide's rectangle on the frame, in frame pixels, and what a tap on it does. */
export interface TapTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  tap: Tap | null;
}

export interface Controls {
  frame(): ControlRead;
  /** The device used last. */
  device(): Device;
  /** The guide drawn this frame, for clicks and taps. */
  target(t: TapTarget | null): void;
  dispose(): void;
}

/** True when a key pressed on `target` belongs to it: a control or a field. (The terminal takes keys by its own flag.) */
function ownsKeys(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [contenteditable]") !== null;
}

function firstDevice(): Device {
  try {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches ? "touch" : "keyboard";
  } catch {
    return "keyboard";
  }
}

/** Extra frame pixels round a guide that still count as on it: more for a finger than a mouse. */
const SLOP = { mouse: 4, touch: 10 };

export function createControls(canvas: HTMLCanvasElement, hooks: ControlsHooks): Controls {
  const down = new Set<string>();
  let family: KeyFamily | null = null;
  let device = firstDevice();
  // Toggle boost: on from one press of a boost key or the pad's trigger to the next (or a slow, or a landing).
  let boostOn = false;
  let pads = 0;
  let padBefore: PadPresses = NO_PRESSES;
  let padBoostBefore = false;
  let padSlowBefore = false;
  let pad: PadFamily = "generic";
  let target: TapTarget | null = null;
  // The last turn asked for: a stick flicked straight behind keeps turning this way.
  let lastTurn = 0;
  // The page starts out drawing for a keyboard: tell it if this is a touch screen.
  if (device !== "keyboard") hooks.device(device);

  const switchTo = (d: Device) => {
    if (d === device) return;
    device = d;
    hooks.device(d);
  };
  const landOrTakeOff = () => {
    boostOn = false;
    if (hooks.phase() === "flying") hooks.land();
    else if (hooks.phase() === "landed") hooks.takeOff();
  };
  /** Esc: pull up, take off, or (Esc only, not the pad's east button) leave. */
  const back = (leave: boolean) => {
    const phase = hooks.phase();
    if (phase === "landing") hooks.pullUp();
    else if (phase === "landed") hooks.takeOff();
    else if (leave) hooks.leave();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const busy = hooks.busy();
    if (busy === "options") return;
    // The terminal takes every key while it is open; Esc closes it.
    if (busy === "terminal") {
      if (e.key === "Escape") {
        e.preventDefault();
        hooks.closeTerminal();
      }
      return;
    }
    switchTo("keyboard");
    const keys = hooks.options().keys;
    const action = actionOf(e.key, keys);
    if (action === "back") {
      // Held, Esc would pull up and then leave: it acts once a press.
      if (!e.repeat) back(true);
      return;
    }
    if (action === "options" || action === "land") {
      // A focused button or link acts on its own key; held keys act once.
      if (ownsKeys(e.target)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (action === "options") hooks.toggleOptions();
      else landOrTakeOff();
      return;
    }
    // Landed, the arrow keys read down the Codex.
    if (hooks.phase() !== "landed" && e.key.startsWith("Arrow")) e.preventDefault();
    const k = normalKey(e.key);
    down.add(k);
    const f = familyOf(k, keys);
    if (f) family = f;
    if (!e.repeat && action === "boost" && hooks.options().boost === "toggle") boostOn = !boostOn;
    if (!e.repeat && action === "slow") boostOn = false;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    down.delete(normalKey(e.key));
  };
  const onBlur = () => {
    down.clear();
  };

  // The frame is the canvas's own size, whatever the window made it.
  const toFrame = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
  };
  const onTarget = (e: PointerEvent): Tap | null => {
    if (!target || !target.tap) return null;
    const p = toFrame(e);
    const s = e.pointerType === "touch" ? SLOP.touch : SLOP.mouse;
    const inside = p.x >= target.x - s && p.x < target.x + target.w + s && p.y >= target.y - s && p.y < target.y + target.h + s;
    return inside ? target.tap : null;
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") switchTo("touch");
    const tap = onTarget(e);
    if (!tap) return;
    e.preventDefault();
    if (tap === "land") landOrTakeOff();
    else if (tap === "takeOff") hooks.takeOff();
    else hooks.pullUp();
  };
  const onPointerMove = (e: PointerEvent) => {
    canvas.style.cursor = onTarget(e) ? "pointer" : "";
  };
  const onAnyPointer = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") switchTo("touch");
  };
  const onPadConnected = () => {
    pads += 1;
  };
  const onPadDisconnected = () => {
    pads = Math.max(0, pads - 1);
    if (pads === 0 && device === "gamepad") switchTo("keyboard");
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("gamepadconnected", onPadConnected);
  window.addEventListener("gamepaddisconnected", onPadDisconnected);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onAnyPointer, true);

  /** The pad this frame: presses act, the reading steers. Null with no pad. */
  const pollPad = (): PadRead | null => {
    if (pads === 0 || typeof navigator.getGamepads !== "function") return null;
    const p = firstPad(navigator.getGamepads());
    if (!p) return null;
    const read = readPad(p);
    pad = padFamily(p.id);
    if (read.active) switchTo("gamepad");
    const pressed = presses(read.down, padBefore);
    padBefore = read.down;
    const busy = hooks.busy();
    if (busy === "options") {
      if (pressed.options || pressed.back) hooks.toggleOptions();
    } else if (busy === null) {
      if (pressed.land) landOrTakeOff();
      if (pressed.back) back(false);
      if (pressed.leave && hooks.phase() === "flying") hooks.leave();
      if (pressed.options) hooks.toggleOptions();
      if (read.boost && !padBoostBefore && hooks.options().boost === "toggle") boostOn = !boostOn;
      if (read.slow && !padSlowBefore) boostOn = false;
    }
    padBoostBefore = read.boost;
    padSlowBefore = read.slow;
    return busy === null ? read : null;
  };

  return {
    frame() {
      const options = hooks.options();
      const read = pollPad();
      const free = hooks.busy() === null;
      const keys = free ? heldFrom(down, options.keys) : NONE_HELD;
      const padTurn = read?.turn ?? 0;
      const tf = free ? (hooks.touch?.() ?? null) : null;
      if (tf) {
        // Toggle boost flips on a press of the Boost button; Brake turns it off, as the keys do.
        for (const p of tf.presses) {
          if (p === "boost" && options.boost === "toggle") boostOn = !boostOn;
          if (p === "brake") boostOn = false;
        }
        for (const t of tf.taps) if (t === "land") landOrTakeOff();
      }
      const stick = tf?.stick.mag ?? 0;
      let turn: number;
      if (tf && stick > 0) turn = pointTurn(tf.stick, hooks.heading?.() ?? 0, lastTurn);
      else if (padTurn !== 0) turn = padTurn;
      else if (tf && tf.tilt !== null && tf.tilt !== 0) turn = tf.tilt;
      else turn = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
      if (turn !== 0) lastTurn = turn;
      const touchBoost = tf?.boost ?? false;
      const touchSlow = tf?.brake ?? false;
      const holdBoost = keys.boost || (read?.boost ?? false) || touchBoost;
      const slow = keys.slow || (read?.slow ?? false) || touchSlow;
      if (options.boost === "hold") boostOn = false;
      const rim = tf?.rim ?? false;
      const boost = (options.boost === "toggle" ? boostOn : holdBoost) || rim;
      // For the lesson, a stick pushed past half-way steers both ways: point steering has no left and right of its own.
      const steering = stick > 0.5;
      return {
        input: { turn, boost, brake: slow, pace: paceOf(options) },
        held: { left: keys.left || padTurn < -0.5 || steering, right: keys.right || padTurn > 0.5 || steering, boost: holdBoost || boost, slow },
        lit: {
          keys: down,
          turn: padTurn !== 0 || stick > 0,
          boost: (read?.boost ?? false) || touchBoost || rim || (options.boost === "toggle" && boostOn),
          slow: (read?.slow ?? false) || touchSlow,
          south: read?.down.land ?? false,
          east: read?.down.back ?? false,
        },
        pad,
        device,
        family,
      };
    },
    device() {
      return device;
    },
    target(t) {
      target = t;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("gamepadconnected", onPadConnected);
      window.removeEventListener("gamepaddisconnected", onPadDisconnected);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onAnyPointer, true);
    },
  };
}
