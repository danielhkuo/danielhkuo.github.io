import assert from "node:assert/strict";
import { test } from "node:test";
import { probe } from "./probe.ts";

test("probe goldens", () => {
  assert.equal(probe(42), "96af1f02");
  assert.equal(probe(0), "f2d012ce");
  assert.equal(probe(1), "2b0f51b7");
});
