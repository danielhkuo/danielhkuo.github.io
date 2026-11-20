import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTLE_SLOPE } from "../dragon/body.ts";
import { CLEARANCE, CRUISE, MIN_GAP, type FlightInput, type FlightState, type Terrain } from "../runtime/flight.ts";
import {
  advance, beginLanding, cameraAt, COIL_MAX, COIL_RADIUS, easeFocus, FOCUS_RATE, LANDING_CAP, land, MAX_TURN, NEAR, nearest, offered,
  pullUp, QUIET_FACTOR, REST_LIFT, restShare, RISE_SLOPE, SINK_END, takeOff, type Phase, type Target,
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
          assert.ok(next.alt >= 5 + Math.min(MIN_GAP, REST_LIFT) - 1e-9, `${label}: below the ground`);
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

test("over the last of its sweep it follows the ground round its coil, and rests on it", () => {
  const slope: Terrain = { groundHeight: (x) => 5 + 0.1 * (x - 5000), occlusionFloor: () => 0 };
  let s = flier(TOWER.x + 60, TOWER.y, Math.PI / 2, 40);
  let phase: Phase = { kind: "landing", approach: beginLanding(s, TOWER, N) };
  while (phase.kind === "landing") {
    const a = phase.approach;
    ({ phase, s } = advance(phase, s, STILL, DT, slope, N, TARGETS));
    const over = s.alt - slope.groundHeight(s.x, s.y);
    if (a.swept / a.sweep > SINK_END + 0.05) assert.ok(Math.abs(over - REST_LIFT) < 0.3, `at ${(a.swept / a.sweep).toFixed(2)} of the sweep: ${over.toFixed(2)} over the ground`);
  }
  assert.ok(Math.abs(s.alt - (slope.groundHeight(s.x, s.y) + REST_LIFT)) < 0.3, `rests at ${s.alt}`);
});

test("at a cliff's foot the head rests where the coil's ring holds it, not down on the ground below", () => {
  // The tower stands on the edge: ground at 14 to its north, the sea at 0 where the head comes to rest.
  const cliff: Terrain = { groundHeight: (_x, y) => (y < 5000 ? 14 : 0), occlusionFloor: () => 0 };
  const { s, phase } = comeDown(flier(TOWER.x + 60, TOWER.y, Math.PI / 2, 40), TOWER, cliff);
  // A quarter of the ring from the cliff's edge, sloping down from it no steeper than the body bends.
  const held = 14 - SETTLE_SLOPE * (Math.PI / 2) * TOWER.radius + REST_LIFT;
  assert.ok(Math.abs(s.alt - held) < 0.6, `rests at ${s.alt.toFixed(2)}, the ring at ${held.toFixed(2)}`);
  const later = advance(phase, s, STILL, 0.5, cliff, N, TARGETS).s;
  assert.equal(later.alt, s.alt);
});

test("round a coil that crosses a cliff it rises and falls no steeper than its body bends, and never dips under the ground", () => {
  // The tower stands on the edge: ground at 14 to its north, the sea at 0 to its south.
  const cliff: Terrain = { groundHeight: (_x, y) => (y < 5000 ? 14 : 0), occlusionFloor: () => 0 };
  for (const heading of [Math.PI / 2, -Math.PI / 2]) {
    let s = flier(TOWER.x + 60, TOWER.y, heading, 40);
    let phase: Phase = { kind: "landing", approach: beginLanding(s, TOWER, N) };
    while (phase.kind === "landing") {
      const a = phase.approach, before = s;
      ({ phase, s } = advance(phase, s, STILL, DT, cliff, N, TARGETS));
      assert.ok(s.alt >= cliff.groundHeight(s.x, s.y) + Math.min(MIN_GAP, REST_LIFT) - 1e-9, `under the ground at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
      if (a.swept / a.sweep <= SINK_END + 0.05) continue;
      const run = Math.hypot(delta(before.x, s.x), delta(before.y, s.y));
      assert.ok(Math.abs(s.alt - before.alt) <= SETTLE_SLOPE * run + 0.02, `stepped ${(s.alt - before.alt).toFixed(3)} over ${run.toFixed(3)} cells`);
    }
  }
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

test("the dragon calms as the coil closes, and rests only once it has landed", () => {
  assert.equal(restShare(FLYING), 0);
  assert.equal(restShare({ kind: "landed", id: TOWER.id }), 1);
  const a = beginLanding(flier(TOWER.x + 50, TOWER.y, Math.PI / 2), TOWER, N);
  assert.equal(restShare({ kind: "landing", approach: a }), 0);
  const mid = restShare({ kind: "landing", approach: { ...a, swept: a.sweep * 0.8 } });
  assert.ok(mid > 0 && mid < 0.5, `${mid}`);
  // Still landing, it is never more at rest than not: the body lies down only when the head has stopped.
  assert.equal(restShare({ kind: "landing", approach: { ...a, swept: a.sweep } }), 0.5);
});

test("taking off, it climbs no steeper than its body can follow, and comes up to its flying height", () => {
  const { s: rest } = comeDown(flier(TOWER.x + 50, TOWER.y, Math.PI / 2), TOWER, FLAT);
  let phase = takeOff({ kind: "landed", id: TOWER.id });
  let s = rest;
  for (let i = 0; i < 60 * 3; i++) {
    const r = advance(phase, s, STILL, DT, FLAT, N, TARGETS);
    const run = Math.hypot(delta(s.x, r.s.x), delta(s.y, r.s.y));
    assert.ok(r.s.alt - s.alt <= RISE_SLOPE * run + 1e-9, `step ${i}: rose ${(r.s.alt - s.alt).toFixed(3)} over ${run.toFixed(3)} cells`);
    ({ phase, s } = r);
  }
  assert.ok(Math.abs(s.alt - (5 + CLEARANCE)) < 0.5, `flying at ${s.alt}`);
});

test("where the land would hide its head at the south point, it comes to rest at the nearest point round that shows", () => {
  // A view that says anything drawn low in a strip 12 cells wide, south of the tower, is behind nearer land (a wooded bank).
  const rect = { x: 4800, y: Math.round(0.8 * 5000) - 112, w: 400, h: 225 };
  const bank: Terrain & { depthAt(px: number, py: number): number; rect(): typeof rect } = {
    ...FLAT,
    rect: () => rect,
    depthAt: (px, py) => (Math.abs(rect.x + px - 5000) < 6 && rect.y + py > 0.8 * 5004 - 20 ? Infinity : -Infinity),
  };
  const { s, phase } = comeDown(flier(TOWER.x + 60, TOWER.y, Math.PI / 2), TOWER, bank);
  assert.equal(phase.kind, "landed");
  // South, and a sixteenth of a turn either side, are hidden; an eighth round to the west shows.
  const at = (3 * Math.PI) / 4;
  const x = TOWER.x + TOWER.radius * Math.cos(at), y = TOWER.y + TOWER.radius * Math.sin(at);
  assert.ok(Math.hypot(delta(x, s.x), delta(y, s.y)) < 3, `rests at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}), wanted (${x.toFixed(1)}, ${y.toFixed(1)})`);
});

test("a building too big to ring: the dragon curls up in a small coil beside it, to the south on open ground", () => {
  // The abbey's ring is 23 cells round its middle; a body of 40 cells would cover a third of it, which is no coil.
  const { s, phase } = comeDown(flier(ABBEY.x + 60, ABBEY.y, Math.PI / 2), ABBEY, FLAT);
  assert.equal(phase.kind, "landed");
  // A coil of COIL_RADIUS just clear of the walls, due south: its middle ABBEY.radius + COIL_RADIUS south of the abbey's.
  const cx = ABBEY.x, cy = ABBEY.y + ABBEY.radius + COIL_RADIUS;
  assert.ok(Math.hypot(delta(cx, s.x), delta(cy + COIL_RADIUS, s.y)) < 3, `rests at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}), wanted (${cx}, ${cy + COIL_RADIUS})`);
});

test("where the land hides the ground south of a big building, it curls up on the first side that shows", () => {
  // A view that draws nearer land over anything low south of row 5010: a wooded bank across the abbey's front.
  const rect = { x: 5800, y: Math.round(0.8 * 5000) - 112, w: 400, h: 225 };
  const bank: Terrain & { depthAt(px: number, py: number): number; rect(): typeof rect } = {
    ...FLAT,
    rect: () => rect,
    depthAt: (_px, py) => (rect.y + py > 0.8 * 5010 - 3 ? Infinity : -Infinity),
  };
  const { s, phase } = comeDown(flier(ABBEY.x + 60, ABBEY.y, Math.PI / 2), ABBEY, bank);
  assert.equal(phase.kind, "landed");
  // South, south-east and south-west are all hidden; east of the abbey shows, and the head rests at that coil's south point.
  const cx = ABBEY.x + ABBEY.radius + COIL_RADIUS, cy = ABBEY.y;
  assert.ok(Math.hypot(delta(cx, s.x), delta(cy + COIL_RADIUS, s.y)) < 3, `rests at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}), wanted (${cx}, ${cy + COIL_RADIUS})`);
});

test("a landmark small enough to ring keeps its coil round it", () => {
  assert.ok(TOWER.radius <= COIL_MAX && ABBEY.radius > COIL_MAX);
  const { s } = comeDown(flier(TOWER.x + 60, TOWER.y, Math.PI / 2), TOWER, FLAT);
  assert.ok(Math.hypot(delta(TOWER.x, s.x), delta(TOWER.y + TOWER.radius, s.y)) < 3, `rests at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
});
