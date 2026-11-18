// Where the clouds are: placed over the torus from the seed by a broad weather
// pattern, so some regions are clear and some hold towering heaps, all drifting
// with one wind. A few big cumulus, flotillas of small puffs, thin streamers; and
// a composed group round the start, so the first view has cloud in it.

import { fbm } from "../core/noise.ts";
import { rngFor, type Rng } from "../core/rng.ts";
import { torusDelta } from "../core/torus.ts";
import type { CloudShape } from "./shapes.ts";

export type CloudLayer = "low" | "bank";

/** One cloud: its shape (index into the shapes), where its sprite's top-left was at t = 0 (cells), and its layer. */
export interface Cloud {
  shape: number;
  x: number;
  y: number;
  layer: CloudLayer;
}

export interface SkyField {
  n: number;
  /** Low clouds run north to south, so a nearer cloud is drawn over a farther one. */
  clouds: Cloud[];
  /** Cells a second: every cloud drifts with it. */
  wind: { x: number; y: number };
}

/** Height of each layer's base, in units: it lifts the sprite on screen (screenY = 0.8·y − alt) and throws its shadow. */
export const LOW_ALT = 40;
export const BANK_ALT = 60;
export const ALT: Readonly<Record<CloudLayer, number>> = { low: LOW_ALT, bank: BANK_ALT };

/** The frame the field is composed for. */
const VIEW_W = 400;
const VIEW_H = 225;
/** Banks stay this far apart, east–west or north–south, so a view never holds two. */
const BANK_GAP_X = 740;
const BANK_GAP_Y = 540;
/** About this many banks on a 6400-wide world; other sizes scale by area. */
const BANKS_AT_6400 = 38;
/** Height of the flier over the sea at the start: the page's camera is lifted by it. */
const START_LIFT = 18;
/** The second opening heap: its middle this far along the flier's line on screen, and at least this far to the right of it, pixels. */
const AHEAD = 285;
const ABEAM = 80;

/** Where the flight starts (cells) and, if known, which way the flier heads (a unit vector). */
export interface Opening {
  x: number;
  y: number;
  dx?: number;
  dy?: number;
}

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

/** A jittered grid of `cols`² cells over the torus: calls `visit` once per cell with a point inside it. */
function scatter(rng: Rng, n: number, cols: number, visit: (x: number, y: number) => void): void {
  const cell = n / cols;
  for (let gy = 0; gy < cols; gy++) for (let gx = 0; gx < cols; gx++) {
    visit(modN((gx + 0.1 + 0.8 * rng.float()) * cell, n), modN((gy + 0.1 + 0.8 * rng.float()) * cell, n));
  }
}

/**
 * Low clouds use heap, puff and wisp shapes; banks use bank shapes.
 * Heaps stand where the weather is heavy, puffs sail in twos and threes where it is fair, and where it is fine the sky
 * is clear. Banks keep BANK_GAP apart. Wind is 2–4 cells a second. With `opening` (the flight's start), the view there
 * at t = 0 is cleared and set with a composed group: a great heap low on the seaward side, puffs, and a streamer; and,
 * when the start has a heading, a second heap ahead and to the right of the flier's line.
 */
export function makeField(seed: number, n: number, shapes: readonly CloudShape[], opening?: Opening): SkyField {
  const rng = rngFor(seed, "sky-field");
  const speed = rng.range(2.5, 3.5);
  const dir = rng.range(0, Math.PI * 2);
  const wind = { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed };

  const weatherSeed = rng.next();
  const weather = (x: number, y: number): number => {
    // Two octaves: the base wavelength is n/6, broad beside a view, so clearings stay clear.
    const v = fbm((x * 6) / n, (y * 6) / n, 6, 2, 0.45, weatherSeed);
    const u = v * 0.5 + 0.5;
    const stretched = (u - 0.5) * 1.65 + 0.5;
    return stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
  };

  const heaps = indices(shapes, "heap");
  const puffs = indices(shapes, "puff");
  const wisps = indices(shapes, "wisp");
  const banks = indices(shapes, "bank");
  let low: Cloud[] = [];
  const put = (pool: readonly number[], x: number, y: number): void => {
    low.push({ shape: pick(rng, pool), x: modN(x, n), y: modN(y, n), layer: "low" });
  };

  if (heaps.length > 0) {
    scatter(rng, n, Math.max(1, Math.round(n / 300)), (x, y) => {
      const w = weather(x, y), roll = rng.float(), mate = rng.float(), ox = rng.range(110, 190), oy = rng.range(50, 110);
      const chance = w < 0.42 ? 0 : w > 0.68 ? 0.9 : 0.12 + 0.78 * ((w - 0.42) / 0.26);
      if (roll >= chance) return;
      put(heaps, x, y);
      // Where the weather is heaviest the heaps stand in ranks, one behind another.
      if (w > 0.64 && mate < 0.5) put(heaps, x + (mate < 0.25 ? ox : -ox), y - oy);
    });
  }
  if (puffs.length > 0) {
    scatter(rng, n, Math.max(1, Math.round(n / 150)), (x, y) => {
      const w = weather(x, y), roll = rng.float(), mate = rng.float(), ox = rng.range(48, 96), oy = rng.range(-34, 34);
      const chance = w < 0.3 ? 0 : w < 0.5 ? 0.26 * ((w - 0.3) / 0.2) : 0.26;
      if (roll >= chance) return;
      put(puffs, x, y);
      // Puffs sail in company.
      if (mate < 0.55) put(puffs, x + ox, y + oy);
      if (mate < 0.18) put(puffs, x - 0.7 * ox, y - 1.4 * oy + 30);
    });
  }
  if (wisps.length > 0) {
    scatter(rng, n, Math.max(1, Math.round(n / 300)), (x, y) => {
      const w = weather(x, y), roll = rng.float();
      if (w > 0.33 && roll < 0.4) put(wisps, x, y);
    });
  }

  let placed: Cloud[] = [];
  if (banks.length > 0) {
    const target = Math.max(1, Math.round(BANKS_AT_6400 * (n / 6400) * (n / 6400)));
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
      for (let i = 0; i < placed.length && ok; i++) {
        ok = Math.abs(torusDelta(x, placed[i].x, n)) >= BANK_GAP_X || Math.abs(torusDelta(y, placed[i].y, n)) >= BANK_GAP_Y;
      }
      if (ok) placed.push({ shape: pick(rng, banks), x, y, layer: "bank" });
    }
  }

  if (opening) {
    // The page's first frame: the flier at its centre, START_LIFT over the sea.
    const rx = Math.floor(opening.x) - (VIEW_W >> 1), ry = Math.floor(0.8 * opening.y) - START_LIFT - (VIEW_H >> 1);
    /** Whether the cloud's box, grown by `pad`, touches the opening view. */
    const inView = (c: Cloud, pad: number): boolean => {
      const s = shapes[c.shape];
      const cx = torusDelta(rx + VIEW_W / 2, c.x + s.w / 2, n);
      const cy = torusDelta(ry + VIEW_H / 2, 0.8 * c.y - ALT[c.layer] + s.h / 2, 0.8 * n);
      return Math.abs(cx) < (VIEW_W + s.w) / 2 + pad && Math.abs(cy) < (VIEW_H + s.h) / 2 + pad;
    };
    low = low.filter((c) => !inView(c, 70));
    // No bank near the start: the first minute is clear flying.
    placed = placed.filter((c) => !inView(c, 260));
    /** Sets a shape with its sprite's top-left at screen (sx, sy) of the opening view. */
    const set = (shape: number, sx: number, sy: number): void => {
      low.push({ shape, x: modN(rx + sx, n), y: modN((ry + sy + LOW_ALT) / 0.8, n), layer: "low" });
    };
    const nearest = (pool: readonly number[], width: number, skip = -1): number => {
      let best = -1;
      for (const i of pool) if (i !== skip && (best < 0 || Math.abs(shapes[i].w - width) < Math.abs(shapes[best].w - width))) best = i;
      return best;
    };
    let first = -1;
    if (heaps.length > 0) {
      // The great heap, low and seaward: its crown level with the flier, its base near the bottom of the frame.
      // Of the heaps a third of the frame wide or more, the one that stands tallest for its width.
      for (const i of heaps) {
        if (shapes[i].w < 140 && first >= 0) continue;
        if (first < 0 || shapes[first].w < 140 || shapes[i].h / shapes[i].w > shapes[first].h / shapes[first].w) first = i;
      }
      // Its right edge stays left of the flier; a very wide heap runs off the frame's left edge instead.
      set(first, Math.min(88 - (shapes[first].w >> 1), 160 - shapes[first].w), 214 - shapes[first].h);
    }
    if (puffs.length > 0) {
      const a = nearest(puffs, 58), b = nearest(puffs, 36, a), c = nearest(puffs, 46, a);
      set(a, 300, 150);
      set(b, 352, 176);
      set(c, 44, 30);
    }
    if (wisps.length > 0) set(nearest(wisps, 110), 232, 196);
    if (heaps.length > 1 && opening.dx !== undefined && opening.dy !== undefined) {
      // A second heap ahead, just off the first frame: the flier, flying on as it starts, passes it close on its
      // right-hand side a few seconds in. The widest heap that is not the first.
      let h = -1;
      for (const i of heaps) if (i !== first && (h < 0 || shapes[i].w > shapes[h].w)) h = i;
      const hx = opening.dx, hy = 0.8 * opening.dy, len = Math.hypot(hx, hy) || 1;
      // Far enough to the right that its crown stays clear of the flier's line.
      const abeam = Math.max(ABEAM, shapes[h].h / 2 + 28);
      // AHEAD along the line, or as much farther as takes its box clear of the first frame.
      let sx = 0, sy = 0;
      for (let ahead = AHEAD; ahead < AHEAD + VIEW_W; ahead += 4) {
        sx = Math.round(VIEW_W / 2 + (ahead * hx - abeam * hy) / len - shapes[h].w / 2);
        sy = Math.round(VIEW_H / 2 + (ahead * hy + abeam * hx) / len - shapes[h].h / 2);
        if (sx >= VIEW_W || sy >= VIEW_H || sx + shapes[h].w <= 0 || sy + shapes[h].h <= 0) break;
      }
      // Clear its place of other low cloud, then set it.
      low = low.filter((c) => {
        const s = shapes[c.shape];
        const dx = torusDelta(rx + sx + shapes[h].w / 2, c.x + s.w / 2, n);
        const dy = torusDelta(ry + sy + shapes[h].h / 2, 0.8 * c.y - LOW_ALT + s.h / 2, 0.8 * n);
        return Math.abs(dx) >= (shapes[h].w + s.w) / 2 + 30 || Math.abs(dy) >= (shapes[h].h + s.h) / 2 + 30 || inView(c, 0);
      });
      set(h, sx, sy);
    }
  }

  low.sort((a, b) => a.y - b.y || a.x - b.x);
  return { n, clouds: [...low, ...placed], wind };
}

/** Where cloud `c` is at time `t` seconds, wrapped into [0, n): exact however large t is. */
export function cloudAt(field: SkyField, c: Cloud, t: number): { x: number; y: number } {
  const n = field.n;
  return { x: wrapDrift(c.x, field.wind.x, t, n), y: wrapDrift(c.y, field.wind.y, t, n) };
}
