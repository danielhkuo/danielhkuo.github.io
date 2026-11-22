import assert from "node:assert/strict";
import { test } from "node:test";
import { CRUISE, startState, stepFlight, type FlightState, type Terrain } from "../runtime/flight.ts";
import { FLICK, headingOf, pointTurn, STEER_GAIN } from "./steer.ts";
import type { StickRead } from "./stick.ts";

const flat: Terrain = { groundHeight: () => 0, occlusionFloor: () => 0 };
const N = 6400;

function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

function stickTo(heading: number): StickRead {
  // A full push on screen toward the world heading: screen y is 0.8 of world y.
  const x = Math.cos(heading);
  const y = Math.sin(heading) * 0.8;
  const m = Math.hypot(x, y);
  return { x: x / m, y: y / m, mag: 1 };
}

test("a stick at rest asks for no turn", () => {
  assert.equal(pointTurn({ x: 0, y: 0, mag: 0 }, 1, 1), 0);
});

test("a screen direction maps to the world heading through the 0.8 foreshortening", () => {
  for (const h of [0, 0.3, 1, Math.PI / 2, 2.5, -2, -Math.PI / 2]) {
    const s = stickTo(h);
    assert.ok(Math.abs(wrapPi(headingOf(s.x, s.y) - h)) < 1e-9, `${h}`);
  }
  // Straight up the screen is north.
  assert.ok(Math.abs(headingOf(0, -1) - -Math.PI / 2) < 1e-12);
});

test("the turn is proportional to the error and full past the gain", () => {
  const ahead = stickTo(0.2);
  assert.ok(Math.abs(pointTurn(ahead, 0, 0) - 0.2 / STEER_GAIN) < 1e-9);
  assert.equal(pointTurn(stickTo(1.2), 0, 0), 1);
  assert.equal(pointTurn(stickTo(-1.2), 0, 0), -1);
});

test("a flick straight behind turns one way, the way the dragon already turns", () => {
  const behind = stickTo(Math.PI - 0.01);
  const behindOther = stickTo(-Math.PI + 0.01);
  assert.ok(Math.abs(wrapPi(Math.PI - 0.01)) > FLICK);
  assert.equal(pointTurn(behind, 0, -0.3), -1);
  assert.equal(pointTurn(behindOther, 0, -0.3), -1);
  assert.equal(pointTurn(behind, 0, 0.3), 1);
  assert.equal(pointTurn(behindOther, 0, 0), 1);
});

test("held toward a heading, the flight settles there within 3° in under 1.5 s, overshooting under 10°", () => {
  const dt = 1 / 60;
  for (let i = 0; i < 16; i++) {
    const start = (i / 16) * 2 * Math.PI - Math.PI;
    for (let j = 0; j < 8; j++) {
      const target = start + ((j + 1) / 9) * 2 * Math.PI - Math.PI;
      const goal = wrapPi(target);
      let s: FlightState = { ...startState({ x: 100, y: 100, dx: Math.cos(start), dy: Math.sin(start) }, flat), heading: start, speed: CRUISE };
      const stick = stickTo(goal);
      const firstError = wrapPi(goal - start);
      let settledAt: number | null = null;
      let overshoot = 0;
      for (let f = 0; f < 240; f++) {
        const turn = pointTurn(stick, s.heading, s.bank);
        s = stepFlight(s, { turn, boost: false, brake: false }, dt, flat, N);
        const err = wrapPi(goal - s.heading);
        // Past the goal: the error has changed sign from the first one.
        if (Math.sign(err) !== Math.sign(firstError)) overshoot = Math.max(overshoot, Math.abs(err));
        if (settledAt === null && Math.abs(err) < (3 * Math.PI) / 180) settledAt = (f + 1) * dt;
        if (settledAt !== null && Math.abs(err) >= (3 * Math.PI) / 180 && Math.sign(err) === Math.sign(firstError)) settledAt = null;
      }
      const label = `from ${start.toFixed(2)} to ${goal.toFixed(2)}`;
      assert.ok(settledAt !== null && settledAt < 1.5 + Math.abs(firstError) / 1.6, `${label}: settled at ${settledAt}`);
      assert.ok(overshoot < (10 * Math.PI) / 180, `${label}: overshot ${((overshoot * 180) / Math.PI).toFixed(1)}°`);
    }
  }
});
