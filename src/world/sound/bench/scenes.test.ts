import assert from "node:assert/strict";
import { test } from "node:test";
import { torusDelta } from "../../core/torus.ts";
import { CRUISE } from "../../runtime/flight.ts";
import { mix, newMemory, newTargets, T } from "../mix.ts";
import { panOf } from "../space.ts";
import { EMPTY_CENSUS, emptyHearing } from "../types.ts";
import { isSoundLog, renderNames, replayScene, SCENES, type SoundLog } from "./scenes.ts";

const byName = (name: string) => SCENES.find((s) => s.name === name)!;

test("every scene is deterministic, has finite poses on the frame clock, and says what to listen for", () => {
  const names = new Set<string>();
  for (const s of SCENES) {
    assert.ok(!names.has(s.name), s.name);
    names.add(s.name);
    assert.ok(s.about.length > 20 && s.seconds > 0);
    for (let k = 0; k <= s.seconds * 60; k += 7) {
      const t = k / 60;
      const a = s.at(t), b = s.at(t);
      assert.deepEqual(a.pose, b.pose);
      for (const v of Object.values(a.pose)) assert.ok(Number.isFinite(v), `${s.name} at ${t}`);
      assert.ok(Math.abs(a.pose.t - (s.t0 + t)) < 1e-9, "world time is the scene's start plus t");
    }
    for (const m of s.marks ?? []) assert.ok(m.t0 >= 0 && m.t1 <= s.seconds && m.t1 > m.t0, `${s.name}: ${m.name}`);
    for (const a of s.actions ?? []) assert.ok(a.at >= 0 && a.at < s.seconds);
  }
  for (const want of ["calibration", "toggle", "hide-show", "stall", "wind-cruise", "wind-speeds", "turns", "reduced-motion", "landing"]) assert.ok(names.has(want), want);
});

test("wind-speeds visits brake, cruise and boost; reduced-motion flies the same keys calm", () => {
  const s = byName("wind-speeds");
  const v = (t: number) => s.at(t).pose.speed / CRUISE;
  assert.ok(Math.abs(v(5) - 0.5) < 0.01 && Math.abs(v(11) - 1) < 0.01 && Math.abs(v(19) - 1.8) < 0.01 && Math.abs(v(29.5) - 0.5) < 0.01);
  const calm = byName("reduced-motion");
  assert.equal(calm.prefs.calm, true);
  assert.equal(calm.seconds, 62);
  assert.ok(Math.abs(calm.at(19).pose.speed / CRUISE - 1.8) < 0.01);
  assert.ok(Math.abs(calm.at(32).pose.bank) > 0.9, "and then the turns");
});

test("turns: each manoeuvre starts from the heading its name says, and the four taps stay under the whoosh's gate", () => {
  const s = byName("turns");
  const north = -Math.PI / 2, south = Math.PI / 2;
  const facing = (t: number, h: number) => Math.abs(Math.cos(s.at(t).pose.heading - h) - 1) < 1e-6;
  assert.ok(facing(0.5, north) && facing(5.9, north) && facing(12.9, north));
  assert.ok(facing(16.5, south) && facing(21.9, south) && facing(28.9, south));
  // Left first (bank < 0), then right.
  assert.ok(s.at(2).pose.bank < -0.9 && s.at(8).pose.bank > 0.9 && s.at(18).pose.bank < -0.9 && s.at(24).pose.bank > 0.9);
  for (const from of [13, 29]) {
    let peak = 0;
    for (let t = from - 0.2; t < from + 2.4; t += 1 / 60) peak = Math.max(peak, Math.abs(s.at(t).pose.bank));
    assert.ok(peak > 0.2 && peak < 0.35, `taps reach ${peak}`);
  }
  // Through the real mix: the whoosh sounds in the turns and never in the taps.
  const memory = newMemory(), targets = newTargets();
  let inTurn = 0, inTaps = 0;
  for (let k = 0; k < 32 * 30; k++) {
    const t = k / 30;
    mix(s.at(t).pose, emptyHearing(), EMPTY_CENSUS, s.prefs, memory, targets);
    if ((t > 1 && t < 3) || (t > 22 && t < 26)) inTurn = Math.max(inTurn, targets[T.W_GAIN]);
    if ((t > 12.8 && t < 15.5) || (t > 28.8 && t < 31.5)) inTaps = Math.max(inTaps, targets[T.W_GAIN]);
  }
  assert.ok(inTurn > 0);
  assert.equal(inTaps, 0);
});

test("landing: the dragon comes to rest and takes off again; the camera moves aside for the Codex and the sound does not hear it", () => {
  const s = byName("landing");
  let landed = -1, tookOff = -1;
  for (let k = 0; k <= s.seconds * 60; k++) {
    const f = s.at(k / 60);
    if (landed < 0 && f.pose.rest === 1) landed = k / 60;
    if (landed >= 0 && tookOff < 0 && f.pose.rest === 0) tookOff = k / 60;
  }
  assert.ok(landed > 3 && landed < 15, `landed at ${landed}`);
  assert.ok(Math.abs(tookOff - landed - 6) < 0.1, `rested ${tookOff - landed} s`);
  assert.ok(s.at(s.seconds).pose.speed > 55, "flying again at the end");
  const rest = s.at(landed + 3);
  assert.equal(rest.pose.speed, 0);
  // At rest the camera sits about 64 cells east of the dragon's landmark …
  const shift = torusDelta(rest.pose.x, rest.camera!.x, 10240);
  assert.ok(shift > 40 && shift < 90, `camera ${shift} cells east of the dragon`);
  // … and a source at the landmark is panned from the dragon, a few cells off, not from the camera, 64 cells off.
  const fromDragon = panOf(torusDelta(rest.pose.x, 5000, 10240), torusDelta(rest.pose.y, 5000, 10240));
  const fromCamera = panOf(torusDelta(rest.camera!.x, 5000, 10240), 0);
  assert.ok(Math.abs(fromDragon) < 0.4, `from the dragon ${fromDragon}`);
  assert.ok(fromCamera < -0.7, `from the camera it would be ${fromCamera}`);
  // In flight the camera is over the dragon.
  assert.ok(Math.abs(torusDelta(s.at(1).pose.x, s.at(1).camera!.x, 10240)) < 1e-9);
});

test("scenes that act: the toggle, the hide and the stall", () => {
  assert.deepEqual(byName("toggle").actions, [{ at: 0, do: "on" }, { at: 6, do: "mute" }, { at: 9, do: "unmute" }, { at: 13, do: "mute" }]);
  assert.deepEqual(byName("hide-show").actions, [{ at: 5, do: "hide" }, { at: 9, do: "show" }]);
  assert.deepEqual(byName("stall").actions, [{ at: 5, do: "stall", for: 0.6 }]);
  for (const n of ["toggle", "hide-show", "stall"]) assert.ok(byName(n).probe);
});

test("render names: each scene, and a -beds twin where it has one", () => {
  const names = renderNames(SCENES).map((s) => s.name);
  assert.ok(names.includes("landing") && names.includes("landing-beds") && names.includes("reduced-motion-beds"));
  assert.ok(!names.includes("wind-cruise-beds"));
});

test("a recorded flight replays row by row, and a log of the wrong shape is refused", () => {
  const log: SoundLog = {
    v: 1, worldId: "w", places: null, prefs: { volume: 0.7, headphones: false, calm: false, touch: false }, hearings: [],
    frames: Array.from({ length: 600 }, (_, k) => [10 + k / 60, 1 / 60, 100 + k, 200, 30, 0, 60, k % 2 ? 0.5 : 0, 0, -1]),
  };
  assert.ok(isSoundLog(log));
  assert.ok(!isSoundLog({ ...log, v: 2 }));
  assert.ok(!isSoundLog({ ...log, frames: [[1, 2, 3]] }));
  assert.ok(!isSoundLog(null));
  const s = replayScene(log);
  assert.equal(s.name, "flight-replay");
  assert.equal(s.seconds, 9);
  assert.equal(s.t0, 10);
  assert.equal(s.at(0).pose.x, 100);
  assert.equal(s.at(2).pose.x, 220);
  assert.equal(s.at(2).pose.t, 12);
  // Asked out of order, it still finds the row.
  assert.equal(s.at(1).pose.x, 160);
  assert.equal(s.prefs.volume, 1, "the bench renders at volume 1");
});
