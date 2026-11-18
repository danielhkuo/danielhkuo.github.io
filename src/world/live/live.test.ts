import assert from "node:assert/strict";
import { test } from "node:test";
import { runLayers, type LiveFrame, type LiveLayer } from "./live.ts";

const frame = (): LiveFrame => ({ out: new Uint32Array(4), bake: new Uint32Array(4), rect: { x: 0, y: 0, w: 2, h: 2 }, t: 1, palette: new Uint32Array(65536), n: 1280 });

test("layers run in order, each seeing the last one's work", () => {
  const seen: string[] = [];
  const a: LiveLayer = { name: "a", draw: (f) => { seen.push("a"); f.out[0] = 7; } };
  const b: LiveLayer = { name: "b", draw: (f) => { seen.push(`b${f.out[0]}`); } };
  runLayers([a, b], frame(), new Set());
  assert.deepEqual(seen, ["a", "b7"]);
});

test("a layer that throws is reported once and skipped after, and the others still run", () => {
  const errors: string[] = [];
  let ran = 0;
  const bad: LiveLayer = { name: "bad", draw: () => { throw new Error("boom"); } };
  const good: LiveLayer = { name: "good", draw: () => { ran++; } };
  const disabled = new Set<string>();
  for (let k = 0; k < 3; k++) runLayers([bad, good], frame(), disabled, (n, m) => errors.push(`${n}: ${m}`));
  assert.deepEqual(errors, ["bad: boom"]);
  assert.equal(ran, 3);
  assert.ok(disabled.has("bad"));
});

test("no layers is fine", () => {
  assert.doesNotThrow(() => runLayers([], frame(), new Set()));
});
