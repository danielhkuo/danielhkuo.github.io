import assert from "node:assert/strict";
import { test } from "node:test";
import { placesOf } from "./places.ts";

test("places come from the layer context, and survive JSON", () => {
  const p = placesOf(
    {
      seed: 3, n: 10240, forceSights: true,
      sites: [{ id: "town-0", type: "town", x: 6814, y: 3710 }, { id: "abbey-0", type: "abbey", x: 7798, y: 3126 }, { id: "lighthouse-2", type: "lighthouse", x: 10, y: 20 }],
      wonders: [{ id: "railway-0", type: "railway", x: 1, y: 2, level: 3, height: 4, anchors: { shore: [5, 6], halt: [7, 8] } }],
    },
    "ae1d17a8da49",
  );
  assert.deepEqual(p.abbeys, [{ x: 7798, y: 3126 }]);
  assert.deepEqual(p.towns, [{ x: 6814, y: 3710 }]);
  assert.deepEqual(p.lighthouses, [{ x: 10, y: 20 }]);
  assert.equal(p.forced, true);
  assert.deepEqual(p.wonders[0].anchors.halt, [7, 8]);
  // JSON-safe: text and back is the same value.
  const text = JSON.stringify(p);
  assert.equal(JSON.stringify(JSON.parse(text)), text);
  assert.equal(placesOf({ seed: 1, n: 64, sites: [] }, "x").wonders.length, 0);
});
