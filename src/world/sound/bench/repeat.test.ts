import assert from "node:assert/strict";
import { test } from "node:test";
import { rngFor } from "../../core/rng.ts";
import { gaussianInto } from "../synth/noise.ts";
import { repeatCheck } from "./repeat.ts";

const RATE = 48000;

/** A hiss-like wave: noise, high-passed a little, under a swell-and-fade envelope. */
function wave(noise: Float32Array, at: number, into: Float32Array, level = 1): void {
  let prev = 0;
  for (let i = 0; i < 4 * RATE; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 0.6) / 0.9);
    const x = noise[i] - 0.9 * prev;
    prev = noise[i];
    into[at + i] += level * env * x;
  }
}

test("one frozen wave played twice is found: more than 0.9", () => {
  const frozen = gaussianInto(new Float32Array(4 * RATE), rngFor(3, "sound/test/frozen"));
  const signal = new Float32Array(16 * RATE);
  wave(frozen, 1 * RATE, signal);
  // Again later, quieter, and not on a multiple of the decimation.
  wave(frozen, 8 * RATE + 3, signal, 0.4);
  const r = repeatCheck(signal, RATE, [1, 8 + 3 / RATE]);
  assert.equal(r.pairs, 1);
  assert.ok(r.repeatMax > 0.9, `repeatMax ${r.repeatMax}`);
  // Found even when the cuts are a third of a second out of step.
  const off = repeatCheck(signal, RATE, [1, 8.33]);
  // (Less than the whole wave overlaps, so less than 1; still far above the 0.3 the check allows.)
  assert.ok(off.repeatMax > 0.6, `out of step: ${off.repeatMax}`);
  assert.ok(Math.abs(Math.abs(off.worst[2]) - 0.33) < 0.01, `lag ${off.worst[2]}`);
});

test("independent noise under the same envelope is not: less than 0.1", () => {
  const signal = new Float32Array(30 * RATE);
  const starts: number[] = [];
  for (let k = 0; k < 6; k++) {
    wave(gaussianInto(new Float32Array(4 * RATE), rngFor(3, `sound/test/fresh/${k}`)), (1 + 4.5 * k) * RATE, signal);
    starts.push(1 + 4.5 * k);
  }
  const r = repeatCheck(signal, RATE, starts);
  assert.equal(r.pairs, 15);
  assert.equal(r.waves, 6);
  assert.ok(r.repeatMax < 0.1, `repeatMax ${r.repeatMax}`);
});

test("waves that run off the end are left out", () => {
  const signal = new Float32Array(6 * RATE);
  wave(gaussianInto(new Float32Array(4 * RATE), rngFor(3, "sound/test/one")), RATE, signal);
  assert.equal(repeatCheck(signal, RATE, [1, 4]).waves, 1);
});
