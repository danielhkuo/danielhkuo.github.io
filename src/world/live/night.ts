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
// Lamplight lands on things: a little on the wall round a window, a pool on the quay under a harbour lantern, and a
// short broken reflection in water that lies just under a light. The quays' bollards carry lanterns, and so do some
// jetties and moored boats; nobody marked those, so they are found here from the shape of what was built.
//
// Everything is drawn in flat steps, as the rest of the page is: no soft gradients.

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
/** Of 256: how strongly a window's light falls on the wall under it, beside it and over it, at full dark. */
const SPILL_UNDER = 96;
const SPILL_BESIDE = 46;
const SPILL_OVER = 24;
/** A lantern on a post: its flame, and of 256 the pool it throws on the 3 × 3 pixels round it. */
const POST = 0xffd27a;
const POOL = 78;
/** A light's reflection: looked for in water this many pixels under it at most, and of 256 each pixel of it going down. */
const MIRROR_REACH = 7;
const MIRROR = [132, 92, 60, 34] as const;
/** Of 65536: the share of windows that ever light. */
const LIT_SHARE = 0.76 * 65536;
/** Of 65536: of those, the share that burn all night, and the share that light again before dawn. */
const ALL_NIGHT = 0.16 * 65536;
const EARLY = 0.3 * 65536;

/** Lighthouse beams: seconds a turn, world cells long, and how fast they widen (pixels a pixel: 2 across at the lamp, 16 at the tip). */
const BEAM_TURN = 14;
const BEAM_LENGTH = 160;
const BEAM_SPREAD = 0.044;
/** The lamp's halo and the lamp's own light. */
const BEAM = 0xfff1c4;
const HALO = 0xffd27a;
const LAMP_WHITE = 0xfff6d8;
/**
 * A beam is a wedge of flat bands, laid over what is under it: four stretches along its length (their ends as shares
 * of it), each a step fainter than the last, and outside the middle BEAM_CORE of its width one step fainter again.
 * Five steps in all: the strength of each (of 256) and its colour, which deepens from pale cream to gold as it thins,
 * so that a faint band over dark sea still reads as warm light and not as grey.
 */
const BAND_END = [0.13, 0.36, 0.66] as const;
const BAND_ALPHA = [204, 160, 122, 92, 66] as const;
const BAND_RGB = [0xfff1c4, 0xffeab2, 0xffe09c, 0xffd688, 0xffcc78] as const;
const BEAM_CORE = 0.5;

/**
 * Stars on the water: about one in this many bake pixels, on a tile of STAR_TILE² that repeats over the world. They
 * lie in loose drifts with dark water between, as a real sky does, not an even scatter.
 */
const STAR_EVERY = 430;
const STAR_TILE = 512;
/** Water this far from the shore (its tone) or farther shows them. */
const STAR_OFFSHORE = 4;
const STAR = 0xe6eef6;
/** Of 256: a star's hash above this is one of the few bright ones. */
const STAR_BRIGHT = 238;

// ── Finding the lights ───────────────────────────────────────────────────────────────────────────────────────────────

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
const ROOF = flags([M.roofSlate, M.roofTile, M.roofLead, M.copper]);
const STARRY = flags([M.sea, M.seaClear, M.lake]);
/** Water that mirrors a light standing over it. */
const WATERY = flags([M.sea, M.seaClear, M.lake, M.river]);
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
  /** Lanterns nobody marked: on the quays' bollards, at the ends of jetties, in the sterns of moored boats. */
  posts: LightFile;
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

/**
 * The lanterns a roofless structure carries, pushed onto `posts`: one on each bollard of a quay (a dark stone post
 * standing clear of the stone round it), one at the seaward end of every other jetty (planks and posts, nothing
 * else), and one in the stern of every other moored boat.
 */
function postLanterns(s: Structure, id: number, n: number, posts: number[]): void {
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= s.w || j >= s.h ? 0 : s.top[j * s.w + i]);
  const light = (i: number, j: number, z: number): void => {
    const [bx, by] = markPixel(s.x + i, s.y + j, s.base + z, n);
    posts.push(bx, by, hash2(bx, by, 0x9057 + id));
  };
  let timber = 0, built = 0;
  for (let c = 0; c < s.mat.length; c++) if (s.top[c] > 0) { built++; if (s.mat[c] === M.timber) timber++; }
  const some = (mix32(id + 0x60a7) & 1) === 0;
  if (built > 0 && timber === built && s.w === 4 && s.h >= 6) {
    // A jetty: the last post on its east side.
    for (let j = s.h - 1; j >= 0 && some; j--) if (at(3, j) > at(2, j)) { light(3, j, at(3, j) + 1); break; }
    return;
  }
  if (s.w === 5 && s.h === 3 && built === 8 && s.marks.every((v, k) => k % 5 !== 3 || v === M.timber)) {
    // A boat at its mooring: a lantern in the stern.
    if (some) light(4, 1, 2);
    return;
  }
  for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
    const top = at(i, j);
    if (top <= 0 || s.mat[j * s.w + i] !== M.stoneDark) continue;
    if (at(i - 1, j) > top - 0.5 || at(i + 1, j) > top - 0.5 || at(i, j + 1) > top - 0.5) continue;
    light(i, j, top + 1);
  }
}

/** Every window, lantern and lighthouse lamp among `structures`, on a world n cells across. */
export function nightLights(structures: readonly Structure[], n: number): NightLights {
  const windows: number[] = [], lanterns: number[] = [], posts: number[] = [], lamps: Lamp[] = [];
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
    if (!roofed && !s.onGround) postLanterns(s, id, n, posts);
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
  return { windows: file(windows, n), lanterns: file(lanterns, n), posts: file(posts, n), lamps };
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
  // Bed from late evening on, nearly all before midnight; early risers light again before dawn.
  const bed = 0.925 + 0.085 * v * v;
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

/** Lamplight on the wall round the lit pixel i at (px, py): under it, and fainter beside it and over it. */
function spill(f: LiveFrame, i: number, px: number, py: number, a: number): void {
  const { out, bake } = f;
  const w = f.rect.w;
  if (py + 1 < f.rect.h && takesSpill(bake[i + w])) tint(out, i + w, SPILL_RGB, (SPILL_UNDER * a) >> 8);
  if (py > 0 && takesSpill(bake[i - w])) tint(out, i - w, SPILL_RGB, (SPILL_OVER * a) >> 8);
  const beside = (SPILL_BESIDE * a) >> 8;
  if (px > 0 && takesSpill(bake[i - 1])) tint(out, i - 1, SPILL_RGB, beside);
  if (px + 1 < w && takesSpill(bake[i + 1])) tint(out, i + 1, SPILL_RGB, beside);
}

/**
 * The reflection of the light at pixel i, where water lies within MIRROR_REACH pixels under it: a short broken
 * streak straight down from where the water starts, in the light's colour, one pixel of it out at a time.
 */
function mirror(f: LiveFrame, i: number, py: number, rgb: number, a: number, key: number): void {
  const { out, bake } = f;
  const w = f.rect.w, h = f.rect.h;
  const last = py + MIRROR_REACH < h ? py + MIRROR_REACH : h - 1;
  let at = i + w;
  for (let y = py + 1; y <= last; y++, at += w) {
    if (WATERY[matOf(bake[at])] === 0) continue;
    const gap = (Math.floor(f.t * 2.5) + key) & 3;
    for (let k = 0; k < MIRROR.length && y + k < h; k++, at += w) {
      if (WATERY[matOf(bake[at])] === 0) return;
      if (k !== 0 && k === gap) continue;
      tint(out, at, rgb, (MIRROR[k] * a) >> 8);
    }
    return;
  }
}

/** The quays' lanterns, the jetties' and the boats': a flame, a warm pool on what stands round it, and its reflection. */
function drawPosts(f: LiveFrame, lights: LightFile, dark: number, glow: number): void {
  const { out, bake, rect, n } = f;
  const w = rect.w, h = rect.h;
  const yPeriod = 0.8 * n;
  const tx0 = Math.floor(rect.x / TILE), tx1 = Math.floor((rect.x + w - 1) / TILE);
  const ty0 = Math.floor(rect.y / TILE), ty1 = Math.floor((rect.y + h - 1) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const tile = modP(ty, lights.ty) * lights.tx + modP(tx, lights.tx);
    for (let k = lights.start[tile]; k < lights.start[tile + 1]; k++) {
      const px = modP(lights.bx[k] - rect.x, n), py = modP(lights.by[k] - rect.y, yPeriod);
      if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
      const i = py * w + px;
      if (matOf(bake[i]) === 0) continue;
      const key = lights.key[k];
      // Lit one by one, early in the dusk: somebody walks the quay with a taper.
      const lit = clamp01((dark - 0.14 - 0.22 * (((key >>> 16) & 255) / 255)) / 0.12);
      if (lit === 0) continue;
      const a = Math.round(256 * lit);
      const pool = Math.round(POOL * lit * glow);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 || dy !== 0) tint(out, i + dy * w + dx, POST, pool);
      }
      tint(out, i, POST, a);
      mirror(f, i + w, py + 1, POST, Math.round(a * glow), key);
    }
  }
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
      const soft = Math.round(a * glow);
      spill(f, i, px, py, soft);
      // The foot of a window is mirrored where water lies under it.
      if (py + 1 < h && matOf(bake[i + w]) !== want) mirror(f, i, py, glass, soft, key);
    }
  }
}

/** The x where the row at `cy` crosses the edge (x1, y1)–(x2, y2), or NaN where it does not. */
function crossing(cy: number, x1: number, y1: number, x2: number, y2: number): number {
  if ((cy < y1 && cy < y2) || (cy > y1 && cy > y2) || y1 === y2) return NaN;
  return x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1);
}

/** This frame, of 256: the strengths of a beam's five steps. */
const bandNow = new Int32Array(BAND_ALPHA.length);

/**
 * One beam from the frame point (ox, oy) along world heading `a`: a wedge of warm light in flat steps, brightest on
 * its axis at the lamp, a step down at each stretch along it and one more outside its middle. Nothing in it is
 * dithered, so nothing shimmers as it turns.
 */
function drawBeam(f: LiveFrame, ox: number, oy: number, a: number): void {
  const { out, rect } = f;
  const w = rect.w, h = rect.h;
  // On screen a world heading (cos a, sin a) runs along (cos a, 0.8 sin a).
  const vx = pcos(a), vy = 0.8 * psin(a);
  const len = Math.sqrt(vx * vx + vy * vy);
  const ux = vx / len, uy = vy / len, qx = -uy, qy = ux;
  const L = BEAM_LENGTH * len;
  const end = 1 + BEAM_SPREAD * L;
  const ax = ox + ux * L + qx * end, ay = oy + uy * L + qy * end;
  const bx = ox + ux * L - qx * end, by = oy + uy * L - qy * end;
  const y0 = Math.max(0, Math.floor(Math.min(oy, ay, by)) - 1), y1 = Math.min(h - 1, Math.ceil(Math.max(oy, ay, by)) + 1);
  const e0 = BAND_END[0] * L, e1 = BAND_END[1] * L, e2 = BAND_END[2] * L;
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
    // A pixel wider than the triangle each side: the wedge is 2 across at the lamp, not a point.
    const c0 = Math.max(0, Math.ceil(lo - 2.5)), c1 = Math.min(w - 1, Math.floor(hi + 1.5));
    const py = cy - oy;
    let s = (c0 + 0.5 - ox) * ux + py * uy, d = (c0 + 0.5 - ox) * qx + py * qy;
    const row = y * w;
    for (let c = c0; c <= c1; c++, s += ux, d += qx) {
      if (s <= 0 || s >= L) continue;
      const half = 1 + BEAM_SPREAD * s, off = d < 0 ? -d : d;
      if (off >= half) continue;
      const step = (s < e0 ? 0 : s < e1 ? 1 : s < e2 ? 2 : 3) + (off > BEAM_CORE * half ? 1 : 0);
      tint(out, row + c, BAND_RGB[step], bandNow[step]);
    }
  }
}

/** The lighthouses: each lamp room ablaze, a small halo round it that flares as a beam swings past the viewer, and the two beams. */
function drawLamps(f: LiveFrame, lamps: readonly Lamp[], dark: number, mist: number): void {
  const { out, bake, rect, n, t } = f;
  const w = rect.w, h = rect.h;
  const strength = clamp01((dark - 0.18) / 0.3);
  if (strength === 0) return;
  // Mist shows a beam up.
  for (let k = 0; k < bandNow.length; k++) bandNow[k] = Math.min(236, Math.round(BAND_ALPHA[k] * strength * (1 + 0.2 * mist)));
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
    // The halo: a bright disc, a warm checker round it, and a thin scatter of gold beyond.
    const near = 2.3 + 1.2 * flare, far = 4.3 + 2 * flare, glow = 7.4;
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const r2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      const at = y * w + x;
      if (r2 <= near * near) tint(out, at, BEAM, Math.round(176 * strength));
      else if (r2 <= far * far) { if (((x + rect.x + y + rect.y) & 1) === 0) tint(out, at, HALO, Math.round(120 * strength)); }
      else if (r2 <= glow * glow && ((x + rect.x) & 1) === 0 && ((y + rect.y) & 1) === 0) tint(out, at, HALO, Math.round(84 * strength));
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

/**
 * The stars on one tile of bake space: x, y and a twinkle hash. Twice as many places are tried as stars are wanted,
 * and each is kept by how thick the drift is there: two slow waves across the tile, which repeat with it.
 */
function starTile(seed: number): Uint32Array {
  const tries = Math.floor((2 * STAR_TILE * STAR_TILE) / STAR_EVERY);
  const kept: number[] = [];
  const turn = (2 * Math.PI) / STAR_TILE;
  for (let k = 0; k < tries; k++) {
    const hsh = hash2(k, 0x57a2, seed);
    const x = hsh % STAR_TILE, y = (hsh >>> 9) % STAR_TILE;
    const drift = 0.5 + 0.3 * psin(turn * (2 * x + y) + (seed & 7)) + 0.26 * psin(turn * (3 * y - x) + 1.7);
    const key = mix32(hsh);
    if (((key >>> 21) & 1023) / 1023 < drift * drift) kept.push(x, y, key);
  }
  return Uint32Array.from(kept);
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
      const bright = rank > STAR_BRIGHT ? 1 : 0.22 + 0.36 * (rank / STAR_BRIGHT);
      const wave = psin(t * (0.7 + ((key >>> 8) & 7) * 0.22) + ((key >>> 11) & 1023));
      const wink = wave > -0.2 ? 1 : wave > -0.8 ? 0.7 : 0.4;
      const a = Math.round(236 * strength * bright * wink);
      tint(out, i, STAR, a);
      // The brightest lie a little long on the water.
      if (rank > STAR_BRIGHT && wink === 1) {
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
      drawPosts(f, lights.posts, dark, glow);
      drawLamps(f, lights.lamps, dark, air.mist);
    },
  };
}
