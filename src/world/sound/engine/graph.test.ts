import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAKE, BOOST, CRUISE } from "../../runtime/flight.ts";
import { LIMITER, LIMITER_TRIM_DB, Q_FLAT_DB } from "../levels.ts";
import { T } from "../mix.ts";
import { emptyHearing, type Pose, type Prefs } from "../types.ts";
import { createEngine, type Engine } from "./engine.ts";
import { FakeContext, fakeKit, FakeNode, FakeParam } from "./fake.ts";
import { buildMaster, clipCurve, type Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import { buildWind } from "./wind.ts";

const PREFS: Prefs = { volume: 1, headphones: false, calm: false, touch: false };
const H = emptyHearing();
const pose = (t: number, o: Partial<Pose> = {}): Pose => ({ t, dt: 1 / 60, x: 0, y: 0, alt: 30, heading: -Math.PI / 2, speed: CRUISE, bank: 0, rest: 0, ...o });

function engineOn(opts: { probe?: boolean; touch?: boolean } = {}): { ctx: FakeContext; engine: Engine } {
  const ctx = new FakeContext();
  const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: opts.touch === true, seed: 3, offline: true, probe: opts.probe });
  return { ctx, engine };
}

/** Flies `seconds` at 60 frames a second from `t0`, the pose from `at(t)`. */
function fly(e: { ctx: FakeContext; engine: Engine }, t0: number, seconds: number, at: (t: number) => Partial<Pose> = () => ({})): void {
  for (let k = 0; k < seconds * 60; k++) {
    const t = t0 + k / 60;
    e.ctx.currentTime = t;
    e.engine.frame(pose(t, at(t - t0)), H, PREFS, { now: t, o: 0 });
  }
}

test("every low-pass and high-pass has Q −3.01 dB, in the master chain and in the wind", () => {
  const { ctx, engine } = engineOn();
  engine.enable(true);
  fly({ ctx, engine }, 0, 0.1);
  const filters = ctx.nodes.filter((n) => n.kind === "biquad");
  const flat = filters.filter((f) => f.type === "lowpass" || f.type === "highpass");
  assert.ok(flat.length >= 7, `${flat.length} low-passes and high-passes`);
  for (const f of flat) assert.equal((f.Q as FakeParam).value, Q_FLAT_DB, `${f.type} at ${(f.frequency as FakeParam).value} Hz`);
  // The band-passes and the peak carry linear Qs, each a number the design names.
  const others = filters.filter((f) => f.type !== "lowpass" && f.type !== "highpass" && f.type !== "highshelf").map((f) => (f.Q as FakeParam).value).sort((a, b) => a - b);
  assert.deepEqual(others, [0.5, 0.7, 1.1, 1.2, 30, 38, 45]);
});

test("every pan is a gain pair into a merger: no panner node is ever made", () => {
  const { ctx, engine } = engineOn();
  engine.enable(true);
  fly({ ctx, engine }, 0, 0.1);
  assert.equal(ctx.nodes.filter((n) => n.kind === "stereoPanner" || n.kind === "panner").length, 0);
  // Each merger is fed on input 0 and input 1 by gains (the buffet's two ears, the whistles' pans, the whoosh's).
  const mergers = ctx.nodes.filter((n) => n.kind === "merger");
  assert.equal(mergers.length, 3);
  for (const m of mergers) {
    const feeds = ctx.nodes.flatMap((n) => n.outs.filter((o) => o.to === m).map((o) => ({ n, input: o.input })));
    assert.ok(feeds.every((f) => f.n.kind === "gain"));
    assert.ok(feeds.some((f) => f.input === 0) && feeds.some((f) => f.input === 1));
  }
});

test("the master chain: high-pass, volume, limiter, trim, soft clip, mute, in that order, and wind round the world bus", () => {
  const ctx = new FakeContext();
  const m = buildMaster(ctx as unknown as Ctx);
  const next = (n: unknown) => (n as FakeNode).outs[0].to as FakeNode;
  const rumble = next(m.sum);
  assert.equal(rumble.type, "highpass");
  assert.equal(next(rumble), m.volume as unknown as FakeNode);
  assert.equal(next(m.volume), m.limiter as unknown as FakeNode);
  const lim = m.limiter as unknown as FakeNode;
  assert.deepEqual(
    [lim.threshold, lim.knee, lim.ratio, lim.attack, lim.release].map((p) => (p as FakeParam).value),
    [LIMITER.thresholdDb, LIMITER.kneeDb, LIMITER.ratio, LIMITER.attackS, LIMITER.releaseS],
  );
  const trim = next(lim);
  assert.ok(Math.abs((trim.gain as FakeParam).value - Math.pow(10, LIMITER_TRIM_DB / 20)) < 1e-9);
  const clip = next(trim);
  assert.equal(clip.kind, "waveShaper");
  assert.equal(next(clip), m.mute as unknown as FakeNode);
  assert.equal(next(m.mute), ctx.destination);
  assert.equal((m.mute.gain as unknown as FakeParam).value, 0, "silent until enabled");
  assert.equal(next(m.bus.wind), m.sum as unknown as FakeNode, "wind is at the listener");
  for (const b of ["water", "life", "moments", "bells"] as const) assert.equal(next(m.bus[b]), m.world as unknown as FakeNode);
});

test("the soft clip is the identity to 0.7 and never reaches 1", () => {
  const c = clipCurve(4097);
  const at = (x: number) => c[Math.round(((x + 1) / 2) * 4096)];
  // (to the width of a table step: the curve has 4097 points)
  for (const x of [-0.7, -0.3, 0, 0.5, 0.7]) assert.ok(Math.abs(at(x) - x) < 5e-4);
  assert.ok(at(1) < 0.95 && at(1) > 0.9);
  assert.ok(Math.abs(at(-1) + at(1)) < 1e-9);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], "monotonic");
});

test("every persistent voice starts at gain 0, and every wind source is a started loop", () => {
  const ctx = new FakeContext();
  const out = ctx.createGain();
  const v = buildWind(ctx as unknown as Ctx, fakeKit() as unknown as Kit, out as unknown as AudioNode, { touch: false, seed: 3, at: 0 });
  for (const step of v.steps) step();
  const gains = [T.A_L, T.A_R, T.B_GAIN, T.C_GAIN, T.D_GAIN, T.E_GAIN, T.W_GAIN];
  for (const i of gains) {
    const b = v.bindings.find((x) => x.i === i);
    assert.ok(b, `target ${i} is bound`);
    for (const p of b.params) assert.equal((p as unknown as FakeParam).value, 0);
  }
  for (const s of v.sources as unknown as FakeNode[]) {
    assert.ok(s.loop && s.started, "looping and started");
  }
  // Whistles are left out on touch.
  const touch = buildWind(new FakeContext() as unknown as Ctx, fakeKit() as unknown as Kit, out as unknown as AudioNode, { touch: true, seed: 3, at: 0 });
  for (const step of touch.steps) step();
  assert.ok(!touch.bindings.some((b) => b.i === T.D_GAIN));
});

test("no parameter gets setValueAtTime while it is sounding: values are set outright only under a master at 0", () => {
  const e = engineOn();
  e.engine.enable(true);
  fly(e, 0, 0.05);
  const before = e.ctx.calls().length;
  // Eight seconds of everything: boost, brake, turns both ways, a landing's rest.
  fly(e, 0.05, 8, (t) => ({
    speed: t < 2 ? CRUISE * BOOST : t < 4 ? CRUISE * BRAKE : CRUISE,
    bank: t > 4 && t < 5 ? 1 : t > 5 && t < 6 ? -1 : 0,
    rest: t > 7 ? 1 : 0,
  }));
  const during = e.ctx.calls().slice(before);
  assert.ok(during.length > 100, "the flight sent targets");
  const outright = during.filter((c) => c.method === "setValueAtTime" || c.method === "cancelScheduledValues");
  assert.deepEqual(outright.map((c) => `${c.param.owner.kind}.${c.param.name}`), []);
  assert.ok(during.every((c) => c.method === "setTargetAtTime"));
});

test("a still scene sends nothing after its first frame", () => {
  const e = engineOn();
  e.engine.enable(true);
  fly(e, 0, 0.05);
  const sends = e.engine.stats().sends;
  assert.ok(sends > 10);
  fly(e, 0.05, 5);
  assert.equal(e.engine.stats().sends, sends);
});

test("mute and hide touch only the master's mute gain, stop every one-shot, and nothing is sent while off", () => {
  const e = engineOn({ probe: true });
  e.engine.enable(true);
  fly(e, 100, 3);
  const shots = e.ctx.nodes.filter((n) => n.kind === "bufferSource" && !n.loop);
  assert.ok(shots.length >= 3, "pips and a tail were started");
  const before = e.ctx.calls().length;
  e.engine.mute(103);
  const after = e.ctx.calls().slice(before);
  assert.ok(after.length >= 2);
  const owners = new Set(after.map((c) => c.param));
  assert.equal(owners.size, 1, "one parameter");
  assert.deepEqual(after.map((c) => c.method), ["cancelScheduledValues", "setValueAtTime", "setTargetAtTime"]);
  for (const s of shots) if (s.started && s.started[0] > 102.5) assert.equal(s.stopped, 103.25);
  const quiet = e.ctx.calls().length;
  fly(e, 103.1, 1);
  assert.equal(e.ctx.calls().length, quiet, "no sends while muted");
  assert.ok(!e.engine.live);
  // On again: parameters are set outright (the master is at 0), then the master fades in along a line.
  e.engine.enable(false);
  fly(e, 105, 0.05);
  assert.ok(e.engine.live);
  const back = e.ctx.calls().slice(quiet);
  assert.ok(back.some((c) => c.method === "linearRampToValueAtTime" && owners.has(c.param)));
  // Hidden: a linear ramp to 0 on the audio clock and every one-shot stopped just after it.
  const b2 = e.ctx.calls().length;
  e.engine.hide(106);
  const hid = e.ctx.calls().slice(b2);
  assert.deepEqual(hid.map((c) => c.method), ["cancelScheduledValues", "setValueAtTime", "linearRampToValueAtTime"]);
  assert.deepEqual(hid[2].args, [0, 106.2]);
});

test("a re-enable waits for the fade-out to finish, so sound always returns from silence", () => {
  const e = engineOn();
  e.engine.enable(true);
  fly(e, 0, 3);
  e.engine.hide(3);
  e.engine.enable(false);
  // 50 ms into the 200 ms ramp: not yet.
  fly(e, 3.05, 0.02);
  assert.ok(!e.engine.live);
  fly(e, 3.21, 0.02);
  assert.ok(e.engine.live);
});
