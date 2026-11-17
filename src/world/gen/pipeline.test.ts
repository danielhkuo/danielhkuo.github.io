import assert from "node:assert/strict";
import { test } from "node:test";
import { paramsFor } from "./params.ts";
import { capLand, type Land, makeLand } from "./pipeline.ts";

const p = paramsFor(1024);
let memo: Land | null = null;
const land = () => (memo ??= makeLand(p, 42));

test("capLand scales land only, and only when it is too high", () => {
  const g = new Float64Array([-3, 10, 200, 50]), sea = new Uint8Array([1, 0, 0, 0]);
  assert.equal(capLand(g, sea, 100), 0.5);
  assert.deepEqual([...g], [-3, 5, 100, 25]);
  assert.equal(capLand(g, sea, 100), 1);
});

test("land stays under the cap, keeps its coastline, and carries debris", () => {
  const l = land();
  let max = 0, debris = 0;
  for (let i = 0; i < l.g.length; i++) {
    if (l.isSea[i]) assert.ok(l.g[i] <= 0);
    else { assert.ok(l.g[i] > 0); max = Math.max(max, l.g[i]); }
    assert.ok(l.debris[i] >= 0);
    debris += l.debris[i];
  }
  assert.ok(max <= p.talus.cap + 1e-9, `max ${max}`);
  assert.ok(debris > 0);
  assert.equal(l.rock.length, l.g.length);
});

test("deterministic", () => {
  assert.deepEqual(makeLand(p, 42).g, land().g);
});

test("makeWorld chains hydrology, rivers and climate", async () => {
  const { makeWorld } = await import("./pipeline.ts");
  const w = makeWorld(p, 42);
  assert.equal(w.rivers.ground.length, p.gN * p.gN);
  assert.ok(w.rivers.reaches.length > 10);
  assert.equal(w.climate.moisture.length, p.cN * p.cN);
  for (const r of w.rivers.reaches) assert.ok(r.endsIn === "sea" || r.endsIn === "lake" || r.endsIn === "reach");
});
