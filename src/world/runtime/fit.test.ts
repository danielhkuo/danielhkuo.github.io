import assert from "node:assert/strict";
import { test } from "node:test";
import { fitScale } from "./fit.ts";

test("fitScale picks the largest whole scale that fits", () => {
  assert.equal(fitScale(1920, 1080, 400, 225), 4);
  assert.equal(fitScale(1000, 700, 400, 225), 2);
  assert.equal(fitScale(2560, 1440, 400, 225), 6);
  assert.equal(fitScale(1600, 899, 400, 225), 3, "one pixel short of 4 in height");
});

test("a viewport smaller than the frame still gets scale 1", () => {
  assert.equal(fitScale(300, 200, 400, 225), 1);
  assert.equal(fitScale(0, 0, 400, 225), 1);
});
