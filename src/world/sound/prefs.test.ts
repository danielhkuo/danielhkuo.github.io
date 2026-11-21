import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VOLUME, KEY_VOLUME, KEY_WANTED, readPrefs, volumeGain, writeVolume, writeWanted } from "./prefs.ts";

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

test("missing or unreadable storage is off, at the default volume", () => {
  assert.deepEqual(readPrefs(null), { wanted: false, volume: DEFAULT_VOLUME, headphones: false });
  assert.deepEqual(readPrefs(store()), { wanted: false, volume: DEFAULT_VOLUME, headphones: false });
  const broken = {
    getItem(): string | null {
      throw new Error("blocked");
    },
    setItem(): void {
      throw new Error("blocked");
    },
  };
  assert.equal(readPrefs(broken).wanted, false);
  writeWanted(broken, true);
  writeVolume(broken, 0.5);
});

test("the choice and the volume round-trip", () => {
  const s = store();
  writeWanted(s, true);
  writeVolume(s, 0.42);
  assert.equal(s.m.get(KEY_WANTED), "on");
  assert.equal(s.m.get(KEY_VOLUME), "42");
  assert.deepEqual(readPrefs(s), { wanted: true, volume: 0.42, headphones: false });
  writeWanted(s, false);
  assert.equal(readPrefs(s).wanted, false);
});

test("a volume that is not a number, or out of range, is made safe", () => {
  assert.equal(readPrefs(store({ [KEY_VOLUME]: "loud" })).volume, DEFAULT_VOLUME);
  assert.equal(readPrefs(store({ [KEY_VOLUME]: "" })).volume, DEFAULT_VOLUME);
  assert.equal(readPrefs(store({ [KEY_VOLUME]: "250" })).volume, 1);
  assert.equal(readPrefs(store({ [KEY_VOLUME]: "-3" })).volume, 0);
});

test("the volume law is the square", () => {
  assert.equal(volumeGain(1), 1);
  assert.equal(volumeGain(0), 0);
  assert.ok(Math.abs(volumeGain(0.7) - 0.49) < 1e-12);
  assert.equal(volumeGain(4), 1);
});
