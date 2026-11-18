// Where the clouds are: scattered over the torus from the seed, thinned by a broad
// weather pattern so some regions are clear and some overcast, drifting with one wind.

import { fbm } from "../core/noise.ts";
import { rngFor, type Rng } from "../core/rng.ts";
import { torusDist2 } from "../core/torus.ts";
import type { CloudShape } from "./shapes.ts";

export type CloudLayer = "low" | "bank" | "high";

/** One cloud: its shape (index into the shapes), where it was at t = 0 (cells), its layer, and whether it is mirrored. */
export interface Cloud {
  shape: number;
  x: number;
  y: number;
  layer: CloudLayer;
  flip: boolean;
}

export interface SkyField {
  n: number;
  clouds: Cloud[];
  /** Cells a second; low clouds and banks drift with `wind`, high streaks with `highWind`. */
  wind: { x: number; y: number };
  highWind: { x: number; y: number };
}

/** Height of each layer, in units: it only lifts the sprite on screen (screenY = 0.8·y − alt). */
export const LOW_ALT = 40;
export const BANK_ALT = 60;
export const HIGH_ALT = 140;

/** Banks stay this far apart on the torus, so a view holds one at a time. */
const BANK_GAP = 780;
/** About this many banks on a 6400-wide world; other sizes scale by area. */
const BANKS_AT_6400 = 38;

function modN(v: number, n: number): number {
  const m = v % n;
  return m < 0 ? m + n : m;
}

function wrapDrift(pos: number, vel: number, t: number, n: number): number {
  return modN(pos + modN(vel * t, n), n);
}

function indices(shapes: readonly CloudShape[], kind: CloudShape["kind"]): number[] {
  const out: number[] = [];
  for (let i = 0; i < shapes.length; i++) if (shapes[i].kind === kind) out.push(i);
  return out;
}

function pick(rng: Rng, pool: readonly number[]): number {
  return pool[rng.int(pool.length)];
}

/**
 * Low clouds use heap and wisp shapes, banks use bank shapes, high streaks (only when `high`) use streak shapes.
 * Low cloud covers 15–35 % of a view on average; banks stand at least 700 cells apart; wind is 2–4 cells a second.
 */
export function makeField(seed: number, n: number, shapes: readonly CloudShape[], high: boolean): SkyField {
  const rng = rngFor(seed, "sky-field");
  const speed = rng.range(2.5, 3.5);
  const dir = rng.range(0, Math.PI * 2);
  const wind = { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed };
  const turn = rng.range(-0.3, 0.3);
  const highSpeed = speed * 1.8;
  const highWind = { x: Math.cos(dir + turn) * highSpeed, y: Math.sin(dir + turn) * highSpeed };

  const weatherSeed = rng.next();
  const weather = (x: number, y: number): number => {
    // Two octaves: the base wavelength is n/6, broad beside a view, so clearings stay clear.
    const v = fbm((x * 6) / n, (y * 6) / n, 6, 2, 0.45, weatherSeed);
    const u = v * 0.5 + 0.5;
    const stretched = (u - 0.5) * 1.65 + 0.5;
    return stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
  };

  const heaps = indices(shapes, "heap");
  const wisps = indices(shapes, "wisp");
  const banks = indices(shapes, "bank");
  const streaks = indices(shapes, "streak");
  const clouds: Cloud[] = [];

  if (heaps.length > 0 || wisps.length > 0) {
    // Spacing leaves an overcast view (chance 1) past 40% covered, and a clear view near empty.
    const cols = Math.max(1, Math.round(n / 44));
    const cell = n / cols;
    for (let gy = 0; gy < cols; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = modN((gx + rng.float()) * cell, n);
        const y = modN((gy + rng.float()) * cell, n);
        const wth = weather(x, y);
        let chance = 0;
        if (wth >= 0.62) chance = 1;
        else if (wth > 0.47) {
          const t = (wth - 0.47) / 0.15;
          chance = 0.22 + 0.78 * t * t;
        }
        if (rng.float() >= chance) continue;
        const useWisp = wisps.length > 0 && (heaps.length === 0 || rng.float() < 0.25);
        const pool = useWisp ? wisps : heaps;
        clouds.push({
          shape: pick(rng, pool),
          x,
          y,
          layer: "low",
          flip: rng.float() < 0.5,
        });
      }
    }
  }

  if (banks.length > 0) {
    const target = Math.max(1, Math.round(BANKS_AT_6400 * (n / 6400) * (n / 6400)));
    const gap2 = BANK_GAP * BANK_GAP;
    const placed: Cloud[] = [];
    let tries = 0;
    let threshold = 0.52;
    while (placed.length < target && tries < target * 160) {
      tries++;
      const x = rng.float() * n;
      const y = rng.float() * n;
      if (weather(x, y) < threshold) {
        if (tries % 40 === 0 && threshold > 0.28) threshold -= 0.02;
        continue;
      }
      let ok = true;
      for (let i = 0; i < placed.length; i++) {
        if (torusDist2(x, y, placed[i].x, placed[i].y, n) < gap2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      placed.push({
        shape: pick(rng, banks),
        x,
        y,
        layer: "bank",
        flip: rng.float() < 0.5,
      });
    }
    for (let i = 0; i < placed.length; i++) clouds.push(placed[i]);
  }

  if (high && streaks.length > 0) {
    const count = Math.max(1, Math.round((n / 300) * (n / 300)));
    for (let i = 0; i < count; i++) {
      clouds.push({
        shape: pick(rng, streaks),
        x: rng.float() * n,
        y: rng.float() * n,
        layer: "high",
        flip: rng.float() < 0.5,
      });
    }
  }

  return { n, clouds, wind, highWind };
}

/** Where cloud `c` is at time `t` seconds, wrapped into [0, n): exact however large t is. */
export function cloudAt(field: SkyField, c: Cloud, t: number): { x: number; y: number } {
  const w = c.layer === "high" ? field.highWind : field.wind;
  const n = field.n;
  return { x: wrapDrift(c.x, w.x, t, n), y: wrapDrift(c.y, w.y, t, n) };
}
