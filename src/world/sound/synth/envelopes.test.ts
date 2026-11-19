import assert from "node:assert/strict";
import { test } from "node:test";
import { BEACH, lastsOf, leadOf, ROCK, SHINGLE } from "../schedule/waves.ts";
import { ENV_BASE, envelope, glideAt, glides } from "./envelopes.ts";

const RATE = 8000;
const peakAt = (x: Float32Array) => x.indexOf(Math.max(...x)) / RATE;

test("every gain starts and ends at 0, lasts its kind's time, and never goes under 0", () => {
  for (const kind of [BEACH, SHINGLE, ROCK]) {
    const ch = envelope(kind, RATE);
    assert.equal(ch.length, 4);
    for (const c of ch) {
      assert.equal(c.length, Math.round(lastsOf(kind) * RATE));
      assert.equal(c[0], 0);
      assert.equal(c[c.length - 1], 0);
      assert.ok(c.every((v) => v >= 0 && Number.isFinite(v)));
    }
  }
});

test("a beach wave: the crash peaks at the picture's moment, the hiss a quarter second after, and foam fizzes on between breaks", () => {
  const [low, mid, high, band] = envelope(BEACH, RATE);
  const lead = leadOf(BEACH);
  assert.ok(Math.abs(peakAt(mid) - lead) < 0.03, `crash at ${peakAt(mid)}`);
  assert.ok(Math.abs(peakAt(low) - lead) < 0.03);
  assert.ok(peakAt(high) > lead + 0.15 && peakAt(high) < lead + 0.4);
  assert.ok(band.every((v) => v === 0), "sand has no rattle");
  // Two seconds after the break the hiss is still about a tenth of its peak; the rumble is long gone.
  const at = Math.round((lead + 2) * RATE);
  const share = high[at] / Math.max(...high);
  assert.ok(share > 0.08 && share < 0.25, `fizz ${share}`);
  assert.ok(low[at] / Math.max(...low) < 0.03);
  // The crash is soft-edged: 10 % to 90 % takes at least 200 ms.
  const top = Math.max(...mid);
  const t10 = mid.findIndex((v) => v > 0.1 * top) / RATE, t90 = mid.findIndex((v) => v > 0.9 * top) / RATE;
  assert.ok(t90 - t10 >= 0.2, `attack ${t90 - t10}`);
});

test("a rock wave: nearly silent, then a boom within 60 ms of the burst that decays at τ ≈ 0.45 s, then the slosh", () => {
  const [low, , , band] = envelope(ROCK, RATE);
  const lead = leadOf(ROCK);
  const top = Math.max(...low);
  assert.ok(low[Math.round((lead - 0.05) * RATE)] < 0.06 * top, "before the burst");
  assert.ok(peakAt(low) >= lead && peakAt(low) <= lead + 0.06, `boom at ${peakAt(low) - lead}`);
  const a = low[Math.round((lead + 0.2) * RATE)], b = low[Math.round((lead + 0.65) * RATE)];
  assert.ok(Math.abs(Math.log(a / b) - 1) < 0.1, "one e-fold in 0.45 s");
  assert.ok(peakAt(band) > lead + 0.8, "the slosh comes after");
});

test("a shingle wave: the rattle is silent until the backwash, fullest at u = 0.70, and falls in pitch", () => {
  const band = envelope(SHINGLE, RATE)[3];
  const lead = leadOf(SHINGLE);
  // u = 0.4 at the lead; 5.2 s a period.
  const t = (u: number) => lead + (u - 0.4) * 5.2;
  assert.equal(band[Math.round(t(0.5) * RATE)], 0);
  assert.ok(Math.abs(peakAt(band) - t(0.7)) < 0.05);
  const g = glides(SHINGLE, 2).band;
  assert.ok(glideAt(g, t(0.55)) > glideAt(g, t(0.9)), "falling");
  assert.ok(Math.abs(ENV_BASE.band * Math.pow(2, glideAt(g, 0) / 1200) - 5000) < 1);
  assert.ok(Math.abs(ENV_BASE.band * Math.pow(2, glideAt(g, 9) / 1200) - 2600) < 1);
});

test("glides: bigger waves sit lower; points are in time order inside the wave", () => {
  const hz = (base: number, c: number) => base * Math.pow(2, c / 1200);
  const end = (k: number, s: number) => hz(ENV_BASE.mid, glides(k, s).mid.at(-1)![1]);
  assert.ok(end(BEACH, 1) > end(BEACH, 2) && end(BEACH, 2) > end(BEACH, 3));
  assert.ok(Math.abs(end(BEACH, 3) - 650) < 1);
  for (const kind of [BEACH, SHINGLE, ROCK]) for (let s = 1; s <= 3; s++) {
    for (const g of Object.values(glides(kind, s))) {
      for (let i = 0; i < g.length; i++) {
        assert.ok(g[i][0] >= 0 && g[i][0] <= lastsOf(kind) + 1e-9);
        if (i) assert.ok(g[i][0] > g[i - 1][0]);
      }
    }
  }
  // Between two points the value is on the line between them.
  const g = glides(BEACH, 2).high;
  const mid = (g[0][0] + g[1][0]) / 2;
  assert.ok(Math.abs(glideAt(g, mid) - (g[0][1] + g[1][1]) / 2) < 1e-9);
});
