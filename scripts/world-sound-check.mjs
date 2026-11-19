// Listens to rendered sound so a person (or a critic) does not have to trust it blind: for each WAV, loudness, peaks,
// clipping, DC, stereo balance and correlation, the biggest sample-to-sample jumps, suspected clicks, and a
// spectrogram. Writes report.json and an index.html contact sheet (players, spectrograms, numbers) beside the WAVs.
//
//   node scripts/world-sound-check.mjs <dir | file.wav ...>
//
// A WAV may come with <name>.onsets.json: a list of seconds where the sound means to start sharply (a bell strike, a
// chuff). Suspected clicks within 6 ms of one are not counted. Needs ffmpeg on the PATH (spectrograms, EBU R128).
//
// It may also come with <name>.stats.json, the render's own stats (scripts/world-sound.mjs writes it). From it the
// checker takes `limiterMinDb` (the scene fails when the safety limiter worked by more than 0.5 dB) and `marks`
// (stretches { name, t0, t1 } measured on their own: loudness, momentary mean and max, left/right balance).
//
// Every scene is held to the design's §9.1: no clipped sample, true peak ≤ −4.5 dBTP, |DC| < 0.001, no click outside
// the onsets, correlation ≥ −0.05, limiter idle. What fails is listed in `fails`.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

// ── WAV ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Channels as Float32Array, from PCM 16/24/32 or float 32/64, plain or extensible. */
export function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV");
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      let format = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (format === 0xfffe) format = buf.readUInt16LE(body + 24);
      fmt = { format, channels, sampleRate, bits };
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, buf.length - body) };
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV without fmt or data");
  const { format, channels, sampleRate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.size / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const p = data.start + (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) v = buf.readFloatLE(p);
      else if (format === 3 && bits === 64) v = buf.readDoubleLE(p);
      else if (bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (bits === 24) v = (buf.readUInt8(p) | (buf.readUInt8(p + 1) << 8) | (buf.readInt8(p + 2) << 16)) / 8388608;
      else if (bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else throw new Error(`unsupported WAV: format ${format}, ${bits} bits`);
      out[c][i] = v;
    }
  }
  return { sampleRate, channels: out };
}

// ── Measures ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x, k = 2) => (Number.isFinite(x) ? Number(x.toFixed(k)) : x);

function channelStats(x) {
  let peak = 0, sum = 0, sum2 = 0, clipped = 0, jump = 0, jumpAt = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sum += v;
    sum2 += v * v;
    if (i > 0) {
      const d = Math.abs(v - x[i - 1]);
      if (d > jump) {
        jump = d;
        jumpAt = i;
      }
    }
  }
  const n = x.length || 1;
  return { peak, rms: Math.sqrt(sum2 / n), dc: sum / n, clipped, jump, jumpAt };
}


/** Linear-prediction coefficients a[1..p] of x[from, from+len) (Hann-windowed autocorrelation, Levinson–Durbin). */
function lpc(x, from, len, p) {
  const r = new Float64Array(p + 1);
  const w = new Float64Array(len);
  for (let i = 0; i < len; i++) w[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let i = k; i < len; i++) s += w[i] * w[i - k];
    r[k] = s;
  }
  r[0] *= 1 + 1e-9;
  if (r[0] <= 1e-20) return null;
  const a = new Float64Array(p + 1);
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / err;
    const prev = a.slice();
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = prev[j] - k * prev[i - j];
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
}

/**
 * Suspected clicks, found the way restoration tools find them: each 2048-sample block is whitened by its own
 * order-24 linear predictor, and a sample whose prediction error stands more than 6.5 robust deviations (and more than
 * 2·10⁻⁴) above the block's is a discontinuity the signal's own colour does not explain. A broadband impulse or a
 * step shows; wind, surf and tones do not. A bell strike or a chuff shows too, which is what the onsets file is for.
 *
 * A block whose level changes a great deal inside it (a fade to digital silence, a sound rising out of it) has a
 * median that speaks for its quiet part only, so its loud part's ordinary samples stand "above" it. So a suspect must
 * also stand 6.5 deviations above its own neighbourhood (the 128 errors either side of it, itself and its 4 nearest
 * left out): a click is one sample among ordinary neighbours; a fade is not. Suspects that pass the block test and
 * fail this one are returned apart, as `faded`, so they can still be looked at.
 */
function clicks(mono, sampleRate, onsets) {
  const P = 24, B = 2048, NEAR = 128, SKIP = 4;
  const found = [];
  const faded = [];
  const e = new Float64Array(B);
  const hood = new Float64Array(2 * NEAR);
  const nearSilence = silenceEdges(mono, sampleRate);
  const note = (list, t, ratio) => {
    const last = list[list.length - 1];
    if (last && t - last.t < 0.02) {
      if (ratio > last.ratio) Object.assign(last, { t, ratio });
      return;
    }
    list.push({ t, ratio });
  };
  // Starts and stops out of digital silence are judged by how abruptly the level moves, not by prediction: there the
  // predictor has nothing to learn from on one side, so it flags clean fades and misses hard cuts of noise.
  for (const a of abrupt(mono, sampleRate)) {
    if (onsets.some((o) => a.t - o > -0.003 && a.t - o < 0.012)) continue;
    found.push({ t: a.t, ratio: a.jumpDb, kind: a.kind });
  }
  for (let from = P; from + B <= mono.length; from += B) {
    const a = lpc(mono, from - P, B + P, P);
    if (!a) continue;
    const err = (n) => {
      let pred = 0;
      for (let k = 1; k <= P; k++) pred += a[k] * mono[n - k];
      return mono[n] - pred;
    };
    for (let i = 0; i < B; i++) e[i] = err(from + i);
    const abs = Float64Array.from(e, Math.abs).sort();
    const sigma = 1.4826 * abs[B >> 1];
    for (let i = 0; i < B; i++) {
      const v = Math.abs(e[i]);
      if (v < 2e-4 || v < 6.5 * sigma) continue;
      if (nearSilence[from + i] === 1) continue;
      const t = (from + i) / sampleRate;
      if (onsets.some((o) => t - o > -0.003 && t - o < 0.012)) continue;
      // Its neighbourhood, whitened by the same predictor (reaching into the next blocks where it must).
      let m = 0;
      for (let d = -NEAR - SKIP; d <= NEAR + SKIP; d++) {
        if (d >= -SKIP && d <= SKIP) continue;
        const n = from + i + d;
        if (n < P || n >= mono.length) continue;
        hood[m++] = Math.abs(n >= from && n < from + B ? e[n - from] : err(n));
      }
      const local = 1.4826 * hood.subarray(0, m).sort()[m >> 1];
      const ratio = sigma > 0 ? v / sigma : Infinity;
      if (m > NEAR && v < 6.5 * local) note(faded, t, local > 0 ? v / local : Infinity);
      else note(found, t, ratio);
    }
  }
  // One event may be found by both tests: keep one entry per 20 ms, the strongest, with its kind if it has one.
  const tidy = (list) =>
    list
      .slice()
      .sort((x, y) => x.t - y.t)
      .reduce((acc, c) => {
        const last = acc[acc.length - 1];
        if (last && c.t - last.t < 0.02) {
          if (c.kind && !last.kind) last.kind = c.kind;
          if (c.ratio > last.ratio) last.ratio = c.ratio;
          return acc;
        }
        acc.push({ ...c });
        return acc;
      }, [])
      .map((c) => ({ t: round(c.t, 4), ratio: round(c.ratio, 1), ...(c.kind ? { kind: c.kind } : {}) }));
  return { found: tidy(found), faded: tidy(faded) };
}

/** 1 for every sample within 30 ms of a run of at least 5 ms of digital silence (|x| < 1e-6). */
function silenceEdges(mono, sampleRate) {
  const run = Math.round(sampleRate * 0.005), reach = Math.round(sampleRate * 0.03);
  const out = new Uint8Array(mono.length);
  let start = -1;
  const mark = (a, b) => {
    for (let i = Math.max(0, a - reach); i < Math.min(mono.length, b + reach); i++) out[i] = 1;
  };
  for (let i = 0; i <= mono.length; i++) {
    const quiet = i < mono.length && Math.abs(mono[i]) < 1e-6;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if (i - start >= run) mark(start, i);
      start = -1;
    }
  }
  return out;
}

/**
 * Hard starts and stops. With the level of 1 ms windows (dBFS, floored at −90): a start is a window more than 20 dB
 * above every one of the 10 before it, and within 10 dB of where the level is 20 ms later; a stop is the mirror. Both
 * above −60 dBFS. A clean fade climbs a few dB a millisecond and is never flagged; a sound cut in or out at full level
 * always is. Looking 10 ms back (not one window) keeps a strong low tone, whose 1 ms windows dip at each zero
 * crossing, from passing for a start.
 */
function abrupt(mono, sampleRate) {
  const W = Math.max(8, Math.round(sampleRate * 0.001));
  const n = Math.floor(mono.length / W);
  const level = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let s2 = 0;
    for (let i = w * W; i < (w + 1) * W; i++) s2 += mono[i] * mono[i];
    level[w] = Math.max(-90, db(Math.sqrt(s2 / W)));
  }
  const most = (a, b) => {
    let m = -Infinity;
    for (let k = Math.max(0, a); k < Math.min(n, b); k++) if (level[k] > m) m = level[k];
    return m;
  };
  const out = [];
  for (let w = 10; w + 20 < n; w++) {
    const before = most(w - 10, w);
    if (level[w] - before > 20 && level[w] > -60 && level[w] >= level[w + 20] - 10) {
      out.push({ t: (w * W) / sampleRate, jumpDb: level[w] - before, kind: "hard start" });
      continue;
    }
    if (w < 21) continue;
    const after = most(w, w + 10);
    if (level[w - 1] - after > 20 && level[w - 1] > -60 && level[w - 1] >= level[w - 21] - 10) {
      out.push({ t: (w * W) / sampleRate, jumpDb: level[w - 1] - after, kind: "hard stop" });
    }
  }
  return out;
}

/** Correlation of the two channels over the whole file, and the share of 50 ms windows that are near silent. */
function stereo(l, r) {
  let sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < l.length; i++) {
    sl += l[i] * l[i];
    sr += r[i] * r[i];
    slr += l[i] * r[i];
  }
  return { correlation: sl && sr ? slr / Math.sqrt(sl * sr) : 1, balanceDb: db(Math.sqrt(sl / l.length)) - db(Math.sqrt(sr / r.length)) };
}

function silentShare(mono, sampleRate) {
  const W = Math.round(sampleRate * 0.05);
  let quiet = 0, all = 0;
  for (let s = 0; s + W <= mono.length; s += W) {
    let s2 = 0;
    for (let i = s; i < s + W; i++) s2 += mono[i] * mono[i];
    if (db(Math.sqrt(s2 / W)) < -60) quiet++;
    all++;
  }
  return all ? quiet / all : 1;
}

function ffmpegLoudness(file) {
  // ebur128 prints its summary on stderr.
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"], {
    encoding: "utf8",
  });
  return parseLoudness(`${run.stdout ?? ""}${run.stderr ?? ""}`);
}

function parseLoudness(text) {
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const num = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  // Momentary loudness (400 ms window) every 100 ms: the shape of every fade and swell.
  const momentary = [];
  for (const m of text.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+)/g)) momentary.push([Number(m[1]), Number(m[2])]);
  return {
    lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/),
    lra: num(/LRA:\s+(-?[\d.]+) LU/),
    truePeakDb: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/),
    momentary,
  };
}

/** The largest rise and fall of momentary loudness from one 100 ms step to the next, above −50 LUFS. */
function steps(momentary) {
  let rise = 0, fall = 0;
  for (let i = 1; i < momentary.length; i++) {
    // The first 400 ms only fill the meter's window.
    if (momentary[i - 1][0] < 0.45) continue;
    const [, a] = momentary[i - 1];
    const [, b] = momentary[i];
    if (a < -50 && b < -50) continue;
    const d = Math.max(b, -50) - Math.max(a, -50);
    if (d > rise) rise = d;
    if (-d > fall) fall = -d;
  }
  return { rise: round(rise, 1), fall: round(fall, 1) };
}

/** A small SVG line of momentary loudness, −60 to 0 LUFS. */
function curve(momentary, seconds) {
  const W = 1400, H = 120;
  const pts = momentary
    .map(([t, m]) => `${((t / seconds) * W).toFixed(1)},${(((Math.min(0, Math.max(-60, m)) / -60) * H)).toFixed(1)}`)
    .join(" ");
  const grid = [-12, -24, -36, -48]
    .map((v) => `<line x1="0" x2="${W}" y1="${(v / -60) * H}" y2="${(v / -60) * H}" stroke="#c9bd9f" stroke-width="1"/><text x="4" y="${(v / -60) * H - 2}" font-size="10" fill="#7a6f5c">${v}</text>`)
    .join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Momentary loudness">${grid}<polyline fill="none" stroke="#b5452c" stroke-width="1.5" points="${pts}"/></svg>`;
}

function spectrogram(file, png) {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-lavfi", "showspectrumpic=s=1400x480:mode=separate:color=intensity:scale=log:fscale=log:legend=1:gain=1", png],
    { stdio: "ignore" },
  );
}

/** x through a second-order Butterworth high-pass at `lo` and low-pass at `hi`: the mid band, where a whoosh lives. */
function midBand(x, sampleRate, lo = 450, hi = 2500) {
  const out = new Float32Array(x.length);
  const coef = (hz, high) => {
    const w = (2 * Math.PI * hz) / sampleRate, cs = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
    const a0 = 1 + al;
    const b = high ? [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2] : [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
    return { b: b.map((v) => v / a0), a1: (-2 * cs) / a0, a2: (1 - al) / a0 };
  };
  const h = coef(lo, true), g = coef(hi, false);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = h.b[0] * x[i] + h.b[1] * x1 + h.b[2] * x2 - h.a1 * y1 - h.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    const v = g.b[0] * y + g.b[1] * u1 + g.b[2] * u2 - g.a1 * v1 - g.a2 * v2;
    u2 = u1; u1 = y; v2 = v1; v1 = v;
    out[i] = v;
  }
  return out;
}

/**
 * Each mark measured on its own: integrated loudness of the stretch, its momentary mean and max, its L−R balance, and
 * the balance and level of its mid band alone (450 Hz–2.5 kHz).
 */
function measureMarks(file, marks, l, r, sampleRate, momentary) {
  const ml = midBand(l, sampleRate), mr = midBand(r, sampleRate);
  return marks.map((m) => {
    const a = Math.max(0, Math.round(m.t0 * sampleRate)), b = Math.min(l.length, Math.round(m.t1 * sampleRate));
    let sl = 0, sr = 0, tl = 0, tr = 0;
    for (let i = a; i < b; i++) {
      sl += l[i] * l[i];
      sr += r[i] * r[i];
      tl += ml[i] * ml[i];
      tr += mr[i] * mr[i];
    }
    const run = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-ss", String(m.t0), "-t", String(m.t1 - m.t0), "-i", file, "-filter_complex", "ebur128", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const loud = parseLoudness(`${run.stdout ?? ""}${run.stderr ?? ""}`);
    // Momentary readings whose 400 ms window lies inside the mark (or, for a short mark, ends inside it).
    const from = m.t1 - m.t0 > 0.5 ? m.t0 + 0.4 : m.t0 + 0.2;
    const inside = momentary.filter(([t]) => t >= from - 1e-6 && t <= m.t1 + 1e-6).map(([, v]) => v);
    const mean = inside.length ? inside.reduce((x, y) => x + y, 0) / inside.length : null;
    return {
      name: m.name, t0: m.t0, t1: m.t1,
      lufs: loud.lufs,
      momentaryMean: mean === null ? null : round(mean, 1),
      momentaryMax: inside.length ? round(Math.max(...inside), 1) : null,
      balanceDb: round(db(Math.sqrt(sl)) - db(Math.sqrt(sr))),
      midBalanceDb: round(db(Math.sqrt(tl)) - db(Math.sqrt(tr))),
      midDb: round(db(Math.sqrt((tl + tr) / (2 * Math.max(1, b - a))))),
    };
  });
}

/** The checks of §9.1 that hold for every scene. */
function everySceneFails(row) {
  const fails = [];
  if (row.clipped > 0) fails.push(`${row.clipped} clipped samples`);
  if (row.truePeakDb !== null && row.truePeakDb > -4.5) fails.push(`true peak ${row.truePeakDb} dBTP over −4.5`);
  if (row.dc.some((d) => Math.abs(d) >= 0.001)) fails.push(`DC ${row.dc.join(" / ")}`);
  if (row.clicks.length) fails.push(`${row.clicks.length} clicks`);
  if (row.correlation < -0.05) fails.push(`correlation ${row.correlation}`);
  const lim = row.stats?.limiterMinDb;
  if (typeof lim === "number" && lim < -0.5) fails.push(`limiter worked ${lim} dB`);
  return fails;
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkWav(file) {
  const { sampleRate, channels } = readWav(readFileSync(file));
  const l = channels[0];
  const r = channels[1] ?? channels[0];
  const mono = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mono[i] = 0.5 * (l[i] + r[i]);
  const onsetsFile = file.replace(/\.wav$/i, ".onsets.json");
  const onsets = existsSync(onsetsFile) ? JSON.parse(readFileSync(onsetsFile, "utf8")) : [];
  const aboutFile = file.replace(/\.wav$/i, ".about.txt");
  const about = existsSync(aboutFile) ? readFileSync(aboutFile, "utf8").trim() : "";
  const per = channels.map(channelStats);
  const png = file.replace(/\.wav$/i, ".png");
  spectrogram(file, png);
  const st = stereo(l, r);
  const loud = ffmpegLoudness(file);
  const suspects = clicks(mono, sampleRate, onsets);
  const statsFile = file.replace(/\.wav$/i, ".stats.json");
  const stats = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, "utf8")) : null;
  const marks = stats?.marks?.length ? measureMarks(file, stats.marks, l, r, sampleRate, loud.momentary) : [];
  const momentaryMax = loud.momentary.reduce((m, [t, v]) => (t >= 0.45 && v > m ? v : m), -Infinity);
  const row = {
    file: path.basename(file),
    about,
    seconds: round(l.length / sampleRate, 2),
    sampleRate,
    lufs: loud.lufs,
    lra: loud.lra,
    loudnessSteps: steps(loud.momentary),
    momentaryMax: round(momentaryMax, 1),
    momentary: loud.momentary.map(([t, m]) => [round(t, 1), round(m, 1)]),
    truePeakDb: loud.truePeakDb,
    peakDb: per.map((c) => round(db(c.peak))),
    rmsDb: per.map((c) => round(db(c.rms))),
    dc: per.map((c) => round(c.dc, 5)),
    clipped: per.reduce((a, c) => a + c.clipped, 0),
    biggestJump: per.map((c) => ({ size: round(c.jump, 4), t: round(c.jumpAt / sampleRate, 3) })),
    correlation: round(st.correlation, 3),
    balanceDb: round(st.balanceDb),
    silentShare: round(silentShare(mono, sampleRate), 3),
    onsets: onsets.length,
    clicks: suspects.found,
    /** Suspects a block's median flagged that their own neighbourhood explains (a fade): not counted, kept to look at. */
    fadeSuspects: suspects.faded,
    spectrogram: path.basename(png),
    stats,
    marks,
  };
  return { ...row, fails: everySceneFails(row) };
}

function page(rows) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cards = rows
    .map(
      (r) => `<section><h2>${esc(r.file)}</h2>${r.about ? `<p>${esc(r.about)}</p>` : ""}
<audio controls preload="none" src="${esc(r.file)}"></audio>
<p>${r.seconds} s · ${r.lufs ?? "?"} LUFS · LRA ${r.lra ?? "?"} · true peak ${r.truePeakDb ?? "?"} dBFS · peak ${r.peakDb.join(" / ")} dBFS ·
rms ${r.rmsDb.join(" / ")} dBFS · clipped ${r.clipped} · corr ${r.correlation} · L−R ${r.balanceDb} dB · silent ${Math.round(r.silentShare * 100)} %
· M steps +${r.loudnessSteps.rise}/−${r.loudnessSteps.fall} LU · clicks ${r.clicks.length}${r.clicks.length ? ` (${r.clicks.slice(0, 8).map((c) => `${c.t}s ×${c.ratio}`).join(", ")})` : ""}
· limiter ${r.stats?.limiterMinDb ?? "?"} dB${r.stats ? ` · ${esc(r.stats.mode ?? "")}${r.stats.browser ? ` in ${esc(r.stats.browser)}` : ""}` : ""}</p>
${r.fails?.length ? `<p><strong>Fails:</strong> ${esc(r.fails.join("; "))}</p>` : ""}
${r.marks?.length ? `<table>${r.marks.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.t0}–${m.t1} s</td><td>${m.lufs ?? "?"} LUFS</td><td>M mean ${m.momentaryMean ?? "?"}, max ${m.momentaryMax ?? "?"}</td><td>L−R ${m.balanceDb} dB</td><td>mid band ${m.midDb} dBFS, L−R ${m.midBalanceDb} dB</td></tr>`).join("")}</table>` : ""}
${curve(r.momentary, r.seconds)}
<img src="${esc(r.spectrogram)}" alt="Spectrogram of ${esc(r.file)}" width="1400"></section>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>World sound check</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;background:#f0e8d2;color:#2e2a24}section{margin:0 0 32px}
h2{font-size:16px;margin:0 0 6px}audio{width:480px}table{border-collapse:collapse;margin:4px 0}td{padding:1px 12px 1px 0}img{display:block;max-width:100%;image-rendering:auto;margin-top:6px}</style>
<h1>World sound check</h1>${cards}`;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: node scripts/world-sound-check.mjs <dir | file.wav ...>");
    process.exit(2);
  }
  const files = args.flatMap((a) =>
    statSync(a).isDirectory()
      ? readdirSync(a)
          .filter((f) => f.toLowerCase().endsWith(".wav"))
          .map((f) => path.join(a, f))
      : [a],
  );
  const rows = files.map(checkWav);
  const dir = statSync(args[0]).isDirectory() ? args[0] : path.dirname(files[0]);
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(rows, null, 2));
  writeFileSync(path.join(dir, "index.html"), page(rows));
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(32)} ${String(r.lufs).padStart(6)} LUFS  tp ${String(r.truePeakDb).padStart(6)}  clip ${r.clipped}  corr ${r.correlation}  clicks ${r.clicks.length}` +
        `${r.fails.length ? `  FAIL: ${r.fails.join("; ")}` : ""}`,
    );
  }
  console.log(`report: ${path.join(dir, "index.html")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
