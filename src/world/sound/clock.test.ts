import assert from "node:assert/strict";
import { test } from "node:test";
import { mix32 } from "../core/hash.ts";
import { easeFor, easeOffset, lateness, LEAD, lookaheadFor, SAMPLE_EVERY, sampleOffset, stampUsable, whenFor } from "./clock.ts";

const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("a fresh output timestamp is used; a zero or stale one is refused", () => {
  const base = { currentTime: 12.5, outputLatency: 0.03, now: 20000 };
  const fresh = { ...base, stamp: { contextTime: 12.46, performanceTime: 19995 } };
  assert.ok(stampUsable(fresh));
  near(sampleOffset(fresh), 12.46 - 19.995, 1e-12);
  const fallback = 12.5 - 0.03 - 20;
  for (const stamp of [null, undefined, {}, { contextTime: 0, performanceTime: 0 }, { contextTime: 12.4, performanceTime: 19000 }, { contextTime: NaN, performanceTime: 19995 }]) {
    const r = { ...base, stamp };
    assert.ok(!stampUsable(r));
    near(sampleOffset(r), fallback, 1e-12);
  }
  // No latency reported: currentTime alone.
  near(sampleOffset({ currentTime: 3, now: 1000 }), 2, 1e-12);
});

test("the eased offset ignores ±40 ms of jitter and snaps on a 0.3 s jump", () => {
  let o = NaN;
  o = easeOffset(o, -7.5);
  assert.equal(o, -7.5);
  for (let i = 0; i < 600; i++) {
    const jitter = ((mix32(i) / 4294967296) * 2 - 1) * 0.04;
    o = easeOffset(o, -7.5 + jitter);
    assert.ok(Math.abs(o + 7.5) < 0.006, `stays put (${o})`);
  }
  o = easeOffset(o, -7.2);
  assert.equal(o, -7.2);
  // A steady drift is followed.
  for (let i = 0; i < 400; i++) o = easeOffset(o, -7.15);
  near(o, -7.15, 1e-3);
});

test("when never leaves its clamp", () => {
  const now = 100, look = 0.3;
  for (const t of [-1e6, 0, 99, 100, 100.1, 100.39, 101, 1e6]) {
    const w = whenFor(t, 0, now, look);
    assert.ok(w >= now + 0.005 - 1e-12 && w <= now + look + 0.1 + 1e-12, `${t} → ${w}`);
  }
  near(whenFor(100.1, 0, now, look), 100.1 + LEAD, 1e-12);
  near(whenFor(50.1, 50, now, look), 100.1 + LEAD, 1e-12);
  assert.equal(lateness(100.1, 0, now), 0);
  near(lateness(99.9, 0, now), 0.1 + 0.005 - LEAD, 1e-12);
});

test("the lookahead grows with the output's latency and stops at 0.5 s", () => {
  near(lookaheadFor({ currentTime: 5, now: 0 }), 0.25, 1e-12);
  near(lookaheadFor({ currentTime: 5, outputLatency: 0.18, now: 0 }), 0.43, 1e-12);
  near(lookaheadFor({ currentTime: 5, outputLatency: 2, now: 0 }), 0.5, 1e-12);
  near(lookaheadFor({ currentTime: 5, now: 1000, stamp: { contextTime: 4.9, performanceTime: 990 } }), 0.35, 1e-12);
  near(lookaheadFor({ currentTime: 5, now: 1000, stamp: { contextTime: 5.2, performanceTime: 990 } }), 0.25, 1e-12);
});

test("sampling ten times a second eases as the frames it stands for would have", () => {
  near(easeFor(1 / 60), 0.02, 1e-12);
  near(easeFor(0), 0.02, 1e-12);
  // Six frames' worth in one pull.
  let o = 0;
  for (let i = 0; i < 6; i++) o = easeOffset(o, 0.1);
  near(easeOffset(0, 0.1, easeFor(0.1)), o, 1e-12);
  assert.ok(SAMPLE_EVERY >= 0.05 && SAMPLE_EVERY <= 0.2);
});
