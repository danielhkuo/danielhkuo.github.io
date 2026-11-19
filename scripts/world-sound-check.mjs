// Listens to rendered sound so a person (or a critic) does not have to trust it blind: for each WAV, loudness, peaks,
// clipping, DC, stereo balance and correlation, the biggest sample-to-sample jumps, suspected clicks, and a
// spectrogram. Writes report.json and an index.html contact sheet (players, spectrograms, numbers) beside the WAVs.
//
//   node scripts/world-sound-check.mjs <dir | file.wav ...>
//
// A WAV may come with <name>.onsets.json: a list of seconds where the sound means to start sharply (a bell strike, a
// chuff). Suspected clicks within 6 ms of one are not counted. Needs ffmpeg on the PATH (spectrograms, EBU R128).

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

function median(xs) {
  const s = Float64Array.from(xs).sort();
  return s.length ? s[s.length >> 1] : 0;
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
 */
function clicks(mono, sampleRate, onsets) {
  const P = 24, B = 2048;
  const found = [];
  const e = new Float64Array(B);
  for (let from = P; from + B <= mono.length; from += B) {
    const a = lpc(mono, from - P, B + P, P);
    if (!a) continue;
    for (let i = 0; i < B; i++) {
      const n = from + i;
      let pred = 0;
      for (let k = 1; k <= P; k++) pred += a[k] * mono[n - k];
      e[i] = mono[n] - pred;
    }
    const abs = Float64Array.from(e, Math.abs).sort();
    const sigma = 1.4826 * abs[B >> 1];
    for (let i = 0; i < B; i++) {
      const v = Math.abs(e[i]);
      if (v < 2e-4 || v < 6.5 * sigma) continue;
      const t = (from + i) / sampleRate;
      if (onsets.some((o) => t - o > -0.003 && t - o < 0.012)) continue;
      const ratio = sigma > 0 ? v / sigma : Infinity;
      const last = found[found.length - 1];
      if (last && t - last.t < 0.02) {
        if (ratio > last.ratio) Object.assign(last, { t, ratio });
        continue;
      }
      found.push({ t, ratio });
    }
  }
  return found.map((c) => ({ t: round(c.t, 4), ratio: round(c.ratio, 1) }));
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
  return {
    file: path.basename(file),
    about,
    seconds: round(l.length / sampleRate, 2),
    sampleRate,
    lufs: loud.lufs,
    lra: loud.lra,
    loudnessSteps: steps(loud.momentary),
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
    clicks: suspects,
    spectrogram: path.basename(png),
  };
}

function page(rows) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const cards = rows
    .map(
      (r) => `<section><h2>${esc(r.file)}</h2>${r.about ? `<p>${esc(r.about)}</p>` : ""}
<audio controls preload="none" src="${esc(r.file)}"></audio>
<p>${r.seconds} s · ${r.lufs ?? "?"} LUFS · LRA ${r.lra ?? "?"} · true peak ${r.truePeakDb ?? "?"} dBFS · peak ${r.peakDb.join(" / ")} dBFS ·
rms ${r.rmsDb.join(" / ")} dBFS · clipped ${r.clipped} · corr ${r.correlation} · L−R ${r.balanceDb} dB · silent ${Math.round(r.silentShare * 100)} %
· M steps +${r.loudnessSteps.rise}/−${r.loudnessSteps.fall} LU · clicks ${r.clicks.length}${r.clicks.length ? ` (${r.clicks.slice(0, 8).map((c) => `${c.t}s ×${c.ratio}`).join(", ")})` : ""}</p>
${curve(r.momentary, r.seconds)}
<img src="${esc(r.spectrogram)}" alt="Spectrogram of ${esc(r.file)}" width="1400"></section>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>World sound check</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;background:#f0e8d2;color:#2e2a24}section{margin:0 0 32px}
h2{font-size:16px;margin:0 0 6px}audio{width:480px}img{display:block;max-width:100%;image-rendering:auto;margin-top:6px}</style>
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
      `${r.file.padEnd(32)} ${String(r.lufs).padStart(6)} LUFS  tp ${String(r.truePeakDb).padStart(6)}  clip ${r.clipped}  corr ${r.correlation}  clicks ${r.clicks.length}`,
    );
  }
  console.log(`report: ${path.join(dir, "index.html")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
