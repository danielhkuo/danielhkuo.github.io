import assert from "node:assert/strict";
import { test } from "node:test";
import { mix32 } from "../../core/hash.ts";
import { pipCues, tailCues, TAIL_AT, TAIL_EVERY } from "../schedule/probe.ts";
import { TAIL_S } from "../synth/probe.ts";
import type { Cue } from "../types.ts";
import { createLedger, createScheduler, type CueSource, type Due } from "./scheduler.ts";

const SOURCES: CueSource[] = [
  { kind: "pip", cues: (a, b, out) => pipCues(3, a, b, out), lookBack: 0 },
  { kind: "tail", cues: tailCues, lookBack: TAIL_S },
];

const all = (kind: string, t0: number, t1: number): Cue[] => {
  const out: Cue[] = [];
  SOURCES.find((s) => s.kind === kind)!.cues(t0, t1, out);
  return out;
};

test("schedules: windows tile, in order, and no cue comes twice", () => {
  for (const kind of ["pip", "tail"]) {
    const whole = all(kind, 100, 160);
    assert.ok(whole.length > 10);
    for (let i = 1; i < whole.length; i++) assert.ok(whole[i].t > whole[i - 1].t);
    const pieces: Cue[] = [];
    let t = 100, i = 0;
    while (t < 160) {
      const step = Math.min(160 - t, 0.01 + (mix32(i++) / 4294967296) * 0.7);
      pieces.push(...all(kind, t, t + step));
      t += step;
    }
    assert.deepEqual(pieces, whole);
    for (const c of whole) assert.ok(c.t >= 100 && c.t < 160);
  }
});

test("a ledger forgets a key only after its time", () => {
  const l = createLedger();
  l.add("a", 5);
  l.add("b", 9);
  l.prune(6);
  assert.ok(!l.has("a") && l.has("b"));
  assert.equal(l.size, 1);
  l.clear();
  assert.equal(l.size, 0);
});

test("steady frames: every cue is started exactly once, before it must start", () => {
  const s = createScheduler(SOURCES);
  const started: Due[] = [];
  let t = 50;
  for (let i = 0; i < 1200; i++) {
    const dt = 1 / 60 + (i % 37 === 0 ? 0.1 : 0);
    t += dt;
    const before = started.length;
    s.pass(t, dt, 0.25, started);
    for (const d of started.slice(before)) if (!d.rejoin) assert.ok(d.cue.t >= t - 1e-9, "found before its start");
  }
  const keys = started.map((d) => `${d.cue.kind}:${d.cue.key}`);
  assert.equal(new Set(keys).size, keys.length, "no key twice");
  const first = 50 + 1 / 60 + 0.1;
  const want = [...all("pip", first, t + 0.25), ...all("tail", first, t + 0.25)].map((c) => `${c.kind}:${c.key}`);
  for (const k of want) assert.ok(keys.includes(k), `${k} was started`);
});

test("the first pass joins a tail that is already sounding, once, and never a pip from the past", () => {
  const s = createScheduler(SOURCES);
  const due: Due[] = [];
  // Half a second into a tail.
  const t = 10 * TAIL_EVERY + TAIL_AT + 0.5;
  s.pass(t, 0, 0.25, due);
  const joined = due.filter((d) => d.rejoin);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].cue.kind, "tail");
  assert.ok(Math.abs(t - joined[0].cue.t - 0.5) < 1e-9);
  assert.ok(due.every((d) => d.rejoin || d.cue.t >= t));
  const again: Due[] = [];
  s.pass(t + 1 / 60, 1 / 60, 0.25, again);
  assert.ok(again.every((d) => !d.rejoin));
});

test("after a stall no key is started twice: tails that kept sounding are left alone, the ones missed are joined", () => {
  const s = createScheduler(SOURCES);
  const started: Due[] = [];
  let t = 10 * TAIL_EVERY + TAIL_AT - 0.1;
  for (let i = 0; i < 30; i++) {
    t += 1 / 60;
    s.pass(t, 1 / 60, 0.25, started);
  }
  // A 0.6 s stall while tail 10 is sounding.
  t += 0.6;
  const after: Due[] = [];
  s.pass(t, 0.6, 0.25, after);
  assert.ok(!after.some((d) => d.cue.kind === "tail"), "the sounding tail is not doubled");
  assert.ok(after.every((d) => d.cue.t >= t), "pips that fell in the stall are dropped");
  // A stall that swallows a tail's start: it is joined in progress.
  const s2 = createScheduler(SOURCES);
  const d2: Due[] = [];
  let u = 20 * TAIL_EVERY + TAIL_AT - 0.5;
  s2.pass(u, 0, 0.1, d2);
  u += 0.9;
  const late: Due[] = [];
  s2.pass(u, 0.9, 0.1, late);
  assert.equal(late.filter((d) => d.rejoin && d.cue.kind === "tail").length, 1);
});

test("after a clear every sound that should still be going is started once more", () => {
  const s = createScheduler(SOURCES);
  const started: Due[] = [];
  let t = 30 * TAIL_EVERY + TAIL_AT - 0.2;
  for (let i = 0; i < 60; i++) {
    t += 1 / 60;
    s.pass(t, 1 / 60, 0.25, started);
  }
  assert.equal(started.filter((d) => d.cue.kind === "tail").length, 1);
  s.clear();
  const back: Due[] = [];
  s.pass(t + 1 / 60, 1 / 60, 0.25, back);
  assert.equal(back.filter((d) => d.rejoin && d.cue.kind === "tail").length, 1);
  const more: Due[] = [];
  s.pass(t + 2 / 60, 1 / 60, 0.25, more);
  assert.ok(!more.some((d) => d.cue.kind === "tail"));
});

test("a source that joins late (its buffers arrived) joins what is sounding, once, without a gap for the others", () => {
  const long: CueSource = { kind: "long", lookBack: 10, cues: (a, b, out) => {
    for (let k = Math.ceil(a / 3); k * 3 < b; k++) out.push({ t: k * 3, kind: "long", key: `${k}`, lasts: 10 });
  } };
  const sources: CueSource[] = [];
  const s = createScheduler(sources);
  const due: Due[] = [];
  for (let t = 0; t < 20; t += 1 / 60) s.pass(t, 1 / 60, 0.25, due);
  assert.equal(due.length, 0);
  sources.push(long);
  s.pass(20, 1 / 60, 0.25, due);
  // Sounding at 20: the strokes of 12, 15 and 18 (9 ended at 19).
  assert.deepEqual(due.map((d) => [d.cue.key, d.rejoin]), [["4", true], ["5", true], ["6", true]]);
  for (let t = 20 + 1 / 60; t < 30; t += 1 / 60) s.pass(t, 1 / 60, 0.25, due);
  assert.deepEqual(due.map((d) => d.cue.key), ["4", "5", "6", "7", "8", "9", "10"]);
  assert.ok(due.slice(3).every((d) => !d.rejoin));
});
