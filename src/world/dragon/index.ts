// The dragon: the long, wingless river-dragon in vermilion lacquer with a gold belly and mane (study A, chosen by the
// owner on 2026-11-18). Its body follows the head's path through a chain; it is drawn as sprite stacks over the land.

import type { ViewRect } from "../render/compose.ts";
import { gradeRgb } from "../render/palette.ts";
import { createChain } from "../runtime/chain.ts";
import { CRUISE, type FlightState } from "../runtime/flight.ts";
import { sunOn, type Air } from "../sky/air.ts";
import { STACK_SHADOW_KEEP } from "../runtime/stack.ts";
import { WAVE_PERIOD, waveRate, type Pose } from "./body.ts";
import { LACQUER, type Look } from "./look.ts";
import type { Land } from "./parts.ts";
import { drawRiver } from "./river.ts";

/**
 * The dragon keeps some of its own light: of each colour's fall from its daylight self to the land's light, the share
 * it is spared, by day's low light and at full dark. Lacquer never goes brown in a red sunset. At night it is its own
 * red, only deeper (never the tan a blue light would mix it to), dimmed with the land so it is not pasted on; its
 * gold (mane, belly, tips) is dimmed less, and warmed: the one thing that glows.
 */
const SPARE_BODY: readonly [number, number] = [0.3, 0.86];
const SPARE_GOLD: readonly [number, number] = [0.35, 0.9];
/** At full dark, the share of its daylight the lacquer keeps, and the gold: red, green and blue each, so the gold warms. */
const NIGHT_LACQUER: readonly [number, number, number] = [0.6, 0.56, 0.6];
const NIGHT_GOLD: readonly [number, number, number] = [0.86, 0.74, 0.56];
/** How far each kind of piece is turned to the light: its highlights catch the sun's colour, its darks the shade's. */
const LIT_HIGH = 1;
const LIT_MID = 0.75;
const LIT_LOW = 0.35;

/** Steps the light is cut into for the dragon's colours: each step builds its pieces again, so they are kept few. */
const STEPS = 64;

function mixRgb(a: number, b: number, t: number): number {
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
  const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
  return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** `c` with each channel taken `night` of the way down to its share in `keep`. */
function dimmed(c: number, keep: readonly [number, number, number], night: number): number {
  const r = (c & 255) * (1 - (1 - keep[0]) * night), g = ((c >>> 8) & 255) * (1 - (1 - keep[1]) * night), b = ((c >>> 16) & 255) * (1 - (1 - keep[2]) * night);
  return (0xff000000 | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** The lacquer in this air: graded as the land is, each piece by how it faces the light, overcast and mist softened, and spared some of the dark. */
export function lookIn(air: Air): Look {
  const o = { time: air.time, season: air.season, overcast: air.overcast * 0.6, mist: air.mist * 0.5 };
  const lit = (c: number, spare: readonly [number, number], facing: number, keep: readonly [number, number, number]): number =>
    mixRgb(gradeRgb(c, o, facing), air.night > 0 ? dimmed(c, keep, air.night) : c, spare[0] + (spare[1] - spare[0]) * air.night);
  const L = LACQUER, B = SPARE_BODY, G = SPARE_GOLD, R = NIGHT_LACQUER, Y = NIGHT_GOLD;
  return {
    bodyLight: lit(L.bodyLight, B, LIT_HIGH, R), body: lit(L.body, B, LIT_MID, R), bodyDark: lit(L.bodyDark, B, LIT_LOW, R),
    scale: lit(L.scale, B, LIT_LOW, R), belly: lit(L.belly, G, LIT_HIGH, Y), bellyDark: lit(L.bellyDark, G, LIT_LOW, Y),
    mane: lit(L.mane, G, LIT_MID, Y), maneLight: lit(L.maneLight, G, LIT_HIGH, Y), maneDark: lit(L.maneDark, G, LIT_LOW, Y),
    tip: lit(L.tip, G, LIT_HIGH, Y), wing: lit(L.wing, B, LIT_MID, R), wingDark: lit(L.wingDark, B, LIT_LOW, R), ink: lit(L.ink, [0, 0], LIT_LOW, R),
  };
}

export { WAVE_PERIOD };
/** Points of path remembered: enough for the whole body at a crawl. */
const PATH = 640;

export interface Dragon {
  /** Call once a frame, after the flight step: remembers the path and moves the body's clocks on by dt seconds. */
  step(s: FlightState, dt: number): void;
  /** Draws the dragon at the flier, with its shadow, depth-tested against the land. */
  draw(out: Uint32Array, rect: ViewRect, s: FlightState, view: Land): void;
  /** Colours the dragon for this air (cheap when the light has not moved a step). */
  setAir(air: Air): void;
  pose: Pose;
}

/** The dragon on a world n cells across. Its motion depends only on the states and times it is stepped with. */
export function createDragon(n: number): Dragon {
  const pose: Pose = { chain: createChain(n, PATH), n, time: 0, wave: 0 };
  let look: Look = LACQUER;
  let lookKey = -1;
  let shadowKeep = STACK_SHADOW_KEEP;
  return {
    pose,
    setAir(air) {
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
