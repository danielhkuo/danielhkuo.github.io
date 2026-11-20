import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyHearing, type Pose, type Prefs } from "../types.ts";
import { createEngine, WORK } from "./engine.ts";
import { FakeContext, fakeKit, FakeNode, type FakeParam } from "./fake.ts";
import { createFresh, FRESH, ownGenerations, type FreshKit } from "./fresh.ts";
import type { Ctx } from "./graph.ts";
import type { Kit } from "./kit.ts";

// Fresh loops (design §14.8): a bed's noise is read from a loop, and before the loop can come round the read moves, by an
// equal-power crossfade, to a new generation of it that the kit has made. No stretch is heard twice.

/** A buffer of a generation: enough of an AudioBuffer to read its name, generation and length. */
interface Gen {
  name: string;
  g: number;
  duration: number;
  numberOfChannels: number;
}

/**
 * A kit of generations. `delay`: seconds (of the time handed to `tick`) from a request until it is adopted; Infinity
 * never adopts. A request `now` is adopted at once.
 */
function genKit(delay = 0) {
  const newest = new Map<string, number>();
  const asked: { name: string; g: number; at: number; now: boolean }[] = [];
  const inFlight: { name: string; g: number; due: number }[] = [];
  let t = 0;
  const buffers = new Map<string, Gen>();
  const buffer = (name: string, g = 0): AudioBuffer => {
    const key = `${name}/${g}`;
    let b = buffers.get(key);
    if (!b) buffers.set(key, (b = { name, g, duration: name === "drops" ? 7.3 : 5, numberOfChannels: 2 }));
    return b as unknown as AudioBuffer;
  };
  const kit: FreshKit & { asked: typeof asked; tick(now: number): void } = {
    asked,
    buffer,
    generation: (name) => newest.get(name) ?? 0,
    pending: () => inFlight.length > 0,
    request(name, g, now = false) {
      assert.ok(!asked.some((a) => a.name === name && a.g === g), `${name} generation ${g} asked for twice`);
      assert.equal(g, (newest.get(name) ?? 0) + 1, `${name}: generations are asked for in turn`);
      asked.push({ name, g, at: t, now });
      if (now) newest.set(name, g);
      else inFlight.push({ name, g, due: t + delay });
    },
    tick(now) {
      t = now;
      for (let i = inFlight.length - 1; i >= 0; i--) {
        if (inFlight[i].due <= now) {
          newest.set(inFlight[i].name, Math.max(newest.get(inFlight[i].name) ?? 0, inFlight[i].g));
          inFlight.splice(i, 1);
        }
      }
    },
  };
  return kit;
}

const sources = (ctx: FakeContext) => ctx.nodes.filter((n) => n.kind === "bufferSource" && n.buffer && (n.buffer as Gen).g !== undefined);
const genOf = (n: FakeNode) => n.buffer as unknown as Gen;
const rateOf = (n: FakeNode) => (n.playbackRate as FakeParam).value;

/** Runs `fresh.frame` at `fps` for `seconds`, the kit ticking first; returns how many swaps each frame made. */
function run(ctx: FakeContext, kit: ReturnType<typeof genKit>, fresh: ReturnType<typeof createFresh>, fps: number, seconds: number, from = 0) {
  const swapsAt: number[] = [];
  for (let k = 0; k < fps * seconds; k++) {
    const now = from + k / fps;
    ctx.currentTime = now;
    kit.tick(now);
    const before = fresh.swaps;
    fresh.frame(now);
    swapsAt.push(fresh.swaps - before);
  }
  return swapsAt;
}

/** No source plays long enough to come round: from its start to its stop it reads less than its buffer. */
function noneWraps(ctx: FakeContext, end: number) {
  for (const s of sources(ctx)) {
    const [when] = s.started ?? [NaN];
    const until = s.stopped ?? end;
    // (A wandering read can run a few percent fast: FRESH.margin allows for it.)
    const read = (until - when) * rateOf(s) * FRESH.margin;
    assert.ok(read < genOf(s).duration, `${genOf(s).name} generation ${genOf(s).g} read ${read.toFixed(2)} s of ${genOf(s).duration} s`);
  }
}

test("a read: a source on the newest generation, through its fade, into a gain that stays; started where asked, wired once", () => {
  const ctx = new FakeContext();
  const kit = genKit();
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
  let wired = 0;
  const r = fresh.read("pink0", { at: 2, offset: 1.5, rate: 0.9, wire: () => (wired++, () => {}) });
  const s = sources(ctx);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].started, [2, 1.5]);
  assert.equal(rateOf(s[0]), 0.9);
  assert.ok(s[0].loop);
  assert.equal(genOf(s[0]).g, 0);
  assert.equal(wired, 1);
  // source → fade → out
  const fade = s[0].outs[0].to as FakeNode;
  assert.equal(fade.kind, "gain");
  assert.equal(fade.outs[0].to, r.out as unknown as FakeNode);
});

test("flown for a minute at 120 Hz: every read moves on before its loop comes round, by an equal-power crossfade, one move a frame", () => {
  const ctx = new FakeContext();
  const kit = genKit(0.3);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
  const unwired: number[] = [];
  fresh.read("pink0", { at: 0, offset: 0.2, rate: 1 });
  fresh.read("pink0", { at: 0, offset: 3.1, rate: 1.06 });
  fresh.read("drops", { at: 0, offset: 0, rate: 1.137, wire: () => () => void unwired.push(1) });
  fresh.read("white0", { at: 0, offset: 4.9, rate: 0.94 });
  const swapsAt = run(ctx, kit, fresh, 120, 60);
  noneWraps(ctx, 60);
  assert.ok(Math.max(...swapsAt) <= 1, "at most one move a frame");
  // Each read moved on many times (a five-second loop read for a minute: twelve times round).
  for (const name of ["pink0", "drops", "white0"]) assert.ok(kit.asked.filter((a) => a.name === name).length >= 10, `${name}: ${kit.asked.filter((a) => a.name === name).length} generations`);
  assert.ok(kit.asked.every((a) => !a.now), "the page never asks for a generation now");
  // The pink reads share their generations: one request a generation for the name, not one a read.
  assert.equal(new Set(kit.asked.filter((a) => a.name === "pink0").map((a) => a.g)).size, kit.asked.filter((a) => a.name === "pink0").length);
  // The crossfades: the new fades in on a curve from 0 to 1, the old out on the same curve reversed, each FRESH.fade long,
  // starting together; at every point the two powers sum to one.
  const fades = ctx.nodes.filter((n) => n.kind === "gain" && (n.gain as FakeParam).curves.length > 0);
  assert.ok(fades.length > 20);
  for (const f of fades) {
    for (const c of (f.gain as FakeParam).curves) {
      assert.ok(Math.abs(c.d - FRESH.fade) < 1e-9);
      const first = c.values[0], last = c.values[c.values.length - 1];
      assert.ok((first === 0 && last === 1) || (first === 1 && last === 0), `a curve from ${first} to ${last}`);
      for (let i = 0; i < c.values.length; i++) {
        const other = c.values[c.values.length - 1 - i];
        assert.ok(Math.abs(c.values[i] ** 2 + other ** 2 - 1) < 1e-6, "equal power");
      }
    }
  }
  // The old source stops as its fade ends, and its wiring is undone once it has.
  for (const s of sources(ctx)) if (s.stopped !== null) assert.ok(s.stopped > (s.started?.[0] ?? 0));
  assert.ok(unwired.length >= 8, `${unwired.length} unwired`);
});

test("a move starts a little ahead, and the old source's fade gain is let go once it has stopped", () => {
  const ctx = new FakeContext();
  const kit = genKit(0);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
  fresh.read("hiss", { at: 0, offset: 0 });
  run(ctx, kit, fresh, 60, 12);
  const s = sources(ctx).sort((a, b) => (a.started?.[0] ?? 0) - (b.started?.[0] ?? 0));
  assert.ok(s.length >= 3);
  for (let i = 1; i < s.length; i++) {
    const when = s[i].started?.[0] ?? NaN;
    // The previous source stops when this one has faded in.
    assert.ok(Math.abs((s[i - 1].stopped ?? NaN) - (when + FRESH.fade)) < 1e-9);
  }
  // Fades of sources long stopped no longer lead anywhere.
  const old = s[0].outs[0].to as FakeNode;
  assert.equal(old.outs.length, 0, "the first fade is disconnected");
});

test("a kit slow to answer still answers in time; a kit that never answers leaves the loop playing as it was", () => {
  {
    const ctx = new FakeContext();
    const kit = genKit(1.2);
    const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
    fresh.read("brown0", { at: 0, offset: 0 });
    run(ctx, kit, fresh, 120, 40);
    noneWraps(ctx, 40);
  }
  {
    const ctx = new FakeContext();
    const kit = genKit(Infinity);
    const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
    fresh.read("brown0", { at: 0, offset: 0 });
    run(ctx, kit, fresh, 120, 20);
    const s = sources(ctx);
    assert.equal(s.length, 1);
    assert.equal(s[0].stopped, null, "still looping");
    assert.equal(kit.asked.length, 1, "asked once, and waits");
  }
});

test("stopping a read stops what is playing and any fade on its way, and it is not moved again", () => {
  const ctx = new FakeContext();
  const kit = genKit(0);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
  const r = fresh.read("rush", { at: 0, offset: 0 });
  run(ctx, kit, fresh, 120, 3);
  r.stop(3.5);
  for (const s of sources(ctx)) assert.ok(s.stopped !== null && s.stopped <= 3.5 + FRESH.fade);
  const n = sources(ctx).length;
  run(ctx, kit, fresh, 120, 10, 3.01);
  assert.equal(sources(ctx).length, n, "no source made after the stop");
});

test("offline: every move due is made in the frame it falls due, generations asked for now, the same each time", () => {
  const once = () => {
    const ctx = new FakeContext();
    const kit = genKit(Infinity);
    const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: true, seed: 3 });
    for (let k = 0; k < 6; k++) fresh.read(k % 2 ? "pink0" : "white0", { at: 0, offset: k * 0.7 });
    run(ctx, kit, fresh, 60, 30);
    noneWraps(ctx, 30);
    assert.ok(kit.asked.length > 0 && kit.asked.every((a) => a.now));
    return sources(ctx).map((s) => `${genOf(s).name}/${genOf(s).g} ${s.started?.join(",")} ${s.stopped}`);
  };
  assert.deepEqual(once(), once());
});

test("a name turned off is read as a plain loop and never asked for again", () => {
  const ctx = new FakeContext();
  const kit = genKit(0);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3, on: (name) => name !== "velvet" });
  fresh.read("velvet", { at: 0, offset: 0 });
  fresh.read("pink0", { at: 0, offset: 0 });
  run(ctx, kit, fresh, 60, 20);
  assert.ok(!kit.asked.some((a) => a.name === "velvet"));
  assert.ok(kit.asked.some((a) => a.name === "pink0"));
});

// ── In the engine ───────────────────────────────────────────────────────────────────────────────────────────────────

const PREFS: Prefs = { volume: 0.7, headphones: false, calm: false, touch: false };

for (const fps of [120, 60]) test(`in the engine at ${fps} Hz: the wind, the surf bed, the open sea, the rain and the river all read fresh, moved on page frames with no mix or waves where there are any`, () => {
  const ctx = new FakeContext();
  const gens = genKit(0.2);
  // The fake kit, with generations. buffer(name) is generation 0 for everyone else (the falls, the moments, the waves'
  // own velvet), which keep their plain loops: only reads that name a generation are fresh ones.
  const kit = { ...fakeKit(), ...gens, buffer: (name: string, g?: number) => (g === undefined ? fakeKit().buffer(name) : gens.buffer(name, g)) };
  const engine = createEngine(ctx as unknown as Ctx, kit as unknown as Kit, { touch: false, seed: 3 });
  engine.enable(true);
  // By a beach, open sea about, a stream, in rain.
  const h = emptyHearing();
  h.surf[0].e = 4;
  h.surf[0].d = 30;
  h.sea = 0.8;
  h.stream.e = 3;
  h.stream.d = 20;
  const work: number[] = [];
  for (let k = 0; k < fps * 30; k++) {
    const t = 10 + k / fps;
    ctx.currentTime = t;
    gens.tick(t);
    const pose: Pose = { t, dt: 1 / fps, x: 0, y: 0, alt: 30, heading: 0, speed: 60, bank: 0, rest: 0, rain: 1 };
    engine.frame(pose, h, PREFS);
    work.push(engine.work());
  }
  const asked = new Set(gens.asked.map((a) => a.name));
  for (const name of ["buffet", "rush", "hiss", "breeze", "brown0", "pink0", "white0", "velvet", "drops", "plinks", "brook", "flow"]) assert.ok(asked.has(name), `${name} is made fresh`);
  noneWraps(ctx, 40);
  // The moves are made on frames that carry neither the mix nor the waves (WORK.fresh marks them).
  // (At 60 Hz every frame carries one or the other, and the moves go anyway.)
  const moved = work.filter((w) => w & WORK.fresh);
  assert.ok(moved.length > 20);
  if (fps === 120) assert.ok(moved.every((w) => (w & (WORK.mix | WORK.lanes)) === 0));
  // A wandering layer's new source is driven as the old was: its detune has the drift's gain as an input.
  // Once a source has stopped and been let go, nothing drives it any more (or the drift would keep every old source).
  const buffets = sources(ctx).filter((s) => genOf(s).name === "buffet" && genOf(s).g > 0);
  const live = buffets.filter((s) => s.stopped === null), gone = buffets.filter((s) => s.stopped !== null && s.stopped < 39);
  assert.ok(live.length > 0 && live.every((s) => (s.detune as FakeParam).inputs.length === 1), "live sources wander");
  assert.ok(gone.length > 0 && gone.every((s) => (s.detune as FakeParam).inputs.length === 0), "stopped sources are unwired");
});

test("an offline engine makes its own generations: two renders on one kit, one after the other, read the same", () => {
  const kit = genKit(0);
  const once = () => {
    const ctx = new FakeContext();
    const own = ownGenerations(ctx as unknown as Ctx, kit, 3);
    const fresh = createFresh(ctx as unknown as Ctx, own, { offline: true, seed: 3 });
    fresh.read("white0", { at: 0, offset: 0.3 });
    for (let k = 0; k < 60 * 12; k++) {
      ctx.currentTime = k / 60;
      fresh.frame(k / 60);
    }
    return { gens: own.generation("white0"), starts: ctx.nodes.filter((n) => n.kind === "bufferSource").map((n) => `${n.started?.join(",")} ${n.stopped}`) };
  };
  const a = once(), b = once();
  assert.ok(a.gens >= 3);
  assert.deepEqual(b, a);
  assert.equal(kit.asked.length, 0, "the shared kit is not asked");
});

test("a move's source is silent until its fade begins", () => {
  const ctx = new FakeContext();
  const kit = genKit(0);
  const fresh = createFresh(ctx as unknown as Ctx, kit, { offline: false, seed: 3 });
  fresh.read("pink0", { at: 0, offset: 0 });
  run(ctx, kit, fresh, 60, 4);
  const moved = sources(ctx).filter((s) => genOf(s).g > 0);
  assert.ok(moved.length > 0);
  for (const s of moved) assert.equal(((s.outs[0].to as FakeNode).gain as FakeParam).value, 0);
});
