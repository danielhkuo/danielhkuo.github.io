// The guides hold still on screen: their anchor is the head measured in whole pixels from the camera, so the flier's
// sub-pixel motion, which the view's floored origin used to turn into a one-pixel flicker, never reaches them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startState, stepFlight, type FlightState } from "../runtime/flight.ts";
import { cameraAt } from "../sites/landing.ts";
import { bodyOnScreen, DWELL, guideAnchor, NO_PLACEMENT, placeGuide, slotAt, SLOTS, type Placement } from "./guides.ts";

const N = 10240;
const flat = { groundHeight: () => 3.25, occlusionFloor: () => 0 };
const FRAMES: [number, number][] = [[400, 225], [481, 271], [320, 180]];

/** A flight at `hz` with the given turn and boost over time, from a start with fractional cells. */
function fly(hz: number, seconds: number, heading: number, turn: (t: number) => number, boost: (t: number) => boolean): FlightState[] {
  let s = startState({ x: 5000.37, y: 4000.61, dx: Math.cos(heading), dy: Math.sin(heading) }, flat);
  const out: FlightState[] = [];
  for (let i = 0; i < seconds * hz; i++) {
    s = stepFlight(s, { turn: turn(i / hz), boost: boost(i / hz), brake: false }, 1 / hz, flat, N);
    out.push(s);
  }
  return out;
}

test("in flight the anchor is the frame's centre on every frame, at 60 and 120 Hz, turning and boosting", () => {
  for (const hz of [60, 120]) {
    const runs = [
      fly(hz, 3, -Math.PI / 4, () => 0, () => false),
      fly(hz, 3, 1.9, () => 0, () => true),
      fly(hz, 3, 0.3, (t) => (Math.floor(t / 1.2) % 2 === 0 ? 1 : -0.6), (t) => t % 2 < 1),
    ];
    for (const states of runs) {
      for (const [fw, fh] of FRAMES) {
        for (const s of states) {
          assert.deepEqual(guideAnchor(s, cameraAt(s, null, 0, N), fw, fh, N), { x: fw >> 1, y: fh >> 1 });
        }
      }
    }
  }
});

test("the anchor reads across the world's edge as near, not a world away", () => {
  // The head is 0.3 cells east of the camera across x = 0, and 3.4 cells south of it across y = 0 (2.72 px down).
  const s = { x: 0.2, y: 3, alt: 20 };
  const camera = { x: N - 0.1, y: N - 0.4 - 20 / 0.8 };
  assert.deepEqual(guideAnchor(s, camera, 400, 225, N), { x: 200, y: 115 });
});

test("as the camera eases off the head, the anchor moves in whole steps and never back", () => {
  const s = { x: 5000.5, y: 4000.5, alt: 20, heading: 0, speed: 0, bank: 0 };
  const site = { x: 5070, y: 4031, alt: 30 };
  let last = guideAnchor(s, cameraAt(s, site, 0, N), 400, 225, N);
  for (let f = 0.002; f <= 1; f += 0.002) {
    const a = guideAnchor(s, cameraAt(s, site, f, N), 400, 225, N);
    assert.ok(Math.abs(a.x - last.x) <= 1 && Math.abs(a.y - last.y) <= 1, `step at ${f}`);
    assert.ok(a.x <= last.x && a.y <= last.y, "the head slides one way across the screen as the camera turns to the site");
    last = a;
  }
});

test("the body is placed from the anchor by its whole-pixel offsets from the head", () => {
  const s = { x: 100.4, y: 200.6, alt: 10 };
  const body = bodyOnScreen({ x: 50, y: 40 }, s, [{ x: 98.4, y: 205.6, alt: 10 }, { x: N - 3, y: 200.6, alt: 12 }], N);
  assert.deepEqual(body, [{ x: 48, y: 44 }, { x: 50 - 103, y: 38 }]);
});

/** Steps a placement `frames` times at 120 Hz with the same anchor and body. */
function hold(p: Placement, frames: number, body: { x: number; y: number }[], anchor = { x: 200, y: 112 }, reduced = false): Placement[] {
  const out: Placement[] = [];
  for (let i = 0; i < frames; i++) {
    p = placeGuide(p, anchor, 60, 12, 400, 225, body, SLOTS, 1 / 120, reduced);
    out.push(p);
  }
  return out;
}

test("a guide with a still anchor and a clear slot never moves", () => {
  const steps = hold(NO_PLACEMENT, 600, []);
  const first = steps[0];
  assert.equal(first.slot, "below");
  assert.deepEqual(first, { ...first, ...slotAt("below", { x: 200, y: 112 }, 60, 12) });
  for (const p of steps) assert.deepEqual([p.x, p.y, p.slot], [first.x, first.y, "below"]);
});

test("covered by the body, a guide waits DWELL, then glides to a clear slot a whole pixel at a time, never back", () => {
  const settled = hold(NO_PLACEMENT, 10, []).at(-1) as Placement;
  // The body trails down through the slot below.
  const under = Array.from({ length: 12 }, (_, i) => ({ x: 200, y: 128 + 3 * i }));
  const steps = hold(settled, Math.ceil(DWELL * 120) + 120, under);
  const waited = steps.findIndex((p) => p.slot !== "below");
  assert.ok(waited >= Math.floor(DWELL * 120) - 1, `moved after ${waited} frames`);
  const glide = steps.slice(waited);
  const target = slotAt(glide[0].slot as "right", { x: 200, y: 112 }, 60, 12);
  for (let i = 1; i < glide.length; i++) {
    for (const k of ["x", "y"] as const) {
      const step = glide[i][k] - glide[i - 1][k];
      assert.ok(Number.isInteger(glide[i][k]), "whole pixels");
      assert.ok(step === 0 || Math.sign(step) === Math.sign(target[k] - glide[i - 1][k]), "on toward the new slot");
    }
  }
  assert.deepEqual([glide.at(-1)?.x, glide.at(-1)?.y], [target.x, target.y], "arrived");
});

test("under reduced motion the move is a cut; a slot that leaves the frame is left at once", () => {
  const settled = hold(NO_PLACEMENT, 10, [], { x: 200, y: 112 }, true).at(-1) as Placement;
  const under = Array.from({ length: 12 }, (_, i) => ({ x: 200, y: 128 + 3 * i }));
  const moved = hold(settled, Math.ceil(DWELL * 120) + 2, under, { x: 200, y: 112 }, true).at(-1) as Placement;
  assert.deepEqual([moved.x, moved.y], [slotAt(moved.slot as "right", { x: 200, y: 112 }, 60, 12).x, slotAt(moved.slot as "right", { x: 200, y: 112 }, 60, 12).y]);
  // The head near the foot of the frame: below would leave it, so the guide goes at once.
  const low = placeGuide(settled, { x: 200, y: 218 }, 60, 12, 400, 225, [], SLOTS, 1 / 120, true);
  assert.notEqual(low.slot, "below");
});
