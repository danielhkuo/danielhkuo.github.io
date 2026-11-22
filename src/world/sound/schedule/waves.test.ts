import assert from "node:assert/strict";
import { test } from "node:test";
import { hash2, mix32 } from "../../core/hash.ts";
import { SET, SETS, WAVE_PERIOD } from "../../live/water.ts";
import type { Cue } from "../types.ts";
import { anchorU, BEACH, lapCues, lastsOf, leadOf, ROCK, SHINGLE, waveCues } from "./waves.ts";

/** water.ts's own arithmetic at time t for a bend: each train's moment in its wave (0 … 255) and its strength. */
function picture(t: number, bend: number): { u: number; strength: number }[] {
  const wave = Math.floor((t / WAVE_PERIOD) * 256);
  const ph = wave + bend, ph2 = ph + 128;
  return [
    { u: ph & 255, strength: SET[(ph >> 8) % SETS] },
    { u: ph2 & 255, strength: SET[((ph2 >> 8) + 4) % SETS] },
  ];
}

const cues = (kind: number, bend: number, t0: number, t1: number): Cue[] => {
  const out: Cue[] = [];
  waveCues({ cell: 7, kind, bend }, t0, t1, out);
  return out;
};

test("a cue's anchor lands where water.ts's own phase reads u = 0.5 (0.4 for rock and shingle), with its strength", () => {
  let checked = 0;
  for (let i = 0; i < 1000; i++) {
    const bend = hash2(i, 1, 9) & 255;
    const kind = [BEACH, SHINGLE, ROCK][i % 3];
    const from = 20 + (hash2(i, 2, 9) % 4000) / 10;
    for (const c of cues(kind, bend, from, from + 6)) {
      const p = picture(c.anchor!, bend)[c.train!];
      assert.equal(p.u, Math.round(anchorU(kind) * 256), `bend ${bend} train ${c.train}`);
      assert.equal(p.strength, c.strength);
      assert.ok(Math.abs(c.t - (c.anchor! - leadOf(kind))) < 1e-9);
      assert.equal(c.lasts, lastsOf(kind));
      checked++;
    }
  }
  assert.ok(checked > 2000);
});

test("both trains come once a period, half a period apart, in time order", () => {
  const all = cues(BEACH, 40, 100, 100 + 20 * WAVE_PERIOD);
  assert.equal(all.length, 40);
  for (let i = 1; i < all.length; i++) {
    assert.ok(Math.abs(all[i].t - all[i - 1].t - WAVE_PERIOD / 2) < 1e-9);
    assert.notEqual(all[i].train, all[i - 1].train);
  }
  assert.equal(new Set(all.map((c) => c.key)).size, all.length);
});

test("any window of 0.25 s that contains a cue's start returns it; windows tile; no cue twice", () => {
  for (const kind of [BEACH, ROCK]) {
    const whole = cues(kind, 201, 50, 200);
    const pieces: Cue[] = [];
    let t = 50, i = 0;
    while (t < 200) {
      const step = Math.min(200 - t, 0.004 + (mix32(i++) / 4294967296) * 0.25);
      pieces.push(...cues(kind, 201, t, t + step));
      t += step;
    }
    assert.deepEqual(pieces, whole);
    for (const c of whole) {
      const got = cues(kind, 201, c.t - 0.1, c.t + 0.15);
      assert.ok(got.some((g) => g.key === c.key));
    }
  }
});

test("nothing before the page's clock starts", () => {
  for (const c of cues(BEACH, 250, -20, 12)) assert.ok(c.k! >= 0);
  assert.ok(cues(BEACH, 250, -20, 12).length >= 2);
});

test("laps: about half the slots hold one, more round u = 0; deterministic; windows tile", () => {
  const all: Cue[] = [];
  lapCues(3, 11, 90, 0, 2000, all);
  const share = all.length / 4000;
  assert.ok(share > 0.5 && share < 0.62, `share ${share}`);
  for (const c of all) {
    assert.ok(c.rate! >= 0.8 && c.rate! <= 1.2);
    assert.ok(c.variant! >= 0 && c.variant! < 4);
  }
  const again: Cue[] = [];
  lapCues(3, 11, 90, 0, 2000, again);
  assert.deepEqual(again, all);
  const pieces: Cue[] = [];
  for (let t = 0; t < 2000; t += 0.37) lapCues(3, 11, 90, t, Math.min(2000, t + 0.37), pieces);
  assert.deepEqual(pieces, all);
  assert.equal(new Set(all.map((c) => c.key)).size, all.length);
});
