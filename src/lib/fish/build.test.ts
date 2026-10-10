import assert from "node:assert/strict";
import { test } from "node:test";
import { drawFish } from "./build.ts";
import { selfIntersections, signedArea, type Pt } from "./geometry.ts";

const pairs = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

test("a name always draws the same fish, whatever was drawn before it", () => {
  const first = drawFish("leaf");
  drawFish("skyspace");
  // Upstream fishdraw fails this: its noise table is filled once per process.
  assert.deepEqual(drawFish("leaf"), first);
});

test("different names draw different fish", () => {
  assert.notEqual(drawFish("leaf").ink, drawFish("MeetMe").ink);
});

test("strokes are compact path data on the half-unit grid", () => {
  const { ink, hatch, w, h } = drawFish("HoldTrue");
  for (const d of [ink, hatch]) assert.match(d, /^(M\d+ \d+l[-\d ]+)+$/);
  assert.ok(Number.isInteger(w) && Number.isInteger(h) && w > h && h > 0);
});

test("the outline is one simple clockwise loop that sits on the fish", () => {
  for (const name of ["leaf", "MeetMe", "empty-state-repo"]) {
    const fish = drawFish(name);
    const outline = pairs(fish.sil);
    assert.ok(outline.length > 100, `${name}: ${outline.length} vertices`);
    assert.ok(signedArea(outline) > 0, `${name}: clockwise`);
    assert.equal(selfIntersections(outline), 0, `${name}: no crossings`);
    // The silhouette covers the body and fins; whiskers and teeth can poke out of it,
    // never the other way round by more than the line it traces.
    for (const [x, y] of outline) {
      assert.ok(x >= -4 && y >= -4 && x <= fish.w + 4 && y <= fish.h + 4, `${name}: ${x},${y} outside ${fish.w}x${fish.h}`);
    }
    assert.equal(fish.soft.length, fish.sil.length, `${name}: soft copy is index-aligned`);
  }
});
