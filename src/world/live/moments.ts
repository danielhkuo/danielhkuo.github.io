// Moments at the wonders, and two sights that are never baked into the land.
//
// Each placed wonder keeps a seeded clock: one appearance every three to eight minutes, for twenty to sixty seconds.
// Steam at the baths is the exception, and rises whenever the baths are in view. The town clock uses the world hour.
// A preview (?sights=all) holds every moment open, with time 0 already at the pose a visitor would wait for.
//
// Seeing a wonder — its focus on screen for about a second — logs the place. Seeing its moment logs that too, once
// in an appearance. The floating garden and the land-ship are live only: they are logged once they have been watched
// for that same second. Nothing here reads the clock on the wall or rolls a die; a second layer at the same t draws
// the same pixels.

import { hash2 } from "../core/hash.ts";
import { PI, pcos, psin } from "../core/psin.ts";
import { isWater, MATERIAL as M } from "../look/materials.ts";
import type { ManifestWonder } from "../pack/manifest.ts";
import { artSet, blend, frameX, frameY, groundRow, modP, ringDelta, smooth01, type ArtSet } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { matOf, toneOf } from "./pixel.ts";
import type { LayerContext } from "./registry.ts";
import type { Land } from "./routes.ts";
import { drawSprite, worldRowAt, type LiveSprite } from "./sprites.ts";

/** One world hour, in seconds of flight. The town clock strikes at the top of each. */
export const WORLD_HOUR = 240;
/** How long the carved figures stay out. */
export const CLOCK_LASTS = 36;
/** Where a preview opens the hour: figures already on the tower. */
export const CLOCK_LEAD = 12;

/** The moments that keep their own clock. The town clock is separate: it strikes on the world hour. */
export const MOMENT_KINDS = [
  "ferry", "train", "church", "plane", "marsh", "airship", "bridge", "oak", "dome", "garden", "land-ship",
] as const;

/** Where a forced preview opens each moment: a fraction of its length, already in the thick of it. */
const LEAD = [0.45, 0.32, 0.22, 0.42, 0.4, 0.5, 0.45, 0.28, 0.62, 0.4, 0.45];

const KIND: Record<string, number> = {};
for (let i = 0; i < MOMENT_KINDS.length; i++) KIND[MOMENT_KINDS[i]] = i;

/** What a visitor is told on finding the place itself. */
export const PLACE_LABEL: Record<string, string> = {
  baths: "The thermal baths",
  railway: "The tide railway",
  "drowned-church": "The drowned church",
  "cove-hotel": "The hotel in the cove",
  "marsh-house": "The marsh house",
  "airship-mast": "The airship mast",
  "bridge-town": "The bridge town",
  "great-oak": "The great oak",
  observatory: "The observatory",
};

const MOMENT_LABEL: Record<string, string> = {
  baths: "A ferry at the quay",
  railway: "A train on the tide line",
  "drowned-church": "A flock rising off the tower",
  "cove-hotel": "A seaplane at the jetty",
  "marsh-house": "A cart on the causeway",
  "airship-mast": "An airship at the mast",
  "bridge-town": "A boat under the bridge",
  "great-oak": "Leaves streaming off the oak",
  observatory: "The dome opens",
};

const REACH_KEYS = [
  "quay", "shore", "halt", "tower", "pontoon", "lamp", "gate", "firm", "mast",
  "west", "east", "upstream", "downstream", "crown", "dome", "funicularFoot",
];

/** Pools, as cells from the bathhouse focus, and which terrace they sit on. */
const POOLS: readonly (readonly [number, number, number])[] = [
  [-1, 12, 0], [-7, 19, 1], [6, 19, 2], [-1, 26, 3],
];
const BATH_QUAY = 2.2;
const BATH_FRAC = [0.72, 0.46, 0.46, 0.2];

export interface MomentSpan {
  every: number;
  lasts: number;
  lead: number;
}

/** What the layer drew, for tests: the kind and the frame pixel it was noted at. */
export interface MomentSeen {
  kind: string;
  px: number;
  py: number;
}

export interface MomentsLayer extends LiveLayer {
  /** Set to an array to have each frame's notes pushed onto it. Null draws the same and records nothing. */
  log: MomentSeen[] | null;
  /**
   * When set, only this moment is drawn: a wonder type, "clock", "floating-garden" or "land-ship".
   * Null draws every moment in view. The flight page leaves it null; the moment strips set it.
   */
  only: string | null;
}

/** How often `kind` appears, how long it stays, and where a preview opens it. The same for a seed and a kind. */
export function momentSpan(seed: number, kind: string): MomentSpan {
  const k = KIND[kind] ?? 0;
  const h = hash2(k, 0x6d6d, seed) >>> 0;
  const every = 180 + (h % 301);
  const lasts = 20 + ((h >>> 9) % 41);
  let lead = Math.round(LEAD[k] * lasts);
  if (lead < 2) lead = 2;
  if (lead >= lasts) lead = lasts - 1;
  return { every, lasts, lead };
}

/** Seconds into `kind`'s appearance, or −1 between appearances. Forced, the appearance loops with no gap. */
export function momentWindow(seed: number, kind: string, t: number, forced = false): number {
  if (t < 0) return -1;
  const span = momentSpan(seed, kind);
  if (forced) return (t + span.lead) % span.lasts;
  const slot = Math.floor(t / span.every);
  const begins = hash2(slot, KIND[kind] ?? 0, seed ^ 0x7a2e) % (span.every - span.lasts);
  const at = t - slot * span.every - begins;
  return at >= 0 && at < span.lasts ? at : -1;
}

/** Seconds into the hour's procession, or −1 through the rest of the hour. Forced, it loops. */
export function clockWindow(t: number, forced = false): number {
  if (t < 0) return -1;
  if (forced) return (t + CLOCK_LEAD) % CLOCK_LASTS;
  const at = t % WORLD_HOUR;
  return at < CLOCK_LASTS ? at : -1;
}

function across(at: number, lasts: number): number {
  const u = at / lasts;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

/** 0 at each end of an appearance, 1 through the middle. The fade is a couple of seconds. */
export function shown(at: number, lasts: number): number {
  return smooth01(at / 2.5) * smooth01((lasts - at) / 2.5);
}

// ── Where each moment's actors are ───────────────────────────────────────────────────────────────────────────────────
// The picture draws from these, and the sound times itself by them: one arithmetic for both.

/** How far along its way out figure `i` of the clock's procession is at `at` seconds: it shows between 0.02 and 0.98. */
export function figureP(at: number, i: number): number {
  const p0 = (at / CLOCK_LASTS) * 1.15;
  return p0 - i * 0.16;
}

/** Seconds into the procession at which figure `i` steps out (its `figureP` passes 0.02). */
export function figureOut(i: number): number {
  return ((0.02 + i * 0.16) * CLOCK_LASTS) / 1.15;
}

/** The clock's figures change pose this many times a second. */
export const FIGURE_STEPS = 4;

/** Where the train is: filled by `trainAt`. `face` is 1 when it faces east. */
export const trainPlace = { x: 0, y: 0, face: 1 };
/** The train `at` seconds into an appearance of `lasts`: from the shore to the halt and back, at one speed, turning at the halt. */
export function trainAt(at: number, lasts: number, shore: readonly [number, number], halt: readonly [number, number], n: number): void {
  const u = across(at, lasts);
  const dx = ringDelta(shore[0], halt[0], n);
  const dy = ringDelta(shore[1], halt[1], n);
  trainPlace.x = modP(shore[0] + dx * u, n);
  trainPlace.y = modP(shore[1] + dy * u, n);
  const going = at < lasts * 0.5 ? 1 : -1;
  trainPlace.face = (dx >= 0 ? 1 : -1) * going;
}
/** The carriage rides this many cells behind the engine. */
export const CARRIAGE_BEHIND = 8;

/** Where the seaplane is: filled by `planeAt`. */
export const planePlace = { x: 0, y: 0, alt: 0 };
/** The seaplane's approach ends, and its taxi ends, at these shares of its appearance. */
export const PLANE_DOWN = 0.34, PLANE_MOORED = 0.62;
/** The seaplane `at` seconds into an appearance of `lasts`: down from the south to the water, a taxi to the pontoon, then riding at its mooring. */
export function planeAt(at: number, lasts: number, pontoon: readonly [number, number]): void {
  const p = at / lasts;
  let x = pontoon[0];
  let y = pontoon[1];
  let alt = 1.4;
  if (p < 0.34) {
    const u = p / 0.34;
    y = pontoon[1] + 48 * (1 - u);
    alt = 16 + (1.4 - 16) * u;
  } else if (p < 0.62) {
    const u = (p - 0.34) / 0.28;
    y = pontoon[1] + 8 * (1 - u);
    x = pontoon[0] + 3 * u;
    alt = 1.35;
  } else {
    x = pontoon[0] + 3;
    y = pontoon[1] + 0.35 * psin(at * 1.6);
    alt = 1.15 + 0.2 * psin(at * 2);
  }
  planePlace.x = x;
  planePlace.y = y;
  planePlace.alt = alt;
}

/** The ferry's y `at` seconds into an appearance of `lasts`: in from 42 cells off to the quay (2 cells off) and out again. Its x is the quay's. */
export function ferryAt(at: number, lasts: number, quay: readonly [number, number]): number {
  const u = across(at, lasts);
  return quay[1] + 42 + (2 - 42) * u;
}

/** Where a bird of the church's flock is, and which wing frame it shows (2 is the downstroke): filled by `flockAt`. */
export const flockPlace = { x: 0, y: 0, alt: 0, frame: 0, left: false };
export const FLOCK_BIRDS = 5;
/** The flock rises over this share of its appearance. */
export const FLOCK_RISE = 0.18;
/** Bird `b` of the flock `at` seconds into an appearance of `lasts`, over a tower at `tower` whose water lies at `level`. */
export function flockAt(at: number, lasts: number, b: number, tower: readonly [number, number], level: number): void {
  const p = at / lasts;
  const rise = p < 0.18 ? p / 0.18 : 1;
  const ang = b * 1.15 + at * 0.4;
  const rad = 3 + rise * (7 + b * 2);
  flockPlace.x = tower[0] + rad * pcos(ang) + rise * 6;
  flockPlace.y = tower[1] + rad * 0.4 * psin(ang);
  flockPlace.alt = level + 8 + rise * (14 + b);
  flockPlace.frame = (Math.floor(at * 7) + b) & 3;
  flockPlace.left = pcos(ang) < 0;
}

function poolAlt(level: number, terrace: number): number {
  const span = level > BATH_QUAY ? level - BATH_QUAY : 0;
  return BATH_QUAY + span * BATH_FRAC[terrace];
}

function sprite(art: ArtSet, lines: readonly string[], ax: number, ay: number, key: Readonly<Record<string, readonly [number, number, number?]>>): LiveSprite {
  const w = lines[0].length;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].length !== w) throw new Error(`sprite row ${i} is ${lines[i].length}, want ${w}: ${lines[i]}`);
  }
  return art.add(lines, ax, ay, key);
}

// ── Where the garden drifts, and where the land-ship runs ───────────────────────────────────────────────────────────

const DIRS = [1, 0, -1, 0, 0, 1, 0, -1];
/** Steps, in frame pixels, along which a beach is measured. Short enough to stay on a narrow strand. */
const SAND_DX = [2, 2, 0, -2, 2, 2, -2, 0];
const SAND_DY = [0, 1, 2, 1, -1, -1, 1, -2];
/** Sea lies on this axis, so the shore runs on the other. */
const ALONG = [2, 2, 0, 0];

interface Survey {
  n: number;
  seed: number;
  seaX: number;
  seaY: number;
  sands: Float32Array;
}

const CACHE = new WeakMap<Float32Array, Survey>();

function heightOf(land: Land, n: number, x: number, y: number): number {
  const gN = land.gN;
  const cell = n / gN;
  let gx = Math.floor(modP(x, n) / cell);
  let gy = Math.floor(modP(y, n) / cell);
  if (gx >= gN) gx = gN - 1;
  if (gy >= gN) gy = gN - 1;
  if (gx < 0) gx = 0;
  if (gy < 0) gy = 0;
  return land.ground[gy * gN + gx];
}

function findSea(land: Land, n: number, seed: number): { x: number; y: number } {
  const { ground, gN } = land;
  if (gN < 2) return { x: -1, y: -1 };
  const cell = n / gN;
  const at = (gx: number, gy: number): number => {
    let x = gx % gN;
    let y = gy % gN;
    if (x < 0) x += gN;
    if (y < 0) y += gN;
    return ground[y * gN + x];
  };
  let best = -1;
  let bx = -1;
  let by = -1;
  const take = (gx: number, gy: number, open: boolean): void => {
    const h = ground[gy * gN + gx];
    if (open ? h >= -4 : h >= -2) return;
    if (open && (at(gx + 6, gy) >= -1 || at(gx - 6, gy) >= -1 || at(gx, gy + 6) >= -1 || at(gx, gy - 6) >= -1)) return;
    const score = -h + (hash2(gx, gy, seed) & 255) / 255;
    if (score > best) {
      best = score;
      bx = gx;
      by = gy;
    }
  };
  for (let gy = 0; gy < gN; gy += 4) for (let gx = 0; gx < gN; gx += 4) take(gx, gy, true);
  if (bx < 0) {
    best = -1;
    for (let gy = 0; gy < gN; gy += 4) for (let gx = 0; gx < gN; gx += 4) take(gx, gy, false);
  }
  if (bx < 0) return { x: -1, y: -1 };
  return { x: (bx + 0.5) * cell, y: (by + 0.5) * cell };
}

function findSands(land: Land, n: number): Float32Array {
  const { ground, gN } = land;
  if (gN < 2) return new Float32Array(0);
  const cell = n / gN;
  const at = (gx: number, gy: number): number => {
    let x = gx % gN;
    let y = gy % gN;
    if (x < 0) x += gN;
    if (y < 0) y += gN;
    return ground[y * gN + x];
  };
  const index = (gx: number, gy: number): number => {
    let x = gx % gN;
    let y = gy % gN;
    if (x < 0) x += gN;
    if (y < 0) y += gN;
    return y * gN + x;
  };
  // The waterline: low ground with the sea within two cells. A curving shore is followed, not a straight shelf.
  const seaDir = (gx: number, gy: number): number => {
    let best = -1;
    let bestS = 9;
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d * 2];
      const dy = DIRS[d * 2 + 1];
      for (let s = 1; s <= 2; s++) {
        if (at(gx + dx * s, gy + dy * s) < -0.3) {
          if (s < bestS) {
            bestS = s;
            best = d;
          }
          break;
        }
      }
    }
    return best;
  };
  const isShore = (gx: number, gy: number): boolean => {
    const h = at(gx, gy);
    return h >= 0 && h <= 1.8 && seaDir(gx, gy) >= 0;
  };
  const seen = new Uint8Array(gN * gN);
  let best: number[] = [];
  const walk = (x0: number, y0: number, turn: number, out: number[]): void => {
    let x = x0;
    let y = y0;
    for (let s = 0; s < 400; s++) {
      const d = seaDir(x, y);
      if (d < 0) break;
      const a = ALONG[d];
      const ax = DIRS[a * 2] * turn;
      const ay = DIRS[a * 2 + 1] * turn;
      const sx = DIRS[d * 2];
      const sy = DIRS[d * 2 + 1];
      let nx = 0;
      let ny = 0;
      let ok = false;
      for (let c = 0; c < 3; c++) {
        let px = x + ax;
        let py = y + ay;
        if (c === 1) {
          px -= sx;
          py -= sy;
        } else if (c === 2) {
          px += sx;
          py += sy;
        }
        if (!isShore(px, py)) continue;
        const k = index(px, py);
        if (seen[k]) continue;
        nx = k % gN;
        ny = (k / gN) | 0;
        ok = true;
        break;
      }
      if (!ok) break;
      seen[ny * gN + nx] = 1;
      out.push(nx, ny);
      x = nx;
      y = ny;
    }
  };
  for (let gy = 0; gy < gN; gy += 2) {
    for (let gx = 0; gx < gN; gx += 2) {
      const start = gy * gN + gx;
      if (seen[start] || !isShore(gx, gy)) continue;
      seen[start] = 1;
      const back: number[] = [];
      const fore: number[] = [];
      walk(gx, gy, -1, back);
      walk(gx, gy, 1, fore);
      const cells: number[] = [];
      for (let i = back.length - 2; i >= 0; i -= 2) cells.push(back[i], back[i + 1]);
      cells.push(gx, gy);
      for (let i = 0; i < fore.length; i++) cells.push(fore[i]);
      if (cells.length > best.length) best = cells;
    }
  }
  if (best.length < 4) return new Float32Array(0);
  const run = new Float32Array(best.length);
  for (let i = 0; i < best.length; i += 2) {
    run[i] = (best[i] + 0.5) * cell;
    run[i + 1] = (best[i + 1] + 0.5) * cell;
  }
  return run;
}

function ensure(land: Land, n: number, seed: number): Survey {
  let s = CACHE.get(land.ground);
  if (!s || s.n !== n) {
    s = { n, seed: -1, seaX: -1, seaY: -1, sands: findSands(land, n) };
    CACHE.set(land.ground, s);
  }
  if (s.seed !== seed) {
    const sea = findSea(land, n, seed);
    s.seaX = sea.x;
    s.seaY = sea.y;
    s.seed = seed;
  }
  return s;
}

/** Where the garden is at time t: over open sea, or null when the land has none. Drifting onto land keeps the centre. */
export function gardenWhere(seed: number, n: number, land: Land, t: number): { x: number; y: number } | null {
  const s = ensure(land, n, seed);
  if (s.seaX < 0) return null;
  const ang = t * 0.011;
  const x = modP(s.seaX + 200 * pcos(ang), n);
  const y = modP(s.seaY + 130 * psin(ang), n);
  if (heightOf(land, n, x, y) >= -1) return { x: s.seaX, y: s.seaY };
  return { x, y };
}

/** The widest beach, as world x, y pairs along the shore. Empty when the land has no beach worth the name. */
export function widestSands(land: Land, n: number): Float32Array {
  return ensure(land, n, 0).sands;
}

const alongAt = { x: 0, y: 0, dx: 1 };

function along(run: Float32Array, u: number, n: number): void {
  const pts = run.length >> 1;
  if (pts <= 0) {
    alongAt.x = 0;
    alongAt.y = 0;
    alongAt.dx = 1;
    return;
  }
  if (pts === 1) {
    alongAt.x = run[0];
    alongAt.y = run[1];
    alongAt.dx = 1;
    return;
  }
  const f = u <= 0 ? 0 : u >= 1 ? pts - 1 : u * (pts - 1);
  let i = Math.floor(f);
  if (i >= pts - 1) i = pts - 2;
  const k = i === pts - 2 && u >= 1 ? 1 : f - i;
  const x0 = run[i * 2];
  const y0 = run[i * 2 + 1];
  const dx = ringDelta(x0, run[i * 2 + 2], n);
  const dy = ringDelta(y0, run[i * 2 + 3], n);
  alongAt.x = modP(x0 + dx * k, n);
  alongAt.y = modP(y0 + dy * k, n);
  alongAt.dx = dx === 0 && dy === 0 ? 1 : dx;
}

// ── The layer ────────────────────────────────────────────────────────────────────────────────────────────────────────

function deepSea(v: number): boolean {
  const m = matOf(v);
  return (m === M.sea || m === M.seaClear) && toneOf(v) >= 8;
}

function sandPixel(v: number): boolean {
  const m = matOf(v);
  return m === M.sand || m === M.sandPale || m === M.shingle;
}

function anchor(w: ManifestWonder, name: string): [number, number] {
  const p = w.anchors ? w.anchors[name] : undefined;
  return p ? p : [w.x, w.y];
}

/** The wonders' moments, the hour at the town clock, the floating garden and the land-ship. */
export function momentsLayer(ctx: LayerContext): MomentsLayer {
  const seed = ctx.seed;
  const forced = ctx.forceSights === true;
  const wonders = ctx.wonders ?? [];
  const survey = ctx.land ? ensure(ctx.land, ctx.n, ctx.seed) : null;
  const art = artSet();

  const steamInk = { a: [M.whitewash, 15, 150], b: [M.whitewash, 15, 235] } as const;
  const puff = sprite(art, ["..a..", ".aba.", "abbba", ".aba.", "..a.."], 2, 4, steamInk);
  const wisp = sprite(art, ["a.a", ".b.", "a.a"], 1, 1, steamInk);
  const ferry = sprite(art, ["...p.......", "..sssss....", ".sswwwss...", "sswwwwwss..", "hhhhhhhhhhh", ".kkkkkkkkk."], 5, 5, {
    p: [M.roofSlate, 5], s: [M.sailcloth, 13], w: [M.whitewash, 14], h: [M.timber, 8], k: [M.timber, 3],
  });
  const engine = sprite(art, ["......p..", ".ccccccc.", ".cwwwwwc.", "ttttttttt", "k.k.k.k.k"], 4, 4, {
    p: [M.roofSlate, 4], c: [M.plaster, 12], w: [M.opening, 2], t: [M.timber, 8], k: [M.stoneDark, 2],
  });
  const carriage = sprite(art, [".ccccccc.", ".cwwwwwc.", "ttttttttt", "k.k.k.k.k"], 4, 3, {
    c: [M.plaster, 11], w: [M.opening, 2], t: [M.timber, 7], k: [M.stoneDark, 2],
  });
  const feather = { W: [M.whitewash, 15], d: [M.roofSlate, 6], k: [M.stoneDark, 2] } as const;
  const birdUp = sprite(art, ["W...W", ".ddd.", "..d.."], 2, 2, feather);
  const birdMid = sprite(art, ["WWdWW", "..d.."], 2, 1, feather);
  const birdDown = sprite(art, [".WWW.", "d...d"], 2, 0, feather);
  const flap = [birdUp, birdMid, birdDown, birdMid] as const;
  const planeInk = {
    p: [M.stoneDark, 3], w: [M.sailcloth, 14], m: [M.timber, 6], h: [M.whitewash, 13], f: [M.roofLead, 6],
  } as const;
  const planeA = sprite(art, ["......p......", "..wwwwwwwww..", "......m......", ".hhhhhhhhhhh.", ".h.........h.", "ff.........ff"], 6, 5, planeInk);
  const planeB = sprite(art, [".....p.p.....", "..wwwwwwwww..", "......m......", ".hhhhhhhhhhh.", ".h.........h.", "ff.........ff"], 6, 5, planeInk);
  const air = sprite(art, ["..ccccccccccc..", ".ccbbbbbbbcccc.", ".ccccccccccccc.", "..ccccccccccc..", "......t.t......", "......ttt......"], 7, 4, {
    c: [M.sailcloth, 13], b: [M.roofLead, 7], t: [M.timber, 5],
  });
  const garden = sprite(art, [
    ".......aaa.......",
    ".....aaaggaaa....",
    "....aagggggaa....",
    "...gggggggggggg..",
    "...SSSSSSSSSSSS..",
    "...S..S....S..S..",
    "...SSSSSSSSSSSS..",
    "......r...r......",
    ".....rr...rr.....",
    "....r.......r....",
    "...r.........r...",
    "..r...........r..",
  ], 8, 6, {
    a: [M.alder, 8], g: [M.meadowMid, 7], S: [M.stone, 10], r: [M.timber, 3, 230],
  });
  const shipInk = {
    p: [M.timber, 5], m: [M.timber, 4], s: [M.sailcloth, 14], h: [M.timber, 8], w: [M.stoneDark, 2],
  } as const;
  const shipA = sprite(art, ["...p....p....", "...m....m....", "..ssss.ssss..", "..ssss.ssss..", ".hhhhhhhhhhh.", ".w..w...w..w."], 6, 5, shipInk);
  const shipB = sprite(art, ["...p....p....", "...m....m....", "..ssss.ssss..", "..ssss.ssss..", ".hhhhhhhhhhh.", "w..w...w..w.."], 6, 5, shipInk);
  const cartInk = { t: [M.timber, 7], h: [M.plaster, 12], k: [M.stoneDark, 2] } as const;
  const cartA = sprite(art, [".ttttt.", ".thhht.", "k.....k"], 3, 2, cartInk);
  const cartB = sprite(art, [".ttttt.", ".thhht.", ".k...k."], 3, 2, cartInk);
  const figInk = { s: [M.stone, 10], k: [M.stoneDark, 3] } as const;
  const figA = sprite(art, [".s.", "sks", ".s.", ".s.", "s.s"], 1, 4, figInk);
  const figB = sprite(art, [".s.", "sks", ".s.", ".s.", ".s."], 1, 4, figInk);
  const lamp = sprite(art, [".l.", "lll", ".t."], 1, 1, { l: [M.lantern, 12], t: [M.timber, 5] });
  const dome = sprite(art, [".ccccc.", "ccccccc", ".ccccc."], 3, 1, { c: [M.copper, 8] });
  const slit = sprite(art, [".k.", "kkk", "kkk", "kkk", ".k."], 1, 2, { k: [M.opening, 1] });
  const boat = sprite(art, ["..s..", ".sss.", "hhhhh", ".kkk."], 2, 3, {
    s: [M.sailcloth, 13], h: [M.timber, 8], k: [M.timber, 3],
  });

  const count = wonders.length;
  const placeSince = new Float64Array(count);
  const placeAt = new Float64Array(count);
  placeSince.fill(NaN);
  placeAt.fill(NaN);
  const placeDone = new Uint8Array(count);
  const told = new Float64Array(count).fill(NaN);
  const towns: { x: number; y: number }[] = [];
  for (let s = 0; s < ctx.sites.length; s++) {
    const site = ctx.sites[s];
    if (site.type === "town") towns.push({ x: site.x, y: site.y });
  }

  let synced = false;
  let gardenSince = NaN;
  let gardenAt = NaN;
  let gardenDone = false;
  let shipSince = NaN;
  let shipAt = NaN;
  let shipDone = false;
  let clockTold = NaN;
  let sandReady = false;
  let sandX = NaN;
  let sandY = NaN;
  let sandRun: Float32Array | null = null;

  const layer: MomentsLayer = {
    name: "moments",
    log: null,
    only: null,
    draw(f) {
      synced = false;
      const t = f.t;
      const focus = layer.only;
      for (let i = 0; i < wonders.length; i++) {
        const w = wonders[i];
        watchPlace(i, w, seenPlace(f, w), t);
        if (focus && focus !== w.type) continue;
        if (!inReach(f, w)) continue;
        const type = w.type;
        if (type === "baths") drawBaths(f, w, i, t);
        else if (type === "railway") drawRailway(f, w, i, t);
        else if (type === "drowned-church") drawChurch(f, w, i, t);
        else if (type === "cove-hotel") drawHotel(f, w, i, t);
        else if (type === "marsh-house") drawMarsh(f, w, i, t);
        else if (type === "airship-mast") drawMast(f, w, i, t);
        else if (type === "bridge-town") drawBridge(f, w, i, t);
        else if (type === "great-oak") drawOak(f, w, i, t);
        else if (type === "observatory") drawDome(f, w, i, t);
      }
      if (!focus || focus === "clock") drawClock(f, t);
      if (!focus || focus === "floating-garden") drawGarden(f, t);
      if (!focus || focus === "land-ship") drawShip(f, t);
    },
  };

  function sync(f: LiveFrame): void {
    if (synced) return;
    art.sync(f.palette);
    synced = true;
  }

  function note(kind: string, px: number, py: number): void {
    const seen = layer.log;
    if (!seen || !kind) return;
    seen.push({ kind, px: px | 0, py: py | 0 });
  }

  function near(f: LiveFrame, x: number, y: number, pad: number): boolean {
    const sx = frameX(f, x, pad);
    if (sx < -pad || sx >= f.rect.w + pad) return false;
    const sy = frameY(f, 0.8 * y, pad);
    return sy >= -pad && sy < f.rect.h + pad;
  }

  function inReach(f: LiveFrame, w: ManifestWonder): boolean {
    if (near(f, w.x, w.y, 160)) return true;
    const a = w.anchors;
    if (!a) return false;
    for (let k = 0; k < REACH_KEYS.length; k++) {
      const p = a[REACH_KEYS[k]];
      if (p && near(f, p[0], p[1], 140)) return true;
    }
    return false;
  }

  function seenPlace(f: LiveFrame, w: ManifestWonder): boolean {
    const sx = frameX(f, w.x, 20);
    if (sx < 16 || sx >= f.rect.w - 16) return false;
    const col = sx | 0;
    const gy = groundRowOf(f, col, w.y);
    if (gy >= 8 && gy < f.rect.h - 8) return true;
    const sy = frameY(f, 0.8 * w.y, 8) | 0;
    if (sy < 8 || sy >= f.rect.h - 8) return false;
    const row = worldRowAt(f, col, sy);
    return row > w.y - 3 && row < w.y + 3;
  }

  function groundRowOf(f: LiveFrame, col: number, y: number): number {
    if (col < 0 || col >= f.rect.w) return -1;
    return groundRow(f, col, y);
  }

  function watchPlace(i: number, w: ManifestWonder, seeing: boolean, t: number): void {
    if (!seeing) {
      placeSince[i] = NaN;
      return;
    }
    if (Number.isNaN(placeSince[i]) || t < placeAt[i] || t - placeAt[i] > 5) placeSince[i] = t;
    placeAt[i] = t;
    if (placeDone[i] || t - placeSince[i] < 1) return;
    const label = PLACE_LABEL[w.type];
    if (!label) return;
    placeDone[i] = 1;
    ctx.discover?.(w.id, label);
  }

  function witness(i: number, w: ManifestWonder, at: number, span: MomentSpan, inside: boolean, t: number): void {
    if (!inside || shown(at, span.lasts) < 0.7) return;
    const slot = forced ? Math.floor((t + span.lead) / span.lasts) : Math.floor(t / span.every);
    if (told[i] === slot) return;
    told[i] = slot;
    const label = MOMENT_LABEL[w.type];
    if (label) ctx.discover?.(`moment:${w.id}`, label);
  }

  function watchGarden(seeing: boolean, t: number): void {
    if (!seeing) {
      gardenSince = NaN;
      return;
    }
    if (Number.isNaN(gardenSince) || t < gardenAt || t - gardenAt > 5) gardenSince = t;
    gardenAt = t;
    if (gardenDone || t - gardenSince < 1) return;
    gardenDone = true;
    ctx.discover?.("floating-garden", "The floating garden");
  }

  function watchShip(seeing: boolean, t: number): void {
    if (!seeing) {
      shipSince = NaN;
      return;
    }
    if (Number.isNaN(shipSince) || t < shipAt || t - shipAt > 5) shipSince = t;
    shipAt = t;
    if (shipDone || t - shipSince < 1) return;
    shipDone = true;
    ctx.discover?.("land-ship", "The land-ship");
  }

  /** Draws `s` and notes `kind` when its anchor falls inside the frame. True when it is plainly visible. */
  function paint(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number, flip: boolean, cover: number, kind: string): boolean {
    if (cover <= 8) return false;
    sync(f);
    drawSprite(f, s, x, y, alt, flip, cover);
    const sx = frameX(f, x, 4);
    const sy = frameY(f, 0.8 * y - alt, 4);
    const inside = sx >= 1 && sy >= 1 && sx < f.rect.w - 1 && sy < f.rect.h - 1;
    if (inside && kind) note(kind, sx, sy);
    return inside && cover >= 170;
  }

  /**
   * Like paint, but when the cliff in front would hide the sprite it is drawn on that screen pixel anyway,
   * just nearer than the land there. Steam rising off a terrace needs this: the wall below the pool faces the camera.
   */
  function paintOver(f: LiveFrame, s: LiveSprite, x: number, y: number, alt: number, cover: number, kind: string): void {
    if (cover <= 8) return;
    sync(f);
    const sx = frameX(f, x, 8);
    const sy = frameY(f, 0.8 * y - alt, 8);
    const inside = sx >= 1 && sy >= 1 && sx < f.rect.w - 1 && sy < f.rect.h - 1;
    if (!inside) {
      drawSprite(f, s, x, y, alt, false, cover);
      return;
    }
    const col = sx | 0;
    const row = sy | 0;
    const depth = worldRowAt(f, col, row);
    if (depth <= y + 1) drawSprite(f, s, x, y, alt, false, cover);
    else {
      const front = depth + 0.5;
      drawSprite(f, s, f.rect.x + col, front, 0.8 * front - (f.rect.y + row), false, cover);
    }
    if (kind) note(kind, col, row);
  }

  function shadow(f: LiveFrame, x: number, y: number, alt: number, cover: number): void {
    if (alt < 3 || cover <= 0) return;
    const col = frameX(f, x, 8);
    if (col < 2 || col >= f.rect.w - 2) return;
    let row = groundRowOf(f, col | 0, y);
    if (row < 0) row = frameY(f, 0.8 * y, 4) | 0;
    if (row < 2 || row >= f.rect.h - 2) return;
    const sx = (col | 0) + Math.round(0.35 * alt);
    const sy = row + Math.round(0.28 * alt);
    const dark = f.palette[(M.roofSlate << 8) | 1];
    const a = (cover * 70) >> 8;
    const rx = 8;
    const ry = 3;
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const w = f.rect.w;
    const h = f.rect.h;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if (dx * dx * ry2 + dy * dy * rx2 > rx2 * ry2) continue;
        const px = sx + dx;
        const py = sy + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        if (f.bake[py * w + px] === 0) continue;
        blend(f.out, py * w + px, dark, a);
      }
    }
  }

  function foam(f: LiveFrame, x: number, y: number, cover: number): void {
    if (cover < 20) return;
    const sx = frameX(f, x, 6) | 0;
    if (sx < 1 || sx >= f.rect.w - 1) return;
    let sy = groundRowOf(f, sx, y);
    if (sy < 0) sy = frameY(f, 0.8 * y, 4) | 0;
    if (sy < 1 || sy >= f.rect.h - 1) return;
    const i = sy * f.rect.w + sx;
    if (isWater[matOf(f.bake[i])] !== 1) return;
    const white = f.palette[(M.whitewash << 8) | 15];
    blend(f.out, i, white, cover >> 1);
    if (sx + 1 < f.rect.w) blend(f.out, i + 1, white, cover >> 2);
  }

  function drawBaths(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    let logged = false;
    for (let p = 0; p < POOLS.length; p++) {
      const pool = POOLS[p];
      const px = w.x + pool[0];
      const py = w.y + pool[1];
      const alt = poolAlt(w.level, pool[2]);
      const wob = psin(t * 0.7 + p) * 0.6;
      paintOver(f, wisp, px + wob, py, alt + 2.2, 230, logged ? "" : "steam");
      logged = true;
      for (let k = 0; k < 2; k++) {
        const age = (t * 0.22 + p * 0.17 + k * 0.5) % 1;
        if (age < 0.08) continue;
        paintOver(f, puff, px + (k - 0.5) * 1.2, py, alt + 2.4 + age * 11, Math.round((1 - age) * 210), "");
      }
    }
    const at = momentWindow(seed, "ferry", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "ferry");
    const q = anchor(w, "quay");
    const y = ferryAt(at, span.lasts, q);
    const cover = Math.round(shown(at, span.lasts) * 255);
    const saw = paint(f, ferry, q[0], y, 1.15, false, cover, "ferry");
    foam(f, q[0], y + 1, cover);
    witness(i, w, at, span, saw, t);
  }

  function drawRailway(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "train", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "train");
    const shore = anchor(w, "shore");
    const halt = anchor(w, "halt");
    trainAt(at, span.lasts, shore, halt, f.n);
    const x = trainPlace.x, y = trainPlace.y, face = trainPlace.face;
    const cover = Math.round(shown(at, span.lasts) * 255);
    const saw = paint(f, engine, x, y, 1.25, face < 0, cover, "train");
    paint(f, carriage, modP(x - face * 8, f.n), y, 1.25, face < 0, cover, "");
    paint(f, puff, x + face * 2, y, 3.4, false, Math.round(cover * (0.45 + 0.2 * psin(at * 3))), "");
    witness(i, w, at, span, saw, t);
  }

  function drawChurch(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "church", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "church");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const tower = anchor(w, "tower");
    const rippled = ripples(f, tower[0], tower[1], at, cover);
    let saw = false;
    for (let b = 0; b < 5; b++) {
      flockAt(at, span.lasts, b, tower, w.level);
      if (paint(f, flap[flockPlace.frame], flockPlace.x, flockPlace.y, flockPlace.alt, flockPlace.left, cover, "flock")) saw = true;
    }
    witness(i, w, at, span, saw || rippled, t);
  }

  function ripples(f: LiveFrame, x: number, y: number, at: number, cover: number): boolean {
    const sx = frameX(f, x, 8);
    if (sx < 2 || sx >= f.rect.w - 2) return false;
    const col = sx | 0;
    let sy = groundRowOf(f, col, y);
    if (sy < 0) sy = frameY(f, 0.8 * y, 4) | 0;
    if (sy < 2 || sy >= f.rect.h - 2) return false;
    const white = f.palette[(M.whitewash << 8) | 15];
    const a0 = (cover * 160) >> 8;
    const w = f.rect.w;
    const h = f.rect.h;
    let drew = false;
    for (let ring = 0; ring < 3; ring++) {
      const phase = (at * 0.65 + ring * 0.33) % 1;
      const rad = 4 + phase * 16;
      const alpha = Math.round((1 - phase) * a0);
      if (alpha < 8) continue;
      const samples = rad < 8 ? 12 : rad < 14 ? 18 : 24;
      for (let k = 0; k < samples; k++) {
        const ang = k * (PI * 2 / samples);
        const px = col + Math.round(rad * pcos(ang));
        const py = sy + Math.round(rad * 0.62 * psin(ang));
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        if (isWater[matOf(f.bake[py * w + px])] !== 1) continue;
        blend(f.out, py * w + px, white, alpha);
        drew = true;
      }
    }
    if (drew) note("ripples", col, sy);
    return drew;
  }

  function drawHotel(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "plane", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "plane");
    const pontoon = anchor(w, "pontoon");
    planeAt(at, span.lasts, pontoon);
    const x = planePlace.x, y = planePlace.y, alt = planePlace.alt;
    const cover = Math.round(shown(at, span.lasts) * 255);
    if (alt > 3) shadow(f, x, y, alt, cover);
    const craft = (Math.floor(at * 12) & 1) === 0 ? planeA : planeB;
    const saw = paint(f, craft, x, y, alt, false, cover, "plane");
    if (alt < 2.2) foam(f, x, y, cover);
    witness(i, w, at, span, saw, t);
  }

  function drawMarsh(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "marsh", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "marsh");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const lampAt = anchor(w, "lamp");
    const flick = 175 + Math.round(70 * psin(at * 3.1));
    const sawLamp = paint(f, lamp, lampAt[0], lampAt[1], w.level + 9, false, flick, "lamp");
    const gate = anchor(w, "gate");
    const firm = anchor(w, "firm");
    const u = across(at, span.lasts);
    const x = modP(gate[0] + ringDelta(gate[0], firm[0], f.n) * u, f.n);
    const y = modP(gate[1] + ringDelta(gate[1], firm[1], f.n) * u, f.n);
    const going = at < span.lasts * 0.5;
    const cart = (Math.floor(at * 6) & 1) === 0 ? cartA : cartB;
    const sawCart = paint(f, cart, x, y, 2.4, !going, cover, "cart");
    witness(i, w, at, span, sawLamp || sawCart, t);
  }

  function drawMast(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "airship", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "airship");
    const mast = anchor(w, "mast");
    const alt = w.level + w.height + 4;
    const swing = 5 * psin(t * 0.31);
    const x = mast[0] + 14 + swing;
    const y = mast[1];
    const cover = Math.round(shown(at, span.lasts) * 255);
    shadow(f, x, y, alt, cover);
    tether(f, mast[0], mast[1], w.level + w.height, x, y, alt - 6, cover);
    const saw = paint(f, air, x, y, alt, swing < 0, cover, "airship");
    witness(i, w, at, span, saw, t);
  }

  function tether(f: LiveFrame, x0: number, y0: number, a0: number, x1: number, y1: number, a1: number, cover: number): void {
    const s0x = frameX(f, x0, 8);
    const s0y = frameY(f, 0.8 * y0 - a0, 8);
    const s1x = frameX(f, x1, 8);
    const s1y = frameY(f, 0.8 * y1 - a1, 8);
    const ink = f.palette[(M.timber << 8) | 4];
    const w = f.rect.w;
    const h = f.rect.h;
    const a = cover >> 1;
    for (let s = 0; s <= 6; s++) {
      const px = Math.round(s0x + ((s1x - s0x) * s) / 6);
      const py = Math.round(s0y + ((s1y - s0y) * s) / 6);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      blend(f.out, py * w + px, ink, a);
    }
  }

  function drawBridge(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "bridge", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "bridge");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const west = anchor(w, "west");
    const east = anchor(w, "east");
    const u = across(at, span.lasts);
    const dx = ringDelta(west[0], east[0], f.n);
    const deck = w.height > 17 ? w.height - 17 : 6;
    const y = west[1] + 3;
    const cart = (Math.floor(at * 5) & 1) === 0 ? cartA : cartB;
    const sawA = paint(f, cart, modP(west[0] + dx * u, f.n), y, deck, false, cover, "cart");
    const sawB = paint(f, cart, modP(east[0] - dx * u, f.n), y, deck, true, cover, "");
    const up = anchor(w, "upstream");
    const down = anchor(w, "downstream");
    const p = at / span.lasts;
    const bx = modP(up[0] + ringDelta(up[0], down[0], f.n) * p, f.n);
    const by = modP(up[1] + ringDelta(up[1], down[1], f.n) * p, f.n);
    const sawBoat = paint(f, boat, bx, by, 0.55, false, cover, "boat");
    foam(f, bx, by, cover);
    witness(i, w, at, span, sawA || sawB || sawBoat, t);
  }

  function drawOak(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "oak", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "oak");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const crown = anchor(w, "crown");
    const gust = smooth01(at / 2.2) * (1 - smooth01((at - span.lasts * 0.65) / (span.lasts * 0.3)));
    const blow = gust < 0.35 ? 0.35 : gust;
    let drew = false;
    let sx = 0;
    let sy = 0;
    for (let leaf = 0; leaf < 18; leaf++) {
      const lane = (hash2(leaf, 3, seed) & 1023) / 1023;
      const life = ((hash2(leaf, 9, seed) & 255) / 255 + at * 0.16) % 1;
      const dist = 3 + life * 36 * blow;
      const wx = crown[0] + dist;
      const wy = crown[1] + (lane - 0.5) * 16;
      const alt = w.level + 20 + lane * 16 - life * 6;
      const px = frameX(f, wx, 4);
      const py = frameY(f, 0.8 * wy - alt, 4);
      if (px < 0 || py < 0 || px >= f.rect.w || py >= f.rect.h) continue;
      const a = Math.round((1 - life * 0.45) * blow * cover);
      if (a < 16) continue;
      const ink = f.palette[(M.broadleafMid << 8) | (12 + (leaf & 3))];
      const px0 = px | 0;
      const py0 = py | 0;
      const fw = f.rect.w;
      blend(f.out, py0 * fw + px0, ink, a);
      if (px0 + 1 < fw) blend(f.out, py0 * fw + px0 + 1, ink, a);
      if (py0 + 1 < f.rect.h) {
        blend(f.out, (py0 + 1) * fw + px0, ink, a >> 1);
        if (px0 + 1 < fw) blend(f.out, (py0 + 1) * fw + px0 + 1, ink, a >> 1);
      }
      if (!drew) {
        sx = px;
        sy = py;
      }
      drew = true;
    }
    if (drew) note("leaves", sx, sy);
    witness(i, w, at, span, drew && cover >= 170, t);
  }

  function drawDome(f: LiveFrame, w: ManifestWonder, i: number, t: number): void {
    const at = momentWindow(seed, "dome", t, forced);
    if (at < 0) return;
    const span = momentSpan(seed, "dome");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const domeAt = anchor(w, "dome");
    const spin = psin(at * 0.35) * 3.5;
    const alt = w.level + w.height;
    const open = smooth01((at / span.lasts - 0.22) / 0.28);
    const saw = paint(f, dome, domeAt[0] + spin, domeAt[1], alt, false, cover, "dome");
    if (open > 0.15) paint(f, slit, domeAt[0] + spin, domeAt[1], alt + 0.6, false, Math.round(cover * open), "");
    witness(i, w, at, span, saw, t);
  }

  function drawClock(f: LiveFrame, t: number): void {
    const at = clockWindow(t, forced);
    if (at < 0 || towns.length === 0) return;
    const cover = Math.round(shown(at, CLOCK_LASTS) * 255);
    for (let s = 0; s < towns.length; s++) {
      const town = towns[s];
      const gx = frameX(f, town.x, 70);
      if (gx < -20 || gx >= f.rect.w + 20) continue;
      const col = gx < 0 ? 0 : gx >= f.rect.w ? f.rect.w - 1 : gx | 0;
      let gy = groundRowOf(f, col, town.y);
      if (gy < 0) gy = frameY(f, 0.8 * town.y, 12) | 0;
      if (gy < 0 || gy >= f.rect.h) continue;
      if (!findDial(f, col, gy)) continue;
      let any = false;
      sync(f);
      for (let i = 0; i < 5; i++) {
        const p = figureP(at, i);
        if (p <= 0.02 || p >= 0.98) continue;
        const ang = PI * (0.85 - 0.7 * p);
        const px = dialAt.sx + Math.round(8 * pcos(ang));
        const py = dialAt.sy - Math.round(2 + 7 * psin(ang));
        if (px < 1 || py < 1 || px >= f.rect.w - 1 || py >= f.rect.h - 1) continue;
        const depth = worldRowAt(f, px, py);
        const front = depth + 0.5;
        const fig = ((Math.floor(at * 4) + i) & 1) === 0 ? figA : figB;
        drawSprite(f, fig, f.rect.x + px, front, 0.8 * front - (f.rect.y + py), false, cover);
        any = true;
      }
      if (!any) continue;
      note("figures", dialAt.sx, dialAt.sy);
      if (cover < 170) continue;
      const slot = forced ? Math.floor((t + CLOCK_LEAD) / CLOCK_LASTS) : Math.floor(t / WORLD_HOUR);
      if (clockTold === slot) continue;
      clockTold = slot;
      ctx.discover?.("moment:clock", "Figures on the hour");
    }
  }

  function drawGarden(f: LiveFrame, t: number): void {
    const at = momentWindow(seed, "garden", t, forced);
    if (at < 0) {
      watchGarden(false, t);
      return;
    }
    let x = 0;
    let y = 0;
    let found = false;
    if (forced) {
      if (seaInFrame(f)) {
        x = seaHit.x;
        y = seaHit.y;
        found = true;
      }
    } else if (survey && ctx.land && survey.seaX >= 0) {
      const where = gardenWhere(seed, f.n, ctx.land, t);
      if (where && onDeep(f, where.x, where.y)) {
        x = where.x;
        y = where.y;
        found = true;
      }
    }
    if (!found) {
      watchGarden(false, t);
      return;
    }
    const span = momentSpan(seed, "garden");
    const cover = Math.round(shown(at, span.lasts) * 255);
    const alt = 74 + 6 * psin(t * 0.21);
    const ox = 5 * psin(t * 0.17);
    shadow(f, x + ox, y, alt, cover);
    const saw = paint(f, garden, x + ox, y, alt, false, cover, "garden");
    watchGarden(saw || cover >= 170, t);
  }

  function drawShip(f: LiveFrame, t: number): void {
    const at = momentWindow(seed, "land-ship", t, forced);
    if (at < 0) {
      watchShip(false, t);
      return;
    }
    const span = momentSpan(seed, "land-ship");
    const u = across(at, span.lasts);
    let drew = false;
    if (survey && survey.sands.length >= 4) {
      along(survey.sands, u, f.n);
      drew = putShip(f, alongAt.x, alongAt.y, alongAt.dx, at, span.lasts, u < 0.5);
    }
    if (!drew) {
      const run = frameSand(f);
      if (run && run.length >= 4) {
        along(run, u, f.n);
        drew = putShip(f, alongAt.x, alongAt.y, alongAt.dx, at, span.lasts, u < 0.5);
      }
    }
    watchShip(drew, t);
  }

  function putShip(f: LiveFrame, x: number, y: number, dx: number, at: number, lasts: number, going: boolean): boolean {
    const sx = frameX(f, x, 16);
    if (sx < 2 || sx >= f.rect.w - 2) return false;
    const col = sx | 0;
    let sy = groundRowOf(f, col, y);
    if (sy < 0) sy = frameY(f, 0.8 * y, 4) | 0;
    if (sy < 0 || sy >= f.rect.h) return false;
    sy = sandNear(f, col, sy);
    if (sy < 0) return false;
    const cover = Math.round(shown(at, lasts) * 255);
    if (cover <= 8) return false;
    const wy = worldRowAt(f, col, sy);
    const face = (dx >= 0 ? 1 : -1) * (going ? 1 : -1);
    const hull = (Math.floor(at * 6) & 1) === 0 ? shipA : shipB;
    sync(f);
    drawSprite(f, hull, x, wy, 0.45, face < 0, cover);
    note("land-ship", col, sy);
    return true;
  }

  function sandNear(f: LiveFrame, sx: number, sy: number): number {
    const w = f.rect.w;
    const h = f.rect.h;
    const bake = f.bake;
    if (sy >= 0 && sy < h && sandPixel(bake[sy * w + sx])) return sy;
    for (let d = 1; d <= 8; d++) {
      if (sy - d >= 0 && sandPixel(bake[(sy - d) * w + sx])) return sy - d;
      if (sy + d < h && sandPixel(bake[(sy + d) * w + sx])) return sy + d;
    }
    return -1;
  }

  function frameSand(f: LiveFrame): Float32Array | null {
    if (sandReady && f.rect.x === sandX && f.rect.y === sandY) return sandRun;
    sandReady = true;
    sandX = f.rect.x;
    sandY = f.rect.y;
    sandRun = scanSand(f);
    return sandRun;
  }

  function scanSand(f: LiveFrame): Float32Array | null {
    const w = f.rect.w;
    const h = f.rect.h;
    const bake = f.bake;
    let best = 0;
    let bx = 0;
    let by = 0;
    let bdx = 2;
    let bdy = 0;
    let tried = 0;
    for (let y = 4; y < h - 4 && best < 8 && tried < 400; y += 2) {
      const row = y * w;
      for (let x = 2; x < w - 2 && best < 8 && tried < 400; x += 2) {
        if (!sandPixel(bake[row + x])) continue;
        tried++;
        for (let d = 0; d < SAND_DX.length; d++) {
          const dx = SAND_DX[d];
          const dy = SAND_DY[d];
          let len = 0;
          let cx = x;
          let cy = y;
          for (let s = 0; s < 48; s++) {
            cx += dx;
            cy += dy;
            if (cx < 2 || cy < 2 || cx >= w - 2 || cy >= h - 2) break;
            if (!sandPixel(bake[cy * w + cx])) break;
            len++;
          }
          if (len > best) {
            best = len;
            bx = x;
            by = y;
            bdx = dx;
            bdy = dy;
          }
        }
      }
    }
    if (best < 4) return null;
    const run = new Float32Array((best + 1) * 2);
    for (let s = 0; s <= best; s++) {
      const sx = bx + bdx * s;
      const sy = by + bdy * s;
      run[s * 2] = f.rect.x + sx;
      run[s * 2 + 1] = worldRowAt(f, sx, sy);
    }
    return run;
  }

  function seaInFrame(f: LiveFrame): boolean {
    const w = f.rect.w;
    const h = f.rect.h;
    const bake = f.bake;
    const cx = w >> 1;
    const cy = h >> 1;
    const hit = (sx: number, sy: number): boolean => {
      if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) return false;
      if (!deepSea(bake[sy * w + sx])) return false;
      seaHit.x = f.rect.x + sx;
      seaHit.y = worldRowAt(f, sx, sy);
      return true;
    };
    if (hit(cx, cy)) return true;
    for (let r = 8; r <= 64; r += 8) {
      for (let a = 0; a < 8; a++) {
        const ang = a * PI * 0.25;
        if (hit(cx + Math.round(r * pcos(ang)), cy + Math.round(r * 0.62 * psin(ang)))) return true;
      }
    }
    return false;
  }

  function onDeep(f: LiveFrame, x: number, y: number): boolean {
    const sx = frameX(f, x, 4);
    if (sx < 1 || sx >= f.rect.w - 1) return false;
    const col = sx | 0;
    const sy = groundRowOf(f, col, y);
    if (sy < 1) return false;
    return deepSea(f.bake[sy * f.rect.w + col]);
  }

  return layer;
}

const seaHit = { x: 0, y: 0 };
const dialAt = { sx: 0, sy: 0 };

function findDial(f: LiveFrame, gx: number, gy: number): boolean {
  const w = f.rect.w;
  const h = f.rect.h;
  const bake = f.bake;
  const x0 = gx - 42 < 0 ? 0 : gx - 42;
  const x1 = gx + 42 >= w ? w - 1 : gx + 42;
  const y0 = gy - 46 < 0 ? 0 : gy - 46;
  const y1 = gy + 36 >= h ? h - 1 : gy + 36;
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      if (matOf(bake[row + x]) !== M.dial) continue;
      sumX += x;
      sumY += y;
      n++;
    }
  }
  if (n < 4) return false;
  dialAt.sx = Math.round(sumX / n);
  dialAt.sy = Math.round(sumY / n);
  return true;
}
