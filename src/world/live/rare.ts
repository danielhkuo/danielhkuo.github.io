// Rare sights: a whale breaching offshore, a balloon over the hills, a fox crossing a field, a heron in the river
// shallows, a ship under full sail, a monk on the abbey road. And the flier's wake on water.
//
// Each sight keeps its own clock: one appearance in every stretch of ten to twenty minutes, at a moment the seed
// picks. While it lasts, the sight shows wherever a candidate point of the world's lattice (also the seed's) lies on
// land that suits it, so a visitor sees it only by being over the right country at the right time. Everything is drawn
// in bake space, on the pixel the land itself is drawn on, so nothing needs a depth test and nothing is remembered
// from frame to frame except which appearance has already been reported.

import { hash2 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { isBuilt, isCrop, isWater, MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, groundRow, modP, smooth01 } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { worldRowAt, type LiveSprite } from "./sprites.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RareKind = "whale" | "balloon" | "fox" | "heron" | "ship" | "monk";

/**
 * The sights: `every` seconds hold one appearance of `lasts` seconds. `lead` is how far into the appearance a forced
 * sight is at time 0, so a preview opens on a telling moment.
 */
export const RARE: readonly { kind: RareKind; id: string; label: string; every: number; lasts: number; lead: number }[] = [
  { kind: "whale", id: "rare-whale", label: "A whale, breaching offshore", every: 780, lasts: 40, lead: 3.2 },
  { kind: "balloon", id: "rare-balloon", label: "A balloon over the hills", every: 900, lasts: 70, lead: 30 },
  { kind: "fox", id: "rare-fox", label: "A fox crossing the field", every: 720, lasts: 24, lead: 5 },
  { kind: "heron", id: "rare-heron", label: "A heron in the shallows", every: 840, lasts: 44, lead: 31.5 },
  { kind: "ship", id: "rare-ship", label: "A ship under full sail", every: 960, lasts: 70, lead: 30 },
  { kind: "monk", id: "rare-monk", label: "A monk on the abbey road", every: 660, lasts: 60, lead: 14 },
];
const WHALE = 0, BALLOON = 1, FOX = 2, HERON = 3, SHIP = 4, MONK = 5;

/** Seconds between the end of a forced appearance and the start of the next. */
const FORCED_GAP = 3;
/** The lattice: candidates to each tile of bake space (the world is a whole number of tiles round). */
const TILE_W = 640;
const TILE_H = 512;
const PER_TILE = [1, 1, 2, 2, 1, 0];
/** A sight settles on the nearest suitable pixel within this many pixels of its candidate, all of which must be in frame. */
const NEAR = 16;
const EDGE = NEAR + 14;
/** Forced sights: the tile under the view's centre, searched this far out from its middle. */
const FORCED_W = 160;
const FORCED_H = 64;
const FORCED_X = 110;
const FORCED_Y = 60;
/** Where each forced sight looks first, from the middle of that tile: apart, so they do not stand on one another. */
const FORCED_DX = [-56, -44, 40, -28, 56, 0];
const FORCED_DY = [14, 34, 22, -12, -16, 0];
/** Shore distance (sea tone) the whale and the ship need under them. */
export const WHALE_DEEP = 10;
export const SHIP_DEEP = 9;
/** Height over the sea a balloon's ground must have, and how high the balloon flies over it, in pixels. */
export const HILL = 12;
const BALLOON_ALT = 62;
/** The sun's slope, as the flier's shadow has it. */
const SHADOW_SLOPE = 0.354;
/** The whale surfaces twice in an appearance, this many seconds apart. */
const WHALE_CYCLE = 20;
/** The heron stands this long, then lifts off. */
export const HERON_LIFT = 34;
/** The monk's walk: half-sides of the box round the abbey that is searched for road, and his pace in pixels a second. */
const MONK_X = 72;
const MONK_Y = 52;
const MONK_PACE = 3;
/** The wake: the flier must be within WAKE_LOW units of the water; foam lasts WAKE_LASTS seconds. */
export const WAKE_LOW = 26;
export const WAKE_LASTS = 1.5;
const WAKE_STEP = 1.5;
const WAKE_SPREAD = 0.27;

const flags = (ids: readonly number[]): Uint8Array => {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
};
export const isSea: Uint8Array = flags([M.sea, M.seaClear]);
/** Where a fox runs: crops, meadow and pasture. */
export const isField: Uint8Array = (() => {
  const t = flags([M.meadowCool, M.meadowMid, M.meadowWarm, M.pastureCool, M.pastureMid, M.pastureWarm]);
  for (let m = 0; m < 256; m++) if (isCrop[m] === 1) t[m] = 1;
  return t;
})();
/** What a monk walks on. */
export const isRoad: Uint8Array = flags([M.road, M.path]);

// ── The clock ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Which appearance of sight `k` time t falls in (or after). */
export function rareSlot(k: number, t: number, forced = false): number {
  const r = RARE[k];
  return Math.floor((forced ? t + r.lead : t) / (forced ? r.lasts + FORCED_GAP : r.every));
}

/** Seconds into sight `k`'s appearance at time t, or −1 between appearances. Forced, one follows another. */
export function rareWindow(seed: number, k: number, t: number, forced = false): number {
  const r = RARE[k];
  const slot = rareSlot(k, t, forced);
  if (forced) {
    const at = t + r.lead - slot * (r.lasts + FORCED_GAP);
    return at < r.lasts ? at : -1;
  }
  const begins = hash2(slot, k, seed ^ 0x7a2e) % (r.every - r.lasts);
  const at = t - slot * r.every - begins;
  return at >= 0 && at < r.lasts ? at : -1;
}

// ── The layers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the layer drew last frame, for tests: the kind, the frame pixel it stands on, and whether it was in full view. */
export interface RareSeen {
  kind: RareKind;
  px: number;
  py: number;
  inView: boolean;
}

export interface RareLayer extends LiveLayer {
  log: RareSeen[] | null;
}

function easeInOut(at: number, stays: number, ease: number): number {
  if (at <= 0 || at >= stays) return 0;
  return smooth01(at / ease) * smooth01((stays - at) / ease);
}

/**
 * How much of a sight shows, of 255: less while its candidate is only just far enough inside the frame to be searched
 * for, so that flying up to a sight brings it in gently. Set before each sight is drawn.
 */
let veil = 255;
const VEIL = 12;

/** Offsets (dx, dy) on a lattice of 2 within ±rx, ±ry, nearest first. */
function offsets(rx: number, ry: number, round: boolean): Int16Array {
  const at: [number, number][] = [];
  for (let dy = -ry; dy <= ry; dy += 2) for (let dx = -rx; dx <= rx; dx += 2) {
    if (!round || dx * dx + dy * dy <= rx * rx) at.push([dx, dy]);
  }
  at.sort((a, b) => a[0] * a[0] + 2 * a[1] * a[1] - (b[0] * b[0] + 2 * b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  const flat = new Int16Array(at.length * 2);
  for (let i = 0; i < at.length; i++) {
    flat[i * 2] = at[i][0];
    flat[i * 2 + 1] = at[i][1];
  }
  return flat;
}

/**
 * Draws the top `rows` rows of `s`, sunk so the last of them lies where the sprite's bottom row would: its anchor on
 * frame pixel (sx, sy), mirrored about the anchor when `flip`, at `a` of 255 of its own coverage.
 */
function put(f: LiveFrame, s: LiveSprite, sx: number, sy: number, flip: boolean, a: number, rows: number): void {
  const w = f.rect.w, h = f.rect.h, out = f.out;
  const sink = s.h - rows;
  for (let y = 0; y < rows; y++) {
    const py = sy - s.ay + y + sink;
    if (py < 0 || py >= h) continue;
    for (let x = 0; x < s.w; x++) {
      const al = s.alpha[y * s.w + x];
      if (al === 0) continue;
      const px = flip ? sx + s.ax - x : sx - s.ax + x;
      if (px < 0 || px >= w) continue;
      const aa = a >= 255 && veil === 255 ? al : (al * (a > 255 ? 255 : a) * veil) / 65025 | 0;
      if (aa >= 255) out[py * w + px] = s.rgba[y * s.w + x];
      else if (aa > 0) blend(out, py * w + px, s.rgba[y * s.w + x], aa);
    }
  }
}

/** The rare sights. `ctx` is the world's seed, size and sites, the visitor's log, and whether every sight is forced. */
export function rareLayer(ctx: LayerContext): RareLayer {
  const seed = ctx.seed;
  const n = ctx.n;
  const forced = ctx.forceSights === true;
  const art = artSet();

  // A whale: slate back with a lit ridge, and the flukes.
  const hide = { b: [M.roofSlate, 3], h: [M.roofSlate, 10], d: [M.roofSlate, 1], k: [M.roofSlate, 0] } as const;
  const back = art.add([
    "....hhhhh....",
    "..hhbbbbbbk..",
    ".hbbbbbbbbbkd",
    "dbbbbbbbbbbbd",
  ], 6, 3, hide);
  const flukes = art.add([
    "hb.....bb",
    "hbb...bbd",
    ".hbbbbbd.",
    "...hbd...",
    "...hbd...",
    "...hbd...",
  ], 4, 5, hide);
  const mist = { w: [M.whitewash, 15, 215], v: [M.whitewash, 15, 125] } as const;
  const spoutRising = art.add([".w.", ".w.", ".w."], 1, 2, mist);
  const spoutFull = art.add([
    "v.v.v",
    ".vwv.",
    ".www.",
    "..w..",
    "..w..",
  ], 2, 4, mist);
  const spoutGoing = art.add([
    "v.v.v",
    ".v.v.",
    "..v..",
    ".....",
    "..v..",
  ], 2, 4, mist);

  // A ship: two masts under square sail, a jib, a dark hull.
  const ship = art.add([
    "...p....p....",
    "...m....m....",
    "..www..www...",
    "..www..www..j",
    ".wwwww.www.jj",
    ".sssss.sss.j.",
    "...m....m.j..",
    "hhhhhhhhhhhhH",
    ".kkkkkkkkkkk.",
  ], 6, 8, {
    p: [M.roofLead, 3], m: [M.timber, 2], w: [M.sailcloth, 14], s: [M.sailcloth, 5], j: [M.sailcloth, 11],
    h: [M.timber, 8], H: [M.timber, 11], k: [M.timber, 2],
  });

  // A balloon: gores of cream and teal, lit from the left, and a wicker basket.
  const balloon = art.add([
    "..aBBcC..",
    ".aaBBcCC.",
    "aaaBBcCCd",
    "aaaBBcCCd",
    "aaaBBcCCd",
    "aaaBBcCCd",
    ".aaBBcCC.",
    ".aaBBcCC.",
    "..aBBcC..",
    "...BBc...",
    "...r.r...",
    "...ttT...",
    "...ttT...",
  ], 4, 12, {
    a: [M.sailcloth, 14], B: [M.roofLead, 7], c: [M.sailcloth, 9], C: [M.roofLead, 4], d: [M.sailcloth, 3],
    r: [M.timber, 4, 170], t: [M.timber, 10], T: [M.timber, 5],
  });

  // A fox: russet (terracotta, well under the dragon's vermilion), a white tip to the brush, dark legs and ears.
  const fur = { r: [M.roofTile, 9], t: [M.roofTile, 11], w: [M.whitewash, 14], e: [M.timber, 1], l: [M.timber, 2], n: [M.roofTile, 6] } as const;
  const foxStretch = art.add([
    "......e.",
    "wtrrrrrn",
    ".trrrr..",
    ".l....l.",
  ], 4, 3, fur);
  const foxGather = art.add([
    "......e.",
    ".wtrrrrn",
    "..rrrr..",
    "...ll...",
  ], 4, 3, fur);
  const foxSit = art.add([
    "...e.e",
    "...rrn",
    "..rrw.",
    "wtrrl.",
  ], 3, 3, fur);

  // A heron: grey, white-necked, a dark crest and a pale bill.
  const plume = {
    W: [M.whitewash, 14], G: [M.whitewash, 3], d: [M.roofSlate, 6], k: [M.roofSlate, 1], y: [M.plaster, 11], l: [M.stoneDark, 2],
    g: [M.whitewash, 6],
  } as const;
  const heronStand = art.add([
    ".kWy",
    "..W.",
    ".GW.",
    "GGG.",
    "dGd.",
    ".l..",
  ], 1, 5, plume);
  const heronStrike = art.add([
    "....",
    "....",
    ".GWk",
    "GGGW",
    "dGdy",
    ".l..",
  ], 1, 5, plume);
  const heronUp = art.add([
    "g.....g",
    "Gg...gG",
    ".GgWgG.",
    "...l...",
  ], 3, 2, plume);
  const heronLevel = art.add([
    "ggGWGgg",
    "ddd.ddd",
    "...l...",
  ], 3, 0, plume);
  const heronDown = art.add([
    "..gWg..",
    ".gG.Gg.",
    "gG.l.Gg",
  ], 3, 0, plume);
  const heronFlap = [heronUp, heronLevel, heronDown, heronLevel] as const;

  // A monk: a dark habit, the hood up, a pale face.
  const habit = { k: [M.timber, 1], b: [M.timber, 8], f: [M.plaster, 11] } as const;
  const monkLeft = art.add([".k.", "kfk", "kbk", "kbb", "kb."], 1, 4, habit);
  const monkRight = art.add([".k.", "kfk", "kbk", "bbk", ".bk"], 1, 4, habit);

  const nearBy = offsets(NEAR, NEAR, true);
  const farOut = offsets(FORCED_X, FORCED_Y, false);

  const abbeys: { x: number; y: number }[] = [];
  for (let s = 0; s < ctx.sites.length; s++) if (ctx.sites[s].type === "abbey") abbeys.push({ x: ctx.sites[s].x, y: ctx.sites[s].y });
  // The monk's road search: steps from the abbey per pixel of the box, the queue, and the path walked.
  const BW = 2 * MONK_X + 1, BH = 2 * MONK_Y + 1;
  const steps = new Int16Array(BW * BH);
  const queue = new Int16Array(BW * BH);
  const path = new Int16Array(BW * BH);

  /** The appearance of each sight last reported. */
  const told = new Float64Array(RARE.length).fill(NaN);

  const layer: RareLayer = {
    name: "rare",
    log: null,
    draw(f: LiveFrame): void {
      let synced = false;
      for (let k = 0; k < RARE.length; k++) {
        const at = rareWindow(seed, k, f.t, forced);
        if (at < 0) continue;
        if (!synced) {
          art.sync(f.palette);
          synced = true;
        }
        const slot = rareSlot(k, f.t, forced);
        if (k === MONK) monk(f, at, slot);
        else if (forced) centred(f, k, at, slot);
        else scattered(f, k, at, slot);
      }
    },
  };

  /** Notes a sight for the tests and, once it is in full view, tells the visitor's log: once an appearance. */
  function seen(k: number, slot: number, px: number, py: number, inView: boolean): void {
    if (layer.log) layer.log.push({ kind: RARE[k].kind, px, py, inView: inView && veil === 255 });
    if (!inView || veil < 255 || told[k] === slot) return;
    told[k] = slot;
    ctx.discover?.(RARE[k].id, RARE[k].label);
  }

  // ── Where ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  function deep(f: LiveFrame, px: number, py: number, tone: number): boolean {
    const v = f.bake[py * f.rect.w + px];
    return isSea[v & 255] === 1 && ((v >>> 8) & 15) >= tone;
  }

  /** Whether sight `k` may stand on frame pixel (px, py), which is at least 14 pixels inside the frame. */
  function suits(f: LiveFrame, k: number, px: number, py: number): boolean {
    const w = f.rect.w, bake = f.bake;
    const v = bake[py * w + px];
    const m = v & 255;
    if (k === WHALE || k === SHIP) {
      if (isSea[m] === 0) return false;
      const tone = k === WHALE ? WHALE_DEEP : SHIP_DEEP;
      return deep(f, px, py, tone) && deep(f, px - 12, py, tone) && deep(f, px + 12, py, tone) && deep(f, px, py - 8, tone) && deep(f, px, py + 8, tone);
    }
    if (k === FOX) {
      return isField[m] === 1 && isField[bake[py * w + px - 4] & 255] === 1 && isField[bake[py * w + px + 4] & 255] === 1;
    }
    if (k === HERON) {
      if (m !== M.river) return false;
      // Shallows: the bank is a step away, on one side or the other.
      for (let d = -2; d <= 2; d += 4) {
        const side = bake[py * w + px + d] & 255, fore = bake[(py + d) * w + px] & 255;
        if ((side !== 0 && isWater[side] === 0) || (fore !== 0 && isWater[fore] === 0)) return true;
      }
      return false;
    }
    // The balloon: open hill country under it.
    if (m === 0 || isWater[m] === 1 || isBuilt[m] === 1) return false;
    return 0.8 * worldRowAt(f, px, py) - (f.rect.y + py) >= HILL;
  }

  /** The first pixel of `order` round (cx, cy) that suits sight `k`, as an index into the frame; −1 when none does. */
  function settle(f: LiveFrame, k: number, cx: number, cy: number, order: Int16Array): number {
    const w = f.rect.w, h = f.rect.h;
    for (let o = 0; o < order.length; o += 2) {
      const px = cx + order[o], py = cy + order[o + 1];
      if (px < 14 || px >= w - 14 || py < 14 || py >= h - 14) continue;
      if (suits(f, k, px, py)) return py * w + px;
    }
    return -1;
  }

  function show(f: LiveFrame, k: number, at: number, slot: number, i: number, hc: number): void {
    const w = f.rect.w;
    const px = i % w, py = (i - px) / w;
    if (k === WHALE) whale(f, px, py, at, slot, hc);
    else if (k === BALLOON) balloonOver(f, px, py, at, slot, hc);
    else if (k === FOX) fox(f, px, py, at, slot, hc);
    else if (k === HERON) heron(f, px, py, at, slot, hc);
    else sail(f, px, py, at, slot, hc);
  }

  /** The candidates of every tile the frame touches. */
  function scattered(f: LiveFrame, k: number, at: number, slot: number): void {
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / TILE_W, perY = (n * 0.8) / TILE_H;
    const tx1 = Math.floor((rx + w - 1) / TILE_W), ty1 = Math.floor((ry + h - 1) / TILE_H);
    for (let ty = Math.floor(ry / TILE_H); ty <= ty1; ty++) for (let tx = Math.floor(rx / TILE_W); tx <= tx1; tx++) {
      for (let c = 0; c < PER_TILE[k]; c++) {
        const hc = hash2(modP(tx, perX) + 64 * modP(ty, perY) + 4096 * c, slot * 8 + k, seed ^ 0x4a2e);
        const cx = tx * TILE_W + (hc % TILE_W) - rx, cy = ty * TILE_H + ((hc >>> 10) % TILE_H) - ry;
        if (cx < EDGE || cx >= w - EDGE || cy < EDGE || cy >= h - EDGE) continue;
        const i = settle(f, k, cx, cy, nearBy);
        if (i < 0) continue;
        const inside = Math.min(cx - EDGE, w - EDGE - 1 - cx, cy - EDGE, h - EDGE - 1 - cy);
        veil = inside >= VEIL ? 255 : Math.round((255 * (inside + 1)) / (VEIL + 1));
        show(f, k, at, slot, i, hc >>> 20);
        veil = 255;
      }
    }
  }

  /** Forced: one sight, as near the middle of the tile under the view's centre as the land allows. */
  function centred(f: LiveFrame, k: number, at: number, slot: number): void {
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const tx = Math.floor((rx + (w >> 1)) / FORCED_W), ty = Math.floor((ry + (h >> 1)) / FORCED_H);
    const i = settle(f, k, tx * FORCED_W + (FORCED_W >> 1) + FORCED_DX[k] - rx, ty * FORCED_H + (FORCED_H >> 1) + FORCED_DY[k] - ry, farOut);
    if (i >= 0) show(f, k, at, slot, i, hash2(tx, ty, seed ^ (0x51 + k)) >>> 8);
  }

  // ── What ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A dot of `rgb` at `a` on frame pixel (px, py), where that is water. */
  function onWater(f: LiveFrame, px: number, py: number, rgb: number, a: number): void {
    const w = f.rect.w;
    if (px < 0 || px >= w || py < 0 || py >= f.rect.h) return;
    if (isWater[f.bake[py * w + px] & 255] === 1) blend(f.out, py * w + px, rgb, (a * veil) / 255 | 0);
  }

  /** Broken water along a body's waterline: `half` pixels either side of (cx, y), flickering. */
  function wash(f: LiveFrame, cx: number, y: number, half: number, a: number): void {
    const white = f.palette[(M.whitewash << 8) | 15];
    const beat = Math.floor(f.t * 5);
    for (let dx = -half; dx <= half; dx++) {
      const g = hash2(dx + 64, beat, 0x77) & 255;
      const edge = dx <= 1 - half || dx >= half - 1;
      if (g < (edge ? 190 : 70)) onWater(f, cx + dx, y, white, a);
      if (g > 215) onWater(f, cx + dx, y + 1, white, a >> 1);
    }
  }

  /** How many of `rows` show of a thing that rises over `rise` seconds from `from`, stays, and sinks to be gone by `to`. */
  function risen(u: number, from: number, to: number, rise: number, rows: number): number {
    if (u <= from || u >= to) return 0;
    const up = (u - from) / rise, down = (to - u) / rise;
    const part = up < down ? up : down;
    return part >= 1 ? rows : Math.ceil(part * rows);
  }

  function whale(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const { palette } = f;
    const dir = (hc & 1) === 1 ? 1 : -1;
    const second = at >= WHALE_CYCLE;
    const u = second ? at - WHALE_CYCLE : at;
    // It travels: the second surfacing is a length further on.
    const x0 = px + dir * (second ? 9 : -9), y = py + (second ? ((hc >>> 1) & 3) - 1 : 0);
    const roll = u < 3 ? 0 : u > 7 ? 5 : Math.floor((u - 3) / 0.8);
    const x = x0 + dir * roll;

    // Its shadow under the water, before and between.
    const shade = smooth01((u - 0.3) / 1.6) * (1 - smooth01((u - 11.5) / 1.5));
    if (shade > 0) {
      const dark = palette[(M.roofSlate << 8) | 2];
      for (let dy = -1; dy <= 1; dy++) {
        const half = dy === 0 ? 8 : 6;
        for (let dx = -half; dx <= half; dx++) onWater(f, x + dx, y + dy, dark, Math.round(84 * shade));
      }
    }
    // The back rolls up and over.
    const backRows = risen(u, 2, 7.4, 0.9, back.h);
    if (backRows > 0) {
      put(f, back, x, y, dir < 0, 255, backRows);
      wash(f, x, y + 1, 7, 200);
    }
    // The spout, from the head.
    const su = u - 2.7;
    if (su >= 0 && su < 2.6) {
      const hx = x + dir * 4, hy = y - backRows;
      if (su < 0.25) put(f, spoutRising, hx, hy, false, 255, spoutRising.h);
      else if (su < 1.5) put(f, spoutFull, hx, hy, false, 255, spoutFull.h);
      else put(f, spoutGoing, hx + dir, hy - Math.floor((su - 1.5) * 2), false, Math.round(255 * (1 - (su - 1.5) / 1.1)), spoutGoing.h);
    }
    // The flukes, last.
    const tailRows = risen(u, 8.2, 11.6, 0.8, flukes.h);
    const tx = x0 + dir * 9;
    if (tailRows > 0) {
      put(f, flukes, tx, y, dir < 0, 255, tailRows);
      wash(f, tx, y + 1, 4, 210);
    }
    // And a ring of foam where it went down.
    const ru = u - 11.2;
    if (ru > 0 && ru < 4.5) {
      const white = palette[(M.whitewash << 8) | 15];
      const r = 3 + 2.6 * ru, a = Math.round(190 * (1 - ru / 4.5));
      for (let j = 0; j < 18; j++) {
        if ((hash2(j, Math.floor(f.t * 3), 0x91) & 3) === 0) continue;
        const ang = (j / 18) * 2 * Math.PI;
        onWater(f, tx + Math.round(r * pcos(ang)), y + Math.round(0.5 * r * psin(ang)), white, a);
      }
    }
    const up = backRows === back.h || tailRows === flukes.h;
    seen(WHALE, slot, x, y, up && x >= 10 && x < f.rect.w - 10 && y >= 12 && y < f.rect.h - 3);
  }

  function sail(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const w = f.rect.w;
    const dir = (hc & 1) === 1 ? 1 : -1;
    const lasts = RARE[SHIP].lasts;
    const x = px + Math.round(dir * 3.2 * (at - lasts / 2));
    if (x < 0 || x >= w || !deep(f, x, py, 5)) return;
    const a = Math.round(255 * easeInOut(at, lasts, 4));
    const y = py + Math.round(0.6 * psin(f.t * 1.3 + (hc & 7)));
    put(f, ship, x, y, dir < 0, a, ship.h);
    // A bow wave and the wake astern.
    const white = f.palette[(M.whitewash << 8) | 15];
    const beat = Math.floor(f.t * 4);
    onWater(f, x + dir * 7, py + 1, white, (a * 200) >> 8);
    for (let j = 1; j <= 7; j++) {
      if ((hash2(j, beat, 0x5a11) & 255) < 120) onWater(f, x - dir * (6 + j), py + 1 + (j > 4 ? (j & 1) : 0), white, (a * (210 - 24 * j)) >> 8);
    }
    seen(SHIP, slot, x, py, a > 200 && x >= 8 && x < w - 8 && py >= 10);
  }

  function balloonOver(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const w = f.rect.w, h = f.rect.h;
    const lasts = RARE[BALLOON].lasts;
    // It goes with the wind, east, and breathes up and down as the burner is worked.
    const x = px + Math.round(3.4 * (at - lasts / 2));
    const alt = BALLOON_ALT + Math.round(4 * psin(at * 0.21 + (hc & 7)));
    const y = py - alt;
    const a = Math.round(255 * easeInOut(at, lasts, 5));
    if (x < -6 || x >= w + 6) return;
    // Its shadow on the hill, down-sun.
    const dark = f.palette[(M.roofSlate << 8) | 1];
    const sx = x + Math.round(SHADOW_SLOPE * alt), sy = py + Math.round(0.8 * SHADOW_SLOPE * alt);
    for (let dy = -2; dy <= 2; dy++) {
      const half = dy === 0 ? 4 : dy === -1 || dy === 1 ? 3 : 2;
      for (let dx = -half; dx <= half; dx++) {
        const qx = sx + dx, qy = sy + dy;
        if (qx < 0 || qx >= w || qy < 0 || qy >= h || f.bake[qy * w + qx] === 0) continue;
        blend(f.out, qy * w + qx, dark, (a * veil * 58) / 65025 | 0);
      }
    }
    put(f, balloon, x, y, false, a, balloon.h);
    seen(BALLOON, slot, x, y, a > 200 && x >= 5 && x < w - 5 && y >= balloon.h && y < h);
  }

  function fox(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const w = f.rect.w, h = f.rect.h;
    const dir = (hc & 1) === 1 ? 1 : -1;
    const slope = (((hc >>> 1) & 3) - 1.5) * 0.1;
    // It trots out, stops to look about, and trots on.
    const sitting = at >= 9 && at < 12;
    const d = at < 9 ? -35 + 5 * at : sitting ? 10 : 10 + 5 * (at - 12);
    const x = px + Math.round(dir * d), y = py + Math.round(slope * d);
    if (x < 5 || x >= w - 5 || y < 4 || y >= h) return;
    // In a hedge or a ditch it is out of sight.
    if (isField[f.bake[y * w + x] & 255] === 0) return;
    const a = Math.round(255 * easeInOut(at, RARE[FOX].lasts, 1));
    const sprite = sitting ? foxSit : (Math.floor(at * 6) & 1) === 0 ? foxStretch : foxGather;
    put(f, sprite, x, y, dir < 0, a, sprite.h);
    seen(FOX, slot, x, y, a > 200);
  }

  function heron(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const w = f.rect.w, h = f.rect.h;
    const dir = (hc & 1) === 1 ? 1 : -1;
    if (at < HERON_LIFT) {
      // Standing, and now and then a strike at a fish.
      const a = Math.round(255 * smooth01(at / 1.5));
      const beat = at % 11;
      const sprite = beat >= 8 && beat < 9 ? heronStrike : heronStand;
      put(f, sprite, px, py, dir < 0, a, sprite.h);
      if (beat >= 8.8 && beat < 10.4) {
        const white = f.palette[(M.whitewash << 8) | 15];
        const r = 1 + Math.floor((beat - 8.8) * 2);
        onWater(f, px + dir * 2 - r, py, white, 150);
        onWater(f, px + dir * 2 + r, py, white, 150);
      }
      seen(HERON, slot, px, py, a > 200);
      return;
    }
    // Up, with slow beats, and away along the valley.
    const tau = at - HERON_LIFT;
    const run = tau < 3 ? 5 * tau * tau : 45 + 30 * (tau - 3);
    const rise = tau < 3 ? 8 * tau : 24;
    const x = px + Math.round(dir * run), y = py - Math.round(rise + 0.2 * run);
    if (x < -4 || x >= w + 4 || y < -3 || y >= h) return;
    const left = RARE[HERON].lasts - at;
    const a = Math.round(255 * smooth01(left / 2));
    const wings = heronFlap[Math.floor(tau * 3) & 3];
    put(f, wings, x, y, false, a, wings.h);
    seen(HERON, slot, x, y, a > 200 && x >= 4 && x < w - 4 && y >= 3);
  }

  /**
   * Floods the road from box pixel `from`, writing each pixel's steps from it into `steps`; returns how many pixels it
   * reached, and leaves the last of them in `last` and the one nearest the box's middle in `nearest`.
   */
  let last = 0, nearest = 0;
  function flood(bake: Uint32Array, w: number, x0: number, y0: number, from: number): number {
    let head = 0, tail = 0, best = 1e9;
    queue[tail++] = from;
    steps[from] = 0;
    while (head < tail) {
      const q = queue[head++];
      const qx = q % BW, qy = (q - qx) / BW;
      const dx = qx - MONK_X, dy = qy - MONK_Y;
      if (dx * dx + 2 * dy * dy < best) {
        best = dx * dx + 2 * dy * dy;
        nearest = q;
      }
      for (let j = 0; j < 8; j++) {
        const nx = qx + NEIGH_X[j], ny = qy + NEIGH_Y[j];
        if (nx < 0 || nx >= BW || ny < 0 || ny >= BH) continue;
        const q2 = ny * BW + nx;
        if (steps[q2] >= 0 || isRoad[bake[(y0 + ny) * w + x0 + nx] & 255] === 0) continue;
        steps[q2] = steps[q] + 1;
        queue[tail++] = q2;
      }
    }
    last = queue[tail - 1];
    return tail;
  }

  /** The monk walks the road out from the abbey and back, on the longest way the road goes within the box round it. */
  function monk(f: LiveFrame, at: number, slot: number): void {
    const w = f.rect.w, h = f.rect.h, bake = f.bake;
    for (let s = 0; s < abbeys.length; s++) {
      const ax = frameX(f, abbeys[s].x, 0);
      if (ax < MONK_X + 2 || ax >= w - MONK_X - 2) continue;
      // The church hides its own ground: take the row from the first column beside it that shows the ground.
      let ay = -1;
      for (let c = 0; c < BESIDE.length && ay < 0; c++) ay = groundRow(f, ax + BESIDE[c], abbeys[s].y);
      if (ay < MONK_Y + 6 || ay >= h - MONK_Y - 2) continue;
      const x0 = ax - MONK_X, y0 = ay - MONK_Y;
      // The biggest stretch of road in the box, and its pixel nearest the abbey.
      steps.fill(-1);
      let from = -1, most = 0;
      for (let ly = 0; ly < BH; ly++) for (let lx = 0; lx < BW; lx++) {
        const q0 = ly * BW + lx;
        if (steps[q0] >= 0 || isRoad[bake[(y0 + ly) * w + x0 + lx] & 255] === 0) continue;
        const size = flood(bake, w, x0, y0, q0);
        if (size > most) {
          most = size;
          from = nearest;
        }
      }
      if (from < 0) continue;
      // Flood along the road from there; the last pixel reached is the far end of his walk.
      steps.fill(-1);
      flood(bake, w, x0, y0, from);
      const far = last;
      const len = steps[far];
      if (len < 12) continue;
      // Back down the flood from the far end: path[j] is j steps from the abbey.
      let q = far;
      for (let j = len; j > 0; j--) {
        path[j] = q;
        const qx = q % BW, qy = (q - qx) / BW;
        for (let c = 0; c < 8; c++) {
          const nx = qx + NEIGH_X[c], ny = qy + NEIGH_Y[c];
          if (nx < 0 || nx >= BW || ny < 0 || ny >= BH) continue;
          if (steps[ny * BW + nx] === j - 1) {
            q = ny * BW + nx;
            break;
          }
        }
      }
      path[0] = from;
      const walked = Math.floor(MONK_PACE * at) % (2 * len);
      const j = walked <= len ? walked : 2 * len - walked;
      const p = path[j];
      const lx = p % BW, ly = (p - lx) / BW;
      const x = x0 + lx, y = y0 + ly;
      const a = Math.round(255 * easeInOut(at, RARE[MONK].lasts, 2));
      const sprite = (Math.floor(at * 2.5) & 1) === 0 ? monkLeft : monkRight;
      put(f, sprite, x, y, false, a, sprite.h);
      seen(MONK, slot, x, y, a > 200);
    }
  }

  return layer;
}

const BESIDE = [0, 16, -16, 28, -28, 40, -40];
const NEIGH_X = [1, -1, 0, 0, 1, -1, 1, -1];
const NEIGH_Y = [0, 0, 1, -1, 1, 1, -1, -1];

/**
 * The flier's wake: while it is within WAKE_LOW of water, two lines of foam open behind it on the surface and thin away
 * over WAKE_LASTS seconds. The track is the flier's heading held straight and the foam is fixed to the water, so the
 * wake needs no memory.
 */
export function wakeLayer(): LiveLayer {
  return {
    name: "wake",
    draw(f: LiveFrame): void {
      const fl = f.flier;
      if (!fl || fl.speed < 8) return;
      const { out, bake, palette } = f;
      const w = f.rect.w, h = f.rect.h;
      const px = frameX(f, fl.x, 0);
      if (px < 0 || px >= w) return;
      const gy = groundRow(f, px, fl.y);
      if (gy < 0 || isWater[bake[gy * w + px] & 255] === 0) return;
      const surface = 0.8 * worldRowAt(f, px, gy) - (f.rect.y + gy);
      const over = fl.alt - surface;
      if (over < 0 || over >= WAKE_LOW) return;
      const strength = smooth01((WAKE_LOW - over) / 10);
      const hx = pcos(fl.heading), hy = psin(fl.heading);
      const white = palette[(M.whitewash << 8) | 15];
      const along = fl.x * hx + fl.y * hy;
      const first = Math.floor(along / WAKE_STEP);
      const reach = fl.speed * WAKE_LASTS;
      for (let j = 1; ; j++) {
        const behind = along - (first - j) * WAKE_STEP;
        if (behind >= reach) break;
        const fade = 1 - behind / reach;
        const spread = 1 + behind * WAKE_SPREAD;
        const a = Math.round(150 * strength * fade);
        if (a < 6) continue;
        for (let side = -1; side <= 1; side += 2) {
          // Broken foam from the first, thinning to lace before it goes.
          const g = hash2(first - j, side, 0x3a7e) & 255;
          if (g > 40 + 130 * fade) continue;
          const sx = px + Math.round(-behind * hx + side * spread * hy);
          const sy = gy + Math.round(0.8 * (-behind * hy - side * spread * hx));
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
          const i = sy * w + sx;
          if (isWater[bake[i] & 255] === 0) continue;
          blend(out, i, white, a);
          // Soft: a paler pixel outside each fleck.
          if (sx + side >= 0 && sx + side < w && isWater[bake[i + side] & 255] === 1) blend(out, i + side, white, a / 3 | 0);
        }
      }
    },
  };
}
