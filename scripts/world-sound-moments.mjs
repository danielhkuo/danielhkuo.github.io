// Measures the clock and the moments from the bench's renders (spec §4.8–4.10, §5.4–5.5):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-sound-moments.mjs [--dir .cache/world-sound]
//
// The clock: when each figure's clack and the tune's phrases fall against the picture's `figureOut`, the count, and
// the opening's level against the same phrase mid-tune. The train: its chuffs against the distance its drawn wheels
// have run, the beat heard in the render, and how far its whistle bends on a cruise pass. The seaplane: its splashes
// against the picture's touchdown, and its engine's note against its designed speed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { figureOut, momentSpan, PLANE_DOWN } from "../src/world/live/moments.ts";
import { LIMITER_DELAY_S } from "../src/world/sound/levels.ts";
import { CHUFF_CELLS, HORN_AFTER, HORN_BEFORE, planeRpm } from "../src/world/sound/schedule/moments.ts";
import { BAR_S, melodySemitones, parsons } from "../src/world/sound/schedule/tune.ts";
import { HORN_HZ, MOMENT_PAD, THUMP_RATE, WHISTLE_HZ } from "../src/world/sound/synth/moments.ts";
import { readWav } from "./world-sound-check.mjs";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : ".cache/world-sound";
let failed = false;
const flag = (ok) => {
  if (!ok) failed = true;
  return ok ? "" : "  FAIL";
};
const stats = (name) => (existsSync(path.join(dir, `${name}.stats.json`)) ? JSON.parse(readFileSync(path.join(dir, `${name}.stats.json`), "utf8")) : null);
const report = existsSync(path.join(dir, "report.json")) ? JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) : null;
const row = (name) => (report?.rows ?? report ?? []).find((r) => r.file === `${name}.wav`);
const mono = (name) => {
  const f = path.join(dir, `${name}.wav`);
  if (!existsSync(f)) return null;
  const w = readWav(readFileSync(f));
  const x = new Float32Array(w.channels[0].length);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (w.channels[0][i] + w.channels[1][i]);
  return { x, rate: w.sampleRate };
};
/** The frequency of the strongest line of x in [lo, hi] Hz over `seconds` from `t` (a Hann-windowed Fourier sum, searched finely). */
function lineAt(x, rate, t, seconds, lo, hi, step) {
  const n = Math.round(seconds * rate), from = Math.round(t * rate);
  let best = 0, bestP = -1;
  for (let hz = lo; hz <= hi; hz += step) {
    let re = 0, im = 0;
    const w = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += h * x[from + i] * Math.cos(w * i);
      im += h * x[from + i] * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      best = hz;
    }
  }
  return best;
}

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = stats("clock");
  if (st) {
    // The scene starts 2 s before the procession.
    const cues = st.momentCues.filter((c) => c.kind === "clock").map((c) => ({ ...c, at: c.at - 2, t: c.t - 2 }));
    const clacks = cues.filter((c) => c.variant === 1 && c.k < 5).sort((a, b) => a.at - b.at);
    const chimes = cues.filter((c) => c.variant === 0).sort((a, b) => a.at - b.at);
    const whirr = cues.find((c) => c.variant === 4), first = cues.filter((c) => c.variant !== 4).sort((a, b) => a.at - b.at)[0];
    console.log(`clock: ${cues.length} cues; the whirr at ${whirr?.at.toFixed(2)} s, the doors at ${first?.at.toFixed(2)} s`);
    const worst = Math.max(...clacks.map((c, i) => Math.abs(c.at - figureOut(i))));
    console.log(`  figures step out (clack) at ${clacks.map((c) => c.at.toFixed(3)).join(", ")} s; the picture's figureOut: ${[0, 1, 2, 3, 4].map((i) => figureOut(i).toFixed(3)).join(", ")}; furthest apart ${(1000 * worst).toFixed(1)} ms${flag(worst < 0.002)}`);
    const phrase = [0, 1, 2, 3, 4].map((i) => chimes.filter((c) => c.k >= 2).reduce((a, c) => (Math.abs(c.at - figureOut(i)) < Math.abs(a.at - figureOut(i)) ? c : a)));
    const off = Math.max(...phrase.map((c, i) => Math.abs(c.at - figureOut(i))));
    console.log(`  the tune's bars 1, 4, 7, 10, 13 begin at ${phrase.map((c) => c.at.toFixed(3)).join(", ")} s (each note is played up to 12 ms early or late): within ${(1000 * off).toFixed(1)} ms of its figure${flag(off <= 0.0125)}; a bar is ${BAR_S.toFixed(4)} s`);
    const count = chimes.filter((c) => c.k === 0 && c.at > 23);
    console.log(`  the count: ${count.length} strokes on the low E at ${count.map((c) => c.at.toFixed(1)).join(", ")} s (hour 3)${flag(count.length === 3)}`);
    const marks = row("clock")?.marks ?? [];
    const a = marks.find((m) => m.name === "its first bar"), b = marks.find((m) => m.name === "bar 7"), tune = marks.find((m) => m.name === "the tune");
    if (a && b) console.log(`  openings are not faded: the first bar ${a.lufs} LUFS, the same phrase at bar 7 ${b.lufs} LUFS (${(a.lufs - b.lufs).toFixed(1)} LU; each note is ±1.5 dB by turns)${flag(Math.abs(a.lufs - b.lufs) <= 1.5)}; the tune ${tune?.lufs} LUFS at 60 cells (target −27)`);
  }
  const semis = melodySemitones();
  console.log(`  the tune's contour: ${parsons(semis)} (${semis.length} notes)`);
}

// ── The train ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = stats("train");
  if (st) {
    const lasts = momentSpan(3, "train").lasts, v = 288 / (lasts / 2);
    const chuffs = st.momentCues.filter((c) => c.kind === "train" && c.variant === 0).map((c) => ({ k: c.k, at: c.at - 2 })).sort((a, b) => a.at - b.at);
    // Each chuff against where the wheels are: cells run on its leg, in chuffs (3 cells); the third beat is 4 % of a beat late by design.
    let worst = 0;
    for (const c of chuffs) {
      const leg = c.at < lasts / 2 ? c.at : c.at - lasts / 2;
      const run = (leg * v) / CHUFF_CELLS - (c.k === 2 ? 0.04 : 0);
      worst = Math.max(worst, Math.abs(run - Math.round(run)) * CHUFF_CELLS);
    }
    console.log(`train: ${chuffs.length} chuffs over two legs of 288 cells at ${v.toFixed(1)} cells a second; each falls within ${worst.toFixed(3)} cells of a multiple of 3 cells run (a wheel turn is 12 cells: four beats)${flag(worst < 0.02)}`);
    const m = mono("train");
    if (m) {
      // The beat in the render, as the train passes nearest: the autocorrelation of the level in 5 ms steps.
      const step = Math.round(0.005 * m.rate), env = [];
      for (let i = Math.round(8.5 * m.rate); i + step < 11.5 * m.rate; i += step) {
        let e = 0;
        for (let k = 0; k < step; k++) e += m.x[i + k] * m.x[i + k];
        env.push(Math.sqrt(e / step));
      }
      const mean = env.reduce((a, b) => a + b, 0) / env.length;
      let best = 0, bestV = -1;
      for (let lag = 20; lag <= 60; lag++) {
        let s = 0;
        for (let i = 0; i + lag < env.length; i++) s += (env[i] - mean) * (env[i + lag] - mean);
        if (s > bestV) {
          bestV = s;
          best = lag;
        }
      }
      console.log(`  heard as it passes nearest: a beat every ${(best * 5).toFixed(0)} ms (${(1000 / (best * 5)).toFixed(2)} a second; the wheels give ${(v / CHUFF_CELLS).toFixed(2)})${flag(Math.abs(best * 0.005 - CHUFF_CELLS / v) < 0.006)}`);
    }
    const marks = row("train")?.marks ?? [];
    console.log(`  levels: ${marks.map((x) => `${x.name} ${x.lufs} LUFS`).join("; ")} (targets at 60 cells: chuffs −26, the whistle −21; from 140 cells the whistle is 7.4 dB down)`);
  }
  const pass = mono("train-pass-alone"), ps = stats("train-pass-alone");
  if (pass && ps) {
    const w = ps.momentCues.find((c) => c.kind === "train" && c.variant === 2);
    if (w) {
      // The whistle's upper tube, through its steady stretch (after the 150 ms it takes to come up, before its last 200 ms sag).
      const t0 = w.at + MOMENT_PAD + LIMITER_DELAY_S, pts = [];
      for (let t = 0.2; t <= 0.9; t += 0.05) pts.push({ t, hz: lineAt(pass.x, pass.rate, t0 + t - 0.04, 0.08, WHISTLE_HZ[1] * 0.93, WHISTLE_HZ[1] * 1.07, 0.5) });
      const cents = pts.map((p) => 1200 * Math.log2(p.hz / WHISTLE_HZ[1]));
      const hi = Math.max(...cents), lo = Math.min(...cents);
      console.log(`train-pass: the whistle's ${WHISTLE_HZ[1]} Hz tube, every 50 ms from 0.2 s to 0.9 s into it: ${cents.map((c) => c.toFixed(0)).join(", ")} cents; it moves ${(hi - lo).toFixed(0)} cents in all (under a semitone)${flag(hi - lo < 100 && hi - lo > 5)}`);
    }
  }
}

// ── The seaplane ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = stats("seaplane"), m = mono("seaplane");
  if (st && m) {
    const lasts = momentSpan(3, "plane").lasts;
    const splashes = st.momentCues.filter((c) => c.kind === "plane" && c.variant === 0).map((c) => c.at - 2), pops = st.momentCues.filter((c) => c.kind === "plane" && c.variant === 1).map((c) => c.at - 2);
    console.log(`seaplane: splashes at ${splashes.map((t) => t.toFixed(2)).join(", ")} s (the picture's floats touch at ${(PLANE_DOWN * lasts).toFixed(2)} s)${flag(Math.abs(splashes[0] - PLANE_DOWN * lasts) < 0.01)}; last pops at ${pops.map((t) => t.toFixed(2)).join(", ")} s`);
    // The engine's strongest line (the firing's second harmonic, eighteen to the half-order: rpm × 18 / 120) at a few moments, against its designed speed.
    const rows = [];
    let ok = true;
    for (const at of [1, 3, 5, 6.5, 10]) {
      const want = (planeRpm(at + 0.15, lasts) * 18) / 120;
      const hz = lineAt(m.x, m.rate, 2 + at + LIMITER_DELAY_S, 0.3, want * 0.94, want * 1.06, 0.25);
      rows.push(`${at} s: ${hz.toFixed(1)} Hz (${((hz * 120) / 18).toFixed(0)} rpm; designed ${planeRpm(at + 0.15, lasts).toFixed(0)})`);
      if (Math.abs(hz / want - 1) > 0.04) ok = false;
    }
    console.log(`  its engine's note (twice the firing rate): ${rows.join("; ")}${flag(ok)}`);
    const marks = row("seaplane")?.marks ?? [];
    console.log(`  levels: ${marks.map((x) => `${x.name} ${x.lufs} LUFS`).join("; ")} (target: the approach at 60 cells −24); lost through small speakers ${row("seaplane")?.smallSpeakerLossLu} LU`);
  }
}

// ── The ferry ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = stats("ferry"), m = mono("ferry");
  if (st && m) {
    const lasts = momentSpan(3, "ferry").lasts;
    const horns = st.momentCues.filter((c) => c.kind === "ferry").map((c) => ({ long: c.variant === 1, at: c.at - 2 }));
    const ok = horns.length === 2 && Math.abs(horns[0].at - (lasts / 2 - HORN_BEFORE)) < 0.01 && Math.abs(horns[1].at - (lasts / 2 + HORN_AFTER)) < 0.01;
    console.log(`ferry: at the quay ${(lasts / 2).toFixed(1)} s in (the picture's ferryAt is nearest then); ${horns.map((h) => `${h.long ? "long" : "short"} blast at ${h.at.toFixed(2)} s`).join(", ")}${flag(ok)}`);
    // The engine's beat, heard: the level's autocorrelation under 300 Hz would need a filter; the loop's beat shows in the whole level too.
    const step = Math.round(0.005 * m.rate), env = [];
    for (let i = Math.round(8 * m.rate); i + step < 20 * m.rate; i += step) {
      let e = 0;
      for (let k = 0; k < step; k++) e += m.x[i + k] * m.x[i + k];
      env.push(Math.sqrt(e / step));
    }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    let best = 0, bestV = -1;
    for (let lag = 24; lag <= 52; lag++) {
      let s2 = 0;
      for (let i = 0; i + lag < env.length; i++) s2 += (env[i] - mean) * (env[i + lag] - mean);
      if (s2 > bestV) {
        bestV = s2;
        best = lag;
      }
    }
    console.log(`  its engine, heard coming in: a beat every ${(best * 5).toFixed(0)} ms (${(1000 / (best * 5)).toFixed(2)} a second; designed ${THUMP_RATE})${flag(Math.abs(best * 0.005 - 1 / THUMP_RATE) < 0.006)}`);
    // The echo: the horn's lower note 0.9 s and 1.7 s after the short blast has ended, against the blast itself.
    const short = horns.find((h) => !h.long);
    if (short) {
      const t0 = 2 + short.at + MOMENT_PAD + LIMITER_DELAY_S;
      const level = (t) => {
        let re = 0, im = 0;
        const n = Math.round(0.25 * m.rate), from = Math.round(t * m.rate), w = (2 * Math.PI * HORN_HZ[0]) / m.rate;
        for (let i = 0; i < n; i++) {
          const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
          re += h * m.x[from + i] * Math.cos(w * i);
          im += h * m.x[from + i] * Math.sin(w * i);
        }
        return 20 * Math.log10(Math.hypot(re, im) / n + 1e-12);
      };
      const direct = level(t0 + 0.4), one = level(t0 + 0.9 + 0.55), two = level(t0 + 1.7 + 0.55);
      console.log(`  the short blast's ${HORN_HZ[0]} Hz note: ${direct.toFixed(1)} dB; its echoes, heard after the blast has ended: ${(one - direct).toFixed(1)} dB at 0.9 s and ${(two - direct).toFixed(1)} dB at 1.7 s (designed −12 and −18)${flag(Math.abs(one - direct + 12) < 3 && Math.abs(two - direct + 18) < 3.5)}`);
    }
    const marks = row("ferry")?.marks ?? [];
    console.log(`  levels: ${marks.map((x) => `${x.name} ${x.lufs} LUFS`).join("; ")} (target: the horn at 80 cells −20; here it is 68 cells off, 1.4 dB nearer)`);
  }
  const pass = mono("ferry-pass-alone"), ps = stats("ferry-pass-alone");
  if (pass && ps) {
    const h = ps.momentCues.find((c) => c.kind === "ferry" && c.variant === 1);
    if (h) {
      const t0 = h.at + MOMENT_PAD + LIMITER_DELAY_S, cents = [];
      // The horn's upper note (the lower one's second harmonic lies clear of it), through its hold.
      for (let t = 0.3; t <= 2.6; t += 0.15) cents.push(1200 * Math.log2(lineAt(pass.x, pass.rate, t0 + t - 0.06, 0.12, HORN_HZ[1] * 0.94, HORN_HZ[1] * 1.06, 0.2) / HORN_HZ[1]));
      const hi = Math.max(...cents), lo = Math.min(...cents);
      console.log(`ferry-pass: the horn's ${HORN_HZ[1]} Hz note every 150 ms through its hold: ${cents.map((c) => c.toFixed(0)).join(", ")} cents; it moves ${(hi - lo).toFixed(0)} cents in all (under a semitone)${flag(hi - lo < 100 && hi - lo > 5)}`);
    }
  }
}

// ── The church's flock ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const st = stats("church-flock");
  if (st) {
    const lasts = momentSpan(3, "church").lasts;
    const flaps = st.momentCues.filter((c) => c.kind === "flock" && c.variant === 0).map((c) => c.at - 2).sort((a, b) => a - b), laps = st.momentCues.filter((c) => c.kind === "flock" && c.variant === 1).map((c) => c.at - 2);
    // Every flap on a step of the picture's wing frames (seven a second).
    const off = Math.max(...flaps.map((t) => Math.abs(t * 7 - Math.round(t * 7)) / 7));
    const gaps = laps.slice(1).map((t, i) => t - laps[i]);
    console.log(`church-flock: ${flaps.length} wingbeats in ${lasts} s (${(flaps.length / lasts).toFixed(2)} a second; five birds at 1.75 each give 8.75)${flag(Math.abs(flaps.length / lasts - 8.75) < 0.2)}; each within ${(1000 * off).toFixed(1)} ms of a step of the picture's wing frames${flag(off < 0.002)}; the first at ${flaps[0].toFixed(3)} s`);
    console.log(`  ripples: ${laps.length} laps, ${Math.min(...gaps).toFixed(2)}–${Math.max(...gaps).toFixed(2)} s apart${flag(Math.min(...gaps) >= 1.19 && Math.max(...gaps) <= 2.01)}`);
    const marks = row("church-flock")?.marks ?? [];
    const lift = marks.find((x) => x.name === "the lift"), circling = marks.find((x) => x.name === "circling");
    if (lift && circling) console.log(`  levels: the lift ${lift.lufs} LUFS from its first beat (target −30 at 60 cells; nothing of the picture's fade)${flag(Math.abs(lift.lufs + 30) <= 1.5)}; circling ${circling.lufs} LUFS (${(lift.lufs - circling.lufs).toFixed(1)} LU down: 12 dB by design, and no clatter)`);
  }
}

process.exit(failed ? 1 : 0);
