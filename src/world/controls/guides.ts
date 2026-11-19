// The guides by the dragon: what to press now, drawn in the glyphs of the device in hand. A landing on offer, coming
// down, or landed each has its prompt; otherwise the first-flight lesson shows, if it is still being taught. One guide
// at a time: the prompt has the place, and the lesson waits.

import { REMAPPABLE, type KeyFamily, type Keys } from "./bindings.ts";
import { padNames, type PadFamily } from "./gamepad.ts";
import { column, keyCap, label, padFace, padStick, padTrigger, plate, row, touchTap, type Sprite } from "./glyphs.ts";
import { lessonAlpha, type Lesson } from "./lesson.ts";

export type Device = "keyboard" | "gamepad" | "touch";

/** What is held now, to light the glyphs: keyboard keys (normalised) and the pad's reading. */
export interface Lit {
  keys: ReadonlySet<string>;
  /** The pad's stick or d-pad is turned. */
  turn: boolean;
  boost: boolean;
  slow: boolean;
  /** The pad's south and east buttons. */
  south: boolean;
  east: boolean;
}

export interface GuideState {
  device: Device;
  phase: "flying" | "landing" | "landed";
  /** While flying, the landmark in reach: the name to show by "land" ("" for none). Null when nothing is in reach. */
  offer: string | null;
  lesson: Lesson;
  keys: Keys;
  /** The family of keys the visitor steers with, once known. */
  family: KeyFamily | null;
  pad: PadFamily;
  lit: Lit;
  reduced: boolean;
}

/** What a click or tap on the guide does. */
export type Tap = "land" | "takeOff" | "pullUp";

export interface Guide {
  /** Names the picture: the same id, the same pixels. */
  id: string;
  sprite: Sprite;
  alpha: number;
  tap: Tap | null;
  /** The guide in words, for the live region. */
  say: string;
}

/** A project's name can be long: the prompt shows this much of it. */
const NAME_MAX = 18;

function short(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

/** A key as a sentence names it. */
export function keyWord(key: string): string {
  const named: Record<string, string> = { " ": "Space", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Escape: "Esc" };
  return named[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

// Built sprites, by id: the guide changes a few times a minute, the frame sixty times a second.
const built = new Map<string, Sprite>();
function memo(id: string, make: () => Sprite): Sprite {
  let s = built.get(id);
  if (!s) {
    if (built.size > 64) built.clear();
    s = make();
    built.set(id, s);
  }
  return s;
}

function lit(s: GuideState, key: string): boolean {
  return s.lit.keys.has(key);
}

/** The glyph that does `what` on the device in hand. */
function glyphFor(s: GuideState, what: "land" | "back"): { id: string; sprite: () => Sprite; word: string } {
  if (s.device === "touch") return { id: "tap", sprite: () => touchTap(), word: "Tap here" };
  if (s.device === "gamepad") {
    const face = what === "land" ? "south" : "east";
    const on = what === "land" ? s.lit.south : s.lit.east;
    return { id: `pad-${face}-${on}`, sprite: () => padFace(face, on), word: `Press the ${what === "land" ? "bottom" : "right"} face button` };
  }
  const key = what === "land" ? s.keys.land : "Escape";
  const on = lit(s, key) || (what === "land" && lit(s, "Enter"));
  return { id: `key-${key}-${on}`, sprite: () => keyCap(key, on), word: `Press ${keyWord(key)}` };
}

function prompt(s: GuideState, what: "land" | "back", verb: string, name: string, tap: Tap): Guide {
  const g = glyphFor(s, what);
  const words = name ? `${verb} · ${short(name)}` : verb;
  const id = `prompt|${g.id}|${words}`;
  return {
    id,
    sprite: memo(id, () => row([g.sprite(), label(words)], 2)),
    alpha: 1,
    tap,
    say: `${g.word} to ${verb}${name ? `: ${name}` : ""}.`,
  };
}

/** A key-cap per key, lit while held, side by side. */
function caps(s: GuideState, keys: readonly string[]): { id: string; sprite: () => Sprite } {
  const on = keys.map((k) => lit(s, k));
  return { id: keys.map((k, i) => `${k}${on[i] ? "*" : ""}`).join("+"), sprite: () => row(keys.map((k, i) => keyCap(k, on[i])), 1) };
}

/** A line of a lesson: glyphs, then a word. */
function line(parts: { id: string; sprite: () => Sprite }[], word: string): { id: string; sprite: () => Sprite } {
  return { id: `${parts.map((p) => p.id).join(",")}:${word}`, sprite: () => row([...parts.map((p) => p.sprite()), label(word)], 2) };
}

function orWord(): { id: string; sprite: () => Sprite } {
  return { id: "or", sprite: () => label("or") };
}

function lessonGuide(s: GuideState): Guide | null {
  const l = s.lesson;
  const alpha = lessonAlpha(l, s.reduced);
  if (alpha <= 0 || s.device === "touch") return null;
  const k = s.keys;
  let lines: { id: string; sprite: () => Sprite }[];
  let say: string;
  if (s.device === "gamepad") {
    const names = padNames(s.pad);
    if (l.stage === "steer") {
      lines = [line([{ id: `stick${s.lit.turn}`, sprite: () => padStick(s.lit.turn) }], "steer")];
      say = "Steer with the left stick.";
    } else if (l.stage === "speed") {
      lines = [
        line([{ id: `${names.boost}${s.lit.boost}`, sprite: () => padTrigger(names.boost, s.lit.boost) }], "boost"),
        line([{ id: `${names.slow}${s.lit.slow}`, sprite: () => padTrigger(names.slow, s.lit.slow) }], "slow"),
      ];
      say = `Hold ${names.boost} to boost, ${names.slow} to slow down.`;
    } else {
      lines = [
        line([{ id: `plate-${names.leave}`, sprite: () => plate(names.leave) }], "leave"),
        line([{ id: `plate-${names.options}`, sprite: () => plate(names.options) }], "options"),
      ];
      say = `Press ${names.leave} to leave the world, ${names.options} for the options.`;
    }
  } else if (l.stage === "steer") {
    const letters = caps(s, [k.left, k.right]);
    const arrows = caps(s, ["ArrowLeft", "ArrowRight"]);
    const parts = s.family === "letters" ? [letters] : s.family === "arrows" ? [arrows] : [letters, orWord(), arrows];
    lines = [line(parts, "steer")];
    say = `Steer with ${keyWord(k.left)} and ${keyWord(k.right)}, or the arrow keys.`;
  } else if (l.stage === "speed") {
    const boost = s.family === "arrows" ? ["ArrowUp", "Shift"] : s.family === "letters" ? [k.boost, "Shift"] : [k.boost, "ArrowUp", "Shift"];
    const slow = s.family === "arrows" ? ["ArrowDown"] : s.family === "letters" ? [k.slow] : [k.slow, "ArrowDown"];
    lines = [line([caps(s, boost)], "boost"), line([caps(s, slow)], "slow")];
    say = `${keyWord(k.boost)}, Up or Shift to boost; ${keyWord(k.slow)} or Down to slow down.`;
  } else {
    lines = [line([caps(s, ["Escape"])], "leave"), line([caps(s, ["o"])], "options")];
    say = "Esc to leave the world, O for the options.";
  }
  const id = `lesson|${l.stage}|${lines.map((x) => x.id).join("/")}`;
  return {
    id,
    // Lines sit flush left, as a legend does.
    sprite: memo(id, () => column(lines.map((x) => x.sprite()), 1, "start")),
    alpha,
    tap: null,
    say,
  };
}

/** The guide to draw by the dragon now, or null for none. */
export function guideFor(s: GuideState): Guide | null {
  if (s.phase === "landed") return prompt(s, "land", "take off", "", "takeOff");
  if (s.phase === "landing") return prompt(s, "back", "pull up", "", "pullUp");
  if (s.offer !== null) return prompt(s, "land", "land", s.offer, "land");
  return lessonGuide(s);
}

/** The four places round the dragon's head a guide can stand. */
export type Slot = "below" | "right" | "above" | "left";

/** The order slots are tried in: under the dragon reads first, as a caption does. */
export const SLOTS: readonly Slot[] = ["below", "right", "above", "left"];
/** Over a bottom sheet (the narrow Codex), the foot of the frame is covered. */
export const SLOTS_HIGH: readonly Slot[] = ["above", "right", "left", "below"];

/** How far a guide stands from the dragon's head, px. */
export const GAP = 12;
/** How near a joint of the body may come to a guide before it counts as covering it, px. */
const BODY_R = 4;

/** The top-left of a w × h guide standing in `slot` round `head`. */
export function slotAt(slot: Slot, head: { x: number; y: number }, w: number, h: number, gap = GAP): { x: number; y: number } {
  if (slot === "below") return { x: Math.round(head.x - w / 2), y: Math.round(head.y + gap) };
  if (slot === "above") return { x: Math.round(head.x - w / 2), y: Math.round(head.y - gap - h) };
  if (slot === "right") return { x: Math.round(head.x + gap), y: Math.round(head.y - h / 2) };
  return { x: Math.round(head.x - gap - w), y: Math.round(head.y - h / 2) };
}

/** How badly a guide in `slot` fares: each joint of the body under it, and a heavy cost for leaving the frame. */
function cost(slot: Slot, head: { x: number; y: number }, w: number, h: number, fw: number, fh: number, body: readonly { x: number; y: number }[]): number {
  const at = slotAt(slot, head, w, h);
  let c = at.x < 0 || at.y < 0 || at.x + w > fw || at.y + h > fh ? 100 : 0;
  for (const p of body) {
    if (p.x >= at.x - BODY_R && p.x < at.x + w + BODY_R && p.y >= at.y - BODY_R && p.y < at.y + h + BODY_R) c += 1;
  }
  return c;
}

/**
 * Where a w × h guide stands: the first slot in `order` that the dragon's body (`body`, its joints on screen) and the
 * frame's edges leave clearest. The `current` slot is kept while no more than one joint crosses it, so the guide does
 * not hop at every sway of the body.
 */
export function chooseSlot(
  current: Slot | null, head: { x: number; y: number }, w: number, h: number, fw: number, fh: number,
  body: readonly { x: number; y: number }[], order: readonly Slot[] = SLOTS,
): Slot {
  if (current && order.includes(current) && cost(current, head, w, h, fw, fh, body) <= 1) return current;
  let best = order[0];
  let bestCost = Infinity;
  for (const slot of order) {
    const c = cost(slot, head, w, h, fw, fh, body);
    if (c < bestCost) {
      best = slot;
      bestCost = c;
    }
  }
  return best;
}

/** Keeps a guide of w × h inside the fw × fh frame, `margin` px from its edges. */
export function clampInto(at: { x: number; y: number }, w: number, h: number, fw: number, fh: number, margin = 2): { x: number; y: number } {
  return {
    x: Math.min(fw - margin - w, Math.max(margin, at.x)),
    y: Math.min(fh - margin - h, Math.max(margin, at.y)),
  };
}

/** The remappable keys in the order the options list them, with what each does in words. */
export const ACTION_WORDS: Record<(typeof REMAPPABLE)[number], string> = {
  left: "steer left",
  right: "steer right",
  boost: "boost",
  slow: "slow",
  land: "land · take off",
};
