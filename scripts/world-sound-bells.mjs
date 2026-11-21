// Measures the abbey's bells and the reverb from the bench's renders, against the design (spec §4.6, §5.2, §6.1):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/world-sound-bells.mjs [--dir .cache/world-sound]
//
// It reads `bell-stroke-dry.wav` (one stroke of the tenor, no reverb): each partial's frequency (cents from the
// design), its T60 (against the table), the beat of each doublet, and the ring's last two seconds. `reverb-impulse.wav`
// (one sample into the send bus): the response's T60 and its early taps. `bells-near.stats.json` and
// `bells-rejoin.stats.json`: when each bell enters, the hour's count, strokes doubled. Exit code 1 when a figure is
// outside its tolerance: partials ±10 cents, T60s ±25 %, the reverb's T60 2.2 s ±0.25, taps within 2 ms (the right
// ear hears each tap up to 1.4 ms after the left).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIMITER_DELAY_S } from "../src/world/sound/levels.ts";
import { BELL_PAD, bellDesign, RING_S, RING_TAIL_S, TENOR } from "../src/world/sound/synth/bells.ts";
import { IR_T60, IR_TAPS, measuredT60 } from "../src/world/sound/synth/ir.ts";
import { readWav } from "./world-sound-check.mjs";

const args = process.argv.slice(2);
const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : ".cache/world-sound";
const SEED = 3;
let failed = false;
const flag = (ok) => {
  if (!ok) failed = true;
  return ok ? "" : "  FAIL";
};

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

const wav = (name) => {
  const file = path.join(dir, `${name}.wav`);
  if (!existsSync(file)) return null;
  const w = readWav(readFileSync(file));
  const mono = new Float32Array(w.channels[0].length);
  for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (w.channels[0][i] + w.channels[1][i]);
  return { rate: w.sampleRate, mono, channels: w.channels };
};

/** The envelope of x round `hz` (complex demodulation, smoothed twice over `smooth` seconds), `per` values a second, from sample `from`. */
function envelope(x, rate, hz, from, seconds, smooth, per = 200) {
  const n = Math.min(x.length - from, Math.round(seconds * rate));
  const re = new Float64Array(n), im = new Float64Array(n);
  const w = (2 * Math.PI * hz) / rate;
  for (let i = 0; i < n; i++) {
    re[i] = x[from + i] * Math.cos(w * i);
    im[i] = -x[from + i] * Math.sin(w * i);
  }
  const box = (a) => {
    const k = Math.max(1, Math.round(smooth * rate));
    const out = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += a[i];
      if (i >= k) acc -= a[i - k];
      out[i] = acc / Math.min(i + 1, k);
    }
    return out;
  };
  const r2 = box(box(re)), i2 = box(box(im));
  const step = Math.round(rate / per);
  const out = [];
  // Each value is the level over the window that ends there: its time is the window's middle.
  for (let i = 0; i < n; i += step) out.push({ t: i / rate - smooth, e: 2 * Math.hypot(r2[i], i2[i]) });
  return out;
}

/** Seconds to fall 60 dB, from a straight-line fit to the envelope in decibels over [t0, t1]. */
function t60Of(env, t0, t1) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of env) {
    if (p.t < t0 || p.t > t1 || !(p.e > 0)) continue;
    const y = 20 * Math.log10(p.e);
    n++;
    sx += p.t;
    sy += y;
    sxx += p.t * p.t;
    sxy += p.t * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { t60: -60 / slope, at0: (sy - slope * sx) / n };
}

/** The period of the envelope's beat, seconds: the first peak of the autocorrelation of its level about its own decay. */
function beatOf(env, t0, t1, fit) {
  const pts = env.filter((p) => p.t >= t0 && p.t <= t1 && p.e > 0);
  const dt = pts.length > 1 ? pts[1].t - pts[0].t : 1;
  const y = pts.map((p) => p.e * p.e / Math.pow(10, (fit.at0 - (60 / fit.t60) * p.t) / 10));
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  for (let i = 0; i < y.length; i++) y[i] -= mean;
  const ac = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < y.length; i++) s += y[i] * y[i + lag];
    return s / (y.length - lag);
  };
  const a0 = ac(0);
  let lag = 1;
  // Past the first dip, the highest point.
  while (lag < y.length / 2 && ac(lag) > 0) lag++;
  let best = -1, bestV = 0;
  for (let l = lag; l < y.length / 2; l++) {
    const v = ac(l);
    if (v > bestV) {
      bestV = v;
      best = l;
    }
  }
  return best > 0 && bestV > 0.2 * a0 ? { period: best * dt, depth: Math.sqrt(2 * a0) } : null;
}

// ── One stroke: partials, decays, beats, the tail ────────────────────────────────────────────────────────────────────

const dry = wav("bell-stroke-dry");
if (!dry) console.log(`no bell-stroke-dry.wav in ${dir}`);
else {
  const design = bellDesign(SEED, TENOR);
  const rate = dry.rate;
  // The stroke is half a second in; its buffer starts with a pad; the limiter delays everything.
  const onset = Math.round((0.5 + BELL_PAD + LIMITER_DELAY_S) * rate);
  const usable = RING_S[TENOR] - 2 * BELL_PAD - RING_TAIL_S;
  console.log(`bell-stroke-dry: the tenor, nominal ${design.nominal.toFixed(2)} Hz (design 660 ±12 cents)`);
  console.log("  partial          design Hz   found Hz   cents   level dB  T60 design  found    beat design  found");
  const N = 1 << 20;
  let doublets = 0;
  for (const p of design.partials) {
    // Frequency: the spectrum of the stroke under a window that falls from 1 to 0, as long as the partial lasts.
    const span = Math.min(usable, Math.max(0.6, 2.5 * p.t60));
    const n = Math.round(span * rate);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < n; i++) re[i] = dry.mono[onset + i] * (0.5 + 0.5 * Math.cos((Math.PI * i) / n));
    fft(re, im);
    const bin = rate / N;
    const lo = Math.floor((p.hz * Math.pow(2, -60 / 1200)) / bin), hi = Math.ceil((p.hz * Math.pow(2, 60 / 1200)) / bin);
    let peak = lo;
    const pow = (k) => re[k] * re[k] + im[k] * im[k];
    for (let k = lo; k <= hi; k++) if (pow(k) > pow(peak)) peak = k;
    // A doublet is two lines: the partial is their centre of power.
    const half = Math.ceil((Math.max(1.5, 2 * p.split) + 2 / span) / bin);
    let num = 0, den = 0;
    for (let k = peak - half; k <= peak + half; k++) {
      num += k * bin * pow(k);
      den += pow(k);
    }
    const found = num / den;
    const cents = 1200 * Math.log2(found / p.hz);
    // Decay: the partial's own envelope, fitted over the stretch in which it falls 40 dB (or all there is of it).
    const smooth = 0.04;
    const env = envelope(dry.mono, rate, p.hz, onset, usable, smooth);
    const until = Math.min(usable - 0.1, Math.max(0.3, 0.667 * p.t60));
    let fit = t60Of(env, 0.06, until);
    const beat = p.split > 0 ? beatOf(env, 0.06, Math.min(usable - 0.1, Math.max(until, 4 / p.split)), fit) : null;
    // A doublet's beat rides on its decay (a deep one all but silences the partial once a beat), so its decay is
    // read from the partial's level over whole beats: one window a beat long after another, by the measured beat.
    if (beat) {
      const n = Math.round(beat.period * rate), first = onset + Math.round(0.06 * rate);
      const windows = Math.min(8, Math.floor((usable - 0.1) / beat.period));
      const level = (from) => {
        let re = 0, im = 0;
        const w = (2 * Math.PI * p.hz) / rate;
        for (let i = 0; i < n; i++) {
          re += dry.mono[from + i] * Math.cos(w * i);
          im += dry.mono[from + i] * Math.sin(w * i);
        }
        return 20 * Math.log10((2 * Math.hypot(re, im)) / n);
      };
      if (windows >= 2) {
        // Windows that still hold the partial (it has not fallen more than 45 dB), fitted with a straight line.
        const pts = [];
        for (let k = 0; k < windows; k++) pts.push({ t: (k + 0.5) * beat.period, e: Math.pow(10, level(first + k * n) / 20) });
        const kept = pts.filter((q) => q.e > pts[0].e * 0.0056);
        if (kept.length >= 2) fit = { ...t60Of(kept, 0, Infinity), at0: fit.at0 };
      }
    }
    if (beat) doublets++;
    const okHz = Math.abs(cents) <= 10, okT = Math.abs(fit.t60 / p.t60 - 1) <= 0.25;
    console.log(
      `  ${p.name.padEnd(15)} ${p.hz.toFixed(2).padStart(9)}  ${found.toFixed(2).padStart(9)}  ${cents.toFixed(1).padStart(6)}  ${(20 * Math.log10(Math.pow(10, fit.at0 / 20))).toFixed(1).padStart(8)}` +
        `  ${p.t60.toFixed(2).padStart(9)}  ${fit.t60.toFixed(2).padStart(6)}   ${p.split > 0 ? `${(1 / p.split).toFixed(2)} s`.padStart(10) : "         —"}  ${beat ? `${beat.period.toFixed(2)} s` : p.split > 0 ? "(none found)" : "—"}` +
        `${flag(okHz && okT)}`,
    );
  }
  console.log(`  beating doublets found: ${doublets}${flag(doublets >= 2)}`);
  // The tail: level every quarter second over the ring's last stretch, and after it.
  const end = 0.5 + RING_S[TENOR] + LIMITER_DELAY_S;
  const level = (t0, t1) => {
    let s = 0;
    const a = Math.round(t0 * rate), b = Math.min(dry.mono.length, Math.round(t1 * rate));
    for (let i = a; i < b; i++) s += dry.mono[i] * dry.mono[i];
    return b > a && s > 0 ? 10 * Math.log10(s / (b - a)) : -Infinity;
  };
  const rows = [];
  for (let t = end - 2.5; t < end + 0.5 - 1e-9; t += 0.25) rows.push(`${(t - end).toFixed(2)} s ${level(t, t + 0.25) === -Infinity ? "silence" : `${level(t, t + 0.25).toFixed(1)} dB`}`);
  console.log(`  the ring's end (level by quarter second, against the buffer's end): ${rows.join("; ")}`);
  const before = level(end - 2.25, end - 2), last = level(end - 0.25, end), after = level(end + 0.05, end + 0.5);
  console.log(`  the last 1.5 s falls ${(before - last).toFixed(1)} dB to its final quarter second; after the ring: ${after === -Infinity ? "digital silence" : `${after.toFixed(1)} dB`}${flag(before - last > 30 && after < -110)}`);
}

// ── The reverb's response ────────────────────────────────────────────────────────────────────────────────────────────

const imp = wav("reverb-impulse");
if (!imp) console.log(`no reverb-impulse.wav in ${dir}`);
else {
  const rate = imp.rate;
  const onset = Math.round((0.5 + LIMITER_DELAY_S) * rate);
  console.log("reverb-impulse: one sample into the send bus, through the convolver and the master chain");
  imp.channels.forEach((c, ear) => {
    const h = c.subarray(onset, onset + Math.round(2.5 * rate));
    const t60 = measuredT60(h, rate);
    // The taps: the four samples that stand furthest above the response round them (the 30 ms either side).
    const half = Math.round(0.03 * rate);
    const sq = new Float64Array(h.length + 1);
    for (let i = 0; i < h.length; i++) sq[i + 1] = sq[i] + h[i] * h[i];
    const above = (i) => {
      const a = Math.max(0, i - half), b = Math.min(h.length, i + half + 1);
      const rest = (sq[b] - sq[a] - h[i] * h[i]) / (b - a - 1);
      return rest > 0 ? Math.abs(h[i]) / Math.sqrt(rest) : 0;
    };
    const first = Math.round(0.1 * rate);
    const order = Array.from({ length: h.length - first }, (_, k) => k + first).sort((a, b) => above(b) - above(a));
    const taps = [];
    for (const i of order) {
      if (taps.length === 4) break;
      if (taps.every((j) => Math.abs(i - j) > 0.02 * rate)) taps.push(i);
    }
    taps.sort((a, b) => a - b);
    const times = taps.map((i) => i / rate);
    const okTaps = times.every((t, k) => Math.abs(t - IR_TAPS[k][0]) < 0.002);
    let e = 0;
    for (const v of h) e += v * v;
    console.log(
      `  ${ear === 0 ? "left " : "right"}: T60 ${t60.toFixed(2)} s (design ${IR_T60})${flag(Math.abs(t60 - IR_T60) <= 0.25)}; early taps at ${times.map((t) => `${(t * 1000).toFixed(1)} ms`).join(", ")}` +
        ` (design ${IR_TAPS.map((t) => `${t[0] * 1000}`).join(", ")} ms)${flag(okTaps)}; energy ${(10 * Math.log10(e)).toFixed(2)} dB re the impulse`,
    );
  });
}

// ── The peal and the hour ────────────────────────────────────────────────────────────────────────────────────────────

for (const name of ["bells-near", "bells-twelve", "bells-rejoin", "hide-show-bells", "stall-bells", "abbey-approach"]) {
  const file = path.join(dir, `${name}.stats.json`);
  if (!existsSync(file)) continue;
  const st = JSON.parse(readFileSync(file, "utf8"));
  const strokes = st.strokes ?? [];
  const firsts = [0, 1, 2, 3, 4].map((b) => {
    const mine = strokes.filter((s) => s.bell === b && s.offset === 0);
    return mine.length ? Math.min(...mine.map((s) => s.at)) : null;
  });
  const hour = strokes.filter((s) => s.bell === 5);
  const hours = [...new Set(hour.map((s) => s.H))];
  const count = hours.map((H) => `hour ${H} (strikes ${((H + 11) % 12) + 1}): ${new Set(hour.filter((s) => s.H === H).map((s) => s.k)).size} strokes at ${hour.filter((s) => s.H === H).map((s) => s.at.toFixed(1)).join(", ")} s`);
  const okCount = hours.every((H) => new Set(hour.filter((s) => s.H === H).map((s) => s.k)).size === ((H + 11) % 12) + 1 || (name !== "bells-near" && name !== "bells-twelve"));
  const seen = new Map();
  let doubled = 0;
  for (const s of strokes) {
    const key = `${s.H}:${s.bell}:${s.k}`;
    const prev = seen.get(key);
    if (prev !== undefined && s.at - prev < 10 && !(st.stops ?? []).some((t) => t > prev - 0.3 && t <= s.at)) doubled++;
    seen.set(key, s.at);
  }
  console.log(`${name}: ${strokes.filter((s) => s.offset === 0).length} strokes struck, ${strokes.filter((s) => s.offset > 0).length} rings joined in progress; doubled ${doubled}${flag(doubled === 0)}`);
  if (firsts.some((t) => t !== null)) console.log(`  each bell's first stroke from its top, treble to tenor: ${firsts.map((t) => (t === null ? "—" : `${t.toFixed(2)} s`)).join(", ")}`);
  if (count.length) console.log(`  ${count.join("; ")}${flag(okCount)}`);
}

process.exit(failed ? 1 : 0);
