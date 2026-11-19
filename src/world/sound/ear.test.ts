import assert from "node:assert/strict";
import { test } from "node:test";
import { createEar } from "./ear.ts";

test("until the scans are built the ear reports open, silent land, stamped with the frame's time", () => {
  const ear = createEar();
  const h = ear.step({ t: 12.5, dt: 1 / 60, x: 0, y: 0, alt: 20, heading: 0, speed: 60, bank: 0, rest: 0 }, { bake: null, rect: null, t: 12.5 });
  assert.equal(h.t, 12.5);
  assert.equal(h.sea, 0);
  assert.deepEqual(h.shores, []);
  assert.equal(h.surf[0].e + h.surf[1].e + h.surf[2].e + h.far.e, 0);
  assert.equal(ear.hearing(), h);
});
