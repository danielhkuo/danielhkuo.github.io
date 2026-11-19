// What the keys do: the flight's actions, the keys bound to them (the letters can be rebound, the arrows, Shift,
// Enter, Esc and O cannot), and what a set of held keys asks of the dragon.

/** Everything a visitor can ask of the flight. `back` pulls up, takes off, or leaves; `land` also takes off. */
export type Action = "left" | "right" | "boost" | "slow" | "land" | "back" | "options";

/** The actions whose first key can be rebound, in the order the options panel lists them. */
export const REMAPPABLE = ["left", "right", "boost", "slow", "land"] as const;
export type Remappable = (typeof REMAPPABLE)[number];

/** The rebindable key of each action, as a normalised KeyboardEvent.key. */
export type Keys = Record<Remappable, string>;

export const DEFAULT_KEYS: Keys = { left: "a", right: "d", boost: "w", slow: "s", land: " " };

/** Keys that always do the same thing, whatever is rebound, and can never be taken. */
export const FIXED: Readonly<Record<string, Action>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "boost",
  ArrowDown: "slow",
  Shift: "boost",
  Enter: "land",
  Escape: "back",
  o: "options",
};

/** Keys that are never bound: focus moves on Tab, and modifiers and dead keys name no key a visitor could see. */
const NEVER = new Set(["Tab", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified", "Process", "Fn", "OS"]);

/** A KeyboardEvent.key as bindings store it: one character in lower case, anything else as given. */
export function normalKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** What `key` asks for, under `keys`; null when it is bound to nothing. */
export function actionOf(key: string, keys: Keys): Action | null {
  const k = normalKey(key);
  for (const a of REMAPPABLE) if (keys[a] === k) return a;
  return FIXED[k] ?? null;
}

/** True when `key` may be bound to an action. */
export function bindable(key: string): boolean {
  const k = normalKey(key);
  return !NEVER.has(k) && FIXED[k] === undefined;
}

/**
 * `keys` with `action` bound to `key`. A key another action holds is swapped: that action takes this one's old key.
 * Null when the key cannot be bound.
 */
export function rebind(keys: Keys, action: Remappable, key: string): Keys | null {
  if (!bindable(key)) return null;
  const k = normalKey(key);
  const next = { ...keys };
  for (const a of REMAPPABLE) if (a !== action && next[a] === k) next[a] = keys[action];
  next[action] = k;
  return next;
}

/** The family of keys a visitor steers with: the arrows, or the rebindable letters. */
export type KeyFamily = "arrows" | "letters";

/** The family `key` belongs to, if it steers or sets the speed; null otherwise. */
export function familyOf(key: string, keys: Keys): KeyFamily | null {
  const k = normalKey(key);
  if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") return "arrows";
  if (k === keys.left || k === keys.right || k === keys.boost || k === keys.slow) return "letters";
  return null;
}

/** Which of the steering and speed actions are held. */
export interface Held {
  left: boolean;
  right: boolean;
  boost: boolean;
  slow: boolean;
}

export const NONE_HELD: Held = { left: false, right: false, boost: false, slow: false };

/** What the keys in `down` (normalised) hold, under `keys`. */
export function heldFrom(down: ReadonlySet<string>, keys: Keys): Held {
  const held = { ...NONE_HELD };
  for (const key of down) {
    const a = actionOf(key, keys);
    if (a === "left" || a === "right" || a === "boost" || a === "slow") held[a] = true;
  }
  return held;
}
