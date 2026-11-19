// A wave's shape (design §4.3). Two parts:
//
//   the gains    one buffer per shore kind at the context's own sample rate, its four channels the levels of the
//                wave's parts over time: 0 low (rumble, boom), 1 mid (crash, body), 2 high (hiss, spray), 3 band (the
//                shingle's rattle, or the rock's slosh). One source into a splitter into the emitter's gains. Played
//                at its own rate: a buffer played off-rate is resampled sample by sample, and that was most of what a
//                wave cost the audio thread.
//   the glides   where each of the emitter's four filters sits over the wave, as a few points (seconds, cents about
//                ENV_BASE) that the engine writes as ramps when the wave starts, on an emitter that is free.
//
// A wave's strength (1, 2, 3) sets its level (8, 4, 0 dB down, applied on the emitter's chain) and how low its crash
// and rumble sit; its shape is the same. The noise it shapes is fresh every wave.

import { WAVE_PERIOD } from "../../live/water.ts";
import { K_SURF } from "../levels.ts";
import { anchorU, BEACH, lastsOf, leadOf, ROCK, SHINGLE } from "../schedule/waves.ts";

export const ENV_CHANNELS = 4;
/** The frequencies (Hz) the emitter's four filters sit at when their detune is 0. */
export const ENV_BASE = { low: 200, mid: 800, high: 2500, band: 3600 };
/** A wave's level by strength (1, 2, 3), dB. */
export const STRENGTH_DB: readonly number[] = [0, -8, -4, 0];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const cents = (hz: number, base: number) => 1200 * Math.log2(hz / base);

/** What a beach wave's hiss and body settle to between breaks, as shares of their peaks: the fizz of foam, and the wash under it. */
const FIZZ = 0.11;
const WASH = 0.04;
/** How strongly the picture draws a middling wave: the hiss's decay is set by it for every strength. */
const A_MID = 0.78;

/** The gains of a wave of `kind` (1 beach, 2 shingle, 3 rock): four channels at `sampleRate`, each starting and ending at 0. */
export function envelope(kind: number, sampleRate: number): Float32Array[] {
  const lasts = lastsOf(kind), lead = leadOf(kind);
  const n = Math.round(lasts * sampleRate);
  const ch = Array.from({ length: ENV_CHANNELS }, () => new Float32Array(n));
  const u0 = anchorU(kind) - lead / WAVE_PERIOD;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const u = u0 + t / WAVE_PERIOD;
    /** Seconds after the picture's event (negative before it). */
    const after = t - lead;
    // Every part is faded in over the first 0.1 s and to nothing at the end (slowly on a beach: the fizz leaves gently).
    const edge = ease(t / 0.1) * ease((lasts - t) / (kind === BEACH ? 0.9 : 0.3));
    let low = 0, mid = 0, high = 0, band = 0;
    if (kind === BEACH) {
      // Rumble: grows as the crest steepens (t² from u = 0.2), peaks as it breaks, dies over half a second.
      const rise = clamp01((u - 0.2) / 0.3);
      low = after < 0 ? rise * rise : Math.exp(-after / 0.5);
      // Crash: a soft-edged break that travels along the beach (0.38 s in), settling to a wash.
      mid = after < 0 ? ease((after + 0.38) / 0.38) : WASH + (1 - WASH) * Math.exp(-after / 0.6);
      // Hiss: the foamy sheet running up the sand, then the backwash; foam keeps fizzing until the next wave.
      const peak = (0.55 - 0.5) * WAVE_PERIOD;
      high = after < peak ? ease((after + 0.3) / (peak + 0.3)) : FIZZ + (1 - FIZZ) * Math.exp(-(after - peak) / (0.9 * (0.6 + 0.4 * A_MID)));
      low *= K_SURF.beach[0];
      mid *= K_SURF.beach[1];
      high *= K_SURF.beach[2];
    } else if (kind === SHINGLE) {
      // The break as on sand but shorter, then the backwash dragging stones: a rattle that swells and falls away.
      const rise = clamp01((u - 0.3) / 0.1);
      low = after < 0 ? rise * rise : Math.exp(-after / 0.4);
      mid = after < 0 ? ease((after + 0.3) / 0.3) : Math.exp(-after / 0.45);
      const peak = 0.06 * WAVE_PERIOD;
      high = after < peak ? ease((after + 0.25) / (peak + 0.25)) : Math.exp(-(after - peak) / (0.45 * (0.6 + 0.4 * A_MID)));
      // Silent to u = 0.52, fullest at 0.70, gone by 0.95.
      band = u < 0.52 ? 0 : u < 0.7 ? ease((u - 0.52) / 0.18) : ease((0.95 - u) / 0.25);
      low *= K_SURF.shingle[0];
      mid *= K_SURF.shingle[1];
      high *= K_SURF.shingle[2];
      band *= K_SURF.shingle[3];
    } else if (kind === ROCK) {
      // A dark swell closes in, nearly silent; the boom as the water slams (40 ms in); spray thrown up, hissing back.
      const surge = 0.04 * clamp01((u - 0.3) / 0.1);
      low = after < 0 ? surge : after < 0.04 ? surge + (1 - surge) * ease(after / 0.04) : Math.exp(-(after - 0.04) / 0.45);
      mid = after < 0 ? 0 : after < 0.06 ? ease(after / 0.06) : Math.exp(-(after - 0.06) / 0.3);
      const up = 0.1 * WAVE_PERIOD;
      high = after < 0 ? 0 : after < up ? ease(after / up) : Math.exp(-(after - up) / 0.7);
      // The gully draining: slosh from u = 0.55 to 0.95.
      band = u < 0.55 ? 0 : ease((u - 0.55) / 0.08) * ease((0.97 - u) / 0.2);
      low *= K_SURF.rock[0];
      mid *= K_SURF.rock[1];
      high *= K_SURF.rock[2];
      band *= K_SURF.rock[4];
    }
    ch[0][i] = low * edge;
    ch[1][i] = mid * edge;
    ch[2][i] = high * edge;
    ch[3][i] = band * edge;
  }
  for (const c of ch) {
    c[0] = 0;
    c[n - 1] = 0;
  }
  return ch;
}

/** Where a filter sits over a wave: (seconds from the wave's start, cents about its base), in time order. */
export type Glide = readonly (readonly [number, number])[];

export interface Glides {
  low: Glide;
  mid: Glide;
  high: Glide;
  band: Glide;
}

/** The filter glides of a wave of `kind` and `strength`: a few points each, straight lines in log frequency between. */
export function glides(kind: number, strength: number): Glides {
  const s = strength - 1;
  const lasts = lastsOf(kind), lead = leadOf(kind);
  const u0 = anchorU(kind) - lead / WAVE_PERIOD;
  /** Seconds from the wave's start at which the picture is at u. */
  const at = (u: number) => Math.min(lasts, Math.max(0, (u - u0) * WAVE_PERIOD));
  if (kind === BEACH) {
    return {
      // Bigger waves plunge, and plunging is lower.
      low: [[0, cents([260, 200, 150][s], ENV_BASE.low)]],
      mid: [[at(0.35), cents(500, ENV_BASE.mid)], [at(0.5), cents([1100, 850, 650][s], ENV_BASE.mid)]],
      // The sheet thins and its hiss rises: 1.2 kHz to 3 kHz up the sand, on to 4.5 kHz through the backwash.
      high: [[at(0.5), cents(1200, ENV_BASE.high)], [at(0.62), cents(3000, ENV_BASE.high)], [at(0.97), cents(4500, ENV_BASE.high)]],
      band: [[0, 0]],
    };
  }
  if (kind === SHINGLE) {
    return {
      low: [[0, cents([240, 190, 150][s], ENV_BASE.low)]],
      mid: [[at(0.3), cents(600, ENV_BASE.mid)], [at(0.4), cents([1100, 900, 750][s], ENV_BASE.mid)]],
      high: [[at(0.4), cents(1200, ENV_BASE.high)], [at(0.52), cents(3200, ENV_BASE.high)]],
      // The bigger stones move last: 5 kHz down to 2.6 kHz.
      band: [[at(0.52), cents(5000, ENV_BASE.band)], [at(0.95), cents(2600, ENV_BASE.band)]],
    };
  }
  // Rock. The slosh's band wanders between about 300 and 800 Hz as the gully drains.
  const wander: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const u = 0.55 + (0.42 * k) / 12;
    wander.push([at(u), cents(500 * Math.pow(1.6, Math.sin(2 * Math.PI * (u - 0.55) * 3.1) * 0.9), ENV_BASE.band)]);
  }
  return {
    low: [[0, cents(110, ENV_BASE.low)]],
    mid: [[lead, cents(520, ENV_BASE.mid)], [lead + 0.5, cents(380, ENV_BASE.mid)]],
    high: [[0, cents(2800, ENV_BASE.high)]],
    band: wander,
  };
}

/** The value of a glide at `t` seconds into the wave (held before its first point and after its last). */
export function glideAt(g: Glide, t: number): number {
  if (t <= g[0][0]) return g[0][1];
  for (let i = 1; i < g.length; i++) {
    if (t <= g[i][0]) return g[i - 1][1] + ((g[i][1] - g[i - 1][1]) * (t - g[i - 1][0])) / (g[i][0] - g[i - 1][0]);
  }
  return g[g.length - 1][1];
}

/** The name the kit keeps a kind's envelope under. */
export function envelopeName(kind: number): string {
  return `env${kind}`;
}
