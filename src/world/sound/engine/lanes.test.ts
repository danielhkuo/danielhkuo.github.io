import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../../look/materials.ts";
import { coastEast, cove, frameOf, gridOf, type FlatWorld } from "../bench/land.ts";
import { createEar } from "../ear.ts";
import type { Hearing, Pose } from "../types.ts";
import { createLanes, TRAIN_GAP, type LapStart, type WaveStart } from "./lanes.ts";

const WARP = new Uint8Array(65536).map((_, i) => ((i * 131) ^ (i >> 7)) & 255);
const ALT = 30;

/** Flies from (x0, y0) at (vx, vy) cells a second for `seconds`, the ear passing ten times a second, lanes stepping at 60 Hz. */
function slide(world: FlatWorld, x0: number, y0: number, vx: number, vy: number, seconds: number, o: { lanes?: number; emitters?: number; gap?: [number, number] } = {}) {
  const ear = createEar();
  ear.setWorld({ n: world.n, land: gridOf(world) });
  ear.setWarp(WARP);
  const lanes = createLanes({ lanes: o.lanes ?? 4, emitters: o.emitters ?? 8, seed: 3 });
  const waves: (WaveStart & { at: number })[] = [], laps: LapStart[] = [];
  const places: { x: number; y: number }[][] = [];
  let hearing: Hearing | null = null;
  const buf = new Uint32Array(400 * 225);
  let last = 100;
  for (let k = 0; k < seconds * 60; k++) {
    const t = 100 + k / 60;
    if (o.gap && t - 100 >= o.gap[0] && t - 100 < o.gap[1]) continue;
    const x = x0 + vx * (t - 100), y = y0 + vy * (t - 100);
    const pose: Pose = { t, dt: 1 / 60, x, y, alt: ALT, heading: 0, speed: 60, bank: 0, rest: 0 };
    if (k % 6 === 0 || !hearing) hearing = ear.pass(pose, frameOf(world, x, y - ALT / 0.8, buf), lanes.mask());
    const w: WaveStart[] = [];
    lanes.step(hearing, t, t - last, 0.25, w, laps);
    last = t;
    for (const s of w) waves.push({ ...s, at: t });
    places.push(lanes.emitters.map((e) => ({ x: e.x, y: e.y, until: e.until })));
  }
  return { waves, laps, places, lanes };
}

test("a still lane by a beach plays about 23 waves a minute, each found before it must start", () => {
  const r = slide(coastEast(5040, M.sand), 5000, 5000, 0, 0, 60);
  assert.ok(r.waves.length > 0);
  for (const w of r.waves) if (w.offset === 0) assert.ok(w.cue.t >= w.at - 1e-9, "found ahead");
  const perLane = r.lanes.started.filter((n) => n > 0);
  for (const n of perLane) assert.ok(n >= 14 && n <= 30, `${n} waves a minute in a lane`);
  assert.ok(perLane.some((n) => n >= 18 && n <= 24), `a still lane keeps the picture's pace (${perLane})`);
  // The lull of the set is a lap, not a wave.
  assert.ok(r.laps.some((l) => l.db === -20));
  assert.ok(r.waves.every((w) => w.strength >= 1 && w.strength <= 3 && w.kind === 1));
});

test("sliding along a coast: no train in a lane starts twice within 2.6 s, and never more than two waves a lane at once", () => {
  const r = slide(coastEast(5040, M.sand), 5000, 3000, 0, 60, 45);
  assert.ok(r.waves.length > 30);
  const byLaneTrain = new Map<string, number[]>();
  for (const w of r.waves) {
    const k = `${w.lane}:${w.cue.train}`;
    (byLaneTrain.get(k) ?? byLaneTrain.set(k, []).get(k)!).push(w.cue.t);
  }
  for (const [k, ts] of byLaneTrain) for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= TRAIN_GAP - 1e-6, `${k}: ${ts[i] - ts[i - 1]}`);
  for (const w of r.waves) {
    const same = r.waves.filter((o) => o.lane === w.lane && o.cue.t <= w.cue.t && o.cue.t + o.cue.lasts! > w.cue.t);
    assert.ok(same.length <= 2);
  }
  assert.equal(new Set(r.waves.map((w) => w.cue.key)).size, r.waves.length, "no wave twice");
});

test("no sounding wave is stopped by a lane change, and a wave's place does not move after it starts", () => {
  const r = slide(coastEast(5040, M.sand), 5000, 3000, 0, 60, 45);
  for (const w of r.waves) {
    // From its start to its end its emitter is not given to another wave …
    const stolen = r.waves.find((o) => o !== w && o.emitter === w.emitter && o.cue.t > w.cue.t && o.cue.t < w.cue.t + w.cue.lasts! - 1e-6);
    assert.equal(stolen, undefined);
    // … and holds the place the wave broke at, frame after frame.
    const from = Math.ceil((w.at - 100) * 60), to = Math.min(r.places.length, Math.floor((w.cue.t + w.cue.lasts! - 100) * 60));
    for (let k = from; k < to; k++) {
      assert.equal(r.places[k][w.emitter].x, w.x);
      assert.equal(r.places[k][w.emitter].y, w.y);
    }
    assert.ok(Math.abs(w.x - 5040) <= 3, "on the shore");
  }
  // The crashes are left behind: places run the length of the flight, not with the dragon.
  const ys = r.waves.map((w) => w.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 2000);
});

test("a cove takes four lanes on desktop and two on touch; the mask names their sectors", () => {
  const desk = slide(cove(5000, 5000, 70, M.sand), 5000, 5000, 0, 0, 10);
  const touch = slide(cove(5000, 5000, 70, M.sand), 5000, 5000, 0, 0, 10, { lanes: 2, emitters: 4 });
  const bits = (m: number) => m.toString(2).split("").filter((c) => c === "1").length;
  assert.equal(bits(desk.lanes.mask()), 4);
  assert.equal(bits(touch.lanes.mask()), 2);
  assert.ok(new Set(touch.waves.map((w) => w.emitter)).size <= 4);
});

test("after a gap the waves that should still be sounding are joined in progress, once; after a clear, again", () => {
  // A 0.6 s stall: waves already sounding are in the ledger and are left alone; one that began inside it is joined.
  const r = slide(coastEast(5040, M.sand), 5000, 5000, 0, 0, 30, { gap: [10, 10.6] });
  assert.equal(new Set(r.waves.map((w) => w.cue.key)).size, r.waves.length);
  const joined = r.waves.filter((w) => w.offset > 0 && w.at > 105);
  for (const w of joined) assert.ok(w.offset < 0.9 && w.at >= 110.6 - 1e-6 && w.at < 110.7);
  // A clear (a hide): every envelope that should be sounding comes back with its offset.
  const lanes = createLanes({ lanes: 4, emitters: 8, seed: 3 });
  const ear = createEar();
  const world = coastEast(5040, M.sand);
  ear.setWorld({ n: world.n, land: gridOf(world) });
  ear.setWarp(WARP);
  const pose: Pose = { t: 200, dt: 0, x: 5000, y: 5000, alt: ALT, heading: 0, speed: 0, bank: 0, rest: 0 };
  const seen = frameOf(world, 5000, 5000 - ALT / 0.8);
  const h = ear.pass(pose, seen, 0);
  const first: WaveStart[] = [];
  lanes.step(h, 200, 0, 0.25, first, []);
  // (The first step after the lane is taken finds the wave in progress.)
  const second: WaveStart[] = [];
  lanes.step(h, 200.02, 0.02, 0.25, second, []);
  const before = [...first, ...second].filter((w) => w.offset > 0);
  assert.ok(before.length >= 1, "a wave is in progress at any moment by a beach");
  lanes.clear();
  const back: WaveStart[] = [];
  lanes.step(h, 204, 4, 0.25, back, []);
  assert.ok(back.some((w) => w.offset > 0));
  const again: WaveStart[] = [];
  lanes.step(h, 204.02, 0.02, 0.25, again, []);
  assert.ok(again.every((w) => w.offset === 0));
});

test("a calm shore plays laps and no waves", () => {
  const r = slide(coastEast(5040, M.cobble), 5000, 5000, 0, 0, 20);
  assert.equal(r.waves.length, 0);
  assert.ok(r.laps.length > 10 && r.laps.length < 60, `${r.laps.length} laps in 20 s`);
});
