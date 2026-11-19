// The night: lamplit windows in the towns and the wonders, lanterns, the lighthouses' lamps with their sweeping
// beams, and stars on the dark water. All of it comes up with the air's darkness (sky/air.ts) and is gone by day.
//
// Windows are the openings the builders marked on lived-in walls (gen/structures.ts, gen/wonderworks.ts): every
// opening of a roofed structure, but not the shade under an arch, nor a ruin's, a quarry's or a bridge's (none of
// those has a roof), nor the hub of a windmill's sails, nor the dark glass of the marsh house. Marks that touch on a wall are one window and light together.
// Each is found once, at its bake pixel, and lit only where the bake shows it: the land nearer the viewer hides it as
// it hides the wall. Windows light one by one as the dusk deepens, most go out in the small hours, and an early few
// light again before dawn. The glass the builders painted lit by day (lantern marks: the bathhouse's windows, the
// marsh house's one) all light at dusk and burn till morning.
//
// Everything is drawn in flat steps and ordered dither, as the rest of the page is: no soft gradients.

import type { Structure } from "../gen/built.ts";
import { hash2, mix32 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { modP } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { matOf, toneOf } from "./pixel.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Below this darkness nothing of the night shows. */
const DARK_FROM = 0.05;
/** Lamplight in the glass (0xRRGGBB): gold, straw, amber, a deep candle orange, and a pale cream for the odd bright room. */
const LAMPS = [0xffc45e, 0xffd87a, 0xf2a64a, 0xe9953f, 0xffe6a8, 0xffc45e, 0xf2a64a, 0xffd87a] as const;
/** The glass the builders lit themselves, and the lamp in a lantern: a pale gold. */
const LANTERN = 0xffe89f;
/** Glass lit while the walls are still bright goes toward this, to stand out from them. */
const EARLY_GLASS = 0xfff4c0;
/** The lamplight that falls on a wall: a deeper amber than the glass. */
const SPILL_RGB = 0xf0a040;
/** Of 256: how strongly a window's light falls on the wall under it and beside it, at full dark. */
const SPILL_UNDER = 78;
const SPILL_BESIDE = 30;
/** Of 65536: the share of windows that ever light. */
const LIT_SHARE = 0.76 * 65536;
/** Of 65536: of those, the share that burn all night, and the share that light again before dawn. */
const ALL_NIGHT = 0.12 * 65536;
const EARLY = 0.3 * 65536;

/** Lighthouse beams: seconds a turn, world cells long, and how fast they widen (pixels a pixel). */
const BEAM_TURN = 14;
const BEAM_LENGTH = 230;
const BEAM_SPREAD = 0.062;
/** The beam's light, and the lamp's own. */
const BEAM = 0xfff2c4;
const LAMP_WHITE = 0xfffbe6;
/**
 * A beam in flat bands from the lamp outward: where each ends (a share of the length) and its strength of 256. Past
 * BEAM_TIP the last band is a checker of pixels, so the beam breaks up into the dark instead of stopping.
 */
const BAND_END = [0.07, 0.2, 0.4, 0.62, 0.82, 1] as const;
const BAND_ALPHA = [156, 112, 82, 58, 40, 27] as const;
const BEAM_TIP = 0.92;
/** The middle of a beam is solid; outside this share of its half-width it is a checker. */
const BEAM_CORE = 0.5;

/** Stars on the water: one in this many bake pixels, on a tile of STAR_TILE² that repeats over the world. */
const STAR_EVERY = 300;
const STAR_TILE = 512;
/** Water this far from the shore (its tone) or farther shows them. */
const STAR_OFFSHORE = 4;
const STAR = 0xe6eef6;

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

/**
 * The light bytes of the marsh house's one lit window (gen/wonderworks.ts marshHouse). A house with that window is
 * empty but for the one room: none of its other glass lights.
 */
const LONE_TONES = [220, 200] as const;

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
    // The columns of an arch: openings there are shade, not glass. And the rows that carry sails: an opening among
    // them is the hub they turn on.
    const arches = new Set<number>(), sails = new Set<number>();
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      if (marks[k + 3] === M.opening && ARCH_TONES.has(marks[k + 4])) arches.add(marks[k + 1] * 4096 + marks[k]);
      if (marks[k + 3] === M.sailcloth) sails.add(marks[k + 1]);
    }
    let lone = 0;
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      if (marks[k + 3] === M.lantern) lone = lone >= 0 && marks[k + 4] === LONE_TONES[lone] ? lone + 1 : -1;
    }
    if (lone === LONE_TONES.length) roofed = false;
    // The glass, by its place on its wall (row, column, height), so touching marks can be joined into one window.
    const glassAt = new Map<number, number>();
    const place = (dx: number, dy: number, z: number): number => (dy * 4096 + dx) * 256 + z;
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      const mat = marks[k + 3], dx = marks[k], dy = marks[k + 1], z = marks[k + 2];
      if (mat === M.opening && roofed && z >= 2 && !arches.has(dy * 4096 + dx) && !sails.has(dy)) glassAt.set(place(dx, dy, z), -1);
    }
    for (let k = 0; k + 5 <= marks.length; k += 5) {
      const mat = marks[k + 3], dx = marks[k], dy = marks[k + 1], z = marks[k + 2];
      if (mat === M.lantern) {
        const [bx, by] = markPixel(s.x + dx, s.y + dy, s.base + z, n);
        lanterns.push(bx, by, hash2(bx, by, 0x316 + id));
        continue;
      }
      if (mat !== M.opening || glassAt.get(place(dx, dy, z)) !== -1) continue;
      // One window: this mark and every mark of glass that touches it, all with the one hash.
      const [kx, ky] = markPixel(s.x + dx, s.y + dy, s.base + z, n);
      const key = hash2(kx, ky, 0x316 + id);
      const todo = [dx, z];
      glassAt.set(place(dx, dy, z), key);
      while (todo.length > 0) {
        const pz = todo.pop()!, px = todo.pop()!;
        const [bx, by] = markPixel(s.x + px, s.y + dy, s.base + pz, n);
        windows.push(bx, by, key);
        for (const [qx, qz] of [[px - 1, pz], [px + 1, pz], [px, pz - 1], [px, pz + 1]]) {
          if (glassAt.get(place(qx, dy, qz)) !== -1) continue;
          glassAt.set(place(qx, dy, qz), key);
          todo.push(qx, qz);
        }
      }
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

/** Moves out[i] toward `rgb` (0xRRGGBB) by `a` of 256, keeping it opaque. */
function tint(out: Uint32Array, i: number, rgb: number, a: number): void {
  const d = out[i];
  const r = d & 255, g = (d >>> 8) & 255, b = (d >>> 16) & 255;
  out[i] = (0xff000000
    | ((b + ((((rgb & 255) - b) * a) >> 8)) << 16)
    | ((g + (((((rgb >>> 8) & 255) - g) * a) >> 8)) << 8)
    | (r + (((((rgb >>> 16) & 255) - r) * a) >> 8))) >>> 0;
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
  const on = 0.25 + 0.66 * u;
  const come = clamp01((dark - on) / 0.1);
  if (come === 0) return 0;
  const habit = (mix32(key) & 0xffff);
  if (habit < ALL_NIGHT) return come;
  // Bed from late evening on, most before midnight and the last in the small hours; early risers light again before dawn.
  const bed = 0.935 + 0.1 * v * v;
  if (e < bed) return come * clamp01((bed - e) / 0.004);
  if (habit < ALL_NIGHT + EARLY) {
    const wake = 1.14 + 0.06 * u;
    return e > wake ? come * clamp01((e - wake) / 0.004) : 0;
  }
  return 0;
}

/** Whether lamplight may fall on this bake pixel: not on other glass, which has its own light or its own dark. */
function takesSpill(v: number): boolean {
  const m = matOf(v);
  return m !== M.opening && m !== M.lantern && m !== 0;
}

/** Lamplight on the wall round the lit pixel i at (px, py): under it, and fainter to either side. */
function spill(f: LiveFrame, i: number, px: number, py: number, a: number): void {
  const { out, bake } = f;
  const w = f.rect.w;
  if (py + 1 < f.rect.h && takesSpill(bake[i + w])) tint(out, i + w, SPILL_RGB, (SPILL_UNDER * a) >> 8);
  const beside = (SPILL_BESIDE * a) >> 8;
  if (px > 0 && takesSpill(bake[i - 1])) tint(out, i - 1, SPILL_RGB, beside);
  if (px + 1 < w && takesSpill(bake[i + 1])) tint(out, i + 1, SPILL_RGB, beside);
}

/**
 * The lit glass of `lights` on the frame. Windows (`own` false) keep their own hours and tones; the glass the
 * builders lit (`own` true) all comes on through the dusk and burns till morning.
 */
function drawLights(f: LiveFrame, lights: LightFile, own: boolean, time: number, dark: number, glow: number): void {
  const { out, bake, rect, n, t } = f;
  const w = rect.w, h = rect.h;
  const yPeriod = 0.8 * n;
  const want = own ? M.lantern : M.opening;
  const beat = Math.floor(t * 7);
  const early = dark < 0.7 ? Math.round(150 * (0.7 - dark) / 0.7) : 0;
  const tx0 = Math.floor(rect.x / TILE), tx1 = Math.floor((rect.x + w - 1) / TILE);
  const ty0 = Math.floor(rect.y / TILE), ty1 = Math.floor((rect.y + h - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const tile = modP(ty, lights.ty) * lights.tx + modP(tx, lights.tx);
    for (let k = lights.start[tile]; k < lights.start[tile + 1]; k++) {
      const px = modP(lights.bx[k] - rect.x, n), py = modP(lights.by[k] - rect.y, yPeriod);
      if (px >= w || py >= h) continue;
      const i = py * w + px;
      // Only where the bake shows the glass: something nearer may stand in front of it.
      if (matOf(bake[i]) !== want) continue;
      const key = lights.key[k];
      let lit: number, glass: number;
      if (own) {
        lit = clamp01((dark - 0.12 - 0.25 * (((key >>> 16) & 255) / 255)) / 0.15);
        glass = LANTERN;
      } else {
        lit = windowLit(key, time, dark);
        // Some rooms are dimmer than others: a curtain, one lamp.
        lit *= 0.74 + 0.26 * (((key >>> 20) & 15) / 15);
        glass = LAMPS[(key >>> 12) & 7];
        // A few burn candles: now and then the flame dips.
        if (((key >>> 9) & 7) === 0) {
          const dip = hash2(beat, key & 0xffff, 0x51) & 7;
          lit *= dip === 0 ? 0.6 : dip < 3 ? 0.84 : 1;
          glass = LAMPS[3];
        }
      }
      if (lit <= 0) continue;
      const a = Math.round(256 * lit);
      tint(out, i, glass, a);
      // The first lamps show against walls still bright with the evening: paler, so they read.
      if (early > 0) tint(out, i, EARLY_GLASS, (early * a) >> 8);
      spill(f, i, px, py, Math.round(a * glow));
    }
  }
}

/** The x where the row at `cy` crosses the edge (x1, y1)–(x2, y2), or NaN where it does not. */
function crossing(cy: number, x1: number, y1: number, x2: number, y2: number): number {
  if ((cy < y1 && cy < y2) || (cy > y1 && cy > y2) || y1 === y2) return NaN;
  return x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1);
}

/** The strengths of a beam's bands this frame (of 256). */
const bandNow = new Int32Array(BAND_ALPHA.length);

/**
 * One beam from the frame point (ox, oy) along world heading `a`: a wedge of light in flat bands, each fainter than
 * the one before, solid down its middle and a checker at its edges and its far end. The checker is fixed to the
 * world, so the beam sweeps over it and nothing crawls.
 */
function drawBeam(f: LiveFrame, ox: number, oy: number, a: number): void {
  const { out, rect } = f;
  const w = rect.w, h = rect.h;
  // On screen a world heading (cos a, sin a) runs along (cos a, 0.8 sin a).
  const vx = pcos(a), vy = 0.8 * psin(a);
  const len = Math.sqrt(vx * vx + vy * vy);
  const ux = vx / len, uy = vy / len, qx = -uy, qy = ux;
  const L = BEAM_LENGTH * len;
  const end = 0.5 + BEAM_SPREAD * L;
  const ax = ox + ux * L + qx * end, ay = oy + uy * L + qy * end;
  const bx = ox + ux * L - qx * end, by = oy + uy * L - qy * end;
  const y0 = Math.max(0, Math.floor(Math.min(oy, ay, by))), y1 = Math.min(h - 1, Math.ceil(Math.max(oy, ay, by)));
  const e0 = BAND_END[0] * L, e1 = BAND_END[1] * L, e2 = BAND_END[2] * L, e3 = BAND_END[3] * L, e4 = BAND_END[4] * L;
  const tip = BEAM_TIP * L, last = 0.5 * (tip + L);
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    let lo = Infinity, hi = -Infinity;
    let x = crossing(cy, ox, oy, ax, ay);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    x = crossing(cy, ax, ay, bx, by);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    x = crossing(cy, bx, by, ox, oy);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    if (lo > hi) continue;
    const c0 = Math.max(0, Math.ceil(lo - 0.5)), c1 = Math.min(w - 1, Math.floor(hi - 0.5));
    const py = cy - oy;
    let s = (c0 + 0.5 - ox) * ux + py * uy, d = (c0 + 0.5 - ox) * qx + py * qy;
    const even = (rect.y + y) & 1, row = y * w;
    for (let c = c0; c <= c1; c++, s += ux, d += qx) {
      if (s <= 0 || s >= L) continue;
      const half = 0.5 + BEAM_SPREAD * s, off = d < 0 ? -d : d;
      if (off >= half) continue;
      const checker = ((rect.x + c) & 1) === even;
      const edge = off > BEAM_CORE * half;
      let band: number;
      if (s < e0) band = 0;
      else if (s < e1) band = 1;
      else if (s < e2) band = 2;
      else if (s < e3) band = 3;
      else if (s < e4) band = 4;
      else {
        // The tip: a checker, and at its edges one pixel in four.
        if (s > tip && (!checker || ((edge || s > last) && even === 1))) continue;
        band = 5;
      }
      if (edge && !checker) continue;
      tint(out, row + c, BEAM, bandNow[band]);
    }
  }
}

/** The lighthouses: each lamp room ablaze, a small halo round it that flares as a beam swings past the viewer, and the two beams. */
function drawLamps(f: LiveFrame, lamps: readonly Lamp[], dark: number, mist: number): void {
  const { out, bake, rect, n, t } = f;
  const w = rect.w, h = rect.h;
  const strength = clamp01((dark - 0.3) / 0.4);
  if (strength === 0) return;
  // Mist shows a beam up.
  for (let k = 0; k < bandNow.length; k++) bandNow[k] = Math.round(BAND_ALPHA[k] * strength * (1 + 0.45 * mist));
  const reach = BEAM_LENGTH + 4;
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i];
    const ox = modP(lamp.bx - rect.x + reach, n) - reach, oy = modP(lamp.by - rect.y + reach, 0.8 * n) - reach;
    if (ox >= w + reach || oy >= h + reach) continue;
    const a = (2 * Math.PI * t) / BEAM_TURN + ((lamp.key & 1023) / 1024) * 2 * Math.PI;
    drawBeam(f, ox, oy, a);
    drawBeam(f, ox, oy, a + Math.PI);
    // A beam that points at the viewer (south) flares.
    const sn = psin(a), s2 = sn * sn, s4 = s2 * s2;
    const flare = s4 * s4;
    const cx = Math.floor(ox), cy = Math.floor(oy);
    if (cx < -8 || cy < -8 || cx >= w + 8 || cy >= h + 8) continue;
    // The halo: two flat rings, the outer a checker.
    const near = 2.3 + 1.2 * flare, far = 4.3 + 2.4 * flare;
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const at = y * w + x;
      if (r2 <= near * near) tint(out, at, BEAM, Math.round(150 * strength));
      else if (r2 <= far * far && ((x + rect.x + y + rect.y) & 1) === 0) tint(out, at, BEAM, Math.round(84 * strength));
      // The lamp room burns: its glazing, wherever the bake shows it.
      if (r2 <= 18 && matOf(bake[at]) === M.lantern) tint(out, at, LAMP_WHITE, Math.round(256 * strength));
    }
    // And a glint: four short rays.
    const rays = Math.round(1 + 5 * flare);
    for (let k = 1; k <= rays; k++) {
      const ray = Math.round(strength * (236 - (150 * k) / rays));
      if (cy >= 0 && cy < h) {
        if (cx - k >= 0 && cx - k < w) tint(out, cy * w + cx - k, LAMP_WHITE, ray);
        if (cx + k >= 0 && cx + k < w) tint(out, cy * w + cx + k, LAMP_WHITE, ray);
      }
      if (cx >= 0 && cx < w) {
        if (cy - k >= 0 && cy - k < h) tint(out, (cy - k) * w + cx, LAMP_WHITE, ray);
        if (cy + k >= 0 && cy + k < h) tint(out, (cy + k) * w + cx, LAMP_WHITE, ray);
      }
    }
    if (cx >= 0 && cy >= 0 && cx < w && cy < h) tint(out, cy * w + cx, LAMP_WHITE, Math.round(256 * strength));
  }
}

/** The stars on one tile of bake space: x, y and a twinkle hash, one in about STAR_EVERY pixels. */
function starTile(seed: number): Uint32Array {
  const cells = (STAR_TILE * STAR_TILE) / STAR_EVERY;
  const out = new Uint32Array(Math.floor(cells) * 3);
  for (let k = 0; k < Math.floor(cells); k++) {
    const hsh = hash2(k, 0x57a2, seed);
    out[k * 3] = hsh % STAR_TILE;
    out[k * 3 + 1] = (hsh >>> 9) % STAR_TILE;
    out[k * 3 + 2] = mix32(hsh);
  }
  return out;
}

/** Stars in the calm water: most faint, a few bright with a short streak; each winks in steps, on its own time. */
function drawStars(f: LiveFrame, stars: Uint32Array, strength: number): void {
  const { out, bake, rect, t } = f;
  const w = rect.w, h = rect.h;
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
      const rank = key & 255;
      const bright = rank > 232 ? 1 : 0.3 + 0.4 * (rank / 232);
      const wave = psin(t * (0.7 + ((key >>> 8) & 7) * 0.22) + ((key >>> 11) & 1023));
      const wink = wave > -0.2 ? 1 : wave > -0.8 ? 0.7 : 0.4;
      const a = Math.round(236 * strength * bright * wink);
      tint(out, i, STAR, a);
      // The brightest lie a little long on the water.
      if (rank > 232 && wink === 1) {
        if (px > 0 && STARRY[matOf(bake[i - 1])] === 1) tint(out, i - 1, STAR, a >> 2);
        if (px + 1 < w && STARRY[matOf(bake[i + 1])] === 1) tint(out, i + 1, STAR, a >> 2);
      }
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
      // Stars need a clear sky to mirror: cloud, rain and mist put them out.
      const veil = Math.max(air.overcast, air.cloud, air.rain, air.mist);
      const starry = clamp01((dark - 0.5) / 0.4) * (1 - veil) * (1 - veil);
      if (starry > 0.02) drawStars(f, stars, starry);
      if (!lights) return;
      // Lamplight carries farther on the wall as it darkens, and in mist.
      const glow = dark * (1 + 0.6 * air.mist);
      drawLights(f, lights.windows, false, air.time, dark, glow);
      drawLights(f, lights.lanterns, true, air.time, dark, glow);
      drawLamps(f, lights.lamps, dark, air.mist);
    },
  };
}
