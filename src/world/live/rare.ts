// Rare sights: a whale breaching offshore, a balloon over the hills, a fox crossing a field, a heron in the river
// shallows, a ship under full sail, a monk on the abbey road. And the flier's wake on water, which alone remembers
// anything: the last few places the flier has been.
//
// Each sight keeps its own clock: one appearance in every stretch of ten to twenty minutes, at a moment the seed
// picks. While it lasts, the sight shows wherever a candidate point of the world's lattice (also the seed's) lies on
// land that suits it, so a visitor sees it only by being over the right country at the right time. Everything is drawn
// in bake space, on the pixel the land itself is drawn on, so nothing needs a depth test. One being watched as its time
// runs out lingers (see linger.ts): the balloon drifts on, the ship sails on, the fox trots on, the heron flies on and
// the monk walks home, until it is out of view. The layer remembers from frame to frame only where the sights it drew
// stood, and which appearance has already been reported. A candidate is settled on the land past the frame's edge as on
// it, so a sight standing or travelling across the edge is drawn part by part like the land.

import { hash2 } from "../core/hash.ts";
import { pcos, psin } from "../core/psin.ts";
import { isBuilt, isCrop, isWater, MATERIAL as M } from "../look/materials.ts";
import { artSet, blend, frameX, frameY, groundRow, modP, ringDelta, smooth01 } from "./art.ts";
import { Lingers } from "./linger.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import type { LayerContext } from "./registry.ts";
import { bakeAt, bakeBox, worldRowAt, type LiveSprite } from "./sprites.ts";

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
/** A sight settles on the nearest suitable pixel within this many pixels of its candidate. */
const NEAR = 16;
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
/** Past his time he goes in at his door, fading into the doorway over his last this many steps. */
const DOOR = 4;
/**
 * The wake: the flier must be within WAKE_LOW units of the water; foam lasts WAKE_LASTS seconds and trails no more
 * than WAKE_LONG cells, a mark every WAKE_STEP, the two arms WAKE_SPREAD apart for each cell behind.
 */
export const WAKE_LOW = 26;
export const WAKE_LASTS = 1.5;
export const WAKE_LONG = 40;
const WAKE_STEP = 1.5;
const WAKE_SPREAD = 0.27;
/** Places of the flier's track kept: enough to reach WAKE_LONG back at WAKE_STEP apart. */
const WAKE_KEEP = 32;
/** How far the foam can lie from the water under the flier: WAKE_LONG back with the arms' spread there, and a pixel. */
const WAKE_REACH_X = 54;
const WAKE_REACH_Y = 44;

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

/**
 * Where one sight drawn on the frame stood: its pixel in bake space (wrapped), its seed bits, its veil and appearance,
 * the monk's abbey, and, once a ship lingering past its time has met shoal water, where it lies to (NaN until then).
 */
interface Sighting {
  bx: number;
  by: number;
  hc: number;
  veil: number;
  slot: number;
  abbey: number;
  lie: number;
}

/**
 * How much of a sight shows, of 255: less while it eases in after a lingering one of its kind has gone (see linger.ts).
 * Set before each sight is drawn.
 */
let veil = 255;
/** Pixels the sight being drawn put on the frame: none means it is out of view. */
let inked = 0;
/** The sighting being drawn on past its time, or null. */
let going: Sighting | null = null;

/**
 * How far sight k, `at` seconds into its appearance, can draw from the pixel it settled on: `side` pixels either way,
 * `up` rows above and `down` below (filled by reachOf). Its travel at that moment, its sprite, and its shadow, wash
 * and wake; the whale's two surfacings and its ring of foam.
 */
const reach = { side: 0, up: 0, down: 0 };
function reachOf(k: number, at: number): void {
  if (k === WHALE) {
    reach.side = 34; reach.up = 11; reach.down = 10;
  } else if (k === SHIP) {
    reach.side = Math.round(3.2 * Math.abs(at - RARE[SHIP].lasts / 2)) + 14; reach.up = 9; reach.down = 2;
  } else if (k === BALLOON) {
    reach.side = Math.round(3.4 * Math.abs(at - RARE[BALLOON].lasts / 2)) + 28; reach.up = 78; reach.down = 21;
  } else if (k === FOX) {
    const d = at < 9 ? 35 : at < 12 ? 10 : 10 + 5 * (at - 12);
    reach.side = Math.ceil(d) + 5; reach.up = 3 + Math.ceil(0.15 * d) + 1; reach.down = Math.ceil(0.15 * d) + 1;
  } else {
    // The heron: standing, then up and away along the valley (see heron).
    const tau = at - HERON_LIFT;
    const run = tau < 0 ? 0 : tau < 3 ? 5 * tau * tau : 45 + 30 * (tau - 3);
    const rise = tau < 0 ? 0 : tau < 3 ? 8 * tau : 24;
    reach.side = Math.ceil(run) + 8; reach.up = Math.ceil(rise + 0.2 * run) + 8; reach.down = 4;
  }
}

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
      if (aa > 0) inked++;
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

  // A heron: a slate-grey back, darker than the pale water it stands in, a white neck and breast, a dark crest
  // trailing from the head, and dark tips to broad wings.
  const plume = {
    W: [M.whitewash, 15], g: [M.roofSlate, 13], s: [M.roofSlate, 10], k: [M.roofSlate, 1], y: [M.plaster, 11], l: [M.stoneDark, 2],
  } as const;
  const heronStand = art.add([
    "..kkWy.",
    "....W..",
    "....W..",
    "..gWW..",
    ".ggsW..",
    "kgsss..",
    ".kk.l..",
    "....l..",
  ], 4, 7, plume);
  const heronStrike = art.add([
    ".......",
    ".......",
    ".......",
    "..gkk..",
    ".ggsWW.",
    "kgsss.W",
    ".kk.l.y",
    "....l..",
  ], 4, 7, plume);
  const heronUp = art.add([
    "k.........k",
    "gk.......kg",
    ".gg.....gg.",
    "..ggsWsgg..",
    ".....l.....",
  ], 5, 3, plume);
  const heronLevel = art.add([
    "kkggsWsggkk",
    "..sss.sss..",
    ".....l.....",
  ], 5, 0, plume);
  const heronDown = art.add([
    "...gsWsg...",
    "..gg.l.gg..",
    ".gk.....kg.",
    "k.........k",
  ], 5, 0, plume);
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
  /** The land under the box, on the frame and past its edges. */
  const box = new Uint32Array(BW * BH);

  /** The appearance of each sight last reported. */
  const told = new Float64Array(RARE.length).fill(NaN);

  /** Which kinds linger past their time, and for each kind the sightings on the last frame and on this one. */
  const lingers = new Lingers(RARE.length);
  let seenLast: Sighting[][] = RARE.map(() => []);
  let seenNow: Sighting[][] = RARE.map(() => []);
  /** How far a kind kept waiting by a lingering one has eased in: set before each kind is drawn in its window. */
  let ease = 1;

  const layer: RareLayer = {
    name: "rare",
    log: null,
    draw(f: LiveFrame): void {
      lingers.frame(f.t);
      const last = seenLast;
      seenLast = seenNow;
      seenNow = last;
      let synced = false;
      for (let k = 0; k < RARE.length; k++) {
        seenNow[k].length = 0;
        const at = lingers.at(k, rareWindow(seed, k, f.t, forced), rareSlot(k, f.t, forced), false);
        if (at < 0) continue;
        if (!synced) {
          art.sync(f.palette);
          synced = true;
        }
        if (lingers.lingering(k)) linger(f, k, at);
        else {
          const slot = lingers.appearance(k);
          ease = lingers.fade(k, 1);
          if (k === MONK) monk(f, at, slot);
          else if (forced) centred(f, k, at, slot);
          else scattered(f, k, at, slot);
          ease = 1;
        }
        lingers.drawn(k, seenNow[k].length > 0);
      }
    },
  };

  /** Notes a sighting on the frame, so that if its time runs out now it goes on from there. */
  function keep(f: LiveFrame, k: number, px: number, py: number, hc: number, slot: number, abbey: number): void {
    seenNow[k].push({ bx: modP(f.rect.x + px, n), by: modP(f.rect.y + py, 0.8 * n), hc, veil, slot, abbey, lie: NaN });
  }

  /** Kind k's sightings on the last frame, past their time: each goes on from where it stood, kept while it shows. */
  function linger(f: LiveFrame, k: number, at: number): void {
    const list = seenLast[k];
    for (let j = 0; j < list.length; j++) {
      const s = list[j];
      veil = s.veil;
      going = s;
      const on = k === MONK
        ? monkAt(f, s.abbey, at, s.slot)
        : sight(f, k, at, s.slot, frameX(f, s.bx, n >> 1), frameY(f, s.by, (0.8 * n) >> 1), s.hc);
      going = null;
      if (on) seenNow[k].push(s);
    }
    veil = 255;
  }

  /** Notes a sight for the tests and, once it is in full view, tells the visitor's log: once an appearance. */
  function seen(k: number, slot: number, px: number, py: number, inView: boolean): void {
    if (layer.log) layer.log.push({ kind: RARE[k].kind, px, py, inView: inView && veil === 255 });
    if (!inView || veil < 255 || told[k] === slot) return;
    told[k] = slot;
    ctx.discover?.(RARE[k].id, RARE[k].label);
  }

  // ── Where ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Whether frame pixel (px, py), on the frame or past its edge, is sea at least `tone` from the shore. */
  function deep(f: LiveFrame, px: number, py: number, tone: number): boolean {
    const v = bakeAt(f, px, py);
    return isSea[v & 255] === 1 && ((v >>> 8) & 15) >= tone;
  }

  /** Whether the heron is asking for broad water: set by `settle`. */
  let broad = false;

  /** Whether sight `k` may stand on frame pixel (px, py), on the frame or past its edge: read from the land there. */
  function suits(f: LiveFrame, k: number, px: number, py: number): boolean {
    const m = bakeAt(f, px, py) & 255;
    if (k === WHALE || k === SHIP) {
      if (isSea[m] === 0) return false;
      const tone = k === WHALE ? WHALE_DEEP : SHIP_DEEP;
      return deep(f, px, py, tone) && deep(f, px - 12, py, tone) && deep(f, px + 12, py, tone) && deep(f, px, py - 8, tone) && deep(f, px, py + 8, tone);
    }
    if (k === FOX) {
      return isField[m] === 1 && isField[bakeAt(f, px - 4, py) & 255] === 1 && isField[bakeAt(f, px + 4, py) & 255] === 1;
    }
    if (k === HERON) {
      if (m !== M.river) return false;
      // Room to stand and be seen: water to either side and above or below, unless any river will do.
      if (broad) {
        if ((bakeAt(f, px - 1, py) & 255) !== M.river || (bakeAt(f, px + 1, py) & 255) !== M.river) return false;
        if ((bakeAt(f, px, py - 1) & 255) !== M.river && (bakeAt(f, px, py + 1) & 255) !== M.river) return false;
      }
      // Shallows: the bank is a step away, on one side or the other.
      for (let d = -2; d <= 2; d += 4) {
        const side = bakeAt(f, px + d, py) & 255, fore = bakeAt(f, px, py + d) & 255;
        if ((side !== 0 && isWater[side] === 0) || (fore !== 0 && isWater[fore] === 0)) return true;
      }
      return false;
    }
    // The balloon: open hill country under it.
    if (m === 0 || isWater[m] === 1 || isBuilt[m] === 1) return false;
    return 0.8 * worldRowAt(f, px, py) - (f.rect.y + py) >= HILL;
  }

  /** Where `settle` found a sight its place: a frame pixel, which may lie past the frame's edge. */
  const settled = { px: 0, py: 0 };

  /** The first pixel of `order` round (cx, cy) that suits sight `k`, into `settled`; false when none does. */
  function settle(f: LiveFrame, k: number, cx: number, cy: number, order: Int16Array): boolean {
    // The heron looks first for a stream broad enough to stand in, and takes a brook only when there is none.
    for (let pass = k === HERON ? 0 : 1; pass < 2; pass++) {
      broad = pass === 0;
      for (let o = 0; o < order.length; o += 2) {
        const px = cx + order[o], py = cy + order[o + 1];
        if (!suits(f, k, px, py)) continue;
        settled.px = px;
        settled.py = py;
        return true;
      }
    }
    return false;
  }

  function show(f: LiveFrame, k: number, at: number, slot: number, px: number, py: number, hc: number): void {
    const v = veil;
    veil = Math.round(veil * ease);
    if (sight(f, k, at, slot, px, py, hc)) keep(f, k, px, py, hc, slot, -1);
    veil = v;
  }

  /** Draws sight k standing on frame pixel (px, py), which may lie off the frame; true when some of it is on it. */
  function sight(f: LiveFrame, k: number, at: number, slot: number, px: number, py: number, hc: number): boolean {
    inked = 0;
    if (k === WHALE) whale(f, px, py, at, slot, hc);
    else if (k === BALLOON) balloonOver(f, px, py, at, slot, hc);
    else if (k === FOX) fox(f, px, py, at, slot, hc);
    else if (k === HERON) heron(f, px, py, at, slot, hc);
    else sail(f, px, py, at, slot, hc);
    return inked > 0;
  }

  /**
   * The candidates whose sight can reach the frame at this moment of its appearance (reachOf, and NEAR for settling),
   * wherever they lie: a candidate past the frame's edge is settled on the land there, as on the frame.
   */
  function scattered(f: LiveFrame, k: number, at: number, slot: number): void {
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const perX = n / TILE_W, perY = (n * 0.8) / TILE_H;
    reachOf(k, at);
    const side = reach.side + NEAR, up = reach.up + NEAR, down = reach.down + NEAR;
    const tx1 = Math.floor((rx + w + side) / TILE_W), ty1 = Math.floor((ry + h + up) / TILE_H);
    for (let ty = Math.floor((ry - down) / TILE_H); ty <= ty1; ty++) for (let tx = Math.floor((rx - side) / TILE_W); tx <= tx1; tx++) {
      for (let c = 0; c < PER_TILE[k]; c++) {
        const hc = hash2(modP(tx, perX) + 64 * modP(ty, perY) + 4096 * c, slot * 8 + k, seed ^ 0x4a2e);
        const cx = tx * TILE_W + (hc % TILE_W) - rx, cy = ty * TILE_H + ((hc >>> 10) % TILE_H) - ry;
        if (cx < -side || cx >= w + side || cy < -down || cy >= h + up) continue;
        if (!settle(f, k, cx, cy, nearBy)) continue;
        show(f, k, at, slot, settled.px, settled.py, hc >>> 20);
      }
    }
  }

  /** Forced: one sight, as near the middle of the tile under the view's centre as the land allows. */
  function centred(f: LiveFrame, k: number, at: number, slot: number): void {
    const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
    const tx = Math.floor((rx + (w >> 1)) / FORCED_W), ty = Math.floor((ry + (h >> 1)) / FORCED_H);
    if (!settle(f, k, tx * FORCED_W + (FORCED_W >> 1) + FORCED_DX[k] - rx, ty * FORCED_H + (FORCED_H >> 1) + FORCED_DY[k] - ry, farOut)) return;
    show(f, k, at, slot, settled.px, settled.py, hash2(tx, ty, seed ^ (0x51 + k)) >>> 8);
  }

  // ── What ───────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A dot of `rgb` at `a` on frame pixel (px, py), where that is water. */
  function onWater(f: LiveFrame, px: number, py: number, rgb: number, a: number): void {
    const w = f.rect.w;
    if (px < 0 || px >= w || py < 0 || py >= f.rect.h) return;
    if (isWater[f.bake[py * w + px] & 255] === 0) return;
    const aa = (a * veil) / 255 | 0;
    if (aa > 0) inked++;
    blend(f.out, py * w + px, rgb, aa);
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
    let x = px + Math.round(dir * 3.2 * (at - lasts / 2));
    if (going !== null) x = lieTo(f, going, px, x, py, dir);
    // The hull, the bow wave and the wake reach 13 pixels either side of its point.
    if (x < -13 || x >= w + 13 || !deep(f, x, py, 5)) return;
    const a = Math.round(255 * smooth01(at / 4));
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

  /**
   * Where a ship sailing on past its time is: at column x of its course from px, unless the water ahead has shoaled,
   * when it lies to in the last deep water it came through, and stays there.
   */
  function lieTo(f: LiveFrame, s: Sighting, px: number, x: number, py: number, dir: number): number {
    if (Number.isNaN(s.lie)) {
      // The water is read past the frame's edge as on it, so it lies to in the same place wherever the edge falls.
      if (deep(f, x, py, 5)) return x;
      let q = x;
      while ((q - px) * dir > 0 && !deep(f, q, py, 5)) q -= dir;
      s.lie = modP(f.rect.x + q, n);
    }
    return frameX(f, s.lie, n >> 1);
  }

  function balloonOver(f: LiveFrame, px: number, py: number, at: number, slot: number, hc: number): void {
    const w = f.rect.w, h = f.rect.h;
    const lasts = RARE[BALLOON].lasts;
    // It goes with the wind, east, and breathes up and down as the burner is worked.
    const x = px + Math.round(3.4 * (at - lasts / 2));
    const alt = BALLOON_ALT + Math.round(4 * psin(at * 0.21 + (hc & 7)));
    const y = py - alt;
    // In over its first seconds; past its time it drifts on out of view.
    const a = Math.round(255 * smooth01(at / 5));
    // The balloon reaches 4 pixels either side of its point, its shadow (down-sun) up to 27 right of it.
    if (x < -27 || x >= w + 4) return;
    // Its shadow on the hill, down-sun.
    const dark = f.palette[(M.roofSlate << 8) | 1];
    const sx = x + Math.round(SHADOW_SLOPE * alt), sy = py + Math.round(0.8 * SHADOW_SLOPE * alt);
    for (let dy = -2; dy <= 2; dy++) {
      const half = dy === 0 ? 4 : dy === -1 || dy === 1 ? 3 : 2;
      for (let dx = -half; dx <= half; dx++) {
        const qx = sx + dx, qy = sy + dy;
        if (qx < 0 || qx >= w || qy < 0 || qy >= h || f.bake[qy * w + qx] === 0) continue;
        const aa = (a * veil * 58) / 65025 | 0;
        if (aa > 0) inked++;
        blend(f.out, qy * w + qx, dark, aa);
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
    // It covers 4 pixels either side of its point and 3 rows above.
    if (x < -4 || x >= w + 4 || y < 0 || y >= h + 3) return;
    // In a hedge or a ditch it is out of sight; across a road or a track it is not.
    const under = bakeAt(f, x, y) & 255;
    if (isField[under] === 0 && isRoad[under] === 0) return;
    const a = Math.round(255 * smooth01(at));
    const sprite = sitting ? foxSit : (Math.floor(at * 6) & 1) === 0 ? foxStretch : foxGather;
    put(f, sprite, x, y, dir < 0, a, sprite.h);
    seen(FOX, slot, x, y, a > 200 && x >= 5 && x < w - 5 && y >= 4 && y < h);
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
        onWater(f, px + dir * 3 - r, py, white, 170);
        onWater(f, px + dir * 3 + r, py, white, 170);
      }
      seen(HERON, slot, px, py, a > 200 && px >= 6 && px < w - 6 && py >= 8 && py < h);
      return;
    }
    // Up, with slow beats, and away along the valley.
    const tau = at - HERON_LIFT;
    const run = tau < 3 ? 5 * tau * tau : 45 + 30 * (tau - 3);
    const rise = tau < 3 ? 8 * tau : 24;
    const x = px + Math.round(dir * run), y = py - Math.round(rise + 0.2 * run);
    // Its wings span 5 pixels either side of its point, from 3 rows above it to 3 below.
    if (x < -5 || x >= w + 5 || y < -3 || y >= h + 3) return;
    const wings = heronFlap[Math.floor(tau * 3) & 3];
    put(f, wings, x, y, false, 255, wings.h);
    seen(HERON, slot, x, y, x >= 6 && x < w - 6 && y >= 3 && y < h);
  }

  /**
   * Floods the road from box pixel `from`, writing each pixel's steps from it into `steps`; returns how many pixels it
   * reached, and leaves the last of them in `last` and the one nearest the box's middle in `nearest`.
   */
  let last = 0, nearest = 0;
  function flood(from: number): number {
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
        if (steps[q2] >= 0 || isRoad[box[q2] & 255] === 0) continue;
        steps[q2] = steps[q] + 1;
        queue[tail++] = q2;
      }
    }
    last = queue[tail - 1];
    return tail;
  }

  /** The monk walks the road out from each abbey in view and back, on the longest way the road goes in the box round it. */
  function monk(f: LiveFrame, at: number, slot: number): void {
    veil = Math.round(255 * ease);
    for (let s = 0; s < abbeys.length; s++) if (monkAt(f, s, at, slot)) keep(f, MONK, 0, 0, 0, slot, s);
    veil = 255;
  }

  /**
   * The monk of abbey s, `at` seconds into his walk; true when some of him is on the frame. Past his time he walks on
   * until his walk next brings him back to his door, and goes in.
   */
  function monkAt(f: LiveFrame, s: number, at: number, slot: number): boolean {
    inked = 0;
    const w = f.rect.w, h = f.rect.h;
    // He walks within the box round the abbey's ground: an abbey whose box reaches the frame is looked at, its road
    // read from the land past the frame's edge as on it.
    const ax = frameX(f, abbeys[s].x, MONK_X + 2);
    if (ax >= w + MONK_X + 2) return false;
    // The church hides its own ground: take the row from the first column beside it that shows the ground.
    let ay: number | null = null;
    for (let c = 0; c < BESIDE.length && ay === null; c++) ay = groundRow(f, ax + BESIDE[c], abbeys[s].y, MONK_Y + 5);
    if (ay === null || ay < -MONK_Y || ay >= h + MONK_Y + 5) return false;
    const x0 = ax - MONK_X, y0 = ay - MONK_Y;
    bakeBox(f, x0, y0, BW, BH, box);
    // The biggest stretch of road in the box, and its pixel nearest the abbey.
    steps.fill(-1);
    let from = -1, most = 0;
    for (let q0 = 0; q0 < BW * BH; q0++) {
      if (steps[q0] >= 0 || isRoad[box[q0] & 255] === 0) continue;
      const size = flood(q0);
      if (size > most) {
        most = size;
        from = nearest;
      }
    }
    if (from < 0) return false;
    // Flood along the road from there; the last pixel reached is the far end of his walk.
    steps.fill(-1);
    flood(from);
    const far = last;
    const len = steps[far];
    if (len < 12) return false;
    let a = 255 * smooth01(at / 2);
    const lasts = RARE[MONK].lasts;
    if (at >= lasts) {
      // Home is where his walk next comes back to its start; he fades into the doorway over his last steps to it.
      const end = MONK_PACE * lasts;
      let home = Math.ceil(end / (2 * len)) * 2 * len;
      if (home - end < 1) home += 2 * len;
      const left = home - MONK_PACE * at;
      if (left <= 0) return false;
      a *= smooth01(left / Math.min(DOOR, home - end));
    }
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
    const sprite = (Math.floor(at * 2.5) & 1) === 0 ? monkLeft : monkRight;
    put(f, sprite, x, y, false, Math.round(a), sprite.h);
    seen(MONK, slot, x, y, a > 200 && x >= 2 && x < w - 2 && y >= 5 && y < h);
    return inked > 0;
  }

  return layer;
}

const BESIDE = [0, 16, -16, 28, -28, 40, -40];
const NEIGH_X = [1, -1, 0, 0, 1, -1, 1, -1];
const NEIGH_Y = [0, 0, 1, -1, 1, 1, -1, -1];

/**
 * The flier's wake: while it is within WAKE_LOW of water, a short V of foam trails behind it along the way it has
 * come, so it bends through a turn; the marks lie still on the water, spread as they age and are gone within
 * WAKE_LONG cells or WAKE_LASTS seconds. The layer keeps the flier's last few places for this and nothing else: where
 * each was, when, the water's level under it and how strongly the foam was laid there (none over land, or from high
 * up). Foam already laid stays on its water and fades as it ages whatever the flier does next: crossing the shore,
 * climbing or slowing. Where the layer has no places (the first frame, or after a jump) the heading held straight
 * stands in for them.
 */
export function wakeLayer(): LiveLayer {
  // The track: places the flier has been, newest last, each WAKE_STEP or more from the one before, with how far it
  // had come by then, the time, the water's level under it (NaN where there was none in view) and the foam's strength
  // there. Unwrapped, so the track runs on across the world's seam.
  const tx = new Float64Array(WAKE_KEEP), ty = new Float64Array(WAKE_KEEP), run = new Float64Array(WAKE_KEEP);
  const tt = new Float64Array(WAKE_KEEP), tl = new Float64Array(WAKE_KEEP), ts = new Float64Array(WAKE_KEEP);
  let kept = 0, lastT = -Infinity;
  // The line the foam lies on, from the flier back: its corners, how far behind the flier each is, how old, and the
  // water's level and the foam's strength there.
  const lx = new Float64Array(WAKE_KEEP + 2), ly = new Float64Array(WAKE_KEEP + 2), lb = new Float64Array(WAKE_KEEP + 2);
  const la = new Float64Array(WAKE_KEEP + 2), ll = new Float64Array(WAKE_KEEP + 2), ls = new Float64Array(WAKE_KEEP + 2);
  return {
    name: "wake",
    draw(f: LiveFrame): void {
      const fl = f.flier;
      if (!fl) return;
      const { out, bake, palette } = f;
      const w = f.rect.w, h = f.rect.h;
      const hx = pcos(fl.heading), hy = psin(fl.heading);

      // The water under the flier now, if it is in view: its level, and how strongly foam is laid on it (by the
      // flier's height over it, and fading out as it slows to a stop).
      // The flier may be past the frame's edge with its foam on it: its water is read from the land there too.
      let level = NaN, strength = 0;
      const px = frameX(f, fl.x, WAKE_REACH_X);
      const gy = px < w + WAKE_REACH_X ? groundRow(f, px, fl.y, WAKE_REACH_Y) : null;
      if (gy !== null && isWater[bakeAt(f, px, gy) & 255] === 1) {
        level = 0.8 * worldRowAt(f, px, gy) - (f.rect.y + gy);
        const over = fl.alt - level;
        if (over >= 0 && over < WAKE_LOW) strength = smooth01((WAKE_LOW - over) / 10) * smooth01((fl.speed - 4) / 8);
      }

      // Where the flier is, on the track's own turn of the world, and how far it has come.
      let x = fl.x, y = fl.y, come = fl.x * hx + fl.y * hy;
      if (kept > 0) {
        const dx = ringDelta(tx[kept - 1], fl.x, f.n), dy = ringDelta(ty[kept - 1], fl.y, f.n);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (f.t < lastT || f.t - lastT > WAKE_LASTS || d > 0.5 * fl.speed + 12) kept = 0;
        else {
          x = tx[kept - 1] + dx;
          y = ty[kept - 1] + dy;
          come = run[kept - 1] + d;
        }
      }
      lastT = f.t;
      if (kept === 0 || come - run[kept - 1] >= WAKE_STEP) {
        if (kept === WAKE_KEEP) {
          tx.copyWithin(0, 1);
          ty.copyWithin(0, 1);
          run.copyWithin(0, 1);
          tt.copyWithin(0, 1);
          tl.copyWithin(0, 1);
          ts.copyWithin(0, 1);
          kept--;
        }
        tx[kept] = x;
        ty[kept] = y;
        tt[kept] = f.t;
        tl[kept] = level;
        ts[kept] = strength;
        run[kept++] = come;
      }

      // The line: the flier, the track back from it, then straight on the way the last of it ran (as old as it would
      // be had the flier come that way at its speed, laid as the last of it was).
      let m = 1, any = strength > 0;
      lx[0] = 0;
      ly[0] = 0;
      lb[0] = 0;
      la[0] = 0;
      ll[0] = level;
      ls[0] = strength;
      for (let k = kept - 1; k >= 0 && lb[m - 1] < WAKE_LONG; k--) {
        if (come - run[k] - lb[m - 1] < 0.25) continue;
        lx[m] = tx[k] - x;
        ly[m] = ty[k] - y;
        lb[m] = come - run[k];
        la[m] = f.t - tt[k];
        ll[m] = tl[k];
        ls[m] = ts[k];
        if (ts[k] > 0 && la[m] < WAKE_LASTS) any = true;
        m++;
      }
      if (!any) return;
      if (lb[m - 1] < WAKE_LONG) {
        let ux = -hx, uy = -hy;
        if (m > 1) {
          const len = Math.hypot(lx[m - 1] - lx[m - 2], ly[m - 1] - ly[m - 2]) || 1;
          ux = (lx[m - 1] - lx[m - 2]) / len;
          uy = (ly[m - 1] - ly[m - 2]) / len;
        }
        const more = WAKE_LONG - lb[m - 1] + 1;
        lx[m] = lx[m - 1] + ux * more;
        ly[m] = ly[m - 1] + uy * more;
        lb[m] = lb[m - 1] + more;
        la[m] = fl.speed > 0 ? la[m - 1] + more / fl.speed : Infinity;
        ll[m] = ll[m - 1];
        ls[m] = ls[m - 1];
        m++;
      }

      // Marks every WAKE_STEP of the way come, so each lies where it was laid as the flier goes on.
      const white = palette[(M.whitewash << 8) | 15];
      const first = Math.floor(come / WAKE_STEP);
      let seg = 1;
      for (let j = 1; ; j++) {
        const behind = come - (first - j) * WAKE_STEP;
        if (behind >= WAKE_LONG || behind >= lb[m - 1]) break;
        while (seg < m - 1 && lb[seg] < behind) seg++;
        const k = (behind - lb[seg - 1]) / (lb[seg] - lb[seg - 1]);
        // Older the further back: once past WAKE_LASTS, so is all the rest.
        const age = la[seg - 1] + (la[seg] - la[seg - 1]) * k;
        if (!(age < WAKE_LASTS)) break;
        const fade = 1 - Math.max(behind / WAKE_LONG, age / WAKE_LASTS);
        const a = Math.round(170 * (ls[seg - 1] + (ls[seg] - ls[seg - 1]) * k) * fade);
        if (a < 6) continue;
        // The water's level there: where one end of the stretch had none in view, the other's.
        const l0 = ll[seg - 1], l1 = ll[seg];
        const lvl = l0 !== l0 ? l1 : l1 !== l1 ? l0 : l0 + (l1 - l0) * k;
        const ex = lx[seg] - lx[seg - 1], ey = ly[seg] - ly[seg - 1];
        const len = Math.sqrt(ex * ex + ey * ey) || 1;
        const cx = lx[seg - 1] + ex * k, cy = ly[seg - 1] + ey * k;
        const spread = 1 + behind * WAKE_SPREAD;
        for (let side = -1; side <= 1; side += 2) {
          // Broken foam from the first, thinning to lace before it goes.
          const g = hash2(first - j, side, 0x3a7e) & 255;
          if (g > 60 + 150 * fade) continue;
          // Each fleck on its own water: where that is drawn, if it is in view and not behind nearer land or water. The
          // fleck may lie a pixel past the frame's side with its soft pixel on it, so it is read from the land there.
          const wx = fl.x + cx - (side * spread * ey) / len, wy = fl.y + cy + (side * spread * ex) / len;
          const sx = frameX(f, wx, 1), sy = frameY(f, 0.8 * wy - lvl, 0);
          if (sx > w || sy >= h) continue;
          if (isWater[bakeAt(f, sx, sy) & 255] === 0) continue;
          const off = worldRowAt(f, sx, sy) - wy;
          if (Math.abs(off - Math.round(off / f.n) * f.n) > 2) continue;
          const i = sy * w + sx;
          if (sx >= 0 && sx < w) blend(out, i, white, a);
          // Soft: a paler pixel outside each fleck.
          if (sx + side >= 0 && sx + side < w && isWater[bake[i + side] & 255] === 1) blend(out, i + side, white, a / 3 | 0);
        }
      }
    },
  };
}
