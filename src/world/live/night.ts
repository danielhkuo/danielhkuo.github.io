// The night: lamplit windows in the towns and the wonders, lanterns, the lighthouses' lamps with their sweeping
// beams, and stars on the dark water. All of it comes up with the air's darkness (sky/air.ts) and is gone by day.
//
// Windows are the openings the builders marked on lived-in walls (gen/structures.ts, gen/wonderworks.ts): every
// opening of a roofed structure, but not the shade under an arch, nor a ruin's, a quarry's or a bridge's (none of
// those has a roof). Each is found once, at its bake pixel, and lit only where the bake shows it: the land nearer the
// viewer hides it as it hides the wall. Windows light one by one as the dusk deepens, most go out in the small hours,
// and an early few light again before dawn.

import type { Structure } from "../gen/built.ts";
import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { blend, modP } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { matOf, toneOf } from "./pixel.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Below this darkness nothing of the night shows. */
const DARK_FROM = 0.05;
/** Lamplight: the window's glass, warm and bright, in three tones (packed RGBA). */
const LAMPS = [0xff5ec4ff, 0xff7ad8ff, 0xff4aa6f2] as const;
/** The lamp in a lantern, nearly white with a little gold. */
const LANTERN = 0xff9fe8ff;
/** Of 255: how strongly a window's light spills onto the wall under it, at full dark. */
const SPILL = 70;
/** Of 65536: the share of windows that ever light. */
const LIT_SHARE = 0.78 * 65536;
/** Of 65536: of those, the share that burn all night, and the share that light again before dawn. */
const ALL_NIGHT = 0.18 * 65536;
const EARLY = 0.3 * 65536;

/** Lighthouse beams: seconds a turn, world cells long, and how fast they widen (pixels a pixel). */
const BEAM_TURN = 9;
const BEAM_LENGTH = 120;
const BEAM_SPREAD = 0.075;
/** Of 255: a beam at its root, at full dark. */
const BEAM_ALPHA = 120;
/** The beam's light. */
const BEAM = 0xffc8f4ff;

/** Stars on the water: one in this many bake pixels, on a tile of STAR_TILE² that repeats over the world. */
const STAR_EVERY = 260;
const STAR_TILE = 512;
/** Water this far from the shore (its tone) or farther shows them. */
const STAR_OFFSHORE = 4;
const STAR = 0xfff6eee6;

// ── Finding the lights ───────────────────────────────────────────────────────────────────────────────────────────────

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
const ROOF = flags([M.roofSlate, M.roofTile, M.roofLead, M.copper]);
const STARRY = flags([M.sea, M.seaClear, M.lake]);
/** The light bytes the builders give the shade under an arch. */
const ARCH_TONES = new Set([92, 104]);

/** Bake-space tiles the lights are filed in. */
const TILE = 256;

/** Lights filed by the bake-space tile they stand in: a pixel each, and a word of hash for their habits. */
export interface LightFile {
  /** Bake pixel column and row (rows wrap every 0.8·n). */
  bx: Int32Array;
  by: Int32Array;
  /** A hash per light: whether and when it lights, its tone, its flicker. */
  key: Uint32Array;
  /** Lights in tile k are start[k] … start[k + 1] − 1. */
  start: Uint32Array;
  /** Tiles across and down. */
  tx: number;
  ty: number;
}

/** A lighthouse's lamp: the middle of its lamp room, in bake space (fractional), and a hash for its beams' phase. */
export interface Lamp {
  bx: number;
  by: number;
  key: number;
}

export interface NightLights {
  windows: LightFile;
  lanterns: LightFile;
  lamps: Lamp[];
}

function file(points: number[], n: number): LightFile {
  const tx = n / TILE, ty = Math.ceil((0.8 * n) / TILE);
  const count = points.length / 3;
  const start = new Uint32Array(tx * ty + 1);
  const tileOf = (k: number): number => Math.floor(points[k * 3 + 1] / TILE) * tx + Math.floor(points[k * 3] / TILE);
  for (let k = 0; k < count; k++) start[tileOf(k) + 1]++;
  for (let i = 0; i < tx * ty; i++) start[i + 1] += start[i];
  const fill = start.slice(0, tx * ty);
  const bx = new Int32Array(count), by = new Int32Array(count), key = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    const at = fill[tileOf(k)]++;
    bx[at] = points[k * 3];
    by[at] = points[k * 3 + 1];
    key[at] = points[k * 3 + 2];
  }
  return { bx, by, key, start, tx, ty };
}

/** The bake pixel a mark at cell (x, y), `top` units up, is drawn on (bake/chunk.ts drawMarks), wrapped into the world. */
function markPixel(x: number, y: number, top: number, n: number): [number, number] {
  const cy = ((y % n) + n) % n;
  return [((x % n) + n) % n, modP(Math.floor((4 * cy) / 5) - Math.floor(top + 0.5), 0.8 * n)];
}

/** Every window, lantern and lighthouse lamp among `structures`, on a world n cells across. */
export function nightLights(structures: readonly Structure[], n: number): NightLights {
  const windows: number[] = [], lanterns: number[] = [], lamps: Lamp[] = [];
  for (let id = 0; id < structures.length; id++) {
    const s = structures[id];
    let roofed = false;
    for (let i = 0; i < s.mat.length && !roofed; i++) if (ROOF[s.mat[i]] === 1) roofed = true;
    const marks = s.marks;
    // The columns of an arch: openings there are shade, not glass.
    const arches = new Set<number>();
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      if (marks[k + 3] === M.opening && ARCH_TONES.has(marks[k + 4])) arches.add(marks[k + 1] * 4096 + marks[k]);
    }
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      const mat = marks[k + 3], dx = marks[k], dy = marks[k + 1], z = marks[k + 2];
      const glass = mat === M.opening && roofed && z >= 2 && !arches.has(dy * 4096 + dx);
      if (!glass && mat !== M.lantern) continue;
      const [bx, by] = markPixel(s.x + dx, s.y + dy, s.base + z, n);
      (glass ? windows : lanterns).push(bx, by, hash2(bx, by, 0x316 + id));
    }
    // A lamp room: lantern cells high on a tower.
    let lx = 0, ly = 0, cells = 0, top = 0;
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const c = j * s.w + i;
      if (s.mat[c] !== M.lantern || s.top[c] < 20) continue;
      lx += i + 0.5;
      ly += j + 0.5;
      top = Math.max(top, s.top[c]);
      cells++;
    }
    if (cells >= 3) {
      const cx = s.x + lx / cells, cy = s.y + ly / cells;
      const wy = ((cy % n) + n) % n;
      lamps.push({ bx: ((cx % n) + n) % n, by: modP(0.8 * wy - (s.base + top - 1.5), 0.8 * n), key: mix32(id + 0x1a3b) });
    }
  }
  return { windows: file(windows, n), lanterns: file(lanterns, n), lamps };
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Calls `fn(k, px, py)` for each light of `lights` on the frame, with its frame pixel. */
function eachOnFrame(f: LiveFrame, lights: LightFile, fn: (k: number, px: number, py: number) => void): void {
  const { rect, n } = f;
  const yPeriod = 0.8 * n;
  const tx0 = Math.floor(rect.x / TILE), tx1 = Math.floor((rect.x + rect.w - 1) / TILE);
  const ty0 = Math.floor(rect.y / TILE), ty1 = Math.floor((rect.y + rect.h - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = modP(ty, lights.ty) * lights.tx + modP(tx, lights.tx);
    for (let k = lights.start[t]; k < lights.start[t + 1]; k++) {
      const px = modP(lights.bx[k] - rect.x, n), py = modP(lights.by[k] - rect.y, yPeriod);
      if (px >= rect.w || py >= rect.h) continue;
      fn(k, px, py);
    }
  }
}

/**
 * Whether a window with hash `key` is lit at sun phase `time` and darkness `dark`, and how fully (0–1): it comes on
 * as the dusk passes its own threshold, goes out at its own bedtime, and an early riser lights again before dawn.
 */
export function windowLit(key: number, time: number, dark: number): number {
  if ((key & 0xffff) >= LIT_SHARE) return 0;
  const u = ((key >>> 16) & 0xff) / 255, v = ((key >>> 24) & 0xff) / 255;
  // Phase through the night: the evening runs on past 1 until sunrise at 1.25.
  const e = time < 0.5 ? time + 1 : time;
  const on = 0.22 + 0.5 * u;
  const come = clamp01((dark - on) / 0.12);
  if (come === 0) return 0;
  const habit = (mix32(key) & 0xffff);
  if (habit < ALL_NIGHT) return come;
  // Bed between an hour before midnight and the small hours; early risers light again before dawn.
  const bed = 0.9 + 0.17 * v;
  if (e < bed) return come * clamp01((bed - e) / 0.004);
  if (habit < ALL_NIGHT + EARLY) {
    const wake = 1.14 + 0.06 * u;
    return e > wake ? come * clamp01((e - wake) / 0.004) : 0;
  }
  return 0;
}

function drawWindows(f: LiveFrame, lights: LightFile, time: number, dark: number): void {
  const { out, bake, t } = f;
  const w = f.rect.w, h = f.rect.h;
  eachOnFrame(f, lights, (k, px, py) => {
    const i = py * w + px;
    // Only where the bake shows the window: something nearer may stand in front of it.
    if (matOf(bake[i]) !== M.opening) return;
    const key = lights.key[k];
    let lit = windowLit(key, time, dark);
    if (lit === 0) return;
    // A few burn candles, and flicker.
    if (((key >>> 9) & 7) === 0) lit *= 0.82 + 0.18 * psin(t * (5 + (key & 3)) + (key & 255));
    const glass = LAMPS[(key >>> 12) % 3];
    blend(out, i, glass, Math.round(255 * lit));
    // The light spills onto the wall below.
    if (py + 1 < h && matOf(bake[i + w]) !== M.opening) blend(out, i + w, glass, Math.round(SPILL * lit * dark));
  });
}

function drawLanterns(f: LiveFrame, lights: LightFile, dark: number): void {
  const { out, bake } = f;
  const w = f.rect.w;
  eachOnFrame(f, lights, (_k, px, py) => {
    const i = py * w + px;
    if (matOf(bake[i]) !== M.lantern) return;
    blend(out, i, LANTERN, Math.round(255 * clamp01((dark - 0.15) / 0.3)));
  });
}

/** One beam from the frame point (ox, oy) along world heading `a`, as a wedge of light fading from its root. */
function drawBeam(f: LiveFrame, ox: number, oy: number, a: number, strength: number): void {
  const { out } = f;
  const w = f.rect.w, h = f.rect.h;
  // On screen a world heading (cos a, sin a) runs along (cos a, 0.8 sin a).
  const vx = pcos(a), vy = 0.8 * psin(a);
  const len = Math.hypot(vx, vy);
  const ux = vx / len, uy = vy / len, qx = -uy, qy = ux;
  const L = BEAM_LENGTH * len;
  const end = 0.5 + BEAM_SPREAD * L;
  const ax = ox + ux * L + qx * end, ay = oy + uy * L + qy * end;
  const bx = ox + ux * L - qx * end, by = oy + uy * L - qy * end;
  const y0 = Math.max(0, Math.floor(Math.min(oy, ay, by))), y1 = Math.min(h - 1, Math.ceil(Math.max(oy, ay, by)));
  const xs = [ox, oy, ax, ay, bx, by];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    for (let e = 0; e < 3; e++) {
      const x1 = xs[e * 2], y1e = xs[e * 2 + 1], x2 = xs[((e + 1) % 3) * 2], y2 = xs[((e + 1) % 3) * 2 + 1];
      if ((cy < y1e && cy < y2) || (cy > y1e && cy > y2) || y1e === y2) continue;
      const x = x1 + ((cy - y1e) / (y2 - y1e)) * (x2 - x1);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (lo > hi) continue;
    const c0 = Math.max(0, Math.ceil(lo - 0.5)), c1 = Math.min(w - 1, Math.floor(hi - 0.5));
    for (let x = c0; x <= c1; x++) {
      const px = x + 0.5 - ox, py = cy - oy;
      const s = px * ux + py * uy;
      if (s < 0 || s > L) continue;
      const across = Math.abs(px * qx + py * qy) / (0.5 + BEAM_SPREAD * s);
      if (across >= 1) continue;
      const fall = 1 - s / L;
      const alpha = BEAM_ALPHA * strength * fall * fall * (1 - across * across);
      if (alpha >= 1) blend(out, y * w + x, BEAM, Math.round(alpha));
    }
  }
}

function drawLamps(f: LiveFrame, lamps: readonly Lamp[], dark: number): void {
  const { out, bake, rect, n, t } = f;
  const strength = clamp01((dark - 0.2) / 0.35);
  if (strength === 0) return;
  const reach = BEAM_LENGTH + 4;
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i];
    const ox = modP(lamp.bx - rect.x + reach, n) - reach, oy = modP(lamp.by - rect.y + reach, 0.8 * n) - reach;
    if (ox >= rect.w + reach || oy >= rect.h + reach) continue;
    // The lamp room burns: its glazing, wherever the bake shows it.
    for (let y = Math.floor(oy) - 3; y <= Math.floor(oy) + 3; y++) for (let x = Math.floor(ox) - 3; x <= Math.floor(ox) + 3; x++) {
      if (x < 0 || y < 0 || x >= rect.w || y >= rect.h) continue;
      if (matOf(bake[y * rect.w + x]) === M.lantern) blend(out, y * rect.w + x, LANTERN, Math.round(255 * strength));
    }
    const a = (2 * Math.PI * t) / BEAM_TURN + ((lamp.key & 1023) / 1024) * 2 * Math.PI;
    drawBeam(f, ox, oy, a, strength);
    drawBeam(f, ox, oy, a + Math.PI, strength);
  }
}

/** The stars on one tile of bake space: x, y and a twinkle hash, one in about STAR_EVERY pixels. */
function starTile(seed: number): Uint32Array {
  const cells = (STAR_TILE * STAR_TILE) / STAR_EVERY;
  const out = new Uint32Array(Math.floor(cells) * 3);
  for (let k = 0; k < cells; k++) {
    const hsh = hash2(k, 0x57a2, seed);
    out[k * 3] = hsh % STAR_TILE;
    out[k * 3 + 1] = (hsh >>> 9) % STAR_TILE;
    out[k * 3 + 2] = mix32(hsh);
  }
  return out;
}

function drawStars(f: LiveFrame, stars: Uint32Array, dark: number): void {
  const { out, bake, rect, t } = f;
  const w = rect.w, h = rect.h;
  const strength = clamp01((dark - 0.45) / 0.4);
  if (strength === 0) return;
  // The tiles under the frame, each the same field of stars.
  const sx0 = Math.floor(rect.x / STAR_TILE), sx1 = Math.floor((rect.x + w - 1) / STAR_TILE);
  const sy0 = Math.floor(rect.y / STAR_TILE), sy1 = Math.floor((rect.y + h - 1) / STAR_TILE);
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) {
    const x0 = sx * STAR_TILE - rect.x, y0 = sy * STAR_TILE - rect.y;
    for (let k = 0; k < stars.length; k += 3) {
      const px = x0 + stars[k], py = y0 + stars[k + 1];
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = py * w + px, v = bake[i];
      if (STARRY[matOf(v)] === 0 || toneOf(v) < STAR_OFFSHORE) continue;
      const key = stars[k + 2];
      const bright = 0.45 + 0.55 * ((key & 255) / 255);
      const twinkle = 0.65 + 0.35 * psin(t * (1.3 + ((key >>> 8) & 7) * 0.4) + ((key >>> 11) & 1023));
      blend(out, i, STAR, Math.round(230 * strength * bright * twinkle));
    }
  }
}

/** The night layer. `lights` from nightLights; without it, only the stars. */
export function nightLayer(seed: number, lights?: NightLights): LiveLayer {
  const stars = starTile(seed);
  return {
    name: "night",
    draw(f) {
      const air = f.air;
      if (!air || air.night < DARK_FROM) return;
      const dark = air.night;
      drawStars(f, stars, dark);
      if (!lights) return;
      drawWindows(f, lights.windows, air.time, dark);
      drawLanterns(f, lights.lanterns, dark);
      drawLamps(f, lights.lamps, dark);
    },
  };
}
