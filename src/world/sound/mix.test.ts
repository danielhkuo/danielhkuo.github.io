import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOST, BRAKE, CRUISE, startState, stepFlight, type FlightInput, type FlightState } from "../runtime/flight.ts";
import { K_WIND } from "./levels.ts";
import { mix, moved, newMemory, newTargets, SEND, T, windSpeed } from "./mix.ts";
import { gainToDb } from "./space.ts";
import { EMPTY_CENSUS, emptyHearing, type Pose, type Prefs } from "./types.ts";

const PREFS: Prefs = { volume: 1, headphones: false, calm: false, touch: false };
const CALM: Prefs = { ...PREFS, calm: true };
const H = emptyHearing();
const FLAT = { groundHeight: () => 10, occlusionFloor: () => 0 };
const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2, EAST = 0, WEST = Math.PI;

const pose = (o: Partial<Pose> = {}): Pose => ({ t: 0, dt: 1 / 60, x: 0, y: 0, alt: 28, heading: NORTH, speed: CRUISE, bank: 0, rest: 0, ...o });
const near = (a: number, b: number, eps: number, what = "") => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
const one = (p: Pose, prefs = PREFS) => mix(p, H, EMPTY_CENSUS, prefs).targets;

/** Flies `seconds` with `input(t)` from `s`, mixing at 30 Hz; returns every mix's targets (copied) with its time. */
function fly(s0: FlightState, seconds: number, input: (t: number) => FlightInput, prefs = PREFS) {
  let s = s0;
  const memory = newMemory();
  const targets = newTargets();
  const out: { t: number; s: FlightState; v: Float32Array }[] = [];
  for (let k = 0; k < seconds * 60; k++) {
    const t = k / 60;
    s = stepFlight(s, input(t), 1 / 60, FLAT, 10240);
    if (k % 2 === 0) {
      mix({ t, dt: 1 / 60, x: s.x, y: s.y, alt: s.alt, heading: s.heading, speed: s.speed, bank: s.bank, rest: 0 }, H, EMPTY_CENSUS, prefs, memory, targets);
      out.push({ t, s, v: targets.slice() });
    }
  }
  return out;
}

const start = (heading: number): FlightState => ({ ...startState({ x: 100, y: 100, dx: Math.cos(heading), dy: Math.sin(heading) }, FLAT), heading });

test("wind targets at brake, cruise and boost", () => {
  const brake = one(pose({ speed: CRUISE * BRAKE })), cruise = one(pose()), boost = one(pose({ speed: CRUISE * BOOST }));
  near(cruise[T.A_L], K_WIND.a, 1e-6);
  assert.equal(cruise[T.A_L], cruise[T.A_R]);
  // A spans about 14 dB from brake to boost, B about 11.
  near(gainToDb(boost[T.A_L] / brake[T.A_L]), 13.9, 0.2);
  near(gainToDb(boost[T.B_GAIN] / brake[T.B_GAIN]), 11.1, 0.2);
  near(cruise[T.A_HZ], 110, 1e-3);
  near(brake[T.A_HZ], 55, 1e-3);
  near(boost[T.A_HZ], 198, 1e-3);
  near(cruise[T.B_HZ], 650, 1e-3);
  near(boost[T.B_HZ], 1170, 1e-3);
  // The hiss is silent at brake and present at boost; the whistles need speed.
  assert.equal(brake[T.C_GAIN], 0);
  assert.ok(boost[T.C_GAIN] > cruise[T.C_GAIN] && cruise[T.C_GAIN] > 0);
  assert.equal(brake[T.D_GAIN], 0);
  assert.ok(boost[T.D_GAIN] > 4 * cruise[T.D_GAIN]);
  near(boost[T.C_HZ], 7500, 1e-2);
  // The world yields 2 dB to the wind at boost, none at cruise.
  near(gainToDb(boost[T.WORLD]), -2, 1e-4);
  assert.equal(cruise[T.WORLD], 1);
  near(cruise[T.MASTER], 1, 1e-9);
  near(one(pose(), { ...PREFS, volume: 0.7 })[T.MASTER], 0.49, 1e-6);
});

test("no whistles on touch", () => {
  assert.equal(one(pose({ speed: CRUISE * BOOST }), { ...PREFS, touch: true })[T.D_GAIN], 0);
});

test("the swell on the hiss comes only while speed rises", () => {
  const run = fly(start(NORTH), 8, (t) => ({ turn: 0, boost: t >= 1 && t < 4, brake: false }));
  const steady = (s: number) => K_WIND.c * Math.max(0, s - 0.6);
  const swell = run.map((r) => r.v[T.C_GAIN] / Math.max(1e-9, steady(r.s.speed / 60)));
  const at = (t: number) => swell[Math.round(t * 30)];
  near(at(0.9), 1, 1e-3, "level cruise");
  assert.ok(at(1.3) > 1.35, `boost onset swells (${at(1.3)})`);
  near(at(3.9), 1, 0.02, "boost held");
  // Slowing down again never lifts it.
  for (let t = 4.5; t < 7.9; t += 0.1) assert.ok(at(t) <= 1 + 1e-6, `slowing at ${t}: ${at(t)}`);
});

test("a 50 ms tap leaves the whoosh shut; a 150 ms turn opens it (through the real stepFlight)", () => {
  const tap = fly(start(NORTH), 2, (t) => ({ turn: t >= 0.5 && t < 0.55 ? 1 : 0, boost: false, brake: false }));
  for (const r of tap) assert.equal(r.v[T.W_GAIN], 0);
  const turn = fly(start(NORTH), 2, (t) => ({ turn: t >= 0.5 && t < 0.65 ? 1 : 0, boost: false, brake: false }));
  const peak = Math.max(...turn.map((r) => r.v[T.W_GAIN]));
  assert.ok(peak > 0.2 * K_WIND.w, `the turn blooms (${peak / K_WIND.w})`);
  // A held turn keeps a faint pressure, well under the bloom's ceiling.
  const held = fly(start(NORTH), 3, (t) => ({ turn: t >= 0.5 ? 1 : 0, boost: false, brake: false }));
  const tail = held[held.length - 1].v[T.W_GAIN];
  near(tail / K_WIND.w, 0.3, 0.02);
});

test("the whoosh and the louder ear go to the outside wing as seen on screen", () => {
  // bank > 0 is a right turn. Flying north the outside (left) wing is on the screen's left; flying south, on its right.
  for (const [heading, bank, side] of [[NORTH, 1, -1], [NORTH, -1, 1], [SOUTH, 1, 1], [SOUTH, -1, -1]] as const) {
    const v = one(pose({ heading, bank }));
    assert.equal(Math.sign(v[T.W_PAN]), side, `pan heading ${heading} bank ${bank}`);
    near(Math.abs(v[T.W_PAN]), 0.3, 1e-6);
    assert.equal(Math.sign(v[T.A_R] - v[T.A_L]), side, `tilt heading ${heading} bank ${bank}`);
    near(Math.abs(gainToDb(v[T.A_R] / v[T.A_L])), 3, 1e-3);
  }
  // Flying east or west the wings are up and down the screen: no side.
  for (const heading of [EAST, WEST]) {
    const v = one(pose({ heading, bank: 1 }));
    near(v[T.W_PAN], 0, 1e-6);
    near(v[T.A_L], v[T.A_R], 1e-6);
  }
});

test("landing: the wind drains, the breeze rises, the world drops 6 dB, the coil's bank makes no whoosh", () => {
  const flying = one(pose());
  const landed = one(pose({ speed: 0, bank: 1, rest: 1 }));
  assert.equal(landed[T.A_L], 0);
  assert.equal(landed[T.B_GAIN], 0);
  assert.equal(landed[T.C_GAIN], 0);
  assert.equal(landed[T.D_GAIN], 0);
  assert.equal(landed[T.W_GAIN], 0);
  near(landed[T.E_GAIN] / flying[T.E_GAIN], 1.8, 1e-6);
  near(gainToDb(landed[T.WORLD]), -6, 1e-4);
  for (const x of landed) assert.ok(Number.isFinite(x));
});

test("reduced motion: half the speed range, no swell, no tilt, no whoosh; the wind still drains at rest", () => {
  near(windSpeed(CRUISE * BOOST, true), 1.4, 1e-12);
  near(windSpeed(CRUISE * BRAKE, true), 0.75, 1e-12);
  assert.equal(windSpeed(0, true), 0);
  assert.equal(windSpeed(CRUISE, true), 1);
  const run = fly(start(NORTH), 4, (t) => ({ turn: t >= 2 ? 1 : 0, boost: t >= 0.5, brake: false }), CALM);
  for (const r of run) {
    assert.equal(r.v[T.W_GAIN], 0);
    assert.equal(r.v[T.W_PAN], 0);
    assert.equal(r.v[T.A_L], r.v[T.A_R]);
    near(r.v[T.C_GAIN], K_WIND.c * Math.max(0, windSpeed(r.s.speed, true) - 0.6), 1e-7);
  }
  const brake = one(pose({ speed: CRUISE * BRAKE }), CALM), boost = one(pose({ speed: CRUISE * BOOST }), CALM);
  near(gainToDb(boost[T.A_L] / brake[T.A_L]), 6.8, 0.2);
});

test("the mix is deterministic", () => {
  const a = fly(start(NORTH), 3, (t) => ({ turn: t > 1 ? -1 : 0, boost: t > 2, brake: false }));
  const b = fly(start(NORTH), 3, (t) => ({ turn: t > 1 ? -1 : 0, boost: t > 2, brake: false }));
  assert.deepEqual(a.map((r) => [...r.v]), b.map((r) => [...r.v]));
});

test("a still scene sends nothing after the first mix", () => {
  const memory = newMemory(), targets = newTargets();
  const sent = new Float32Array(T.COUNT).fill(NaN);
  let sends = 0;
  for (let k = 0; k < 90; k++) {
    mix(pose({ t: k / 30 }), H, EMPTY_CENSUS, PREFS, memory, targets);
    for (let i = 0; i < T.COUNT; i++) {
      if (moved(i, sent[i], targets[i])) {
        sent[i] = targets[i];
        if (k > 0) sends++;
      }
    }
  }
  assert.equal(sends, 0);
});

test("send thresholds: dB for gains, cents for frequencies, plain for pans", () => {
  assert.equal(SEND.length, T.COUNT);
  assert.ok(moved(T.A_L, NaN, 0.5), "never sent");
  assert.ok(!moved(T.A_L, 0.5, 0.5 * 1.02), "0.17 dB");
  assert.ok(moved(T.A_L, 0.5, 0.5 * 1.05), "0.42 dB");
  assert.ok(moved(T.A_L, 0.5, 0), "to silence");
  assert.ok(!moved(T.A_L, 0, 0.0005), "both under −60 dB");
  assert.ok(moved(T.A_L, 0, 0.01), "out of silence");
  assert.ok(!moved(T.B_HZ, 650, 651));
  assert.ok(moved(T.B_HZ, 650, 653));
  assert.ok(!moved(T.W_PAN, 0.1, 0.11));
  assert.ok(moved(T.W_PAN, 0.1, 0.125));
});

test("a stall does not read as a burst of speed or roll", () => {
  const memory = newMemory(), targets = newTargets();
  mix(pose({ t: 0 }), H, EMPTY_CENSUS, PREFS, memory, targets);
  mix(pose({ t: 1 / 30 }), H, EMPTY_CENSUS, PREFS, memory, targets);
  mix(pose({ t: 5, speed: CRUISE * BOOST, bank: 1 }), H, EMPTY_CENSUS, PREFS, memory, targets);
  assert.equal(memory.sDot, 0);
  assert.equal(memory.roll, 0);
});

test("take-off and touchdown: the wind's level never moves faster than 10 dB a second once it is over the breeze", () => {
  const memory = newMemory(), targets = newTargets();
  const levels: number[] = [];
  // At rest, then the speed leaps to cruise and, later, back to nothing: harsher than the game ever is.
  for (let k = 0; k < 300; k++) {
    const t = k / 30;
    const speed = t < 1 ? 0 : t < 6 ? CRUISE : 0;
    mix(pose({ t, speed, rest: 0 }), H, EMPTY_CENSUS, PREFS, memory, targets);
    levels.push(targets[T.B_GAIN]);
  }
  assert.equal(levels[29], 0);
  near(levels[30 * 5], K_WIND.b, 1e-6, "cruise is reached");
  assert.equal(levels[299], 0);
  const floor = K_WIND.b * 0.12;
  for (let k = 1; k < levels.length; k++) {
    const a = levels[k - 1], b = levels[k];
    if (a <= floor * 1.001 || b <= floor * 1.001) continue;
    assert.ok(Math.abs(gainToDb(b / a)) <= 10 / 30 + 1e-6, `step ${k}: ${gainToDb(b / a)} dB`);
  }
  // It gets there in about two seconds.
  near(levels[30 * 3 + 15], K_WIND.b, 1e-6, "within two and a half seconds");
});

test("ordinary flight is never held back by that limit for long", () => {
  const run = fly(start(NORTH), 6, (t) => ({ turn: 0, boost: t >= 1 && t < 3, brake: t >= 4 }));
  for (const r of run) near(r.v[T.B_GAIN], K_WIND.b * (r.s.speed / 60), K_WIND.b * 0.08);
});
