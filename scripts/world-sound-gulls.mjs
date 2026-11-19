// Measures the gulls from the bench's renders, against the design (spec §4.7, §5.3; Recipes §6):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-sound-gulls.mjs [--dir .cache/world-sound]
//
// From `gull-calls.wav` (one bird, 30 cells off): the yelp's kyow and every note of the long call: its fundamental as
// it starts, at its highest and as it ends (by autocorrelation, every 10 ms), how its energy is shared among its
// harmonics at its peak, and how rough it is (how far every other period of the
// voice differs from the ones between) at its peak against its quiet ends. Then the schedule itself: calls a slot over 10,000 slots by a town and at a
// lighthouse, answers, and whether any bird calls over itself. Exit code 1 when a figure is outside the design.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIMITER_DELAY_S } from "../src/world/sound/levels.ts";
import { callLength, callNotes, gullCues, LONG, P_ANSWER, P_LIGHT, P_TOWN, SLOT_S, voiceOf, YELP } from "../src/world/sound/schedule/gulls.ts";
import { GULL_PAD, gullVoice, noteShape } from "../src/world/sound/synth/gulls.ts";
import { readWav } from "./world-sound-check.mjs";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : ".cache/world-sound";
const SEED = 3;
let failed = false;
const flag = (ok) => {
  if (!ok) failed = true;
  return ok ? "" : "  FAIL";
};

/** The fundamental of x round sample `at`, Hz, by the autocorrelation's highest peak between 450 and 1800 Hz (30 ms window); 0 when there is none. */
function pitchAt(x, rate, at) {
  const n = Math.round(0.03 * rate);
  if (at < 0 || at + n + rate / 400 >= x.length) return 0;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[at + i] * x[at + i];
  if (e < 1e-9) return 0;
  let best = 0, bestV = 0;
  const lo = Math.floor(rate / 1800), hi = Math.ceil(rate / 450);
  const ac = (lag) => {
    let s = 0, e2 = 0;
    for (let i = 0; i < n; i++) {
      s += x[at + i] * x[at + i + lag];
      e2 += x[at + i + lag] * x[at + i + lag];
    }
    return s / Math.sqrt(e * e2 + 1e-20);
  };
  for (let lag = lo; lag <= hi; lag++) {
    const v = ac(lag);
    // The first strong peak: a later one is a multiple of the period.
    if (v > bestV + 0.03) {
      bestV = v;
      best = lag;
    }
  }
  if (bestV < 0.5) return 0;
  // Between samples: a parabola through the peak.
  const a = ac(best - 1), b = ac(best), c = ac(best + 1);
  const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return rate / (best + d);
}

/** The level of x at `hz` over 40 ms from `at` (a Hann-windowed Fourier sum). */
function levelAt(x, rate, hz, at) {
  const n = Math.round(0.04 * rate);
  let re = 0, im = 0;
  const w = (2 * Math.PI * hz) / rate;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += h * x[at + i] * Math.cos(w * i);
    im += h * x[at + i] * Math.sin(w * i);
  }
  return Math.hypot(re, im) / n;
}

const file = path.join(dir, "gull-calls.wav");
if (!existsSync(file)) console.log(`no gull-calls.wav in ${dir}`);
else {
  const w = readWav(readFileSync(file));
  const rate = w.sampleRate;
  const x = new Float32Array(w.channels[0].length);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (w.channels[0][i] + w.channels[1][i]);
  const bird = gullVoice(SEED, 0);
  console.log(`gull-calls: voice 0, base pitch ${bird.base.toFixed(0)} Hz (design 620–820), formants × ${bird.shift.toFixed(3)}`);
  // The scene's script: a yelp at 0.5 s (performance 1000) and the long call at 5.2 s (performance 1003).
  const calls = [{ name: "yelp", at: 0.5, key: 1000, call: YELP }, { name: "long call", at: 5.2, key: 1003, call: LONG }];
  console.log("  note            starts   f0 start → peak (at) → end, Hz      design ×B          lasts   H1    H2–5   H6+    rough: away from the peak / at it");
  for (const c of calls) {
    const notes = callNotes(SEED, 0, c.key, c.call);
    console.log(`  ${c.name}: ${notes.length} notes (${notes.filter((n) => n.note[0] === "s").length} squeals, ${notes.filter((n) => n.note[0] === "k").length} kyows), ${callLength(SEED, 0, c.key, c.call).toFixed(2)} s`);
    notes.forEach((nt, k) => {
      const shape = noteShape(SEED, 0, nt.note);
      const start = c.at + nt.dt + GULL_PAD / nt.rate + LIMITER_DELAY_S, lasts = shape.seconds / nt.rate;
      const track = [];
      for (let t = 0.01; t < lasts - 0.035; t += 0.01) {
        const f = pitchAt(x, rate, Math.round((start + t) * rate));
        if (f > 0) track.push({ t, f });
      }
      if (track.length < 3) return;
      // The break's octave jump is left out of the contour: the peak is the highest the voice holds for 20 ms.
      const held = track.filter((p, i) => i > 0 && i < track.length - 1 && Math.abs(track[i + 1].f / p.f - 1) < 0.12 && Math.abs(track[i - 1].f / p.f - 1) < 0.12);
      const peak = (held.length ? held : track).reduce((a, b) => (b.f > a.f ? b : a));
      const at = Math.round((start + peak.t) * rate);
      const h = [];
      for (let n = 1; n <= 12; n++) h.push(levelAt(x, rate, n * peak.f, at) ** 2);
      const total = h.reduce((a, b) => a + b, 0);
      const share = (a, b) => Math.round((100 * h.slice(a - 1, b).reduce((p, q) => p + q, 0)) / total);
      // Roughness: the rasp makes every other period of the voice weaker. Six periods from t, taken in turn: how far
      // the energy of the odd ones differs from the even ones' (the most, over where the periods are cut), in percent.
      const rough = (t) => {
        const i0 = Math.round((start + t) * rate);
        const f = pitchAt(x, rate, i0) || peak.f, T = rate / f;
        let most = 0;
        for (let cut = 0; cut < 8; cut++) {
          let even = 0, odd = 0;
          for (let k = 0; k < 6; k++) {
            const a = Math.round(i0 + (cut / 8 + k) * T), b = Math.round(i0 + (cut / 8 + k + 1) * T);
            let e = 0;
            for (let i = a; i < b; i++) e += x[i] * x[i];
            if (k & 1) odd += e;
            else even += e;
          }
          most = Math.max(most, (100 * Math.abs(even - odd)) / (even + odd + 1e-20));
        }
        return most;
      };
      const first = track[0], last = track[track.length - 1];
      // (Away from the peak: a squeal's first quarter, a kyow's fall. Not its very ends, where the level itself is changing by the period.)
      const ends = rough(nt.note[0] === "s" ? 0.25 * lasts : 0.7 * lasts), top = nt.note[0] === "s" ? rough(lasts - 0.16) : Math.max(rough(peak.t - 0.005), rough(peak.t + 0.015));
      const d0 = shape.pitch(0.02) * nt.rate, d1 = Math.max(...Array.from({ length: 50 }, (_, i) => shape.pitch((i / 50) * shape.seconds)).filter((v) => v < 1.6)) * nt.rate, d2 = shape.pitch(shape.seconds - 0.03) * nt.rate;
      const okPitch = Math.abs(peak.f / (d1 * bird.base) - 1) < 0.06;
      const okH = share(2, 5) > 50, okRough = top > 2 * ends && top > 8;
      console.log(
        `    ${String(k + 1).padStart(2)} ${nt.note.padEnd(3)} ${(c.at + nt.dt).toFixed(2).padStart(7)} s  ${first.f.toFixed(0).padStart(5)} → ${peak.f.toFixed(0).padStart(5)} (${(1000 * peak.t).toFixed(0).padStart(3)} ms) → ${last.f.toFixed(0).padStart(5)}` +
          `   ${d0.toFixed(2)} → ${d1.toFixed(2)} → ${d2.toFixed(2)}  ${(1000 * lasts).toFixed(0).padStart(5)} ms  ${String(share(1, 1)).padStart(3)} %  ${String(share(2, 5)).padStart(3)} %  ${String(share(6, 12)).padStart(3)} %   ${ends.toFixed(0)} / ${top.toFixed(0)} %${flag(okPitch && okH && okRough)}`,
      );
    });
  }
}

// ── The schedule ─────────────────────────────────────────────────────────────────────────────────────────────────────

for (const colony of [{ id: 1, birds: 9, town: true }, { id: 2, birds: 5, town: false }]) {
  const SLOTS = 10000;
  const cues = [];
  gullCues(SEED, [colony], 0, SLOTS * SLOT_S, cues);
  const firsts = cues.filter((c) => c.key.endsWith(":0")), answers = cues.filter((c) => c.key.endsWith(":1"));
  const kinds = [0, 1, 2, 3].map((k) => Math.round((100 * firsts.filter((c) => c.call === k).length) / firsts.length));
  // Does any bird start a call while an earlier call of its own is still sounding?
  const until = new Map();
  let over = 0;
  for (const c of cues) {
    if ((until.get(c.bird) ?? -1) > c.t) over++;
    until.set(c.bird, c.t + c.lasts);
  }
  // Silences: the gaps between one call's start and the next.
  const gaps = cues.slice(1).map((c, i) => c.t - cues[i].t).sort((a, b) => a - b);
  const want = colony.town ? P_TOWN : P_LIGHT, rate = firsts.length / SLOTS;
  console.log(
    `${colony.town ? "town" : "lighthouse"} (${colony.birds} birds), ${SLOTS} slots of ${SLOT_S} s: ${rate.toFixed(3)} calls a slot (design ${want})${flag(Math.abs(rate - want) < 0.02)}; ` +
      `${answers.length} answers (${(answers.length / firsts.length).toFixed(2)} of calls, design ${P_ANSWER} less those a bird could not make)${flag(Math.abs(answers.length / firsts.length - P_ANSWER) < 0.06)}; ` +
      `yelp / keks / mew / long ${kinds.join(" / ")} %; a bird calling over itself: ${over}${flag(over === 0)}; gap between calls: median ${gaps[gaps.length >> 1].toFixed(1)} s, a tenth under ${gaps[Math.floor(gaps.length / 10)].toFixed(1)} s, a tenth over ${gaps[Math.floor(0.9 * gaps.length)].toFixed(1)} s; voices in use ${new Set(cues.map((c) => voiceOf(SEED, colony.id, c.bird))).size}`,
  );
}

for (const name of ["gulls-harbour", "gulls-lowpass", "gulls-lowpass-birds"]) {
  const f = path.join(dir, `${name}.stats.json`);
  if (!existsSync(f)) continue;
  const st = JSON.parse(readFileSync(f, "utf8"));
  console.log(`${name}: ${st.gullCalls.length} calls (${st.gullCalls.map((g) => `${["yelp", "keks", "mew", "long call"][g.call]} by bird ${g.bird} at ${g.at} s`).join("; ") || "none"}), ${st.gullsDropped} dropped, ${st.gullStartles} birds put up`);
}

process.exit(failed ? 1 : 0);
