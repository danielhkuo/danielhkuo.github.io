// The flight's options, kept in localStorage: hold or toggle boost, the pace, motion, and the rebound keys.

import { DEFAULT_KEYS, REMAPPABLE, bindable, normalKey, type Keys } from "./bindings.ts";

/** The part of Storage this uses (the discoveries' KeyValue). */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Options {
  /** Hold a boost key to boost, or press it once to start and again to stop. */
  boost: "hold" | "toggle";
  /** Cruising at full speed, or at GENTLE of it. */
  pace: "cruise" | "gentle";
  /** Reduced: no boost streaks, a cut for the landing camera, guides that neither fade nor pulse. */
  motion: "full" | "reduced";
  keys: Keys;
  /** Touch: which thumb steers. Right-handed puts the stick on the left and the buttons on the right. */
  hand: "right" | "left";
  /** Touch: the controls' size, 80, 100, 125 or 150%. */
  size: "s" | "m" | "l" | "xl";
  /** Touch: the controls fade when untouched, or stay solid. */
  fade: "fade" | "solid";
  /** Touch: with one thumb, pushing the stick to its rim boosts. */
  thumb: "two" | "one";
  /** Touch: a light tick on Boost, a landing and a discovery, where the phone can (Android). */
  buzz: "on" | "off";
  /** Touch: steer by tilting the phone like a wheel. */
  tilt: "off" | "on";
}

/** The size setting as a scale. */
export const SIZE_SCALE: Record<Options["size"], number> = { s: 0.8, m: 1, l: 1.25, xl: 1.5 };

export const OPTIONS_KEY = "world:options";
/** The gentle pace, as a share of cruising speed. */
export const GENTLE = 0.6;

export function defaultOptions(prefersReducedMotion: boolean): Options {
  return {
    boost: "hold",
    pace: "cruise",
    motion: prefersReducedMotion ? "reduced" : "full",
    keys: { ...DEFAULT_KEYS },
    hand: "right",
    size: "m",
    fade: "fade",
    thumb: "two",
    buzz: "on",
    tilt: "off",
  };
}

/** The keys in `raw`, where each is a key that can be bound and no two actions share one; the defaults otherwise. */
function keysFrom(raw: unknown): Keys {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_KEYS };
  const r = raw as Record<string, unknown>;
  const keys = { ...DEFAULT_KEYS };
  for (const a of REMAPPABLE) {
    const k = r[a];
    if (typeof k === "string" && bindable(k)) keys[a] = normalKey(k);
  }
  const seen = new Set(REMAPPABLE.map((a) => keys[a]));
  return seen.size === REMAPPABLE.length ? keys : { ...DEFAULT_KEYS };
}

/** The stored options, each field checked; anything missing or unreadable is the default (motion from the system). */
export function readOptions(store: Store | null, prefersReducedMotion: boolean): Options {
  const d = defaultOptions(prefersReducedMotion);
  if (!store) return d;
  try {
    const raw = store.getItem(OPTIONS_KEY);
    if (raw === null) return d;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      boost: o.boost === "toggle" ? "toggle" : "hold",
      pace: o.pace === "gentle" ? "gentle" : "cruise",
      motion: o.motion === "reduced" ? "reduced" : o.motion === "full" ? "full" : d.motion,
      keys: keysFrom(o.keys),
      hand: o.hand === "left" ? "left" : "right",
      size: o.size === "s" || o.size === "l" || o.size === "xl" ? o.size : "m",
      fade: o.fade === "solid" ? "solid" : "fade",
      thumb: o.thumb === "one" ? "one" : "two",
      buzz: o.buzz === "off" ? "off" : "on",
      tilt: o.tilt === "on" ? "on" : "off",
    };
  } catch {
    return d;
  }
}

export function writeOptions(store: Store | null, o: Options): void {
  if (!store) return;
  try {
    store.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    // storage refused this write; the options still hold for this visit
  }
}

/** The share of cruising speed `o` asks for. */
export function paceOf(o: Options): number {
  return o.pace === "gentle" ? GENTLE : 1;
}
