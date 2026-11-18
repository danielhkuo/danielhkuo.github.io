import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTION_MS, createDiscoveries, DISCOVERY_KEY, type KeyValue } from "./discoveries.ts";

function memory(initial: Record<string, string> = {}): KeyValue & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

test("a new sight is recorded, captioned for a while, and remembered", () => {
  let clock = 1000;
  const store = memory();
  const d = createDiscoveries(store, () => clock);
  assert.equal(d.caption(), null);
  assert.equal(d.discover("whale", "A whale, breaching"), true);
  assert.equal(d.caption(), "A whale, breaching");
  clock += CAPTION_MS - 1;
  assert.equal(d.caption(), "A whale, breaching");
  clock += 2;
  assert.equal(d.caption(), null);
  assert.deepEqual(JSON.parse(store.data[DISCOVERY_KEY]), ["whale"]);
  assert.deepEqual(d.list(), ["whale"]);
});

test("a sight seen before is not news again, even on a later visit", () => {
  const store = memory({ [DISCOVERY_KEY]: JSON.stringify(["whale"]) });
  const d = createDiscoveries(store, () => 0);
  assert.equal(d.discover("whale", "A whale, breaching"), false);
  assert.equal(d.caption(), null);
  assert.equal(d.discover("fox", "A fox in the barley"), true);
  assert.deepEqual(d.list(), ["whale", "fox"]);
});

test("a newer find replaces the caption", () => {
  let clock = 0;
  const d = createDiscoveries(memory(), () => clock);
  d.discover("a", "First");
  clock += 1000;
  d.discover("b", "Second");
  assert.equal(d.caption(), "Second");
  clock += CAPTION_MS - 10;
  assert.equal(d.caption(), "Second");
});

test("broken or missing storage still works for this visit", () => {
  const throwing: KeyValue = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  for (const store of [null, throwing, memory({ [DISCOVERY_KEY]: "{not json" }), memory({ [DISCOVERY_KEY]: JSON.stringify({ a: 1 }) })]) {
    const d = createDiscoveries(store, () => 0);
    assert.equal(d.discover("heron", "A heron in the shallows"), true);
    assert.equal(d.discover("heron", "A heron in the shallows"), false);
    assert.deepEqual(d.list(), ["heron"]);
  }
});
