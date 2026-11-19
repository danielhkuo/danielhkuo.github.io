// Timed sights seen as their time runs out: each carries on and leaves, or stays while it is watched, and none is cut
// off in view. The clocks stay the seed's and every visitor's; what lingers is the watching viewer's own.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import type { ManifestWonder } from "../pack/manifest.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { drawn, frameOf, land, manifest, seaFrame, shot } from "../testing/liveShot.ts";
import { LINGER_EASE, LINGER_GAP, Lingers } from "./linger.ts";
import type { LiveFrame } from "./live.ts";
import { CLOCK_LASTS, gardenWhere, momentSpan, momentsLayer, momentWindow, widestSands } from "./moments.ts";
import { HILL, RARE, rareLayer, rareWindow, type RareKind, type RareLayer, type RareSeen } from "./rare.ts";
import { KITE_EVERY, KITE_UP, NET_EVERY, RAINBOW_EVERY, sightsLayer } from "./sights.ts";

const seed = manifest.seed;
const n = manifest.n;
const ctx = { seed, n, sites: manifest.sites };
const palette = buildPalette(MIDDAY);
const W = 400, H = 225;
/** Seconds between the frames the tests draw. */
const DT = 0.25;

/** The times from t0 to t1 (inclusive) a frame apart. */
function times(t0: number, t1: number): number[] {
  const all: number[] = [];
  for (let j = 0; t0 + j * DT <= t1 + 1e-9; j++) all.push(t0 + j * DT);
  return all;
}

/** How strongly `out` differs from `bare`: every channel's difference, summed; only within `box` when one is given. */
function ink(out: Uint32Array, bare: Uint32Array, box?: { x0: number; y0: number; x1: number; y1: number }): number {
  let d = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = bare[i];
    if (a === b) continue;
    if (box) {
      const x = i % W, y = (i - x) / W;
      if (x < box.x0 || x >= box.x1 || y < box.y0 || y >= box.y1) continue;
    }
    d += Math.abs((a & 255) - (b & 255)) + Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)) + Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255));
  }
  return d;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

// ── The helper ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A sight's clock: appearance 0 from 5 s to 10 s, appearance 1 from 20 s to 25 s. Seconds into it, or −1. */
const windowAt = (t: number): number => (t >= 5 && t < 10 ? t - 5 : t >= 20 && t < 25 ? t - 20 : -1);
const slotAt = (t: number): number => (t < 15 ? 0 : 1);

/** Sight 0 of `l` through frames t0…t1, on the frame while `on(t)`: per frame, the seconds into its appearance drawn. */
function through(l: Lingers, t0: number, t1: number, on: (t: number) => boolean, rejoins = false): { t: number; at: number; fade: number }[] {
  const got: { t: number; at: number; fade: number }[] = [];
  for (const t of times(t0, t1)) {
    l.frame(t);
    const at = l.at(0, windowAt(t), slotAt(t), rejoins);
    if (at >= 0) l.drawn(0, on(t));
    got.push({ t, at, fade: l.fade(0, 1) });
  }
  return got;
}

test("a sight on the frame as its window shuts goes on past it, counting on from its start", () => {
  for (const g of through(new Lingers(1), 8, 14, () => true)) assert.ok(close(g.at, g.t - 5), `${g.t}: ${g.at}`);
});

test("a sight off the frame as its window shuts is gone with it", () => {
  for (const g of through(new Lingers(1), 8, 14, (t) => t < 9)) assert.ok(close(g.at, g.t < 10 ? g.t - 5 : -1), `${g.t}: ${g.at}`);
});

test("a lingering sight is gone for good once a frame has none of it, until its next appearance", () => {
  for (const g of through(new Lingers(1), 8, 22, (t) => t < 12)) {
    const want = g.t <= 12 ? g.t - 5 : g.t < 20 ? -1 : g.t - 20;
    assert.ok(close(g.at, want), `${g.t}: ${g.at}, want ${want}`);
  }
  // Not drawn at all in a frame (a layer that skips it out of reach) is as good as off the frame.
  const l = new Lingers(1);
  through(l, 8, 11, () => true);
  l.frame(11.25);
  l.frame(11.5);
  assert.equal(l.at(0, -1, 0, false), -1);
});

test("a jump in time forgets what lingers, forward or back", () => {
  const ahead = new Lingers(1);
  through(ahead, 8, 10.5, () => true);
  ahead.frame(10.5 + LINGER_GAP + 0.25);
  assert.equal(ahead.at(0, -1, 0, false), -1);
  const back = new Lingers(1);
  through(back, 8, 11, () => true);
  back.frame(10.5);
  assert.equal(back.at(0, -1, 0, false), -1);
});

test("while one lingers its next appearance waits, then eases in once it has gone", () => {
  const got = through(new Lingers(1), 8, 25, (t) => t < 22);
  for (const g of got) {
    if (g.t <= 22) assert.ok(close(g.at, g.t - 5), `${g.t}: still the first (${g.at})`);
    else assert.ok(close(g.at, g.t < 25 ? g.t - 20 : -1), `${g.t}: the next (${g.at})`);
  }
  const first = got.find((g) => g.t > 22);
  assert.ok(first && first.fade < 0.2, `the next shows faintly at first (${first?.fade})`);
  assert.ok(got.filter((g) => g.t >= 22.25 + LINGER_EASE).every((g) => close(g.fade, 1)), "and fully in a moment");
});

test("a sight that rejoins hands over to its next appearance at full strength", () => {
  const l = new Lingers(1);
  for (const t of times(8, 22)) {
    l.frame(t);
    const at = l.at(0, windowAt(t), slotAt(t), true);
    l.drawn(0, true);
    if (t < 10) assert.ok(close(at, t - 5));
    else if (t < 20) assert.ok(close(at, t - 5), `${t}: lingering (${at})`);
    else {
      assert.ok(close(at, t - 20), `${t}: the next (${at})`);
      assert.equal(l.fade(0, 0), 1, "shown in full though its own fade-in has not begun");
    }
  }
  // Without a linger before it, an appearance shows by its own fade-in.
  const fresh = new Lingers(1);
  fresh.frame(5.5);
  fresh.at(0, windowAt(5.5), 0, true);
  assert.equal(fresh.fade(0, 0.3), 0.3);
});

// ── Rare sights ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Make = (rx: number, ry: number, t: number) => LiveFrame;

/** Level country of one material, `height` units up, with the tone given; as seaFrame, which is the sea at tone 9. */
function country(rx: number, ry: number, t: number, material: number, tone: number, height: number): LiveFrame {
  const f = seaFrame(rx, ry, t, palette, n, material);
  for (let r = 0; r < H; r++) {
    const by = ry + r, cy = Math.floor(by / 256);
    const depth = Math.round(((by + height - 256 * cy) / 0.8) * 8);
    for (let c = 0; c < W; c++) f.bake[r * W + c] = (material | (tone << 8) | (depth << 16)) >>> 0;
  }
  return f;
}
const moor: Make = (rx, ry, t) => country(rx, ry, t, M.moorMid, 8, HILL + 20);
const deepSea: Make = (rx, ry, t) => country(rx, ry, t, M.sea, 12, 0);
const meadow: Make = (rx, ry, t) => country(rx, ry, t, M.meadowMid, 8, 20);
/** Meadow crossed by a narrow river every 24 rows. */
const streams: Make = (rx, ry, t) => {
  const f = meadow(rx, ry, t);
  for (let r = 0; r < H; r++) {
    if ((((ry + r) % 24) + 24) % 24 >= 3) continue;
    for (let c = 0; c < W; c++) f.bake[r * W + c] = (f.bake[r * W + c] & ~0xff) | M.river;
  }
  return f;
};

const kindOf = (kind: RareKind): number => RARE.findIndex((r) => r.kind === kind);

/** When sight k's first appearance ends, unforced: its window shuts at this time. */
function rareEnd(k: number): number {
  for (let t = 0; t < 2 * RARE[k].every; t += 1) {
    const at = rareWindow(seed, k, t);
    if (at >= 0) return t - at + RARE[k].lasts;
  }
  throw new Error("no appearance");
}

/** A camera on `make`'s land where one `kind`, and only one, is in full view well inside the frame at time t. */
function watching(kind: RareKind, make: Make, t: number): { rx: number; ry: number } | null {
  for (let ry = 1000; ry < 1000 + 512; ry += 70) for (let rx = 2000; rx < 2000 + 640; rx += 140) {
    const rare = rareLayer(ctx);
    rare.log = [];
    rare.draw(make(rx, ry, t));
    const mine = rare.log.filter((s) => s.kind === kind);
    if (mine.length === 1 && mine[0].inView && mine[0].px >= 24 && mine[0].px < W - 24 && mine[0].py >= 24 && mine[0].py < H - 24) return { rx, ry };
  }
  return null;
}

/** `rare` drawn on `make`'s land at one camera through `when`: per frame, the time and what of `kind` it logged. */
function watch(rare: RareLayer, make: Make, cam: { rx: number; ry: number }, kind: RareKind, when: number[]): { t: number; seen: RareSeen[] }[] {
  return when.map((t) => {
    rare.log = [];
    rare.draw(make(cam.rx, cam.ry, t));
    return { t, seen: rare.log.filter((s) => s.kind === kind) };
  });
}

/** True when the frames after `end` keep the sight drawn for a while, then never again; returns the last sighting. */
function stayedThenWent(frames: { t: number; seen: RareSeen[] }[], end: number, what: string): RareSeen {
  const after = frames.filter((f) => f.t >= end);
  const gone = after.findIndex((f) => f.seen.length === 0);
  assert.ok(gone !== 0, `${what} is still there as its time runs out`);
  assert.ok(gone > 0, `${what} has gone by ${after[after.length - 1].t - end} s after its time`);
  for (const f of after.slice(gone)) assert.equal(f.seen.length, 0, `${what} does not come back (${f.t - end} s after)`);
  for (const f of after.slice(0, gone)) assert.equal(f.seen.length, 1, `${what}: one, never two (${f.t - end} s after)`);
  return after[gone - 1].seen[0];
}

test("a rare sight in full view as its time runs out carries on until it has left the frame", () => {
  const cases: [RareKind, Make][] = [["balloon", moor], ["ship", deepSea], ["fox", meadow], ["heron", streams]];
  for (const [kind, make] of cases) {
    const k = kindOf(kind);
    const end = rareEnd(k);
    const cam = watching(kind, make, end - DT);
    assert.ok(cam, `a ${kind} in full view as its window shuts`);
    const frames = watch(rareLayer(ctx), make, cam, kind, times(end - 1, end + 240));
    const first = frames.find((f) => f.t >= end)?.seen[0];
    const last = stayedThenWent(frames, end, `the ${kind}`);
    assert.ok(first, `the ${kind} after its time`);
    assert.ok(last.px < 12 || last.px >= W - 12 || last.py < 14 || last.py >= H - 2, `the ${kind} left by the frame's edge, from ${last.px}, ${last.py}`);
    assert.ok(Math.hypot(last.px - first.px, last.py - first.py) > 20, `the ${kind} went on, from ${first.px}, ${first.py} to ${last.px}, ${last.py}`);
  }
});

test("a balloon drifts on east past its time, at the wind's pace", () => {
  const k = kindOf("balloon");
  const end = rareEnd(k);
  const cam = watching("balloon", moor, end - DT);
  assert.ok(cam);
  const frames = watch(rareLayer(ctx), moor, cam, "balloon", times(end - 1, end + 10)).filter((f) => f.t >= end);
  const xs = frames.map((f) => f.seen[0]?.px ?? NaN);
  assert.ok(xs.every((x) => !Number.isNaN(x)), "drawn throughout");
  const pace = (xs[xs.length - 1] - xs[0]) / 10;
  assert.ok(pace > 2.5 && pace < 4.5, `east at ${pace.toFixed(2)} px a second`);
});

test("a ship past its time that meets shoal water lies to there, still in view", () => {
  const k = kindOf("ship");
  const end = rareEnd(k);
  const cam = watching("ship", deepSea, end - DT);
  assert.ok(cam);
  const ahead = watch(rareLayer(ctx), deepSea, cam, "ship", times(end - DT, end + 1));
  const s0 = ahead[0].seen[0], s1 = ahead[ahead.length - 1].seen[0];
  assert.ok(s0 && s1);
  const dir = Math.sign(s1.px - s0.px);
  // Shoal water a few seconds' sailing ahead of it, across the whole frame.
  const shoal = s0.px + dir * 24;
  const shoals: Make = (rx, ry, t) => {
    const f = deepSea(rx, ry, t);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if ((c - shoal) * dir >= 0) f.bake[r * W + c] = (f.bake[r * W + c] & ~0xf00) | (2 << 8);
    return f;
  };
  const frames = watch(rareLayer(ctx), shoals, cam, "ship", times(end - 1, end + 60));
  for (const f of frames) assert.equal(f.seen.length, 1, `the ship is there ${f.t - end} s after its time`);
  const at = frames.map((f) => f.seen[0].px);
  assert.ok(at.every((x) => (x - shoal) * dir < 0), "short of the shoals");
  assert.equal(at[at.length - 1], at[at.length - 20], "and lying to");
});

test("a fox trotting on past its time crosses a road in its way, and goes from sight only into cover", () => {
  const k = kindOf("fox");
  const end = rareEnd(k);
  const cam = watching("fox", meadow, end - DT);
  assert.ok(cam);
  const ahead = watch(rareLayer(ctx), meadow, cam, "fox", times(end - DT, end + 1));
  const s0 = ahead[0].seen[0], s1 = ahead[ahead.length - 1].seen[0];
  assert.ok(s0 && s1);
  const dir = Math.sign(s1.px - s0.px);
  // A track across its way a little ahead, then a hedge further on.
  const road = s0.px + dir * 12, hedge = s0.px + dir * 30;
  const lane: Make = (rx, ry, t) => {
    const f = meadow(rx, ry, t);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const m = Math.abs(c - road) <= 1 ? M.path : (c - hedge) * dir >= 0 ? M.hedge : -1;
      if (m >= 0) f.bake[r * W + c] = (f.bake[r * W + c] & ~0xff) | m;
    }
    return f;
  };
  const frames = watch(rareLayer(ctx), lane, cam, "fox", times(end - 1, end + 30));
  const gone = frames.findIndex((f) => f.seen.length === 0);
  assert.ok(gone > 0, "the fox is there as its time runs out");
  const last = frames[gone - 1].seen[0];
  assert.ok((last.px - road) * dir > 1, `it crossed the track at ${road}, last seen at ${last.px}`);
  assert.ok((hedge - last.px) * dir <= 6, `and went into the hedge at ${hedge}, last seen at ${last.px}`);
  for (const f of frames.slice(gone)) assert.equal(f.seen.length, 0, "and stays in it");
});

test("the monk walks on past his time and goes in at his door", async () => {
  const k = kindOf("monk");
  const end = rareEnd(k);
  const abbey = await shot("abbey");
  // His door: where he stands as he comes out.
  const out = rareLayer(ctx);
  out.log = [];
  drawn(out, abbey, end - RARE[k].lasts + 0.1);
  const door = out.log.find((s) => s.kind === "monk");
  assert.ok(door, "he comes out");
  const rare = rareLayer(ctx);
  const frames = times(end - 1, end + 400).map((t) => {
    rare.log = [];
    rare.draw(frameOf(abbey, t));
    return { t, seen: rare.log.filter((s) => s.kind === "monk") };
  });
  const before = frames.filter((f) => f.t < end);
  assert.ok(before[before.length - 1].seen[0]?.inView, "in full view as his time runs out");
  const last = stayedThenWent(frames, end, "the monk");
  assert.ok(Math.abs(last.px - door.px) <= 1 && Math.abs(last.py - door.py) <= 1, `in at his door (${door.px}, ${door.py}) from ${last.px}, ${last.py}`);
});

test("the whale is under before its time runs out: nothing of it is cut", () => {
  const k = kindOf("whale");
  const end = rareEnd(k);
  const start = end - RARE[k].lasts;
  let cam: { rx: number; ry: number } | null = null, up: RareSeen | undefined;
  for (let ry = 1000; ry < 1512 && !cam; ry += 70) for (let rx = 2000; rx < 2640 && !cam; rx += 140) {
    const rare = rareLayer(ctx);
    rare.log = [];
    rare.draw(deepSea(rx, ry, start + 4));
    up = rare.log.find((s) => s.kind === "whale" && s.inView);
    if (up) cam = { rx, ry };
  }
  assert.ok(cam && up, "a whale breaching");
  const box = { x0: up.px - 30, y0: up.py - 20, x1: up.px + 30, y1: up.py + 20 };
  const rare = rareLayer(ctx);
  for (const t of times(end - 4, end + 2)) {
    const f = deepSea(cam.rx, cam.ry, t);
    const bare = new Uint32Array(f.out);
    rare.draw(f);
    assert.equal(ink(f.out, bare, box), 0, `nothing of the whale ${t - end} s from its time`);
  }
});

test("only the viewer who watched a sight go keeps it: not one arriving after, nor after a jump in time", () => {
  const k = kindOf("balloon");
  const end = rareEnd(k);
  const cam = watching("balloon", moor, end - DT);
  assert.ok(cam);
  const late = rareLayer(ctx);
  assert.equal(watch(late, moor, cam, "balloon", [end + 0.5])[0].seen.length, 0, "not for one arriving after its time");
  const jumpy = rareLayer(ctx);
  const seen = watch(jumpy, moor, cam, "balloon", [end - DT, end + LINGER_GAP + 0.5]);
  assert.equal(seen[0].seen.length, 1);
  assert.equal(seen[1].seen.length, 0, "not after a jump in time");
  const away = rareLayer(ctx);
  const back = [
    ...watch(away, moor, cam, "balloon", [end - 0.5]),
    ...watch(away, moor, { rx: cam.rx + 3000, ry: cam.ry }, "balloon", [end - DT, end]),
    ...watch(away, moor, cam, "balloon", [end + DT]),
  ];
  assert.equal(back[0].seen.length, 1);
  assert.equal(back[3].seen.length, 0, "not for one looking elsewhere as its time ran out");
});

test("forced, a lingering balloon keeps the next from showing until it has gone, and the next eases in", () => {
  const k = kindOf("balloon");
  const rare = rareLayer({ ...ctx, forceSights: true });
  // The first forced appearance shuts at lasts − lead; the next opens FORCED_GAP later.
  const end = RARE[k].lasts - RARE[k].lead;
  const frames = watch(rare, moor, { rx: 2000, ry: 1000 }, "balloon", times(end - 1, end + 150));
  for (const f of frames) assert.ok(f.seen.length <= 1, `${f.seen.length} balloons ${f.t - end} s after`);
  const after = frames.filter((f) => f.t >= end);
  assert.ok(after[0].seen.length === 1, "the first stays on past its time");
  // The first drifts east until it has left the frame (it is drawn, and so seen, while any of it is on the frame); the
  // next, waiting till then, comes in back near the middle, a frame or so after the first was last seen.
  let first = -1, jump = -1;
  for (let j = 0; j < after.length && jump < 0; j++) {
    if (after[j].seen.length === 0) continue;
    if (first >= 0 && after[j].seen[0].px < after[first].seen[0].px - 50) jump = j;
    else first = j;
  }
  assert.ok(jump > 0, "the next comes once the first has gone");
  for (const f of after.slice(0, first + 1)) assert.equal(f.seen.length, 1, `the first drifts on ${f.t - end} s after its time`);
  assert.ok(jump - first <= 2, `the next follows the first's going at once (${jump - first} frames)`);
  assert.ok(after[first].seen[0].px >= W - 12, `the first left by the edge, from ${after[first].seen[0].px}`);
  assert.ok(!after[jump].seen[0].inView, "the next comes in faintly");
});

// ── Occasional sights ────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether the sights layer draws the kite on `view` at time t, from nothing before (no lingering). */
async function kiteUp(t: number): Promise<boolean> {
  const sights = sightsLayer(ctx);
  sights.log = [];
  drawn(sights, await shot("town"), t);
  return sights.log.some((p) => p.kind === "kite");
}

/** When the town's kite comes down: the first time a quarter-second after one it flew at, to a quarter-second. */
let kiteDownAt: Promise<number> | null = null;
function kiteDown(): Promise<number> {
  kiteDownAt ??= (async () => {
    let was = false;
    for (let t = 0; t < 2 * KITE_EVERY; t += 1) {
      const up = await kiteUp(t);
      if (was && !up) {
        for (let s = t - 1 + DT; s <= t; s += DT) if (!(await kiteUp(s))) return s;
      }
      was = up;
    }
    throw new Error("the kite never comes down");
  })();
  return kiteDownAt;
}

test("a kite watched as its flight ends stays down with the child while the town is in view, and goes once out of it", async () => {
  const town = await shot("town");
  const abbey = await shot("abbey");
  const end = await kiteDown();
  const sights = sightsLayer(ctx);
  const kites = (s: typeof town, t: number): number => {
    sights.log = [];
    drawn(sights, s, t);
    return sights.log.filter((p) => p.kind === "kite").length;
  };
  for (const t of times(end - 2, end + 30)) assert.equal(kites(town, t), 1, `the kite ${t - end} s after its flight`);
  // Looked away and back: gone, until its next flight.
  assert.equal(kites(abbey, end + 30.25), 0);
  for (const t of times(end + 30.5, end + 40)) assert.equal(kites(town, t), 0, `gone ${t - end} s after its flight`);
});

test("a kite still down when its next flight begins goes up again without a flicker", async () => {
  const town = await shot("town");
  const end = await kiteDown();
  const sights = sightsLayer(ctx);
  const next = end + KITE_EVERY - KITE_UP;
  for (const t of times(end - 1, next + 10)) {
    sights.log = [];
    drawn(sights, town, t);
    assert.equal(sights.log.filter((p) => p.kind === "kite").length, 1, `the kite ${t - end} s after its flight`);
  }
});

test("a rainbow and its shower fade away within their time: nothing of them is cut", () => {
  const sights = sightsLayer(ctx);
  let bow: { x: number; y: number } | null = null, when = 0;
  for (let t = 0; t < 2 * RAINBOW_EVERY && !bow; t += 2) {
    const full = sights.rainbowsAt(t).find((r) => r.shown === 1);
    if (full) {
      bow = full;
      when = t;
    }
  }
  assert.ok(bow, "a rainbow");
  const standing = (t: number): { shown: number } | undefined => sights.rainbowsAt(t).find((r) => r.x === bow?.x && r.y === bow?.y);
  let end = when;
  while (standing(end)) end += DT;
  for (const t of times(end - 1, end - DT)) assert.ok((standing(t)?.shown ?? 0) < 0.02, `the bow ${t - end} s before its time: ${standing(t)?.shown}`);
  // On the frame: in its last moment nothing of the bow or the rain is left to cut.
  const at = (t: number): number => {
    const f = seaFrame(Math.round(bow.x) - 200, Math.round(0.8 * (bow.y - 40)) - 112, t, palette, n, M.sea);
    const bare = new Uint32Array(f.out);
    sightsLayer(ctx).draw(f);
    return ink(f.out, bare, { x0: 80, y0: 0, x1: 320, y1: 140 });
  };
  assert.ok(at(end - 8) > 0, "the shower is there a little before");
  assert.ok(at(end - 0.05) < at(end - 8) / 50, `and all but gone at the last (${at(end - 0.05)} of ${at(end - 8)})`);
});

test("a fishing net is hauled in within its time: nothing of it is cut", () => {
  // A boat with its net out, found as the sights tests find one, watched through the net's end.
  for (let k = 0; k < 6; k++) {
    const x = 300 + k * 700, y = 500 + k * 450;
    const rx = Math.round(x) - 200, ry = Math.round(0.8 * y) - 112;
    const netOut = (t: number): boolean => {
      const s = sightsLayer(ctx);
      s.log = [];
      s.draw(seaFrame(rx, ry, t, palette, n, M.sea));
      return s.log.some((p) => p.kind === "net");
    };
    let end = -1;
    for (let t = 0; t < NET_EVERY && end < 0; t += DT) if (netOut(t) && !netOut(t + DT)) end = t + DT;
    if (end < 0) continue;
    const corks = (t: number): number => {
      const f = seaFrame(rx, ry, t, palette, n, M.sea);
      const bare = new Uint32Array(f.out);
      sightsLayer(ctx).draw(f);
      return ink(f.out, bare);
    };
    assert.equal(corks(end - DT), corks(end), "every float is in before its time");
    return;
  }
  assert.fail("no net to watch");
});

// ── The wonders' moments ─────────────────────────────────────────────────────────────────────────────────────────────

const X = 3200;
const Y = 2100;

function seaAt(x: number, y: number, t: number, material: number = M.sea): LiveFrame {
  return seaFrame(Math.round(x) - 200, Math.round(0.8 * y) - 112, t, palette, n, material);
}

function wonder(type: string, level: number, height: number, anchors: Record<string, [number, number]>): ManifestWonder {
  return { id: `${type}-0`, type, x: X, y: Y, level, height, anchors };
}

/** When `kind`'s first appearance ends, unforced. */
function momentEnd(kind: string): number {
  for (let t = 0; t < 4000; t += 1) {
    const at = momentWindow(seed, kind, t);
    if (at >= 0) return t - at + momentSpan(seed, kind).lasts;
  }
  throw new Error("no appearance");
}

interface Case {
  kind: string;
  w: ManifestWonder;
  /** What the layer notes of the moment while it shows. */
  notes: string[];
}

/** Moments that stay where their time leaves them while they are watched. */
const PARKED: Case[] = [
  { kind: "ferry", w: wonder("baths", 24, 22, { quay: [X, Y + 35], funicularTop: [X + 20, Y + 6], funicularFoot: [X + 20, Y + 30] }), notes: ["ferry"] },
  { kind: "train", w: wonder("railway", 0, 13, { shore: [X - 90, Y], halt: [X + 70, Y + 3] }), notes: ["train"] },
  { kind: "plane", w: wonder("cove-hotel", 0, 31, { pontoon: [X, Y + 16], cove: [X, Y - 30] }), notes: ["plane"] },
  { kind: "marsh", w: wonder("marsh-house", 3.6, 19, { lamp: [X - 2, Y + 2], gate: [X, Y + 8], firm: [X + 36, Y + 28] }), notes: ["lamp", "cart"] },
  { kind: "airship", w: wonder("airship-mast", 18, 46, { mast: [X, Y] }), notes: ["airship"] },
  { kind: "bridge", w: wonder("bridge-town", 1, 25, { west: [X - 22, Y], east: [X + 22, Y], upstream: [X, Y - 28], downstream: [X, Y + 28] }), notes: ["cart", "boat"] },
];

/** Moments with an end of their own, and how long after their time it takes at most. */
const ENDING: (Case & { within: number })[] = [
  { kind: "church", w: wonder("drowned-church", 4, 31, { tower: [X, Y] }), notes: ["flock"], within: 15 },
  { kind: "oak", w: wonder("great-oak", 12, 47, { crown: [X, Y], swing: [X + 11, Y], treehouse: [X - 11, Y], village: [X, Y + 40] }), notes: ["leaves"], within: 10 },
];

/** A layer for one wonder drawn on the sea round it through `when`: per frame, the time, its notes and its ink. */
function watchMoment(c: Case, when: number[], frame: (t: number) => LiveFrame = (t) => seaAt(X, Y, t)): { t: number; notes: string[]; ink: number }[] {
  const layer = momentsLayer({ seed, n, sites: [], wonders: [c.w] });
  return when.map((t) => {
    const f = frame(t);
    const bare = new Uint32Array(f.out);
    layer.log = [];
    layer.draw(f);
    return { t, notes: layer.log.map((p) => p.kind), ink: ink(f.out, bare) };
  });
}

test("a wonder's moment watched as its time runs out stays where its time left it while it is in view", () => {
  for (const c of PARKED) {
    const end = momentEnd(c.kind);
    const frames = watchMoment(c, times(end - 1, end + 30));
    for (const f of frames) for (const note of c.notes) assert.ok(f.notes.includes(note), `${c.kind}: the ${note} ${f.t - end} s after its time`);
    // Not fading: as strong after its time as at the end of it.
    const last = frames.filter((f) => f.t < end).pop();
    const later = frames[frames.length - 1];
    assert.ok(last && later.ink >= 0.8 * last.ink, `${c.kind}: ink ${later.ink} after, ${last?.ink} at its end`);
  }
});

test("a moment with an end of its own plays it out in view, unhurried, and is then gone", () => {
  for (const c of ENDING) {
    const end = momentEnd(c.kind);
    const frames = watchMoment(c, times(end - 1, end + c.within + 5));
    const atEnd = frames.filter((f) => f.t < end).pop();
    assert.ok(atEnd && atEnd.ink > 0, `${c.kind} shows as its time runs out`);
    const after = frames.filter((f) => f.t >= end);
    assert.ok(c.notes.every((note) => after[0].notes.includes(note)), `${c.kind} goes on past its time`);
    const gone = after.findIndex((f) => f.ink === 0);
    assert.ok(gone > 0 && after[gone].t <= end + c.within, `${c.kind} has ended ${after[gone]?.t - end} s after its time`);
    for (const f of after.slice(gone)) assert.equal(f.ink, 0, `${c.kind} does not come back`);
    let drop = 0;
    for (let j = 1; j <= gone; j++) drop = Math.max(drop, after[j - 1].ink - after[j].ink);
    assert.ok(drop <= 0.5 * atEnd.ink, `${c.kind}: no sudden end (a drop of ${drop} from ${atEnd.ink})`);
  }
});

test("the observatory's dome closes and comes to rest past its time, and stays so while it is watched", () => {
  const end = momentEnd("dome");
  const layer = momentsLayer({ seed, n, sites: [], wonders: [wonder("observatory", 40, 24, { dome: [X, Y] })] });
  const frames = times(end - 6, end + 30).map((t) => {
    const f = seaAt(X, Y, t);
    const bare = new Uint32Array(f.out);
    layer.log = [];
    layer.draw(f);
    return { t, dome: layer.log.find((p) => p.kind === "dome"), ink: ink(f.out, bare) };
  });
  for (const f of frames) assert.ok(f.dome, `the dome ${f.t - end} s after its time`);
  // Turning, its slit open, as its time runs out; shut and still a few seconds after, and so it stays.
  const before = frames.filter((f) => f.t < end);
  assert.ok(before.some((f) => f.dome?.px !== before[0].dome?.px), "turning as its time runs out");
  const rest = frames.filter((f) => f.t >= end + 6);
  assert.ok(rest.every((f) => f.dome?.px === rest[0].dome?.px && f.ink === rest[0].ink), "at rest");
  assert.ok(rest[0].ink < before[before.length - 1].ink, "its slit shut");
  let drop = 0;
  for (let j = 1; j < frames.length; j++) drop = Math.max(drop, frames[j - 1].ink - frames[j].ink);
  assert.ok(drop <= 0.5 * before[before.length - 1].ink, `closing without a jump (a drop of ${drop})`);
});

test("the town clock's figures file back in past the hour's time", () => {
  const paint = (f: LiveFrame): LiveFrame => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (112 + dy) * W + (200 + dx);
      f.bake[i] = (f.bake[i] & ~255) | M.dial;
    }
    return f;
  };
  const layer = momentsLayer({ seed, n, sites: [{ id: "town-0", type: "town", x: X, y: Y }] });
  const end = CLOCK_LASTS;
  const frames = times(end - 2, end + 25).map((t) => {
    const f = paint(seaAt(X, Y, t));
    const bare = new Uint32Array(f.out);
    layer.log = [];
    layer.draw(f);
    return { t, figures: layer.log.some((p) => p.kind === "figures"), ink: ink(f.out, bare) };
  });
  const after = frames.filter((f) => f.t >= end);
  assert.ok(after[0].figures, "still out as the hour's time runs out");
  const gone = after.findIndex((f) => !f.figures);
  assert.ok(gone > 0 && after[gone].t < end + 20, `all in ${after[gone]?.t - end} s after`);
  for (const f of after.slice(gone)) assert.equal(f.ink, 0);
  const atEnd = frames.filter((f) => f.t < end).pop();
  assert.ok(atEnd);
  for (let j = 1; j <= gone; j++) assert.ok(after[j - 1].ink - after[j].ink <= 0.5 * atEnd.ink, "one at a time");
});

test("the floating garden and the land-ship stay while they are watched past their time", () => {
  const end = momentEnd("garden");
  const at = gardenWhere(seed, n, land, end);
  assert.ok(at);
  const garden = momentsLayer({ seed, n, sites: [], land });
  for (const t of times(end - 1, end + 20)) {
    garden.log = [];
    garden.draw(seaAt(at.x, at.y, t));
    assert.ok(garden.log.some((p) => p.kind === "garden"), `the garden ${t - end} s after its time`);
  }
  // The land-ship on a beach of its own, as moments.test.ts builds one.
  const gN = 128, worldN = 512;
  const ground = new Float32Array(gN * gN).fill(9);
  for (let y = 30; y < gN; y++) for (let x = 0; x < gN; x++) ground[y * gN + x] = -4;
  for (let y = 22; y <= 29; y++) for (let x = 16; x < 40; x++) ground[y * gN + x] = 0.45;
  const run = widestSands({ gN, ground }, worldN);
  const mid = (run.length >> 2) << 1;
  const ship = momentsLayer({ seed, n: worldN, sites: [], land: { gN, ground } });
  const shipEnd = momentEnd("land-ship");
  for (const t of times(shipEnd - 1, shipEnd + 20)) {
    ship.log = [];
    ship.draw(seaFrame(Math.round(run[mid]) - 200, Math.round(0.8 * run[mid + 1]) - 112, t, palette, worldN, M.sand));
    assert.ok(ship.log.some((p) => p.kind === "land-ship"), `the land-ship ${t - shipEnd} s after its time`);
  }
});

test("a lingering moment is gone once it has been out of view, until its next appearance", () => {
  const c = PARKED.find((p) => p.kind === "airship");
  assert.ok(c);
  const end = momentEnd(c.kind);
  const span = momentSpan(seed, c.kind);
  let next = end + 1;
  while (momentWindow(seed, c.kind, next) < 0) next += 1;
  const when = [...times(end - 1, end + 5), end + 5.25, ...times(end + 5.5, end + 10), next + 3];
  const frames = watchMoment(c, when, (t) => (t === end + 5.25 ? seaAt(X + 3000, Y, t) : seaAt(X, Y, t)));
  for (const f of frames) {
    const want = f.t <= end + 5 || f.t === next + 3;
    if (f.t === end + 5.25) continue;
    assert.equal(f.notes.includes("airship"), want, `the airship ${f.t - end} s after its time (next in ${next - end} s, lasts ${span.lasts})`);
  }
});

test("a moored plane waits out its next arrival while it is watched: never two at once, never moved", () => {
  const c = PARKED.find((p) => p.kind === "plane");
  assert.ok(c);
  const end = momentEnd(c.kind);
  let next = end + 1;
  while (momentWindow(seed, c.kind, next) < 0) next += 1;
  const layer = momentsLayer({ seed, n, sites: [], wonders: [c.w] });
  let moored: { px: number; py: number } | null = null;
  for (const t of times(end - DT, next + momentSpan(seed, c.kind).lasts + 2)) {
    layer.log = [];
    layer.draw(seaAt(X, Y, t));
    const planes = layer.log.filter((p) => p.kind === "plane");
    assert.equal(planes.length, 1, `one plane ${t - end} s after its time`);
    if (t < end) continue;
    moored ??= planes[0];
    // It rides at its mooring, bobbing a pixel or so.
    assert.ok(Math.abs(planes[0].px - moored.px) <= 1 && Math.abs(planes[0].py - moored.py) <= 1, `still at its mooring ${t - end} s after its time`);
  }
});

test("an airship at its mast hands over to its next appearance without a flicker", () => {
  const c = PARKED.find((p) => p.kind === "airship");
  assert.ok(c);
  const end = momentEnd(c.kind);
  let next = end + 1;
  while (momentWindow(seed, c.kind, next) < 0) next += 1;
  const frames = watchMoment(c, times(end - 1, next + 6));
  const strength = frames[0].ink;
  for (const f of frames) {
    assert.ok(f.notes.includes("airship"), `the airship ${f.t - end} s after its time`);
    assert.ok(f.ink >= 0.6 * strength, `in full ${f.t - end} s after its time (${f.ink} of ${strength})`);
  }
});
