// The world held behind the title: the dragon waits in place, low in the frame under the window, until the visitor
// enters the world; then it sets off and the camera eases back onto it. Back holds it again: it glides to a stop and
// the camera eases down. Pure rules, so the session only has to apply them each frame.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CRUISE, stepFlight, type FlightInput, type FlightState } from "./flight.ts";
import { cameraAt } from "../sites/landing.ts";
import { guideAnchor } from "../controls/guides.ts";
import { easeHold, HELD_INPUT, HOLD_AT, HOLD_LOW, holdCamera, holdStep } from "./hold.ts";

const N = 10240;
const FLAT = { groundHeight: () => 0, occlusionFloor: () => 0 };
const DT = 1 / 120;
const FLY: FlightInput = { turn: 0, boost: false, brake: false, pace: 1 };

function state(speed: number): FlightState {
  return { x: 5000, y: 6000, heading: -Math.PI / 2, speed, alt: 18, bank: 0 };
}

/** Runs the flight for `seconds` as the session does: the model's step, then the hold's. */
function run(s: FlightState, held: boolean, seconds: number, each?: (s: FlightState, t: number) => void): FlightState {
  for (let t = DT; t <= seconds + 1e-9; t += DT) {
    s = holdStep(stepFlight(s, held ? HELD_INPUT : FLY, DT, FLAT, N), held, DT);
    each?.(s, t);
  }
  return s;
}

test("held, the dragon is asked for nothing: no turn, no boost or brake, and no pace", () => {
  assert.deepEqual(HELD_INPUT, { turn: 0, boost: false, brake: false, pace: 0 });
});

test("held from the start, it does not move at all", () => {
  const s0 = state(0);
  const s = run(s0, true, 10);
  assert.equal(s.speed, 0);
  assert.equal(s.x, s0.x);
  assert.equal(s.y, s0.y);
  assert.equal(s.heading, s0.heading);
});

test("held in flight, it reins in to a stop: slowing every frame, and stopped outright as the window comes back", () => {
  let last = CRUISE;
  let at01 = -1;
  const s = run(state(CRUISE), true, 0.7, (f, t) => {
    assert.ok(f.speed <= last + 1e-9, `t=${t.toFixed(3)} it never speeds up`);
    last = f.speed;
    if (at01 < 0 && t >= 0.1) at01 = f.speed;
  });
  assert.ok(at01 > 0.3 * CRUISE, `a glide, not a halt: ${at01.toFixed(1)} cells/s after a tenth of a second`);
  assert.equal(s.speed, 0, "stopped outright within 0.7 s");
  const x = s.x, y = s.y;
  const still = run(s, true, 2);
  assert.equal(still.x, x);
  assert.equal(still.y, y);
});

test("let go, it sets off at once: over half its cruising speed within 0.6 s", () => {
  const s = run(state(0), false, 0.6);
  assert.ok(s.speed > 0.5 * CRUISE, `${s.speed.toFixed(1)} cells/s`);
  assert.ok(s.y < state(0).y, "it has moved off along its heading (north)");
});

test("in flight the hold changes nothing", () => {
  for (const speed of [0, 0.2, 30, CRUISE]) assert.deepEqual(holdStep(state(speed), false, DT), state(speed));
});

test("the camera's share comes down as fast as the window comes back, eases out over a second, and cuts under reduced motion", () => {
  let share = 0;
  let t = 0;
  while (share < 1 && t < 3) {
    const next = easeHold(share, true, DT, false);
    assert.ok(next >= share && next <= 1, "rises, never past 1");
    share = next;
    t += DT;
  }
  assert.ok(t >= 0.5 && t <= 0.8, `held, it eases down in ${t.toFixed(2)} s`);
  assert.ok(easeHold(0, true, 0.25, false) > 0.1 && easeHold(0, true, 0.25, false) < 0.5, "a quarter second is part of the way");
  t = 0;
  while (share > 0 && t < 3) {
    const next = easeHold(share, false, DT, false);
    assert.ok(next <= share && next >= 0, "falls, never past 0");
    share = next;
    t += DT;
  }
  assert.ok(t >= 0.8 && t <= 1.5, `let go, it eases back in ${t.toFixed(2)} s`);
  assert.equal(easeHold(0, true, DT, true), 1, "reduced motion: cut to held");
  assert.equal(easeHold(1, false, DT, true), 0, "reduced motion: cut to flying");
});

test("held, the camera sits so the dragon's head is drawn 80% of the way down the frame, under the window", () => {
  assert.equal(HOLD_LOW, 0.3);
  assert.deepEqual(HOLD_AT, { x: 0.5, y: 0.8 });
  for (const [fw, fh] of [[400, 225], [480, 300], [356, 200]]) {
    const s = state(0);
    const flying = cameraAt(s, null, 0, N);
    assert.deepEqual(holdCamera(flying, 0, fw, fh), flying, "share 0 is the flight's own framing");
    const low = guideAnchor(s, holdCamera(flying, 1, fw, fh), fw, fh, N);
    assert.equal(low.x, fw >> 1, "still centred across");
    assert.ok(Math.abs(low.y - 0.8 * fh) <= 1, `${fw}×${fh}: head at ${low.y}, wanted ${0.8 * fh}`);
    const half = guideAnchor(s, holdCamera(flying, 0.5, fw, fh), fw, fh, N);
    assert.ok(Math.abs(half.y - 0.65 * fh) <= 1, `${fw}×${fh}: halfway at ${half.y}`);
  }
});

test("the title can hold the head anywhere in the frame: beside its button, say", () => {
  for (const [fw, fh] of [[400, 225], [480, 300]]) {
    for (const at of [{ x: 0.62, y: 0.84 }, { x: 0.3, y: 0.7 }]) {
      const s = state(0);
      const held = guideAnchor(s, holdCamera(cameraAt(s, null, 0, N), 1, fw, fh, at), fw, fh, N);
      assert.ok(Math.abs(held.x - at.x * fw) <= 1 && Math.abs(held.y - at.y * fh) <= 1, `${fw}×${fh} at ${at.x},${at.y}: ${held.x},${held.y}`);
    }
  }
});
