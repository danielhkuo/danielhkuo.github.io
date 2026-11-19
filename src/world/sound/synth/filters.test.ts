import assert from "node:assert/strict";
import test from "node:test";
import { rngFor } from "../../core/rng.ts";
import { coefficients, filtered, response, type FilterSpec } from "./filters.ts";
import { gaussianInto } from "./noise.ts";

const RATE = 48000;
const db = (g: number) => 20 * Math.log10(g);

test("a Butterworth low-pass and high-pass are 3 dB down at their corner and flat away from it", () => {
  const low = coefficients({ type: "lowpass", hz: 1500, q: -3.01 }, RATE);
  assert.ok(Math.abs(db(response(low, 1500, RATE)) + 3.01) < 0.05);
  assert.ok(Math.abs(db(response(low, 100, RATE))) < 0.01);
  assert.ok(db(response(low, 6000, RATE)) < -23);
  const high = coefficients({ type: "highpass", hz: 2500, q: -3.01 }, RATE);
  assert.ok(Math.abs(db(response(high, 2500, RATE)) + 3.01) < 0.05);
  assert.ok(Math.abs(db(response(high, 15000, RATE))) < 0.05);
  assert.ok(db(response(high, 625, RATE)) < -23);
});

test("a band-pass is at unity at its centre, a peak at its gain, a shelf at its gain well above", () => {
  assert.ok(Math.abs(db(response(coefficients({ type: "bandpass", hz: 400, q: 0.5 }, RATE), 400, RATE))) < 0.01);
  const peak = coefficients({ type: "peaking", hz: 250, q: 1.2, db: 4 }, RATE);
  assert.ok(Math.abs(db(response(peak, 250, RATE)) - 4) < 0.01);
  assert.ok(Math.abs(db(response(peak, 4000, RATE))) < 0.1);
  const shelf = coefficients({ type: "highshelf", hz: 5000, db: -6 }, RATE);
  assert.ok(Math.abs(db(response(shelf, 20000, RATE)) + 6) < 0.2);
  assert.ok(Math.abs(db(response(shelf, 5000, RATE)) + 3) < 0.1);
  assert.ok(Math.abs(db(response(shelf, 200, RATE))) < 0.1);
});

test("a filtered loop is seamless: it is the steady state of the loop played round and round", () => {
  const x = gaussianInto(new Float32Array(4096), rngFor(1, "filters"));
  const chain: FilterSpec[] = [{ type: "bandpass", hz: 400, q: 0.5 }, { type: "lowpass", hz: 1500, q: -3.01 }];
  const y = filtered(x, chain, RATE);
  // The same loop, three times round, filtered straight through: its last round is the loop.
  const long = new Float32Array(3 * x.length);
  for (let i = 0; i < long.length; i++) long[i] = x[i % x.length];
  let z = long;
  for (const f of chain) {
    const c = coefficients(f, RATE);
    const o = new Float32Array(z.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < z.length; i++) {
      const v = c.b0 * z[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = z[i];
      y2 = y1;
      y1 = v;
      o[i] = v;
    }
    z = o;
  }
  for (let i = 0; i < x.length; i++) assert.ok(Math.abs(y[i] - z[2 * x.length + i]) < 1e-4, `sample ${i}`);
  assert.notEqual(x[10], y[10]);
});
