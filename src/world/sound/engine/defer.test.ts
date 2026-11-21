import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyHearing, type Hearing, type Pose, type Prefs } from "../types.ts";
import { createEngine, WORK } from "./engine.ts";
import { FakeContext, fakeKit, type FakeNode } from "./fake.ts";
import type { Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";
import { createOneShots, DEFER_DUE } from "./slots.ts";

// The heavy page frames (design §14.9): a one-shot started on the page is made (a source, a gain, their connections:
// tens of microseconds at 4×) in the frame that finds it, on top of the mix or the voices. Started a few frames later
// it sounds at the same audio time: its `when` is a quarter of a second ahead. So a one-shot not due soon waits for a
// light frame.

const fakeBuffer = { duration: 1, numberOfChannels: 1, sampleRate: 48000, length: 48000 } as unknown as AudioBuffer;

test("a deferring register makes a one-shot not due soon only when flushed, at most as many a flush as asked, the soonest first", () => {
  const ctx = new FakeContext();
  const shots = createOneShots(ctx as unknown as Ctx, 40, { defer: true });
  const dest = ctx.createGain() as unknown as AudioNode;
  const sources = () => ctx.nodes.filter((n) => n.kind === "bufferSource");
  ctx.currentTime = 10;
  assert.ok(shots.play(fakeBuffer, dest, { when: 10.3, gain: 0.5 }));
  assert.ok(shots.play(fakeBuffer, dest, { when: 10.2, gain: 0.5 }));
  assert.equal(sources().length, 0, "nothing made yet");
  assert.equal(shots.started, 2, "both count as started: the caller's bookkeeping does not change");
  shots.flush(10, 1);
  assert.equal(sources().length, 1);
  assert.deepEqual(sources()[0].started, [10.2, 0], "the soonest first, at its own time");
  shots.flush(10.01, 0);
  assert.equal(sources().length, 1, "a flush of none makes none");
  // Due soon: made at once, whatever the flush allows.
  shots.play(fakeBuffer, dest, { when: 10.01 + DEFER_DUE / 2, gain: 0.5 });
  assert.equal(sources().length, 2);
  // And one left waiting is made once it falls due, even by a flush of none.
  ctx.currentTime = 10.3 - DEFER_DUE / 2;
  shots.flush(ctx.currentTime, 0);
  assert.equal(sources().length, 3);
  assert.deepEqual(sources()[2].started, [10.3, 0]);
});

test("a mute stops what is waiting too: it is never made", () => {
  const ctx = new FakeContext();
  const shots = createOneShots(ctx as unknown as Ctx, 40, { defer: true });
  const dest = ctx.createGain() as unknown as AudioNode;
  ctx.currentTime = 5;
  shots.play(fakeBuffer, dest, { when: 5.3, gain: 0.5 });
  shots.stopAll(5.01);
  shots.flush(5.5, 10);
  assert.equal(ctx.nodes.filter((n) => n.kind === "bufferSource").length, 0);
});

test("without deferring (offline, and the default), a one-shot is made as it is asked for", () => {
  const ctx = new FakeContext();
  const shots = createOneShots(ctx as unknown as Ctx, 40);
  shots.play(fakeBuffer, ctx.createGain() as unknown as AudioNode, { when: 9, gain: 0.5 });
  assert.equal(ctx.nodes.filter((n) => n.kind === "bufferSource").length, 1);
});

// ── In the engine ───────────────────────────────────────────────────────────────────────────────────────────────────

const PREFS: Prefs = { volume: 0.7, headphones: false, calm: false, touch: false };

function byABeach(): Hearing {
  const h = emptyHearing();
  h.shores.push({ sector: 0, cell: 77, kind: 1, bend: 40, x: 25, y: 0, w: 10 });
  h.surf[0].e = 4;
  h.surf[0].dx = 3;
  h.surf[0].d = 30;
  h.sea = 0.4;
  return h;
}

/** Flies the page's path at `fps` from four seconds before an hour's peal, by a beach, an abbey near. */
function fly(fps: number, seconds: number, offline: boolean, defer?: boolean) {
  const ctx = new FakeContext();
  const engine = createEngine(ctx as unknown as Ctx, fakeKit() as unknown as Kit, { touch: false, seed: 3, abbeys: [{ x: 0, y: -60 }], offline, defer });
  engine.enable(true);
  const hearing = byABeach();
  const made: { work: number; when: number; due: number }[] = [];
  for (let k = 0; k < seconds * fps; k++) {
    const t = 244 + k / fps;
    ctx.currentTime = t;
    const before = ctx.nodes.length;
    const pose: Pose = { t, dt: 1 / fps, x: (t - 244) * 3, y: 0, alt: 30, heading: -Math.PI / 2, speed: 60, bank: 0, rest: 0 };
    engine.frame(pose, hearing, PREFS, offline ? { now: t, o: 0 } : undefined);
    const work = engine.work();
    for (const n of ctx.nodes.slice(before) as FakeNode[]) {
      // A one-shot: a buffer source that does not loop.
      if (n.kind === "bufferSource" && !n.loop && n.started) made.push({ work, when: n.started[0], due: n.started[0] - t });
    }
  }
  return { engine, made };
}

test("on the page at 120 Hz, a one-shot (a lap, a bell's ring and strike) is made on a frame with the mix or the voices only when it is due soon; each sounds at its own time", () => {
  const live = fly(120, 16, false);
  const st = live.engine.stats();
  assert.ok(st.strokes.length >= 5, `${st.strokes.length} strokes`);
  assert.ok(live.made.length >= 10, `${live.made.length} one-shots`);
  for (const m of live.made) if (m.work & (WORK.mix | WORK.voices)) assert.ok(m.due < DEFER_DUE + 1e-9, `made on a heavy frame ${m.due.toFixed(3)} s ahead`);
  // The same one-shots at the same audio times as an engine that makes each at once (defer: false, as before).
  const now = fly(120, 16, false, false);
  const whens = (r: typeof live) => r.made.map((m) => m.when.toFixed(6)).sort();
  assert.deepEqual(whens(live), whens(now));
  // And nothing deferred was made late: each is made before its time.
  for (const m of live.made) assert.ok(m.due > 0, `made ${(-m.due).toFixed(3)} s late`);
});

test("offline nothing waits: every one-shot is made in the step that asks for it", () => {
  const off = fly(60, 16, true);
  assert.ok(off.made.length >= 5);
  // (Made in the step it was asked for: its start is never earlier than the step's time and the register keeps none.)
  for (const m of off.made) assert.ok(m.due > -1e-9);
});
