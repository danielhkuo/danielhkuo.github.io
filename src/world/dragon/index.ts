// The dragon: the long, wingless river-dragon in vermilion lacquer with a gold belly and mane (study A, chosen by the
// owner on 2026-11-18). Its body follows the head's path through a chain; it is drawn as sprite stacks over the land.

import { hash2 } from "../core/hash.ts";
import type { ViewRect } from "../render/compose.ts";
import { gradeRgb } from "../render/palette.ts";
import { createChain } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { sunOn, type Air } from "../sky/air.ts";
import { STACK_SHADOW_KEEP } from "../runtime/stack.ts";
import { WAVE_PERIOD, waveRate, type Pose } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import { imageOn, type Land } from "./parts.ts";
import { drawRiver } from "./river.ts";

/**
 * The dragon keeps some of its own light: of each colour's fall from its daylight self to the land's light, the share
 * it is spared, by day's low light and at full dark. Lacquer never goes brown in a red sunset. At night the lacquer is
 * its own red, only deeper (never the tan a blue light would mix it to), and its gold (mane, belly, tips) glows.
 */
const SPARE_BODY: readonly [number, number] = [0.3, 0.86];
const SPARE_GOLD: readonly [number, number] = [0.35, 0.92];
/** At full dark the lacquer it keeps is dimmed to this share of its daylight; the gold is not. */
const NIGHT_LACQUER = 0.86;
/** How far each kind of piece is turned to the light: its highlights catch the sun's colour, its darks the shade's. */
const LIT_HIGH = 1;
const LIT_MID = 0.75;
const LIT_LOW = 0.35;
/**
 * The light it throws on the ground at night: not a disc (warm light veiled over blue ground only greys it) but a
 * scatter of gold glints under its head, short dashes that stay where they are on the ground and light as it passes.
 * Half-width of the scatter in pixels, the strength (of 256) of a glint at its middle, and the gold, packed RGBA.
 */
const POOL = 18;
const POOL_ALPHA = 185;
const POOL_LIGHT = 0xff70c4ff;
/** Of eight ground cells, how many glint at the middle, midway and at the edge of the scatter. */
const POOL_SHARE: readonly number[] = [1, 1, 2];
const POOL_SEED = 0x51de;

/** Steps the light is cut into for the dragon's colours: each step builds its pieces again, so they are kept few. */
const STEPS = 64;

function mixRgb(a: number, b: number, t: number): number {
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
  const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
  return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

function dimmed(c: number, k: number): number {
  return (0xff000000 | (Math.round(((c >>> 16) & 255) * k) << 16) | (Math.round(((c >>> 8) & 255) * k) << 8) | Math.round((c & 255) * k)) >>> 0;
}

/** The lacquer in this air: graded as the land is, each piece by how it faces the light, overcast and mist softened, and spared some of the dark. */
export function lookIn(air: Air): Look {
  const o = { time: air.time, season: air.season, overcast: air.overcast * 0.6, mist: air.mist * 0.5 };
  const lit = (c: number, spare: readonly [number, number], facing: number, dim = 1): number =>
    mixRgb(gradeRgb(c, o, facing), dim === 1 ? c : dimmed(c, dim), spare[0] + (spare[1] - spare[0]) * air.night);
  const L = LACQUER, B = SPARE_BODY, G = SPARE_GOLD, d = 1 - (1 - NIGHT_LACQUER) * air.night;
  return {
    bodyLight: lit(L.bodyLight, B, LIT_HIGH, d), body: lit(L.body, B, LIT_MID, d), bodyDark: lit(L.bodyDark, B, LIT_LOW, d),
    scale: lit(L.scale, B, LIT_LOW, d), belly: lit(L.belly, G, LIT_HIGH), bellyDark: lit(L.bellyDark, G, LIT_LOW),
    mane: lit(L.mane, G, LIT_MID), maneLight: lit(L.maneLight, G, LIT_HIGH), maneDark: lit(L.maneDark, G, LIT_LOW),
    tip: lit(L.tip, G, LIT_HIGH), wing: lit(L.wing, B, LIT_MID, d), wingDark: lit(L.wingDark, B, LIT_LOW, d), ink: lit(L.ink, [0, 0], LIT_LOW),
  };
}

/** The gold glints the dragon's glow lights on the ground under its head, at darkness `night`. */
function drawPool(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land, n: number, night: number): void {
  const strength = POOL_ALPHA * night;
  if (strength < 8) return;
  const g = view.groundHeight(s.x, s.y);
  const cx = imageOn(Math.round(s.x), rect.x, n, rect.w, POOL + 1);
  const cy = imageOn(Math.round(0.8 * s.y - g), rect.y, n * 0.8, rect.h, POOL + 1);
  const ry = POOL * 0.8;
  const lr = POOL_LIGHT & 255, lg = (POOL_LIGHT >>> 8) & 255, lb = (POOL_LIGHT >>> 16) & 255;
  for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(rect.h - 1, Math.floor(cy + ry)); y++) {
    const dy = (y - cy) / ry;
    for (let x = Math.max(0, Math.ceil(cx - POOL)); x <= Math.min(rect.w - 1, Math.floor(cx + POOL)); x++) {
      const dx = (x - cx) / POOL, d = 1 - (dx * dx + dy * dy);
      if (d <= 0) continue;
      // A glint is a dash two pixels long, fixed to the ground.
      if ((hash2((x + rect.x) >> 1, y + rect.y, POOL_SEED) & 7) >= POOL_SHARE[d > 0.6 ? 2 : d > 0.25 ? 1 : 0]) continue;
      const a = (strength * (0.45 + 0.55 * d)) | 0, inv = 256 - a;
      const i = y * rect.w + x, dst = out[i];
      const r = ((dst & 255) * inv + lr * a) >> 8;
      const gg = (((dst >>> 8) & 255) * inv + lg * a) >> 8;
      const b = (((dst >>> 16) & 255) * inv + lb * a) >> 8;
      out[i] = (0xff000000 | (b << 16) | (gg << 8) | r) >>> 0;
    }
  }
}

export { WAVE_PERIOD };
/** Points of path remembered: enough for the whole body at a crawl. */
const PATH = 640;

export interface Dragon {
  /** Call once a frame, after the flight step: remembers the path and moves the body's clocks on by dt seconds. */
  step(s: FlightState, dt: number): void;
  /** Draws the dragon at the flier, with its shadow, depth-tested against the land. */
  draw(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land): void;
  /** Colours the dragon for this air (cheap when the light has not moved a step), and lights its glow at night. */
  setAir(air: Air): void;
  pose: Pose;
}

/** The dragon on a world n cells across. Its motion depends only on the states and times it is stepped with. */
export function createDragon(n: number): Dragon {
  const pose: Pose = { chain: createChain(n, PATH), n, time: 0, wave: 0 };
  let look: Look = LACQUER;
  let lookKey = -1;
  let night = 0;
  let shadowKeep = STACK_SHADOW_KEEP;
  return {
    pose,
    setAir(air) {
      night = air.night;
      // Its shadow needs the sun, as a cloud's does: gone in rain and mist, faint by moonlight.
      shadowKeep = Math.round(256 - (256 - STACK_SHADOW_KEEP) * sunOn(air));
      // The light in steps, as a number (cheaper each frame than a string); cloud and rain do not colour the dragon.
      const key = ((Math.round(air.time * STEPS) * 9 + Math.round(air.season * 8)) * 9 + Math.round(air.overcast * 8)) * 9 + Math.round(air.mist * 8);
      if (key === lookKey) return;
      lookKey = key;
      const plain = air.night === 0 && air.overcast === 0 && air.mist === 0 && Math.abs(air.time - 0.5) < 0.14;
      look = plain ? LACQUER : lookIn({ ...air, time: Math.round(air.time * STEPS) / STEPS });
    },
    step(s, dt) {
      pose.chain.push(s.x, s.y, s.alt);
      pose.time += dt;
      // The wave quickens with speed, so a boost tightens the undulation.
      pose.wave += waveRate(s.speed) * dt;
    },
    draw(out, rect, s, view) {
      if (night > 0) drawPool(out, rect, s, view, n, night);
      drawRiver(out, rect, s, view, pose, look, shadowKeep);
    },
  };
}

/**
 * A dragon that has flown straight along `s.heading` for `distance` cells and arrived at `s`, with its body laid out
 * behind it and its undulation at time `time`: for tools that draw single frames.
 */
export function flownDragon(n: number, s: FlightState, time = 0, distance = 160): Dragon {
  const dragon = createDragon(n);
  const dx = Math.cos(s.heading), dy = Math.sin(s.heading);
  for (let k = distance; k >= 0; k--) {
    const x = (((s.x - dx * k) % n) + n) % n, y = (((s.y - dy * k) % n) + n) % n;
    dragon.step({ ...s, x, y }, 1 / CRUISE);
  }
  dragon.pose.time = time;
  dragon.pose.wave = (time * 2 * Math.PI) / WAVE_PERIOD;
  return dragon;
}
