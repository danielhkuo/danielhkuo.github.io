import assert from "node:assert/strict";
import { test } from "node:test";
import { ALOFT } from "../../live/life.ts";
import type { Cue } from "../types.ts";
import { callLength, callNotes, FLAP_FRAMES, gullCues, KEKS, LONG, MEW, nightKeeps, P_LIGHT, P_TOWN, SLOT_S, startleNotes, YELP, type Colony } from "./gulls.ts";

const SEED = 3;
const TOWN: Colony = { id: 1, birds: 9, town: true }, LIGHT: Colony = { id: 2, birds: 5, town: false };
const all = (c: Colony, t0: number, t1: number): Cue[] => {
  const out: Cue[] = [];
  gullCues(SEED, [c], t0, t1, out);
  return out;
};

test("call rates over 10,000 slots: near 0.25 a slot by a town, 0.12 at a lighthouse; about a third are answered", () => {
  for (const [c, p] of [[TOWN, P_TOWN], [LIGHT, P_LIGHT]] as const) {
    const cues = all(c, 0, 10000 * SLOT_S);
    const firsts = cues.filter((x) => x.key.endsWith(":0")), answers = cues.filter((x) => x.key.endsWith(":1"));
    assert.ok(Math.abs(firsts.length / 10000 - p) < 0.02, `${firsts.length / 10000} a slot`);
    assert.ok(Math.abs(answers.length / firsts.length - 0.35) < 0.06);
    const share = (k: number) => firsts.filter((x) => x.call === k).length / firsts.length;
    assert.ok(Math.abs(share(YELP) - 0.55) < 0.04 && Math.abs(share(KEKS) - 0.2) < 0.04 && Math.abs(share(MEW) - 0.15) < 0.04 && Math.abs(share(LONG) - 0.1) < 0.04);
    // An answer is another bird's, 0.6–2 s after the call it answers.
    for (const a of answers.slice(0, 200)) {
      const first = firsts.find((f) => f.key === a.key.replace(/:1$/, ":0"));
      if (!first) continue;
      assert.notEqual(a.bird, first.bird);
      assert.ok(a.t - first.t >= 0.6 && a.t - first.t <= 2);
    }
  }
});

test("no bird calls over itself; windows tile; the same seed gives the same morning", () => {
  const cues = all(TOWN, 0, 4000 * SLOT_S);
  const until = new Map<number, number>();
  for (const c of cues) {
    assert.ok((until.get(c.bird ?? 0) ?? -1) <= c.t, `bird ${c.bird} at ${c.t}`);
    until.set(c.bird ?? 0, c.t + (c.lasts ?? 0));
  }
  const parts: Cue[] = [];
  for (let t = 0; t < 400; t += 0.7) gullCues(SEED, [TOWN], t, Math.min(400, t + 0.7), parts);
  assert.deepEqual(parts.map((c) => c.key), all(TOWN, 0, 400).map((c) => c.key));
  assert.deepEqual(all(TOWN, 0, 400), all(TOWN, 0, 400));
  assert.equal(new Set(cues.map((c) => c.key)).size, cues.length);
});

test("a long call: one to three squeals, then seven to eleven kyows about 0.29 s apart, slowing a little, each lower and quieter", () => {
  const counts = new Set<number>();
  for (let key = 0; key < 200; key++) {
    const notes = callNotes(SEED, key % 6, key, LONG).map((n) => ({ ...n }));
    const squeals = notes.filter((n) => n.note[0] === "s"), kyows = notes.filter((n) => n.note[0] === "k");
    assert.ok(squeals.length >= 1 && squeals.length <= 3 && kyows.length >= 7 && kyows.length <= 11);
    assert.ok(notes.length >= 8 && notes.length <= 14, "eight to fourteen notes, as herring gulls' long calls are");
    counts.add(kyows.length);
    for (let i = 1; i < kyows.length; i++) {
      const gap = kyows[i].dt - kyows[i - 1].dt;
      assert.ok(gap >= 0.26 - 1e-9 && gap <= 0.352 + 1e-9, "about 3.4 a second");
      if (i > 1) assert.ok(gap >= kyows[i - 1].dt - kyows[i - 2].dt - 1e-9, "slowing");
      assert.ok(kyows[i].rate < kyows[i - 1].rate && kyows[i].rate > kyows[i - 1].rate * 0.979);
      assert.ok(Math.abs(kyows[i].db - kyows[i - 1].db + 0.7) < 1e-9);
    }
    assert.ok(squeals.every((s) => s.db > kyows[0].db), "the squeals are the loudest");
    assert.ok(callLength(SEED, key % 6, key, LONG) < 9);
    assert.ok(kyows[kyows.length - 1].dt - kyows[kyows.length - 2].dt <= 1.1001 * (kyows[1].dt - kyows[0].dt), "slowing by a tenth at most");
  }
  assert.ok(counts.size >= 4);
  const keks = callNotes(SEED, 0, 5, KEKS);
  assert.ok(keks.length >= 3 && keks.length <= 6 && Math.abs(keks[1].dt - 0.16) < 1e-9);
});

test("a startled gull: one to three runs of keks in its first second, and a wingbeat on each drawn downstroke, fading", () => {
  for (const g of [0x1234567, 0x0badcafe, 3, 0x7fffffff]) {
    const t0 = 123.456;
    const notes = startleNotes(SEED, g, t0, ALOFT).map((n) => ({ ...n }));
    const keks = notes.filter((n) => !n.flap), flaps = notes.filter((n) => n.flap);
    assert.ok(keks.length >= 3 && keks.length <= 18);
    assert.ok(keks.every((k) => k.t >= t0 && k.t < t0 + 1.9), "the runs start in the first second");
    // The picture draws wing frame floor(t·7 + (g & 3)) & 3, and frame 2 is the wings down: a flap is where it turns to 2.
    for (const f of flaps) {
      assert.equal(Math.floor((f.t + 1e-6) * FLAP_FRAMES + (g & 3)) & 3, 2);
      assert.equal(Math.floor((f.t - 1e-6) * FLAP_FRAMES + (g & 3)) & 3, 1);
      assert.ok(f.t >= t0 && f.t < t0 + ALOFT);
    }
    // 1.75 beats a second for 4.4 s.
    assert.ok(flaps.length >= 7 && flaps.length <= 8);
    assert.ok(flaps[flaps.length - 1].db < flaps[0].db - 8);
  }
});

test("at night the colonies keep a seeded share of their calls: none, all, about the share, and a smaller share keeps a subset", () => {
  let kept15 = 0, kept50 = 0, subset = true;
  for (let k = 0; k < 10000; k++) {
    assert.equal(nightKeeps(SEED, 1, k, 1), true);
    assert.equal(nightKeeps(SEED, 1, k, 0), false);
    const a = nightKeeps(SEED, 1, k, 0.15), b = nightKeeps(SEED, 1, k, 0.5);
    if (a) kept15++;
    if (b) kept50++;
    if (a && !b) subset = false;
  }
  assert.ok(Math.abs(kept15 / 10000 - 0.15) < 0.015, `share kept at 0.15: ${kept15 / 10000}`);
  assert.ok(Math.abs(kept50 / 10000 - 0.5) < 0.02, `share kept at 0.5: ${kept50 / 10000}`);
  assert.ok(subset, "every call kept at a 15 % share is also kept at 50 %");
  // The same call, the same answer: the seed and the call decide, nothing else.
  assert.equal(nightKeeps(SEED, 2, 77, 0.3), nightKeeps(SEED, 2, 77, 0.3));
});

