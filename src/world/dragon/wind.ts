// The wind of a boost: thin pale streaks that peel off the dragon's flanks and slip back along its path, and a faint
// bow of air ahead of its snout. Both grow in as the speed rises above cruising and fade out as it falls back. They
// are a function of the pose's clocks alone (no state of their own), so the same flight draws the same wind.

import { mix32 } from "../core/hash.ts";
import type { ViewRect } from "../render/compose.ts";
import type { Joint } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { smooth } from "./body.ts";
import { rgb } from "./look.ts";
import { imageOn, type Land } from "./parts.ts";

/** Pale air: paper white, a little cool so it is not the dragon's cream. */
const AIR = rgb(240, 244, 236);
const AIR_R = AIR & 255, AIR_G = (AIR >>> 8) & 255, AIR_B = (AIR >>> 16) & 255;
/** Streaks alive at once, and the opacity (of 256) of the strongest pixel of one at full boost. */
const STREAKS = 12;
const STREAK_ALPHA = 215;
/** A streak lives this long (seconds, least and spread), slipping TRAVEL cells back along the body as it goes. */
const LIFE = 0.7;
const LIFE_SPREAD = 0.3;
const TRAVEL = 26;
/** Where along the body streaks are shed (cells of path behind the head), and how long they are. */
const SHED_FROM = 3;
const SHED_SPAN = 31;
const LENGTH = 10;
const LENGTH_SPREAD = 8;
/** How far off the body's flank a streak starts, and how far it drifts outwards over its life, cells. */
const FLANK = 3.5;
const FLANK_SPREAD = 3;
const DRIFT = 2;
/** No streak is drawn farther back along the path than this, cells. */
export const WIND_BACK = 69;
/** The bow: its nose this far ahead of the head, swept back to BOW_HALF either side, at most BOW_ALPHA of 256. */
const BOW_NOSE = 12.5;
const BOW_HALF = 4.7;
const BOW_SWEEP = 0.2;
const BOW_ALPHA = 120;
/** Speed, as a multiple of cruising, at which the wind starts to show, and the further span over which it grows in. */
const WIND_FROM = 1.05;
const WIND_SPAN = 0.5;

/** How strongly the wind shows at `speed`: 0 at cruising speed and below, 1 at a full boost. */
export function windAmount(speed: number): number {
  return smooth((speed / CRUISE - WIND_FROM) / WIND_SPAN);
}

const MAX_JOINTS = 96;
const jx = new Float64Array(MAX_JOINTS), jy = new Float64Array(MAX_JOINTS), ja = new Float64Array(MAX_JOINTS);
const jsin = new Float64Array(MAX_JOINTS), jcos = new Float64Array(MAX_JOINTS);

/** A number in [0, 1) from a streak's slot and the count of lives it has had, and which of its traits is asked for. */
function chance(slot: number, life: number, trait: number): number {
  return mix32((Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(life + 1, 0x85ebca6b) ^ Math.imul(trait + 1, 0xc2b2ae35)) >>> 0) / 4294967296;
}

/**
 * Draws the wind of a boost under the dragon: call it after the shadow and before the body. `joints` are the path's
 * points every `spacing` cells behind the head (reaching WIND_BACK), `time` and `wave` the pose's clocks, `waveRate`
 * the wave's speed (radians a second), and `sway(d, phase)` the body's swing to the right, d cells behind the head,
 * when the wave there is at `phase`. Nothing is drawn farther than `reach` pixels from the head, or at cruising speed.
 */
export function drawWind(
  out: Uint32Array, rect: ViewRect, view: Land, s: FlightState, joints: readonly Joint[], spacing: number, n: number,
  time: number, wave: number, waveRate: number, wavenumber: number, sway: (d: number, phase: number) => number, reach: number,
): void {
  const amount = windAmount(s.speed);
  if (amount <= 0) return;
  const fw = rect.w, fh = rect.h, yPeriod = n * 0.8, half = n / 2;
  const bake0 = Math.round(s.y * 0.8 - s.alt);
  const sx0 = imageOn(Math.round(s.x), rect.x, n, fw, 2), sy0 = imageOn(bake0, rect.y, yPeriod, fh, 2);
  const row0 = s.y + Math.round((rect.y + sy0 - bake0) / yPeriod) * n;
  const reach2 = reach * reach;
  const count = Math.min(joints.length, MAX_JOINTS);
  for (let j = 0; j < count; j++) {
    const jt = joints[j];
    let dx = (jt.x - s.x) % n;
    if (dx > half) dx -= n;
    else if (dx < -half) dx += n;
    let dy = (jt.y - s.y) % n;
    if (dy > half) dy -= n;
    else if (dy < -half) dy += n;
    jx[j] = dx;
    jy[j] = dy;
    ja[j] = jt.alt - s.alt;
    jsin[j] = Math.sin(jt.heading);
    jcos[j] = Math.cos(jt.heading);
  }
  const back = Math.min(WIND_BACK, (count - 1) * spacing - 0.01);

  // One pixel of air at (dx, dy) cells and `up` units from the head, `alpha` of 256 opaque.
  let lastX = -1, lastY = -1;
  const dot = (dx: number, dy: number, up: number, alpha: number): void => {
    const px = sx0 + Math.floor(dx + 0.5), py = sy0 + Math.floor(0.8 * dy - up + 0.5);
    if (px === lastX && py === lastY) return;
    lastX = px;
    lastY = py;
    if (px < 0 || py < 0 || px >= fw || py >= fh || alpha <= 0) return;
    const ox = px - sx0, oy = py - sy0;
    if (ox * ox + oy * oy > reach2) return;
    if (view.depthAt(px, py) > row0 + dy + 1) return;
    const i = py * fw + px, dst = out[i];
    const r = dst & 255, g = (dst >>> 8) & 255, b = (dst >>> 16) & 255;
    out[i] = (0xff000000
      | ((b + (((AIR_B - b) * alpha) >> 8)) << 16) | ((g + (((AIR_G - g) * alpha) >> 8)) << 8) | (r + (((AIR_R - r) * alpha) >> 8))) >>> 0;
  };

  for (let slot = 0; slot < STREAKS; slot++) {
    const span = LIFE + LIFE_SPREAD * chance(slot, 0, 0);
    const clock = time / span + chance(slot, 0, 1);
    const life = Math.floor(clock), age = clock - life;
    // Grows in over its first quarter, and is gone by its end.
    const shown = smooth(age / 0.25) * (1 - smooth((age - 0.35) / 0.65));
    const peak = STREAK_ALPHA * amount * shown;
    if (peak < 6) continue;
    const side = chance(slot, life, 2) < 0.5 ? -1 : 1;
    const shed = SHED_FROM + SHED_SPAN * chance(slot, life, 3);
    const length = (LENGTH + LENGTH_SPREAD * chance(slot, life, 4)) * (0.5 + 0.5 * amount);
    // It keeps the place in the air where the flank was when it was shed, and drifts a little wider.
    const flank = sway(shed, wave - waveRate * age * span - shed * wavenumber)
      + side * (FLANK + FLANK_SPREAD * chance(slot, life, 5) + DRIFT * age);
    const front = shed + TRAVEL * age;
    lastX = -1;
    for (let d = front; d < front + length && d < back; d += 0.5) {
      const at = d / spacing, j = Math.floor(at), f = at - j;
      const u = (d - front) / length;
      // Soft at its leading end, strongest just behind it, thinning to nothing at its tail.
      const alpha = peak * Math.min(1, (d - front) / 2 + 0.3) * (1 - u * u);
      dot(
        jx[j] + (jx[j + 1] - jx[j]) * f - jsin[j] * flank,
        jy[j] + (jy[j + 1] - jy[j]) * f + jcos[j] * flank,
        ja[j] + (ja[j + 1] - ja[j]) * f,
        alpha | 0,
      );
    }
  }

  // The bow: one arc of pressed air ahead of the snout, swept back, strongest at its nose.
  const hs = Math.sin(s.heading), hc = Math.cos(s.heading);
  lastX = -1;
  for (let w = -BOW_HALF; w <= BOW_HALF; w += 0.5) {
    const u = w / BOW_HALF, ahead = BOW_NOSE - BOW_SWEEP * w * w;
    dot(ahead * hc - w * hs, ahead * hs + w * hc, 0, (BOW_ALPHA * amount * (1 - u * u)) | 0);
  }
}
