import assert from "node:assert/strict";
import { test } from "node:test";
import { actionOf, bindable, DEFAULT_KEYS, familyOf, heldFrom, normalKey, rebind } from "./bindings.ts";
import { DEAD_ZONE, firstPad, padFamily, padNames, presses, readPad, type PadLike } from "./gamepad.ts";
import { defaultOptions, GENTLE, OPTIONS_KEY, paceOf, readOptions, writeOptions, type Store } from "./options.ts";

test("keys: the letters, arrows, Shift, Enter, Esc and O do what the flight says", () => {
  const k = DEFAULT_KEYS;
  assert.deepEqual(["a", "D", "ArrowUp", "Shift", "s", " ", "Enter", "Escape", "o", "q"].map((key) => actionOf(key, k)), [
    "left", "right", "boost", "boost", "slow", "land", "land", "back", "options", null,
  ]);
  assert.equal(normalKey("W"), "w");
  assert.equal(normalKey("ArrowLeft"), "ArrowLeft");
});

test("held keys ask for their actions; anything unbound asks for nothing", () => {
  assert.deepEqual(heldFrom(new Set(["a", "ArrowUp", "x"]), DEFAULT_KEYS), { left: true, right: false, boost: true, slow: false });
  assert.equal(familyOf("ArrowLeft", DEFAULT_KEYS), "arrows");
  assert.equal(familyOf("w", DEFAULT_KEYS), "letters");
  assert.equal(familyOf(" ", DEFAULT_KEYS), null);
});

test("rebinding takes a free key, swaps a taken one, and refuses the fixed and the unnameable", () => {
  const e = rebind(DEFAULT_KEYS, "land", "e");
  assert.deepEqual(e, { ...DEFAULT_KEYS, land: "e" });
  const swapped = rebind(DEFAULT_KEYS, "left", "D");
  assert.deepEqual(swapped, { ...DEFAULT_KEYS, left: "d", right: "a" });
  for (const key of ["Escape", "ArrowLeft", "Shift", "Enter", "o", "Tab", "Control", "Meta", "Dead"]) {
    assert.equal(bindable(key), false, key);
    assert.equal(rebind(DEFAULT_KEYS, "boost", key), null, key);
  }
});

function pad(axes: number[], pressed: number[] = [], values: Record<number, number> = {}, id = "Xbox Wireless Controller (STANDARD GAMEPAD)"): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) }));
  return { id, mapping: "standard", axes, buttons };
}

test("the stick steers past its dead zone, rescaled; the d-pad steers fully", () => {
  assert.equal(readPad(pad([DEAD_ZONE * 0.9, 0])).turn, 0);
  assert.ok(Math.abs(readPad(pad([1, 0])).turn - 1) < 1e-9);
  assert.ok(Math.abs(readPad(pad([-0.6, 0])).turn + 0.5) < 1e-9);
  assert.equal(readPad(pad([0, 0], [14])).turn, -1);
  assert.equal(readPad(pad([0, 0], [14, 15])).turn, 0);
});

test("the right trigger or shoulder boosts, the left ones slow, and the face buttons are read for presses", () => {
  assert.equal(readPad(pad([0, 0], [], { 7: 0.8 })).boost, true);
  assert.equal(readPad(pad([0, 0], [], { 7: 0.1 })).boost, false);
  assert.equal(readPad(pad([0, 0], [5])).boost, true);
  assert.equal(readPad(pad([0, 0], [6])).slow, true);
  const r = readPad(pad([0, 0], [0, 9]));
  assert.deepEqual(r.down, { land: true, back: false, leave: false, options: true });
  assert.equal(r.active, true);
  assert.equal(readPad(pad([0.1, 0])).active, false);
});

test("a press is a button down now that was up the frame before", () => {
  const before = { land: true, back: false, leave: false, options: false };
  const now = { land: true, back: true, leave: false, options: false };
  assert.deepEqual(presses(now, before), { land: false, back: true, leave: false, options: false });
});

test("pads are named by family from their ids, and only the standard mapping is read", () => {
  assert.equal(padFamily("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)"), "xbox");
  assert.equal(padFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)"), "playstation");
  assert.equal(padFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e)"), "nintendo");
  assert.equal(padFamily("8BitDo SN30"), "generic");
  assert.deepEqual(padNames("playstation"), { boost: "R2", slow: "L2", leave: "create", options: "options" });
  const odd = { ...pad([0, 0]), mapping: "" };
  assert.equal(firstPad([null, odd]), null);
  assert.equal(firstPad([null, odd, pad([0, 0])])?.mapping, "standard");
});

function memory(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

test("options: defaults follow the system's motion setting, and what is stored reads back", () => {
  assert.equal(readOptions(null, true).motion, "reduced");
  assert.equal(readOptions(null, false).motion, "full");
  const store = memory();
  const o = { ...defaultOptions(false), boost: "toggle" as const, pace: "gentle" as const, keys: { ...DEFAULT_KEYS, land: "e" } };
  writeOptions(store, o);
  assert.deepEqual(readOptions(store, true), o);
  assert.equal(paceOf(o), GENTLE);
});

test("options: anything unreadable falls back field by field; clashing keys fall back together", () => {
  const store = memory();
  store.data.set(OPTIONS_KEY, JSON.stringify({ boost: "sideways", motion: "reduced", keys: { left: "Escape", land: "e" } }));
  const o = readOptions(store, false);
  assert.deepEqual([o.boost, o.pace, o.motion], ["hold", "cruise", "reduced"]);
  assert.deepEqual(o.keys, { ...DEFAULT_KEYS, land: "e" });
  store.data.set(OPTIONS_KEY, JSON.stringify({ keys: { left: "d" } }));
  assert.deepEqual(readOptions(store, false).keys, DEFAULT_KEYS);
  store.data.set(OPTIONS_KEY, "{not json");
  assert.deepEqual(readOptions(store, false), defaultOptions(false));
  const throwing: Store = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.deepEqual(readOptions(throwing, false), defaultOptions(false));
  assert.doesNotThrow(() => writeOptions(throwing, defaultOptions(false)));
});
