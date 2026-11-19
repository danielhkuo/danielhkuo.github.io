import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultOptions, OPTIONS_KEY, readOptions, SIZE_SCALE, writeOptions, type Store } from "./options.ts";

function store(initial: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

test("the touch settings default to right-handed, normal size, fading, two thumbs, ticks on and no tilt", () => {
  const d = defaultOptions(false);
  assert.deepEqual([d.hand, d.size, d.fade, d.thumb, d.buzz, d.tilt], ["right", "m", "fade", "two", "on", "off"]);
  assert.deepEqual(SIZE_SCALE, { s: 0.8, m: 1, l: 1.25, xl: 1.5 });
});

test("the touch settings round-trip through storage, and older stored options read with their defaults", () => {
  const s = store();
  const o = { ...defaultOptions(false), hand: "left" as const, size: "xl" as const, fade: "solid" as const, thumb: "one" as const, buzz: "off" as const, tilt: "on" as const };
  writeOptions(s, o);
  assert.deepEqual(readOptions(s, false), o);
  // Options stored before the touch settings existed keep what they had and gain the defaults.
  const old = store({ [OPTIONS_KEY]: JSON.stringify({ boost: "toggle", pace: "gentle", motion: "full" }) });
  const r = readOptions(old, false);
  assert.deepEqual([r.boost, r.pace, r.hand, r.size, r.tilt], ["toggle", "gentle", "right", "m", "off"]);
});

test("unreadable touch settings fall back to their defaults one by one", () => {
  const s = store({ [OPTIONS_KEY]: JSON.stringify({ hand: "both", size: "giant", fade: 1, thumb: null, buzz: "loud", tilt: true }) });
  const r = readOptions(s, false);
  assert.deepEqual([r.hand, r.size, r.fade, r.thumb, r.buzz, r.tilt], ["right", "m", "fade", "two", "on", "off"]);
});
