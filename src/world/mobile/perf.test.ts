import assert from "node:assert/strict";
import { test } from "node:test";
import { createPacer, phoneWorkers, UP_AFTER } from "./perf.ts";

test("phones bake with two workers, or one on a phone Chrome reports as 2 GB or less", () => {
  assert.equal(phoneWorkers(undefined), 2);
  assert.equal(phoneWorkers(8), 2);
  assert.equal(phoneWorkers(4), 2);
  assert.equal(phoneWorkers(2), 1);
  assert.equal(phoneWorkers(1), 1);
});

/** Runs a pacer over `seconds` of callbacks every `hz`, each drawn frame working `work(t)` ms; returns frames drawn a second. */
function run(p: ReturnType<typeof createPacer>, start: number, seconds: number, hz: number, work: (t: number) => number): { end: number; drawn: number } {
  let drawn = 0;
  let t = start;
  const step = 1000 / hz;
  while (t < start + seconds * 1000) {
    if (p.want(t)) {
      drawn += 1;
      p.worked(work(t));
    }
    t += step;
  }
  return { end: t, drawn: drawn / seconds };
}

test("at the 60 cap frames are evenly paced: every other callback at 120 Hz, every callback at 60, every other at 90", () => {
  for (const [hz, want] of [[120, 60], [60, 60], [90, 45]]) {
    const p = createPacer();
    const r = run(p, 1000, 4, hz, () => 3);
    assert.equal(p.rate(), 60);
    assert.ok(Math.abs(r.drawn - want) <= 1.5, `${hz} Hz drew ${r.drawn}`);
  }
});

test("long frames step it down to 30, and ten easy seconds step it back up", () => {
  const p = createPacer();
  let r = run(p, 1000, 4, 60, () => 15);
  assert.equal(p.rate(), 30);
  r = run(p, r.end, 3, 60, () => 15);
  assert.ok(Math.abs(r.drawn - 30) <= 1, `drew ${r.drawn}`);
  assert.equal(p.rate(), 30);
  r = run(p, r.end, UP_AFTER - 3, 60, () => 3);
  assert.equal(p.rate(), 30, "not back up before ten easy seconds");
  r = run(p, r.end, 8, 60, () => 3);
  assert.equal(p.rate(), 60);
});

test("a browser that only calls back 30 times a second (Low Power Mode) sets the cap to 30 and stays there", () => {
  const p = createPacer();
  const r = run(p, 1000, 4, 30, () => 3);
  assert.equal(p.rate(), 30);
  run(p, r.end, 20, 30, () => 3);
  assert.equal(p.rate(), 30);
});

test("short spikes under the 90th percentile do not step it down", () => {
  const p = createPacer();
  let n = 0;
  run(p, 1000, 6, 60, () => (++n % 20 === 0 ? 25 : 4));
  assert.equal(p.rate(), 60);
});
