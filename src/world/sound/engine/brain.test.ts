import assert from "node:assert/strict";
import { test } from "node:test";
import { PASS } from "../ear.ts";
import { bellCues, LONGEST_RING } from "../schedule/bells.ts";
import { emptyHearing, type Hearing, type Pose, type Prefs } from "../types.ts";
import { BRAIN_AHEAD, createBrain, unpackEmitters, type BrainAsk, type BrainInit, type BrainReply, type RemoteBrain } from "./brain.ts";
import { createEngine, WORK, type Engine } from "./engine.ts";
import { FakeContext, fakeKit } from "./fake.ts";
import type { Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import { createLanes, type EmitterState, type LapStart, type WaveStart } from "./lanes.ts";
import { createScheduler, type Due } from "./scheduler.ts";

const PREFS: Prefs = { volume: 0.7, headphones: false, calm: false, touch: false };
const INIT: BrainInit = { seed: 3, n: 10240, touch: false, forced: false, colonies: [], railway: null };
const pose = (t: number, o: Partial<Pose> = {}): Pose => ({ t, dt: 1 / 120, x: 0, y: 0, alt: 30, heading: -Math.PI / 2, speed: 60, bank: 0, rest: 0, mist: 0, night: 0, rain: 0, ...o });
const ask = (t: number, o: Partial<BrainAsk> = {}): BrainAsk => ({ t, x: 0, y: 0, night: 0, look: 0.25, reach: 0, surf: true, epoch: 0, ...o });

/** A Hearing with a beach due east (heavy enough to take a lane at once) and a little open sea. */
function byABeach(): Hearing {
  const h = emptyHearing();
  h.shores.push({ sector: 0, cell: 77, kind: 1, bend: 40, x: 25, y: 0, w: 10 });
  h.surf[0].e = 4;
  h.surf[0].dx = 3;
  h.surf[0].d = 30;
  h.sea = 0.4;
  return h;
}

/** Where the engine's flights begin: four seconds before a world hour's peal (the hours are 240 s; the strokes start 8 s in). */
const T0 = 244;

/** The flight both sides are given: cruise, a boost, a banked turn, cruise again; rain coming on. */
const flight = (t: number): Partial<Pose> => {
  const u = t - T0;
  return { speed: u < 2 ? 60 : u < 4 ? 60 + 20 * (u - 2) : 100, bank: u > 5 && u < 7 ? 0.5 * Math.sin((u - 5) * Math.PI / 2) : 0, x: 3 * u, rain: Math.min(1, Math.max(0, (u - 6) / 3)) };
};

test("a brain's step gives the lanes' waves and the scheduler's cues, as the same functions give them looking a pass further", () => {
  const brain = createBrain(INIT);
  brain.source("bell");
  const hearing = byABeach();
  // The same, by hand.
  const lanes = createLanes({ lanes: 4, emitters: 8, seed: 3 });
  const scheduler = createScheduler([{ kind: "bell", cues: (a, b, out) => bellCues(3, a, b, out), lookBack: LONGEST_RING }]);
  const waves: WaveStart[] = [], laps: LapStart[] = [], due: Due[] = [];
  const emitters: EmitterState[] = [];
  let lastT = NaN, wavesSeen = 0, cuesSeen = 0;
  // Ten steps a second through the first of a world hour (the peal).
  for (let k = 0; k < 10 * 20; k++) {
    const t = 0.5 + k * PASS;
    const reply = brain.step(ask(t, { epoch: 7 }), hearing);
    const since = lastT === lastT ? t - lastT : 0;
    lastT = t;
    waves.length = 0;
    laps.length = 0;
    lanes.step(hearing, t, since, 0.25 + BRAIN_AHEAD, waves, laps);
    due.length = 0;
    scheduler.pass(t, since, 0.25 + BRAIN_AHEAD, due);
    unpackEmitters(reply.emitters, emitters);
    assert.equal(reply.mask, lanes.mask());
    assert.equal(reply.epoch, 7);
    assert.deepEqual(emitters, lanes.emitters.map((e) => ({ ...e })));
    assert.deepEqual(reply.waves ?? [], waves);
    assert.deepEqual(reply.laps ?? [], laps);
    assert.deepEqual(reply.due ?? [], due);
    // Everything is found at least as far ahead as the page finds it thirty times a second: a quarter of a second.
    if (k > 0) {
      for (const w of waves) if (w.offset === 0) assert.ok(w.cue.t - t > 0.25 - 1e-9, `a wave ${w.cue.t - t} s ahead`);
      for (const d of due) if (!d.rejoin) assert.ok(d.cue.t - t > 0.25 - 1e-9, `a stroke ${d.cue.t - t} s ahead`);
    }
    wavesSeen += waves.length;
    cuesSeen += due.length;
  }
  assert.ok(wavesSeen >= 4 && cuesSeen >= 10, `${wavesSeen} waves, ${cuesSeen} strokes`);
});

test("a brain asks only the sources whose voices exist, steps the lanes only once the page's surf is built, and rejoins after a clear", () => {
  const brain = createBrain(INIT);
  const hearing = byABeach();
  let cues = 0, waves = 0;
  // Into the peal (its strokes start 8 s into the hour), the bells' voice and the surf not yet built.
  for (let k = 0; k < 110; k++) {
    const r = brain.step(ask(1 + k * PASS, { surf: false }), hearing);
    cues += r.due?.length ?? 0;
    waves += r.waves?.length ?? 0;
  }
  assert.equal(cues, 0, "no bells before their voice exists");
  assert.equal(waves, 0, "no waves before the surf is built");
  brain.source("bell");
  // The source joins as after a gap: rings already sounding are found again, joined in progress. So do the lanes: a
  // wave already breaking is joined part of the way in.
  let rang = false, joined = false;
  for (let k = 0; k < 40; k++) {
    const r = brain.step(ask(12.1 + k * PASS), hearing);
    if (k === 0) rang = (r.due ?? []).some((d) => d.rejoin);
    joined ||= (r.waves ?? []).some((w) => w.offset > 0);
    cues += r.due?.length ?? 0;
  }
  assert.ok(rang, "the rings sounding are joined");
  assert.ok(joined, "the wave in progress is joined");
  assert.ok(cues > 0);
  brain.clear();
  const after = brain.step(ask(16.2), hearing);
  assert.ok((after.due ?? []).some((d) => d.rejoin), "rejoined after the clear");
});

/** A RemoteBrain in the same thread, for the engine: stepped ten times a second, each answer taken a frame later. */
function passBrain(init: BrainInit, hearing: Hearing): RemoteBrain & { frame(t: number, x: number): void; kill(): void; steps: number } {
  const brain = createBrain(init);
  const flying: BrainReply[] = [], landed: BrainReply[] = [];
  let alive = true, last = NaN;
  const mine = { look: 0.25, reach: 0, surf: false };
  return {
    steps: 0,
    alive: () => alive,
    ask: mine,
    take: () => landed.shift() ?? null,
    source: (kind) => brain.source(kind),
    clear() {
      brain.clear();
      flying.length = 0;
      landed.length = 0;
    },
    /** Before each of the engine's frames: the last pass's answer lands, and a pass goes out when one is due. */
    frame(t, x) {
      landed.push(...flying.splice(0));
      if (last === last && t - last < PASS - 1e-9) return;
      last = t;
      this.steps++;
      flying.push(brain.step({ t, x, y: 0, night: 0, look: mine.look, reach: mine.reach, surf: mine.surf, epoch: 0 }, hearing));
    },
    kill() {
      alive = false;
    },
  };
}

interface Flown {
  engine: Engine;
  /** What each frame did (WORK bits). */
  work: number[];
}

/** Flies an engine on the page's path (not offline) at `fps` for `seconds` from T0, by a beach, an abbey near. */
function flyLive(fps: number, seconds: number, remote: boolean, each?: (k: number, b: ReturnType<typeof passBrain> | null) => void): Flown {
  const ctx = new FakeContext();
  const hearing = byABeach();
  const brain = remote ? passBrain(INIT, hearing) : null;
  const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: false, seed: 3, abbeys: [{ x: 0, y: -60 }], brain });
  engine.enable(true);
  const work: number[] = [];
  for (let k = 0; k < seconds * fps; k++) {
    const t = T0 + k / fps;
    ctx.currentTime = t;
    const p = pose(t, { ...flight(t), dt: 1 / fps });
    brain?.frame(t, p.x);
    each?.(k, brain);
    engine.frame(p, hearing, PREFS, { now: t, o: 0 });
    work.push(engine.work());
  }
  return { engine, work };
}

const waves = (s: ReturnType<Engine["stats"]>) => s.waves.map((w) => `${w.t.toFixed(4)} ${w.lane} ${w.kind} ${w.strength}`).sort();
const strokes = (s: ReturnType<Engine["stats"]>) => s.strokes.map((k) => `${k.H} ${k.bell} ${k.k} ${k.t.toFixed(4)}`).sort();

test("with its lanes and scheduler worked elsewhere, the engine starts the same waves and strokes, each at its own time", () => {
  for (const fps of [120, 60]) {
    const own = flyLive(fps, 14, false), far = flyLive(fps, 14, true);
    const a = own.engine.stats(), b = far.engine.stats();
    assert.ok(a.waves.length >= 3 && a.strokes.length >= 5, `${a.waves.length} waves, ${a.strokes.length} strokes`);
    assert.deepEqual(waves(b), waves(a), `${fps} Hz: the same waves`);
    assert.deepEqual(strokes(b), strokes(a), `${fps} Hz: the same strokes`);
    // Each starts when its cue says (a wave or a stroke found in time is scheduled at its own time, whoever found it).
    const when = (s: typeof a) => new Map([...s.waves.filter((w) => w.t > T0 + 1).map((w) => [`w${w.t.toFixed(4)}`, w.when] as const), ...s.strokes.filter((k) => k.t > T0 + 1).map((k) => [`s${k.t.toFixed(4)} ${k.bell}`, k.when] as const)]);
    const wa = when(a), wb = when(b);
    for (const [key, at] of wa) assert.ok(Math.abs((wb.get(key) ?? NaN) - at) < 1e-9, `${fps} Hz: ${key} at ${wb.get(key)} against ${at}`);
    // The mix is the page's own either way: the same sends.
    assert.ok(Math.abs(b.sends - a.sends) <= 0.02 * a.sends, `${b.sends} sends against ${a.sends}`);
  }
});

test("worked elsewhere, the page's frames carry no scheduler and no lanes of their own", () => {
  const far = flyLive(120, 8, true);
  const steady = far.work.slice(240);
  // The scheduler's bit shows only in the frames an answer with cues came in (ten a second at most), where on the
  // page it showed in every frame.
  const sched = steady.filter((w) => w & WORK.sched).length;
  assert.ok(sched > 0 && sched <= 10 * (steady.length / 120) + 1, `${sched} frames with cues in ${steady.length}`);
  const own = flyLive(120, 8, false).work.slice(240);
  assert.equal(own.filter((w) => w & WORK.sched).length, own.length);
  // The mix, the voices and the emitters go on as before, thirty times a second each.
  for (const bit of [WORK.mix, WORK.voices, WORK.emitters]) {
    const n = steady.filter((w) => w & bit).length;
    assert.ok(n >= 0.9 * 30 * (steady.length / 120) && n <= 1.1 * 30 * (steady.length / 120), `bit ${bit}: ${n} in ${steady.length} frames`);
  }
});

test("a brain that fails is done without: the engine works its lanes and scheduler itself from the next frame", () => {
  let killedAt = -1;
  const run = flyLive(120, 14, true, (k, b) => {
    if (k === 120 * 5) {
      b?.kill();
      killedAt = b?.steps ?? -1;
    }
  });
  const st = run.engine.stats();
  assert.ok(killedAt > 30);
  // Waves and strokes go on after it has gone.
  assert.ok(st.waves.some((w) => w.when > T0 + 6) && st.strokes.some((s) => s.when > T0 + 6), `${st.waves.length} waves, ${st.strokes.length} strokes`);
  const own = flyLive(120, 14, false).engine.stats();
  assert.ok(st.strokes.length >= own.strokes.length && st.waves.length >= own.waves.length - 1);
});
