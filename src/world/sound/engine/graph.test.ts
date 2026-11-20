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
import { createFresh } from "./fresh.ts";
import { buildHub } from "./hub.ts";
import { buildWhistles, buildWhoosh, buildWind } from "./wind.ts";

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
  // At boost, so the whistles are built too.
  fly({ ctx, engine }, 0, 0.2, () => ({ speed: CRUISE * BOOST }));
  const filters = ctx.nodes.filter((n) => n.kind === "biquad");
  const flat = filters.filter((f) => f.type === "lowpass" || f.type === "highpass");
  // The master's three, the wind's two that move (the fixed ones are run into its buffers), three an emitter, the hiss's top.
  assert.ok(flat.length >= 5 + 8 * 3 + 1, `${flat.length} low-passes and high-passes`);
  for (const f of flat) assert.equal((f.Q as FakeParam).value, Q_FLAT_DB, `${f.type} at ${(f.frequency as FakeParam).value} Hz`);
  // The band-passes and the peak carry linear Qs, each a number the design names: the wind's four (the breeze's band and the buffet's bump are in their buffers; the whoosh is built only in a turn), and for each of
  // the eight wave emitters the crash's band (0.8) and the rattle and slosh band (1.5).
  const others = filters.filter((f) => f.type !== "lowpass" && f.type !== "highpass" && f.type !== "highshelf").map((f) => (f.Q as FakeParam).value).sort((a, b) => a - b);
  const want = [0.7, 30, 38, 45, ...new Array<number>(8).fill(0.8), ...new Array<number>(8).fill(1.5)].sort((a, b) => a - b);
  assert.deepEqual(others, want);
});

test("every pan is a gain pair into a merger: no panner node is ever made", () => {
  const { ctx, engine } = engineOn();
  engine.enable(true);
  fly({ ctx, engine }, 0, 0.2, () => ({ speed: CRUISE * BOOST }));
  assert.equal(ctx.nodes.filter((n) => n.kind === "stereoPanner" || n.kind === "panner").length, 0);
  // Each merger is fed on input 0 and input 1 by gains (the buffet's two ears, the whistles' pans, and
  // each of the eight wave emitters').
  const mergers = ctx.nodes.filter((n) => n.kind === "merger");
  assert.equal(mergers.length, 2 + 8);
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
  const kit = fakeKit() as unknown as Kit;
  const hub = buildHub(ctx as unknown as Ctx, kit, 3, 0);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: true, seed: 3 });
  const built = { hub, seed: 3, at: 0, fresh };
  const v = buildWind(ctx as unknown as Ctx, kit, out as unknown as AudioNode, built);
  for (const step of v.steps) step();
  const d = buildWhistles(ctx as unknown as Ctx, kit, out as unknown as AudioNode, built);
  for (const step of d.steps) step();
  const w = buildWhoosh(ctx as unknown as Ctx, kit, out as unknown as AudioNode, built);
  for (const step of w.steps) step();
  const gains = [T.A_L, T.A_R, T.B_GAIN, T.C_GAIN, T.D_GAIN, T.E_GAIN, T.W_GAIN];
  for (const i of gains) {
    const b = [...v.bindings, ...d.bindings, ...w.bindings].find((x) => x.i === i);
    assert.ok(b, `target ${i} is bound`);
    for (const p of b.params) assert.equal((p as unknown as FakeParam).value, 0);
  }
  // The wind's reads are handles (they move on). Every buffer source these voices started is a loop.
  for (const s of ctx.nodes) if (s.kind === "bufferSource") assert.ok(s.loop && s.started, "looping and started");
  // The control signals are played once, in the hub: the wind itself starts only noise.
  assert.equal(hub.sources.length, 3);
  assert.ok(!v.bindings.some((b) => b.i === T.D_GAIN), "the whistles are a voice of their own");
});

test("the whoosh is built as a turn begins, follows the mix at its own pace from its first value, and is let go after", () => {
  const e = engineOn();
  e.engine.enable(true);
  const bands = () => e.ctx.nodes.filter((n) => n.kind === "biquad" && (n.Q as FakeParam).value === 1.1);
  fly(e, 0, 1);
  assert.equal(bands().length, 0, "none in level flight");
  fly(e, 1, 1, (t) => ({ bank: Math.min(1, (t - 1) * 3) }));
  assert.equal(bands().length, 1);
  // Its level gain: the one the band feeds. Never set outright, and its first approach is the whoosh's rise (70 ms).
  const lev = (bands()[0].outs[0].to as FakeNode).gain as FakeParam;
  assert.ok(lev.calls.length > 0);
  assert.deepEqual([...new Set(lev.calls.map((c) => c.method))], ["setTargetAtTime"]);
  assert.equal(lev.calls[0].args[2], 0.07);
  const live = () => e.ctx.nodes.filter((n) => n.kind === "bufferSource" && n.loop && n.stopped === null).length;
  const before = live();
  fly(e, 2, 4);
  assert.equal(live(), before - 1, "its noise is stopped");
});

test("the whistles are built only at speed, and let go two seconds after the dragon slows", () => {
  const e = engineOn();
  e.engine.enable(true);
  const whistles = () => e.ctx.nodes.filter((n) => n.kind === "biquad" && [30, 38, 45].includes((n.Q as FakeParam).value)).length;
  fly(e, 0, 1);
  assert.equal(whistles(), 0, "none at cruise");
  fly(e, 1, 3, () => ({ speed: CRUISE * BOOST }));
  assert.equal(whistles(), 3);
  const sources = e.ctx.nodes.filter((n) => n.kind === "bufferSource" && n.loop && n.stopped === null).length;
  fly(e, 4, 4);
  assert.equal(e.ctx.nodes.filter((n) => n.kind === "bufferSource" && n.loop && n.stopped === null).length, sources - 2, "their noise and their squalls are stopped");
  // Never on touch.
  const t = engineOn({ touch: true });
  t.engine.enable(true);
  fly(t, 0, 2, () => ({ speed: CRUISE * BOOST }));
  assert.equal(t.ctx.nodes.filter((n) => n.kind === "biquad" && (n.Q as FakeParam).value === 38).length, 0);
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
  // (The whistles are built during the boost and the whoosh in each turn: a new voice's filters and pans are placed
  // once, while its own level is still 0.)
  const fresh = e.ctx.nodes.filter((n) => n.kind === "biquad" && [1.1, 30, 38, 45].includes((n.Q as FakeParam).value));
  const pans = new Set(fresh.filter((n) => (n.Q as FakeParam).value === 1.1).flatMap((band) => (band.outs[0].to as FakeNode).outs.map((o) => o.to)));
  const whistle = (c: { param: FakeParam }) => fresh.includes(c.param.owner) || pans.has(c.param.owner);
  const outright = during.filter((c) => (c.method === "setValueAtTime" || c.method === "cancelScheduledValues") && !whistle(c));
  assert.deepEqual(outright.map((c) => `${c.param.owner.kind}.${c.param.name}`), []);
  // Three whistles; and the whoosh, built once for the two turns: its band and its two pan gains.
  assert.equal(during.filter((c) => c.method === "setValueAtTime" && whistle(c)).length, 3 + 3);
  assert.ok(during.every((c) => c.method === "setTargetAtTime" || whistle(c)));
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

/** A Hearing with one beach cell due east, 25 cells off, heavy enough to take a lane at once. */
function byABeach(): ReturnType<typeof emptyHearing> {
  const h = emptyHearing();
  h.shores.push({ sector: 0, cell: 77, kind: 1, bend: 40, x: 25, y: 0, w: 10 });
  return h;
}

test("a wave is one envelope source started on a free emitter, whose chain is set outright only while it is silent", () => {
  const e = engineOn();
  e.engine.enable(true);
  const h = byABeach();
  const run = (t0: number, seconds: number) => {
    for (let k = 0; k < seconds * 60; k++) {
      const t = t0 + k / 60;
      e.ctx.currentTime = t;
      e.engine.frame(pose(t, { speed: 0 }), h, PREFS, { now: t, o: 0 });
    }
  };
  run(100, 12);
  const st = e.engine.stats();
  assert.ok(st.waves.length >= 3, `${st.waves.length} waves in twelve seconds`);
  assert.equal(e.engine.laneMask(), 1, "the eastern sector holds a lane");
  // Envelope sources: not loops, played at their own rate, each into a splitter.
  const envs = e.ctx.nodes.filter((n) => n.kind === "bufferSource" && !n.loop && (n.outs[0]?.to as FakeNode).kind === "splitter");
  for (const env of envs) assert.equal((env.playbackRate as FakeParam).value, 1);
  assert.equal(envs.length, st.waves.length);
  for (const env of envs) {
    assert.ok(env.started);
    assert.equal((env.outs[0].to as FakeNode).kind, "splitter");
  }
  // A wave found ahead starts at its own time, not now.
  const fresh = st.waves.filter((w) => w.lasts === 4);
  assert.ok(fresh.length >= 2);
  for (const w of fresh) assert.ok(Math.abs(w.when - w.t) < 1e-9);
  // No emitter's chain was set outright while a wave of its own was sounding.
  const sets = e.ctx.calls().filter((c) => c.method === "setValueAtTime" && c.param.owner.kind === "gain" && c.args[1] >= 100.1);
  assert.ok(sets.length >= st.waves.length);
  // Hidden: every envelope is stopped just after the ramp, and the next frames start none until sound is back.
  e.engine.hide(112);
  for (const env of envs) if (env.started![0] > 108) assert.ok(Math.abs(env.stopped! - 112.21) < 1e-9);
  const before = e.engine.stats().waves.length;
  e.engine.enable(false);
  run(116, 1);
  const back = e.engine.stats().waves.slice(before);
  assert.ok(back.some((w) => w.lasts < 4), "a wave already breaking is joined part-way");
});

test("bells: a stroke is a ring and a strike into its slot; a ring joined late has no strike; three rings a bell; a mute stops them all", () => {
  const ctx = new FakeContext();
  const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: false, seed: 3, offline: true, abbeys: [{ x: 0, y: -60 }] });
  const e = { ctx, engine };
  engine.enable(true);
  const sources = () => ctx.nodes.filter((n) => n.kind === "bufferSource" && !n.loop);
  // Hour 5, twelve seconds in: the peal is under way. The rings already sounding are joined, each on a rising gain, with no strike.
  const top = 240 * 5;
  fly(e, top + 12, 0.1, () => ({ speed: 0 }));
  const joined = sources().filter((s) => (s.started as number[])[1] > 0);
  assert.ok(joined.length > 3);
  for (const s of joined) {
    assert.ok((s.started as number[])[1] > 0, "started part of the way in");
    const g = (s.outs[0].to as FakeNode).gain as FakeParam;
    assert.deepEqual(g.calls.map((c) => c.method), ["setValueAtTime", "setTargetAtTime"]);
  }
  // Of each bell, the three newest are heard; any older is stopped before it sounds.
  const heard = joined.filter((s) => s.stopped === null);
  assert.ok(heard.length >= 3 && heard.length <= 15 && heard.length < joined.length);
  for (const s of joined) if (s.stopped !== null) assert.equal(s.stopped, (s.started as number[])[0]);
  assert.equal(ctx.nodes.filter((n) => n.kind === "convolver").length, 1);
  // On through the peal: every new stroke is two sources from their tops; no bell ever has more than three rings left alone.
  fly(e, top + 12.1, 10, () => ({ speed: 0 }));
  const fresh = sources().filter((s) => (s.started as number[])[1] === 0);
  assert.ok(fresh.length > 20 && fresh.length % 2 === 0);
  assert.equal(sources().length, joined.length + fresh.length, "nothing is joined late once the peal is being followed");
  const faded = ctx.nodes.filter((n) => n.kind === "gain" && (n.gain as FakeParam).calls.some((c) => c.method === "setTargetAtTime" && c.args[0] === 0 && c.args[2] === 0.25));
  assert.ok(faded.length > 5, "older rings made way");
  // The duck: wind and water are down 3 dB while the abbey rings this near.
  const duck = ctx.calls().filter((c) => c.method !== "cancelScheduledValues" && Math.abs((c.args[0] as number) - Math.pow(10, -3 / 20)) < 1e-4);
  assert.ok(duck.length >= 2);
  engine.mute(top + 22.2);
  // (The stand-in rings last 5 s: any started in the last four are still sounding.)
  const sounding = sources().filter((s) => (s.started as number[])[0] > top + 18.2 && s.buffer !== undefined);
  assert.ok(sounding.length > 5 && sounding.every((s) => s.stopped !== null), "every ring still sounding is stopped");
});

test("rivers and falls: the bed is built when a river is heard; a fall's chain plays while its fall is reported and stops after", () => {
  const { ctx, engine } = engineOn();
  engine.enable(true);
  const hearing = emptyHearing();
  const run = (t0: number, seconds: number) => {
    for (let k = 0; k < seconds * 60; k++) {
      const t = t0 + k / 60;
      ctx.currentTime = t;
      engine.frame(pose(t, { speed: 0 }), hearing, PREFS, { now: t, o: 0 });
    }
  };
  const loops = () => ctx.nodes.filter((n) => n.kind === "bufferSource" && n.loop && n.started && n.stopped === null).length;
  run(0, 0.5);
  const quiet = loops();
  // A river to the east: the bed's four reads of the bubble beds and its riffle's noise.
  hearing.river = { e: 40, dx: 30, dy: 0, d: 30 };
  run(0.5, 0.5);
  assert.equal(loops(), quiet + 5);
  const offRate = ctx.nodes.filter((n) => n.kind === "bufferSource" && n.loop && (n.playbackRate as FakeParam).value !== 1 && (n.playbackRate as FakeParam).value >= 0.94);
  assert.equal(offRate.length, 4, "each bed read twice, a little off true");
  // A tall fall 30 cells east: one chain, five sources less the brook (a tall fall has none), its gain eased up.
  hearing.falls = [{ x: 30, y: 0, h: 0, run: 18, w: 10, edge: 1 }];
  run(1, 1);
  assert.equal(loops(), quiet + 5 + 4);
  assert.equal(engine.stats().fallsBound, 1);
  // A small fall beside it takes the second chain: pink, white, plunge and the brook, no rumble.
  hearing.falls = [{ x: 30, y: 0, h: 0, run: 18, w: 10, edge: 1 }, { x: -40, y: 10, h: 0, run: 4, w: 3, edge: 1 }];
  run(2, 1);
  assert.equal(loops(), quiet + 5 + 4 + 4);
  // Both gone from the frame: each fades with its edge, then its sources are stopped; the river goes too.
  hearing.falls = [];
  hearing.river = { e: 0, dx: 0, dy: 0, d: 0 };
  run(3, 5);
  assert.equal(loops(), quiet);
  assert.equal(engine.stats().fallHandovers, 0);
});
