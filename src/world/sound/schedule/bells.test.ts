import assert from "node:assert/strict";
import test from "node:test";
import { createScheduler, type Due } from "../engine/scheduler.ts";
import type { Cue } from "../types.ts";
import { bellCues, bellDuck, HAMMER, HOUR_AT, HOUR_GAP, HOUR_S, hourNumber, JITTER, LONGEST_RING, PEAL_AT, PEAL_PERIODS, pealPeriod, pealStrokes } from "./bells.ts";

const SEED = 3;
const all = (t0: number, t1: number): Cue[] => {
  const out: Cue[] = [];
  bellCues(SEED, t0, t1, out);
  return out;
};

test("the page opens at twelve, and the hours follow", () => {
  assert.equal(hourNumber(0), 12);
  assert.equal(hourNumber(1), 1);
  assert.equal(hourNumber(12), 12);
  assert.equal(hourNumber(17), 5);
});

test("the stroke count is the hour number, for a whole day", () => {
  for (let H = 0; H < 24; H++) {
    const strokes = all(H * HOUR_S, (H + 1) * HOUR_S).filter((c) => c.bell === HAMMER);
    assert.equal(strokes.length, hourNumber(H), `hour ${H}`);
    strokes.forEach((c, j) => {
      assert.ok(Math.abs(c.t - (H * HOUR_S + HOUR_AT + HOUR_GAP * j)) < 1e-9);
      assert.equal(c.strikeDb, 5);
    });
  }
});

test("the peal fits its window, each bell enters in turn and keeps its own pace within the jitter", () => {
  for (let H = 0; H < 6; H++) {
    const top = H * HOUR_S;
    const peal = all(top, top + HOUR_S).filter((c) => c.bell !== HAMMER);
    for (const c of peal) assert.ok(c.t >= top + PEAL_AT && c.t <= top + 36, `stroke at ${c.t - top}`);
    for (let i = 0; i < 5; i++) {
      const mine = peal.filter((c) => c.bell === i);
      assert.equal(mine.length, pealStrokes(SEED, i));
      const p = pealPeriod(SEED, i);
      assert.ok(Math.abs(p / PEAL_PERIODS[i] - 1) <= 0.03);
      const enter = top + PEAL_AT + 1.5 * i;
      mine.forEach((c, k) => {
        assert.equal(c.k, k);
        assert.ok(Math.abs(c.t - (enter + JITTER + k * p)) <= JITTER + 1e-9, `bell ${i} stroke ${k}`);
        assert.equal(c.take, k & 1);
      });
      // In turn: no bell's first stroke comes before the one above it.
      if (i > 0) assert.ok(mine[0].t > peal.filter((c) => c.bell === i - 1)[0].t);
      assert.deepEqual([mine[0].ringDb, mine[1].ringDb, mine[2].ringDb], [-6, -3, 0]);
      assert.deepEqual([mine[mine.length - 2].ringDb, mine[mine.length - 1].ringDb], [-3, -6]);
    }
  }
});

test("windows tile: any cut of a stretch gives the same strokes, each once, in time order", () => {
  const whole = all(0, 2 * HOUR_S);
  const parts: Cue[] = [];
  for (let t = 0; t < 2 * HOUR_S; t += 0.37) bellCues(SEED, t, Math.min(2 * HOUR_S, t + 0.37), parts);
  assert.deepEqual(parts.map((c) => c.key), whole.map((c) => c.key));
  assert.equal(new Set(whole.map((c) => c.key)).size, whole.length);
  for (let i = 1; i < whole.length; i++) assert.ok(whole[i].t >= whole[i - 1].t);
});

test("looking back ten seconds mid-peal finds every stroke whose ring is still sounding", () => {
  const t = HOUR_S + 25;
  const back = all(t - LONGEST_RING, t);
  const sounding = all(HOUR_S, t).filter((c) => c.t + (c.lasts ?? 0) > t);
  assert.ok(sounding.length > 20);
  for (const c of sounding) assert.ok(back.some((b) => b.key === c.key), c.key);
});

test("the duck holds from just before the peal to 2.5 s after the hour's last stroke", () => {
  assert.equal(bellDuck(PEAL_AT - 0.2), 0);
  assert.equal(bellDuck(PEAL_AT - 0.1), 1);
  assert.equal(bellDuck(38), 1);
  // Hour 0 strikes twelve: the last at 40 + 2.4 · 11.
  assert.equal(bellDuck(HOUR_AT + HOUR_GAP * 11 + 2.4), 1);
  assert.equal(bellDuck(HOUR_AT + HOUR_GAP * 11 + 2.6), 0);
  // Hour 1 strikes one.
  assert.equal(bellDuck(HOUR_S + HOUR_AT + 2.4), 1);
  assert.equal(bellDuck(HOUR_S + HOUR_AT + 2.6), 0);
});

test("the ledger: after a stall no stroke is started twice; after a clear every ringing stroke is started once", () => {
  const sched = createScheduler([{ kind: "bell", cues: (a, b, out) => bellCues(SEED, a, b, out), lookBack: LONGEST_RING }]);
  const started = new Map<string, number>();
  const run = (t: number, dt: number): Due[] => {
    const due: Due[] = [];
    sched.pass(t, dt, 0.25, due);
    for (const d of due) started.set(d.cue.key, (started.get(d.cue.key) ?? 0) + 1);
    return due;
  };
  // Unlock mid-peal: the rings in progress are joined.
  let t = 20;
  const first = run(t, 0);
  assert.ok(first.filter((d) => d.rejoin).length > 10);
  for (; t < 24; t += 1 / 60) run(t, 1 / 60);
  // A stall of 0.6 s: the strokes that fell inside it are joined in progress, none already started is started again.
  t += 0.6;
  const after = run(t, 0.6);
  assert.ok(after.some((d) => d.rejoin));
  for (; t < 30; t += 1 / 60) run(t, 1 / 60);
  for (const [key, n] of started) assert.equal(n, 1, key);
  const expected = all(20 - LONGEST_RING, 30.25).filter((c) => c.t + (c.lasts ?? 0) > 20 + 0.08 || c.t >= 20);
  for (const c of expected) assert.ok(started.has(c.key), c.key);
  // A hide: everything was stopped, the ledger is cleared, and each ring still sounding comes back once.
  sched.clear();
  started.clear();
  t += 4;
  const back = run(t, 0);
  const sounding = all(t - LONGEST_RING, t).filter((c) => c.t + (c.lasts ?? 0) > t + 0.08);
  assert.deepEqual(back.filter((d) => d.rejoin).map((d) => d.cue.key).sort(), sounding.map((c) => c.key).sort());
  for (const n of started.values()) assert.equal(n, 1);
});
