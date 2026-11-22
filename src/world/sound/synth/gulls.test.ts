import assert from "node:assert/strict";
import { test } from "node:test";
import { flap, GULL_NOTES, GULL_PAD, GULL_VOICES, gullNote, gullVoice, noteShape } from "./gulls.ts";

const RATE = 24000, SEED = 3;

test("six birds, each with its own pitch (620 Hz ±10 %) and size; eight notes each, starting and ending in silence", () => {
  const bases = new Set<number>();
  for (let v = 0; v < GULL_VOICES; v++) {
    const b = gullVoice(SEED, v);
    assert.ok(b.base >= 558 && b.base <= 682 && Math.abs(b.shift - 1) <= 0.08);
    bases.add(Math.round(b.base));
  }
  assert.ok(bases.size >= 5);
  assert.equal(GULL_NOTES.length, 8);
  for (const note of GULL_NOTES) {
    const x = gullNote(SEED, 1, note, RATE);
    const pad = Math.round(GULL_PAD * RATE);
    assert.equal(x[0], 0);
    assert.equal(x[x.length - 1], 0);
    assert.ok(Math.abs(x[pad + 2]) < 0.01, "no step at its start");
    let peak = 0;
    for (const s of x) peak = Math.max(peak, Math.abs(s));
    // (Keks are levelled by their bark, not their peak.)
    if (note[0] === "e") assert.ok(peak > 0.3 && peak < 0.8);
    else assert.ok(Math.abs(peak - 0.5) < 1e-6);
    assert.ok(Math.abs(x.length / RATE - noteShape(SEED, 1, note).seconds - 2 * GULL_PAD) < 2 / RATE);
  }
});

test("note shapes: a kyow rises quickly and falls away; a squeal climbs slowly and is highest; a kek is a short low bark; a mew is pure", () => {
  for (let v = 0; v < GULL_VOICES; v++) {
    const k = noteShape(SEED, v, "k0"), s = noteShape(SEED, v, "s0"), e = noteShape(SEED, v, "e0"), m = noteShape(SEED, v, "m"), broken = noteShape(SEED, v, "k2");
    assert.ok(k.seconds >= 0.14 && k.seconds <= 0.2, "terminal notes are 0.15–0.2 s, as the sonogram has them");
    assert.ok(k.pitch(0) < 1 && k.pitch(0.045) > 1.17 && k.pitch(0.045) < 1.25 && k.pitch(k.seconds) < 0.9);
    assert.ok(s.seconds > 0.75 && s.pitch(0) < 0.85 && s.pitch(s.seconds) > k.pitch(0.045), "the squeal ends above the kyow's peak");
    assert.ok(s.pitch(0.3) < s.pitch(0.6));
    assert.ok(e.seconds < 0.13 && e.pitch(0) <= 0.75 && e.pitch(e.seconds) < e.pitch(0));
    assert.ok(m.seconds > 1.1 && m.tract < 1);
    // Rough only at the loud moment: nothing at a kyow's start or end, something at its peak; a squeal only in its last part; a mew never.
    assert.equal(k.rasp(0), 0);
    assert.equal(k.rasp(k.seconds - 0.03), 0);
    assert.ok(k.rasp(0.05) > 0.3);
    assert.equal(s.rasp(0.3 * s.seconds), 0);
    assert.ok(s.rasp(0.85 * s.seconds) > 0.25);
    for (let t = 0; t < m.seconds; t += 0.05) assert.equal(m.rasp(t), 0);
    // The break: for 25 ms the voice jumps toward its octave.
    let jumped = 0;
    for (let t = 0; t < broken.seconds; t += 0.002) if (broken.pitch(t) > 1.6) jumped++;
    assert.ok(jumped >= 11 && jumped <= 14);
  }
});

test("the energy of a kyow lies in harmonics 2–5, not in the fundamental", () => {
  const b = gullVoice(SEED, 2), shape = noteShape(SEED, 2, "k0");
  const x = gullNote(SEED, 2, "k0", 48000);
  const f0 = b.base * shape.pitch(0.05), from = Math.round((GULL_PAD + 0.035) * 48000), n = 1440;
  const level = (hz: number) => {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += h * x[from + i] * Math.cos((2 * Math.PI * hz * i) / 48000);
      im += h * x[from + i] * Math.sin((2 * Math.PI * hz * i) / 48000);
    }
    return re * re + im * im;
  };
  const h = Array.from({ length: 12 }, (_, i) => level((i + 1) * f0));
  const total = h.reduce((a, c) => a + c, 0);
  assert.ok((h[1] + h[2] + h[3] + h[4]) / total > 0.6);
  assert.ok(h[0] / total < 0.3);
});

test("three wingbeats: short, soft-edged, low", () => {
  for (let k = 0; k < 3; k++) {
    const x = flap(SEED, k, RATE);
    assert.ok(x.length / RATE < 0.16);
    assert.equal(x[0], 0);
    assert.equal(x[x.length - 1], 0);
  }
  assert.notDeepEqual(flap(SEED, 0, RATE), flap(SEED, 1, RATE));
});
