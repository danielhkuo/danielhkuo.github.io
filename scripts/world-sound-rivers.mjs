// Measures the rivers and falls from the bench's renders, against the design (spec §4.4, §4.5):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-sound-rivers.mjs [--dir .cache/world-sound]
//
// The brook's bubbles (their frequencies, from the bed's own making, and where the `brook` render's power lies); the
// rumble under 140 Hz in `fall-tall` and `fall-small`; in `river-to-fall` and `falls-handover`, which falls were
// given a chain and when one took the spare, and the loudness through the half second of that crossfade.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { rngFor } from "../src/world/core/rng.ts";
import { BROOK, bubbleBed, bubbleHz, FLOW } from "../src/world/sound/synth/bubbles.ts";
import { readWav } from "./world-sound-check.mjs";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : ".cache/world-sound";
let failed = false;
const flag = (ok) => {
  if (!ok) failed = true;
  return ok ? "" : "  FAIL";
};

// ── The bubbles, as made ─────────────────────────────────────────────────────────────────────────────────────────────

for (const [name, bed] of [["brook", BROOK], ["flow", FLOW]]) {
  const hz = [];
  let energy = 0, inBand = 0;
  bubbleBed(bed, 8000, rngFor(3, `sound/${name}`), (r, amp) => {
    const f = bubbleHz(r);
    hz.push(f);
    energy += amp * amp;
    if (f >= 600 && f <= 3000) inBand += amp * amp;
  });
  hz.sort((a, b) => a - b);
  const q = (p) => Math.round(hz[Math.min(hz.length - 1, Math.floor(p * hz.length))]);
  const edges = [0, 600, 1000, 1500, 2000, 3000, 4500, 1e9];
  const hist = edges.slice(0, -1).map((lo, i) => `${lo}–${edges[i + 1] > 1e8 ? "" : edges[i + 1]} Hz ${Math.round((100 * hz.filter((f) => f >= lo && f < edges[i + 1]).length) / hz.length)} %`);
  const share = hz.filter((f) => f >= 600 && f <= 3000).length / hz.length;
  console.log(`${name}: ${hz.length} bubbles in ${bed.seconds} s (${bed.rate} a second); frequencies ${q(0)}–${q(0.999)} Hz, quartiles ${q(0.25)} / ${q(0.5)} / ${q(0.75)} Hz`);
  console.log(`  by count: ${hist.join(", ")}`);
  console.log(`  in 600 Hz–3 kHz: ${Math.round(100 * share)} % of the bubbles, ${Math.round((100 * inBand) / energy)} % of their energy${name === "brook" ? flag(share > 0.5) : ""}`);
}

// ── Where a render's power lies ──────────────────────────────────────────────────────────────────────────────────────

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** The level, dBFS, of the render's mono sum in each band [lo, hi) Hz, from t0 to t1. */
function bands(name, list, t0 = 2, t1 = 18) {
  const file = path.join(dir, `${name}.wav`);
  if (!existsSync(file)) return null;
  const w = readWav(readFileSync(file));
  const rate = w.sampleRate, N = 16384;
  const power = new Float64Array(N / 2);
  let frames = 0;
  for (let at = Math.round(t0 * rate); at + N <= Math.min(w.channels[0].length, t1 * rate); at += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = 0.5 * (w.channels[0][at + i] + w.channels[1][at + i]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  // Mean square of a Hann-windowed frame is 3/8 of the signal's: put back.
  const scale = 2 / (frames * N * N * 0.375);
  return list.map(([lo, hi]) => {
    let s = 0;
    for (let k = Math.ceil((lo * N) / rate); k < Math.min(N / 2, (hi * N) / rate); k++) s += power[k];
    return s > 0 ? 10 * Math.log10(s * scale) : -Infinity;
  });
}

const brook = bands("brook", [[20, 600], [600, 3000], [3000, 20000]]);
if (brook) console.log(`brook (render): level under 600 Hz ${brook[0].toFixed(1)} dBFS, 600 Hz–3 kHz ${brook[1].toFixed(1)}, above 3 kHz ${brook[2].toFixed(1)}${flag(brook[1] > brook[0] + 6 && brook[1] > brook[2] + 6)}`);
const tall = bands("fall-tall", [[25, 140], [140, 20000]]), small = bands("fall-small", [[25, 140], [140, 20000]]);
if (tall && small) {
  console.log(`fall-tall: under 140 Hz ${tall[0].toFixed(1)} dBFS, above ${tall[1].toFixed(1)} (the rumble is ${(tall[0] - tall[1]).toFixed(1)} dB against the rest)${flag(tall[0] - tall[1] > -15)}`);
  console.log(`fall-small: under 140 Hz ${small[0].toFixed(1)} dBFS, above ${small[1].toFixed(1)} (${(small[0] - small[1]).toFixed(1)} dB against the rest: no rumble)${flag(small[0] - small[1] < -20)}`);
}

// ── Voices and the handover ──────────────────────────────────────────────────────────────────────────────────────────

/** Momentary loudness (400 ms window, every 100 ms) of a render, by ffmpeg's ebur128. */
function momentary(name) {
  const file = path.join(dir, `${name}.wav`);
  if (!existsSync(file)) return null;
  const text = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr ?? "";
  const out = [];
  for (const m of text.matchAll(/t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)/g)) out.push({ t: Number(m[1]), m: m[2] === "-inf" ? -Infinity : Number(m[2]) });
  return out;
}

for (const name of ["fall-small", "fall-tall", "river-to-fall", "river-to-fall-beds", "falls-handover"]) {
  const file = path.join(dir, `${name}.stats.json`);
  if (!existsSync(file)) continue;
  const st = JSON.parse(readFileSync(file, "utf8"));
  const events = (st.falls ?? []).map((f) => `${f.handover ? "took the spare" : "given a chain"} at ${f.at} s (the fall at ${f.x}, ${f.y})`);
  console.log(`${name}: ${st.fallsBound} falls given a chain, ${st.fallHandovers} handovers${events.length ? `: ${events.join("; ")}` : ""}`);
  if (name === "river-to-fall-beds") {
    // The continuous layers alone: the largest change of momentary loudness from one 100 ms to the next, and when.
    const m = (momentary(name) ?? []).filter((p) => p.t > 1 && Number.isFinite(p.m));
    let up = 0, upAt = 0, down = 0, downAt = 0;
    for (let i = 1; i < m.length; i++) {
      const d = m[i].m - m[i - 1].m;
      if (d > up) [up, upAt] = [d, m[i].t];
      if (-d > down) [down, downAt] = [-d, m[i].t];
    }
    console.log(`  largest momentary step: +${up.toFixed(1)} LU at ${upAt.toFixed(1)} s, −${down.toFixed(1)} LU at ${downAt.toFixed(1)} s${flag(up <= 1.5 && down <= 1.5)}`);
  }
  if (name.startsWith("river-to-fall")) console.log(`  one fall, one voice from the frame's edge to the frame's edge${flag(st.fallsBound === 1 && st.fallHandovers === 0)}`);
  for (const f of (st.falls ?? []).filter((x) => x.handover)) {
    const m = momentary(name);
    if (!m) continue;
    const near = m.filter((p) => p.t >= f.at - 1 && p.t <= f.at + 1.5);
    const during = near.filter((p) => p.t >= f.at && p.t <= f.at + 0.9);
    const before = near.filter((p) => p.t < f.at).map((p) => p.m), lo = Math.min(...during.map((p) => p.m));
    const floor = Math.min(...before);
    console.log(`  the crossfade from ${f.at} s: momentary loudness in the second before ${Math.min(...before).toFixed(1)} … ${Math.max(...before).toFixed(1)} LUFS; through it ${during.map((p) => p.m.toFixed(1)).join(", ")}; lowest ${lo.toFixed(1)} (${(lo - floor).toFixed(1)} LU against the quietest moment before: no hole)${flag(lo > floor - 1)}`);
  }
}

process.exit(failed ? 1 : 0);
