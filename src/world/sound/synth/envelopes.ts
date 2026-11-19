// A wave's shape, prerendered (design §4.3): one buffer per shore kind and strength, its channels the gains and the
// filter glides of the wave's parts as functions of time. Played like the control signals (3000 Hz buffers at a
// tenth of the speed), one source into a splitter into the emitter's gains and detunes. The noise it shapes is fresh
// every wave; only this shape repeats, as it does on a real beach.
//
// Channels: 0 low gain (rumble, boom), 1 mid gain (crash, body), 2 high gain (hiss, spray), 3 grain gain (the
// shingle's rattle), 4 slosh gain (the rock's gully); 5–8 the detunes, in cents, of the low, mid, high and grain/slosh
// filters about ENV_BASE. Every gain starts and ends at 0.

import { WAVE_PERIOD } from "../../live/water.ts";
import { K_SURF } from "../levels.ts";
import { anchorU, BEACH, lastsOf, leadOf, ROCK, SHINGLE } from "../schedule/waves.ts";
import { CONTROL_HZ } from "./controls.ts";

export const ENV_CHANNELS = 9;
/** The frequencies (Hz) the emitter's four filters sit at when their detune is 0. */
export const ENV_BASE = { low: 200, mid: 800, high: 2500, band: 3600 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const cents = (hz: number, base: number) => 1200 * Math.log2(hz / base);
const db = (x: number) => Math.pow(10, x / 20);
/** A glide in log frequency from a (at x = 0) to b (at x = 1). */
const glide = (a: number, b: number, x: number) => a * Math.pow(b / a, clamp01(x));

/** What a beach wave's hiss and body settle to between breaks, as shares of their peaks: the fizz of foam, and the wash under it. */
const FIZZ = 0.11;
const WASH = 0.04;

/** The envelope of a wave of `kind` (1 beach, 2 shingle, 3 rock) and `strength` (1, 2, 3): its channels, as played. */
export function envelope(kind: number, strength: number): Float32Array[] {
  const lasts = lastsOf(kind), lead = leadOf(kind);
  const n = Math.round(lasts * CONTROL_HZ);
  const ch = Array.from({ length: ENV_CHANNELS }, () => new Float32Array(n));
  const s = strength - 1;
  /** How strongly the picture draws it. */
  const a = [0.5, 0.78, 1][s];
  /** The wave's whole level: 8, 4 and 0 dB down. */
  const level = db([-8, -4, 0][s]);
  const u0 = anchorU(kind) - lead / WAVE_PERIOD;
  for (let i = 0; i < n; i++) {
    const t = i / CONTROL_HZ;
    const u = u0 + t / WAVE_PERIOD;
    /** Seconds after the picture's event (negative before it). */
    const after = t - lead;
    // Every part is faded to nothing over the envelope's last 0.3 s, and in over its first 0.1 s.
    const edge = ease(t / 0.1) * ease((lasts - t) / (kind === BEACH ? 0.9 : 0.3));
    let low = 0, mid = 0, high = 0, grain = 0, slosh = 0;
    let fLow = ENV_BASE.low, fMid = ENV_BASE.mid, fHigh = ENV_BASE.high, fBand = ENV_BASE.band;
    if (kind === BEACH) {
      // Rumble: grows as the crest steepens (t² from u = 0.2), peaks as it breaks, dies over half a second.
      const rise = clamp01((u - 0.2) / 0.3);
      low = after < 0 ? rise * rise : Math.exp(-after / 0.5);
      fLow = [260, 200, 150][s];
      // Crash: a soft-edged break that travels along the beach (0.35 s in), lower the bigger the wave.
      mid = after < 0 ? ease((after + 0.38) / 0.38) : WASH + (1 - WASH) * Math.exp(-after / 0.6);
      fMid = glide(500, [1100, 850, 650][s], (u - 0.35) / 0.15);
      // Hiss: the foamy sheet running up the sand, thinning and rising in pitch, then the backwash's fizz.
      // It does not die away between waves: foam keeps fizzing on the wet sand until the next one runs over it, so the
      // decay settles onto a floor (FIZZ of the peak) that lasts to the envelope's end.
      const peak = (0.55 - 0.5) * WAVE_PERIOD;
      high = after < peak ? ease((after + 0.3) / (peak + 0.3)) : FIZZ + (1 - FIZZ) * Math.exp(-(after - peak) / (0.9 * (0.6 + 0.4 * a)));
      fHigh = u < 0.62 ? glide(1200, 3000, (u - 0.5) / 0.12) : glide(3000, 4500, (u - 0.62) / 0.35);
      low *= K_SURF.beach[0];
      mid *= K_SURF.beach[1];
      high *= K_SURF.beach[2];
    } else if (kind === SHINGLE) {
      // The break as on sand but shorter, then the backwash dragging stones: a rattle that swells and falls in pitch.
      const rise = clamp01((u - 0.3) / 0.1);
      low = after < 0 ? rise * rise : Math.exp(-after / 0.4);
      fLow = [240, 190, 150][s];
      mid = after < 0 ? ease((after + 0.3) / 0.3) : Math.exp(-after / 0.45);
      fMid = glide(600, [1100, 900, 750][s], (u - 0.3) / 0.1);
      const peak = 0.06 * WAVE_PERIOD;
      high = after < peak ? ease((after + 0.25) / (peak + 0.25)) : Math.exp(-(after - peak) / (0.45 * (0.6 + 0.4 * a)));
      fHigh = glide(1200, 3200, (u - 0.4) / 0.12);
      // Silent to u = 0.52, fullest at 0.70, gone by 0.95; the bigger stones move last.
      grain = u < 0.52 ? 0 : u < 0.7 ? ease((u - 0.52) / 0.18) : ease((0.95 - u) / 0.25);
      fBand = glide(5000, 2600, (u - 0.52) / 0.43);
      low *= K_SURF.shingle[0];
      mid *= K_SURF.shingle[1];
      high *= K_SURF.shingle[2];
      grain *= K_SURF.shingle[3];
    } else if (kind === ROCK) {
      // A dark swell closes in, nearly silent; the boom as the water slams (40 ms in); spray thrown up, hissing back.
      const surge = 0.04 * clamp01((u - 0.3) / 0.1);
      low = after < 0 ? surge : after < 0.04 ? surge + (1 - surge) * ease(after / 0.04) : Math.exp(-(after - 0.04) / 0.45);
      fLow = 110;
      mid = after < 0 ? 0 : after < 0.06 ? ease(after / 0.06) : Math.exp(-(after - 0.06) / 0.3);
      fMid = glide(520, 380, after / 0.5);
      const up = 0.1 * WAVE_PERIOD;
      high = after < 0 ? 0 : after < up ? ease(after / up) : Math.exp(-(after - up) / 0.7);
      fHigh = 2800;
      // The gully draining: slosh from u = 0.55 to 0.95, its band wandering between 300 and 800 Hz.
      slosh = u < 0.55 ? 0 : ease((u - 0.55) / 0.08) * ease((0.97 - u) / 0.2);
      fBand = 500 * Math.pow(1.6, Math.sin(2 * Math.PI * (u - 0.55) * 3.1) * 0.9);
      low *= K_SURF.rock[0];
      mid *= K_SURF.rock[1];
      high *= K_SURF.rock[2];
      slosh *= K_SURF.rock[4];
    }
    const g = level * edge;
    ch[0][i] = low * g;
    ch[1][i] = mid * g;
    ch[2][i] = high * g;
    ch[3][i] = grain * g;
    ch[4][i] = slosh * g;
    ch[5][i] = cents(fLow, ENV_BASE.low);
    ch[6][i] = cents(fMid, ENV_BASE.mid);
    ch[7][i] = cents(fHigh, ENV_BASE.high);
    ch[8][i] = cents(fBand, ENV_BASE.band);
  }
  // The gains end exactly at 0.
  for (let c = 0; c < 5; c++) {
    ch[c][0] = 0;
    ch[c][n - 1] = 0;
  }
  return ch;
}

/** The name the kit keeps a wave's envelope under. */
export function envelopeName(kind: number, strength: number): string {
  return `env${kind}${strength}`;
}
