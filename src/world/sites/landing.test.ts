import assert from "node:assert/strict";
import { test } from "node:test";
import { CRUISE, MIN_GAP, type FlightInput, type FlightState, type Terrain } from "../runtime/flight.ts";
import {
  advance, beginLanding, cameraAt, easeFocus, FOCUS_RATE, LANDING_CAP, land, MAX_TURN, NEAR, nearest, offered,
  pullUp, QUIET_FACTOR, REST_LIFT, restShare, takeOff, type Phase, type Target,
} from "./landing.ts";

const N = 10240;
const DT = 1 / 60;
const STILL: FlightInput = { turn: 0, boost: false, brake: false };
const ground = (h: number): Terrain => ({ groundHeight: () => h, occlusionFloor: () => 0 });
const FLAT = ground(5);
const TOWER: Target = { id: "lighthouse-0", x: 5000, y: 5000, radius: 9 };
const ABBEY: Target = { id: "abbey-0", x: 6000, y: 5000, radius: 23 };
const TARGETS = [TOWER, ABBEY];
const FLYING: Phase = { kind: "flying", quiet: null };

function flier(x: number, y: number, heading: number, alt = 23, speed = CRUISE): FlightState {
  return { x, y, heading, speed, alt, bank: 0 };
}

function delta(a: number, b: number): number {
  let d = (((b - a) % N) + N) % N;
  if (d >= N / 2) d -= N;
  return d;
}

function turned(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Steps from `s` toward `target` until landed or `seconds` pass; calls `each` with every step's states. */
function comeDown(s: FlightState, target: Target, terrain: Terrain, seconds = LANDING_CAP + 1, each?: (prev: FlightState, next: FlightState) => void) {
  let phase: Phase = { kind: "landing", approach: beginLanding(s, target, N) };
  let t = 0;
  while (phase.kind === "landing" && t < seconds) {
    const r = advance(phase, s, STILL, DT, terrain, N, TARGETS);
    each?.(s, r.s);
    s = r.s;
    phase = r.phase;
    t += DT;
  }
  return { s, phase, t };
}

test("the nearest landmark within reach is offered, the short way round the world", () => {
  assert.equal(nearest(5000 + NEAR - 1, 5000, TARGETS, N)?.id, "lighthouse-0");
  assert.equal(nearest(5000 + NEAR + 1, 5010, TARGETS, N), null);
  const edge: Target = { id: "yew-0", x: 20, y: 20, radius: 22 };
  assert.equal(nearest(N - 40, N - 40, [edge], N)?.id, "yew-0");
});

test("a landing is offered only while flying, and never at the site just left", () => {
  assert.equal(offered(FLYING, 5050, 5000, TARGETS, N)?.id, "lighthouse-0");
  assert.equal(offered({ kind: "flying", quiet: "lighthouse-0" }, 5050, 5000, TARGETS, N), null);
  assert.equal(offered({ kind: "landed", id: "lighthouse-0" }, 5050, 5000, TARGETS, N), null);
});

test("landing begins only near a landmark", () => {
  const near = land(FLYING, flier(5060, 5000, Math.PI), TARGETS, N);
  assert.equal(near.kind, "landing");
  assert.deepEqual(land(FLYING, flier(4000, 4000, 0), TARGETS, N), FLYING);
  const landed: Phase = { kind: "landed", id: "abbey-0" };
  assert.equal(land(landed, flier(6000, 5023, 0), TARGETS, N), landed);
});

test("from any heading and distance, the dragon coils down to rest at the landmark's south point", () => {
  for (const d of [30, 70, NEAR]) {
    for (let k = 0; k < 8; k++) {
      const bearing = (k * Math.PI) / 4 + 0.3;
      for (const heading of [bearing, bearing + Math.PI / 2, bearing + Math.PI]) {
        const start = flier(TOWER.x + d * Math.cos(bearing), TOWER.y + d * Math.sin(bearing), heading);
        const label = `d ${d} bearing ${bearing.toFixed(2)} heading ${heading.toFixed(2)}`;
        const { s, phase, t } = comeDown(start, TOWER, FLAT, LANDING_CAP + 1, (prev, next) => {
          assert.ok(Math.abs(turned(next.heading, prev.heading)) <= MAX_TURN * DT + 1e-9, `${label}: heading jumped`);
          assert.ok(next.alt >= 5 + MIN_GAP - 1e-9, `${label}: below the ground`);
        });
        assert.equal(phase.kind, "landed", label);
        assert.ok(t < LANDING_CAP - 1, `${label}: took ${t.toFixed(1)} s`);
        assert.ok(Math.abs(delta(TOWER.x, s.x)) < 3 && Math.abs(delta(TOWER.y + TOWER.radius, s.y)) < 3, `${label}: rests at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
        assert.equal(s.speed, 0, label);
        assert.ok(Math.abs(s.alt - (5 + REST_LIFT)) < 0.5, `${label}: rests at height ${s.alt.toFixed(2)}`);
      }
    }
  }
});

test("it slows as it comes down and never speeds up in its last second", () => {
  const speeds: number[] = [];
  const { t } = comeDown(flier(TOWER.x + 80, TOWER.y, Math.PI / 2), TOWER, FLAT, LANDING_CAP + 1, (_p, next) => speeds.push(next.speed));
  const last = speeds.slice(-Math.round(1 / DT));
  for (let i = 1; i < last.length; i++) assert.ok(last[i] <= last[i - 1] + 1e-9, `rose at ${i}`);
  assert.ok(Math.max(...speeds) <= CRUISE + 1e-9 && t > 2);
});

test("it comes down onto the ground where it lies, not a level of its own", () => {
  const slope: Terrain = { groundHeight: (x) => 5 + 0.1 * (x - 5000), occlusionFloor: () => 0 };
  const { s } = comeDown(flier(TOWER.x + 60, TOWER.y, Math.PI / 2, 40), TOWER, slope);
  assert.ok(Math.abs(s.alt - (slope.groundHeight(s.x, s.y) + REST_LIFT)) < 0.5, `alt ${s.alt}`);
});

test("it lands across the world's edge", () => {
  const edge: Target = { id: "windmill-0", x: 10, y: 10, radius: 10.4 };
  const { s, phase } = comeDown(flier(N - 50, 10, 0), edge, FLAT);
  assert.equal(phase.kind, "landed");
  assert.ok(Math.abs(delta(edge.x, s.x)) < 3 && Math.abs(delta(edge.y + edge.radius, s.y)) < 3, `(${s.x}, ${s.y})`);
});

test("landed, it holds still whatever keys are down", () => {
  const { s } = comeDown(flier(TOWER.x + 50, TOWER.y, Math.PI / 2), TOWER, FLAT);
  const landed: Phase = { kind: "landed", id: TOWER.id };
  const r = advance(landed, s, { turn: 1, boost: true, brake: false }, 0.5, FLAT, N, TARGETS);
  assert.deepEqual([r.s.x, r.s.y, r.s.heading, r.s.speed, r.s.alt], [s.x, s.y, s.heading, 0, s.alt]);
  assert.equal(r.phase, landed);
  assert.equal(r.landed, null);
});

test("the step that finishes the coil reports the landing once", () => {
  let s = flier(TOWER.x + 50, TOWER.y, Math.PI / 2);
  let phase: Phase = { kind: "landing", approach: beginLanding(s, TOWER, N) };
  const reports: string[] = [];
  for (let i = 0; i < 60 * (LANDING_CAP + 2); i++) {
    const r = advance(phase, s, STILL, DT, FLAT, N, TARGETS);
    if (r.landed) reports.push(r.landed);
    s = r.s;
    phase = r.phase;
  }
  assert.deepEqual(reports, ["lighthouse-0"]);
});

test("taking off flies again from rest, and the site stays quiet until it is left behind", () => {
  const { s } = comeDown(flier(TOWER.x + 50, TOWER.y, Math.PI / 2), TOWER, FLAT);
  let phase = takeOff({ kind: "landed", id: TOWER.id });
  assert.deepEqual(phase, { kind: "flying", quiet: TOWER.id });
  let st = s;
  for (let i = 0; i < 30; i++) ({ phase, s: st } = advance(phase, st, STILL, DT, FLAT, N, TARGETS));
  assert.ok(st.speed > 0 && st.speed < CRUISE && st.alt > s.alt, "rising and gathering speed");
  assert.equal(offered(phase, st.x, st.y, TARGETS, N), null);
  for (let i = 0; i < 60 * 6; i++) ({ phase, s: st } = advance(phase, st, STILL, DT, FLAT, N, TARGETS));
  assert.ok(Math.hypot(delta(TOWER.x, st.x), delta(TOWER.y, st.y)) > NEAR * QUIET_FACTOR);
  assert.deepEqual(phase, { kind: "flying", quiet: null });
});

test("pulling up leaves the landing and quiets the site; take-off and pull-up do nothing out of turn", () => {
  const s = flier(TOWER.x + 50, TOWER.y, Math.PI / 2);
  const coming: Phase = { kind: "landing", approach: beginLanding(s, TOWER, N) };
  assert.deepEqual(pullUp(coming), { kind: "flying", quiet: TOWER.id });
  assert.equal(takeOff(coming), coming);
  assert.equal(takeOff(FLYING), FLYING);
  const landed: Phase = { kind: "landed", id: TOWER.id };
  assert.equal(pullUp(landed), landed);
});

test("the camera eases from the flier to the landmark and back", () => {
  const s = flier(N - 10, 400, 0, 20);
  const site = { x: 30, y: 400, alt: 12 };
  assert.deepEqual(cameraAt(s, site, 0, N), { x: s.x, y: s.y - s.alt / 0.8 });
  const on = cameraAt(s, site, 1, N);
  assert.ok(Math.abs(on.x - (N + 30)) < 1e-9 && Math.abs(on.y - (400 - 12 / 0.8)) < 1e-9, `${on.x}, ${on.y}`);
  const half = cameraAt(s, site, 0.5, N);
  assert.ok(half.x > s.x && half.x < N + 30);
  assert.equal(easeFocus(0, true, 0.1), 0.1 * FOCUS_RATE);
  assert.equal(easeFocus(1, true, 0.1), 1);
  assert.equal(easeFocus(0.05, false, 0.1), 0);
});

test("the dragon rests as the coil closes: not at all flying, fully once landed", () => {
  assert.equal(restShare(FLYING), 0);
  assert.equal(restShare({ kind: "landed", id: TOWER.id }), 1);
  const a = beginLanding(flier(TOWER.x + 50, TOWER.y, Math.PI / 2), TOWER, N);
  assert.equal(restShare({ kind: "landing", approach: a }), 0);
  assert.equal(restShare({ kind: "landing", approach: { ...a, swept: a.sweep * 0.5 } }), 0);
  const late = restShare({ kind: "landing", approach: { ...a, swept: a.sweep * 0.9 } });
  assert.ok(late > 0 && late < 1, `${late}`);
  assert.equal(restShare({ kind: "landing", approach: { ...a, swept: a.sweep } }), 1);
});
