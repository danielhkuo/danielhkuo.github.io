import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOOST, CLEARANCE, CRUISE, DT_MAX, FLOOR_MARGIN, MIN_GAP, startState, stepFlight, TURN,
  type FlightInput, type FlightState, type Terrain,
} from "./flight.ts";

const N = 6400;
const flat: Terrain = { groundHeight: () => 0, occlusionFloor: () => 0 };
const STRAIGHT: FlightInput = { turn: 0, boost: false, brake: false };
const torusStep = (a: number, b: number) => {
  let d = (((b - a) % N) + N) % N;
  if (d >= N / 2) d -= N;
  return d;
};

function fly(s: FlightState, input: FlightInput, seconds: number, terrain: Terrain, each?: (s: FlightState) => void): FlightState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    s = stepFlight(s, input, dt, terrain, N);
    each?.(s);
  }
  return s;
}

test("the start state cruises level along the start's heading, at the height it will hold", () => {
  const terrain: Terrain = { groundHeight: () => 12, occlusionFloor: () => 0 };
  const s = startState({ x: 100, y: 200, dx: 0, dy: -1 }, terrain);
  assert.deepEqual([s.x, s.y, s.speed, s.bank], [100, 200, CRUISE, 0]);
  assert.ok(Math.abs(Math.cos(s.heading)) < 1e-9 && Math.abs(Math.sin(s.heading) + 1) < 1e-9, `heading ${s.heading}`);
  assert.equal(s.alt, 12 + CLEARANCE);
});

test("cruising covers 60 cells a second", () => {
  let s = startState({ x: 100, y: 100, dx: 1, dy: 0 }, flat);
  s = fly(s, STRAIGHT, 3, flat);
  const x0 = s.x, y0 = s.y;
  s = fly(s, STRAIGHT, 1, flat);
  assert.ok(Math.abs(torusStep(x0, s.x) - CRUISE) <= 0.5, `${torusStep(x0, s.x)} cells`);
  assert.ok(Math.abs(s.y - y0) < 1e-6);
});

test("boost and brake change speed smoothly, without overshoot", () => {
  let s = startState({ x: 100, y: 100, dx: 1, dy: 0 }, flat);
  let last = s.speed;
  s = fly(s, { turn: 0, boost: true, brake: false }, 4, flat, (q) => {
    assert.ok(q.speed >= last - 1e-9 && q.speed <= CRUISE * BOOST + 1e-9);
    last = q.speed;
  });
  assert.ok(Math.abs(s.speed - CRUISE * BOOST) < 1);
  s = fly(s, { turn: 0, boost: false, brake: true }, 4, flat);
  assert.ok(s.speed < CRUISE * 0.55);
});

test("a full turn takes 2π/TURN seconds once banked, and right turns clockwise", () => {
  let s = startState({ x: 3000, y: 3000, dx: 1, dy: 0 }, flat);
  const right: FlightInput = { turn: 1, boost: false, brake: false };
  s = fly(s, right, 1, flat, (q) => assert.ok(q.bank <= 1 + 1e-9));
  assert.ok(s.bank > 0.99);
  const h0 = s.heading;
  let t = 0;
  while (s.heading - h0 < 2 * Math.PI && t < 10) {
    s = stepFlight(s, right, 1 / 60, flat, N);
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - (2 * Math.PI) / TURN) <= 0.25, `${t} s`);
  // Clockwise on screen: heading east, a right turn swings south (y grows).
  let q = startState({ x: 3000, y: 3000, dx: 1, dy: 0 }, flat);
  q = fly(q, right, 0.5, flat);
  assert.ok(q.y > 3000);
});

test("the flier keeps clear of the ground and above the occlusion floor", () => {
  const ramp: Terrain = { groundHeight: (x) => 0.1 * ((x % N) - 100), occlusionFloor: (x) => ((x % N) > 400 ? 60 : 0) };
  let s = startState({ x: 100, y: 500, dx: 1, dy: 0 }, ramp);
  s = fly(s, STRAIGHT, 3, ramp);
  fly(s, STRAIGHT, 5, ramp, (q) => {
    const want = Math.max(ramp.groundHeight(q.x, q.y) + CLEARANCE, ramp.occlusionFloor(q.x, q.y) + FLOOR_MARGIN);
    if (Math.abs(q.x - 400) > 70) assert.ok(q.alt >= want - 0.5, `alt ${q.alt} under ${want} at x ${q.x}`);
  });
});

test("the flier never goes under the ground, even at a cliff", () => {
  const cliff: Terrain = { groundHeight: (x) => ((x % N) > 300 ? 100 : 0), occlusionFloor: () => 0 };
  const s = startState({ x: 100, y: 500, dx: 1, dy: 0 }, cliff);
  fly(s, { turn: 0, boost: true, brake: false }, 8, cliff, (q) => {
    assert.ok(q.alt >= cliff.groundHeight(q.x, q.y) + MIN_GAP - 1e-9, `alt ${q.alt} at x ${q.x}`);
  });
});

test("a long frame is clamped", () => {
  const s = startState({ x: 100, y: 100, dx: 1, dy: 0 }, flat);
  const input: FlightInput = { turn: 1, boost: true, brake: false };
  assert.deepEqual(stepFlight(s, input, 5, flat, N), stepFlight(s, input, DT_MAX, flat, N));
  assert.deepEqual(stepFlight(s, input, -1, flat, N), stepFlight(s, input, 0, flat, N));
});

test("position wraps into the world", () => {
  let s = startState({ x: N - 1, y: N - 1, dx: Math.SQRT1_2, dy: Math.SQRT1_2 }, flat);
  s = stepFlight(s, STRAIGHT, 0.1, flat, N);
  assert.ok(s.x >= 0 && s.x < N && s.y >= 0 && s.y < N, `${s.x}, ${s.y}`);
  assert.ok(s.x < 10 && s.y < 10);
});

test("stepping does not change the state it is given", () => {
  const s = startState({ x: 100, y: 100, dx: 1, dy: 0 }, flat);
  const copy = { ...s };
  stepFlight(s, { turn: -1, boost: true, brake: false }, 0.05, flat, N);
  assert.deepEqual(s, copy);
});
