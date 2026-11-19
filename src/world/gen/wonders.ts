// The wonders (design 2026-11-18): rare places hidden where the land suits
// them. They are sited after the landmarks and everything else that is built,
// most constrained first, and never within WONDER_SPACING of a landmark or of
// each other. A wonder whose land is missing is skipped and named in
// `skipped`; it is never forced.
//
// A new wonder is one entry in KINDS: its candidates (where the land suits
// it) and its stand (the structures and conforms it puts there), plus a
// builder in gen/wonderworks.ts.
//
// Positions are in cells; G node j sits at cell 4j + 2. Every distance below
// is written at the 6400 scale and multiplied by wonderScale(n): worlds above
// 6400 keep the 6400 scale and add more islands.

import { hash2 } from "../core/hash.ts";
import { sortIndicesBy } from "../core/heap.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Conform, Structure } from "./built.ts";
import { coverAtNode, heightAt, isFarmable, isOpenCover, type SiteContext, tempAt } from "./sites.ts";
import { boat, put, sculpt } from "./structures.ts";
import * as W from "./wonderworks.ts";

export type WonderType =
  | "baths" | "railway" | "drowned-church" | "cove-hotel"
  | "marsh-house" | "airship-mast" | "bridge-town" | "great-oak" | "observatory";

/**
 * The order wonders are sited in: the one with the fewest places it could go first. Each round's wonders come
 * after the last round's, so a new wonder never moves one that has already been judged.
 */
export const WONDER_ORDER: readonly WonderType[] = [
  "cove-hotel", "drowned-church", "railway", "baths",
  "observatory", "bridge-town", "marsh-house", "airship-mast", "great-oak",
];

/** Lengths scale with the world up to 6400 cells a side, and no further. */
export function wonderScale(n: number): number {
  return Math.min(1, n / 6400);
}

export interface WonderRules {
  /** How many of each type. */
  counts: Record<WonderType, number>;
  /** Least distance from any landmark or other wonder, cells. */
  spacing: number;
  /** Share of each wonder's height the camera must see, at every point it is checked. */
  visible: number;
  /** Ground plus wonder stays under this. */
  heightCap: number;
  /** `cliff`: the cliff top's height. `open`: cells of open sea south of the quay. `relief`: the most the court's ground may vary. */
  baths: { cliff: readonly [number, number]; open: number; relief: number };
  /**
   * `flat`: least width of the shallows along the line. `depth`: the deepest water a trestle stands in.
   * `track`: the line's least and greatest length. `between`: the far shore lies within this of the near one.
   * `lone`: the halt is at least this far from any land.
   */
  railway: { flat: number; depth: number; track: readonly [number, number]; between: number; lone: number };
  /** `across`: the lake's least extent. `shore`: the tower's least distance from the shore. `depth`: the least water over the nave. */
  church: { across: number; shore: number; depth: number };
  /** `rock`: the rock lies within this of the cove's mouth. `exposure`: the cove's greatest exposure. `top`: the rock's greatest height. */
  hotel: { rock: number; exposure: number; top: number };
  /** `around`: marsh or tidal water this far round the house. `causeway`: its least and greatest length. */
  marsh: { around: number; causeway: readonly [number, number] };
  /**
   * `ground`: the headland's least and greatest height. `rays`: of sixteen compass rays, how many meet the sea
   * within `reach`. `exposure`: the shore's least exposure. `relief`: the most the pad's ground may vary.
   */
  mast: { ground: readonly [number, number]; rays: number; reach: number; exposure: number; relief: number };
  /**
   * `width`: the river's least and greatest width. `level`: the most the two bridgeheads may differ. `deck`: the
   * deck's least and greatest height over the water. `farm`: the least share of farmland within `within`.
   */
  bridgeTown: { width: readonly [number, number]; level: number; deck: readonly [number, number]; farm: number; within: number };
  /**
   * `village`: the knoll lies this far from a village, and `above` higher than it. `prominence`: over the land round it.
   * `open`: the least share of open ground within 40 cells.
   */
  oak: { village: readonly [number, number]; above: number; prominence: number; open: number };
  /** `least`: the lowest summit considered. `relief`: the most the terrace's ground may vary. */
  observatory: { least: number; relief: number };
}

export function wonderRules(n: number): WonderRules {
  const k = wonderScale(n);
  return {
    counts: {
      baths: 1, railway: 1, "drowned-church": 1, "cove-hotel": 1,
      "marsh-house": 1, "airship-mast": 1, "bridge-town": 1, "great-oak": 1, observatory: 1,
    },
    spacing: 600 * k,
    visible: 0.8,
    heightCap: 152,
    baths: { cliff: [12, 35], open: 120 * k, relief: 9 },
    railway: { flat: 220 * k, depth: 3, track: [150 * k, 300 * k], between: 1600 * k, lone: 40 * k },
    church: { across: 120 * k, shore: 20 * k, depth: 2 },
    hotel: { rock: 160 * k, exposure: 0.66, top: 14 },
    marsh: { around: 40, causeway: [40 * k, 160 * k] },
    mast: { ground: [8, 80], rays: 10, reach: 160 * k, exposure: 0.45, relief: 5 },
    bridgeTown: { width: [3, 12], level: 3, deck: [6.5, 10], farm: 0.25, within: 120 * k },
    oak: { village: [50 * k, 200 * k], above: 5, prominence: 2.5, open: 0.6 },
    observatory: { least: 30, relief: 30 },
  };
}

export interface PlacedWonder {
  id: string;
  type: WonderType;
  /** The wonder's focus, cells: the rotunda, the halt, the tower, the hotel's rock. */
  x: number;
  y: number;
  /** The height it stands on: the cliff top, the sea (0) or the lake's surface. */
  level: number;
  /** How far it stands above `level`. */
  height: number;
  /** Its footprint, cells: x0, y0, x1, y1 (unwrapped; x1 and y1 are past the end). */
  box: readonly [number, number, number, number];
  /** Named points a moment needs, cells: the quay, the track's two ends, the pontoon. */
  anchors: Record<string, readonly [number, number]>;
  score: number;
}

export interface WondersResult {
  wonders: PlacedWonder[];
  /** One line per wonder the land could not host: its type and the rule that failed. */
  skipped: string[];
}

/** What wonder siting reads beside the site context. */
export interface WonderLand {
  c: SiteContext;
  /** Ground on G as it stands now, with every pad cut in. */
  g: ArrayLike<number>;
  seed: number;
  lakes: readonly { id: number; level: number }[];
  /** Coves from the coast stage: the mouth, the unit vector inland, the length and the greatest half-width, cells. */
  coves: readonly { x: number; y: number; ax: number; ay: number; len: number; width: number }[];
  /** 1 on G nodes where something is built or a road runs. */
  busy: Uint8Array;
  /** The villages and the town, cells. */
  villages: readonly { x: number; y: number }[];
}

interface Cand {
  x: number;
  y: number;
  level: number;
  height: number;
  score: number;
  box: readonly [number, number, number, number];
  anchors: Record<string, readonly [number, number]>;
  /** Points the camera must see: x, y, the height the thing stands on there and how tall it is. */
  probes: readonly (readonly [number, number, number, number])[];
}

/** How many places passed each rule, in order: the first rule nothing passed is why a wonder was skipped. */
class Tally {
  private steps: [string, number][] = [];
  private index = new Map<string, number>();
  constructor(rules: string[]) {
    for (const r of rules) { this.index.set(r, this.steps.length); this.steps.push([r, 0]); }
  }
  pass(rule: string): void {
    this.steps[this.index.get(rule) as number][1]++;
  }
  failed(): string {
    for (const [rule, count] of this.steps) if (count === 0) return rule;
    return "every rule met at once";
  }
}

interface Kind {
  /** The rules a place must pass, in the order they are checked. */
  rules(r: WonderRules): string[];
  candidates(land: WonderLand, r: WonderRules, tally: Tally): Cand[];
  stand(land: WonderLand, w: PlacedWonder): { structures: Structure[]; conforms: Conform[] };
}

// ---------------------------------------------------------------------------
// Reading the land.

function at(c: SiteContext, gx: number, gy: number): number {
  return wrap(gy, c.gN) * c.gN + wrap(gx, c.gN);
}

function nodeOf(c: SiteContext, x: number, y: number): number {
  return at(c, Math.floor(x / 4), Math.floor(y / 4));
}

function isDry(c: SiteContext, i: number): boolean {
  return !c.isSea[i] && c.lakeId[i] < 0 && c.rw[i] === 0;
}

/** Share of a thing `height` tall standing at `level` on (x, y) that the land to the south leaves in view. */
function seen(c: SiteContext, x: number, y: number, level: number, height: number): number {
  const over = c.horizon[nodeOf(c, x, y)] - level;
  return over <= 0 ? 1 : over >= height ? 0 : 1 - over / height;
}

const seaDistMemo = new WeakMap<Uint8Array, Uint8Array>();
/** Nodes from each sea node to the nearest land, by 4-steps, capped at 250; 0 on land. */
function seaDistance(c: SiteContext): Uint8Array {
  const memo = seaDistMemo.get(c.isSea);
  if (memo) return memo;
  const gN = c.gN, nn = gN * gN;
  const dist = new Uint8Array(nn).fill(250);
  let frontier: number[] = [];
  for (let i = 0; i < nn; i++) if (!c.isSea[i]) { dist[i] = 0; frontier.push(i); }
  for (let d = 1; d < 250 && frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % gN, y = (i - x) / gN;
      for (let k = 0; k < 4; k++) {
        const j = at(c, x + (k === 0 ? 1 : k === 1 ? -1 : 0), y + (k === 2 ? 1 : k === 3 ? -1 : 0));
        if (dist[j] > d) { dist[j] = d; next.push(j); }
      }
    }
    frontier = next;
  }
  seaDistMemo.set(c.isSea, dist);
  return dist;
}

/** Ground at a cell as it stands now, bilinear on G. */
function groundAt(land: WonderLand, x: number, y: number): number {
  return heightAt({ h: land.g, gN: land.c.gN }, x, y);
}

// Sixteen compass rays, clockwise from east (y runs south): 0 E, 4 S, 8 W, 12 N.
const C1 = 0.9238795325112867, S1 = 0.3826834323650898, D1 = 0.7071067811865476;
const RX = [1, C1, D1, S1, 0, -S1, -D1, -C1, -1, -C1, -D1, -S1, 0, S1, D1, C1];
const RY = [0, S1, D1, C1, 1, C1, D1, S1, 0, -S1, -D1, -C1, -1, -C1, -D1, -S1];

/** The rock a thing built on (x, y) is made of: the material of its top and of its faces. */
function rockAt(c: SiteContext, x: number, y: number): [number, number] {
  const k = c.rock[nodeOf(c, x, y)];
  return k === 0 ? [M.rockHard, M.cliffHard] : k === 1 ? [M.rockSed, M.cliffSed] : [M.rockLime, M.cliffLime];
}

// ---------------------------------------------------------------------------
// The thermal baths: a south-facing sea cliff.

const BATHS: Kind = {
  rules: (r) => [
    `a cliff top ${r.baths.cliff[0]}–${r.baths.cliff[1]} high`,
    "the sea at the cliff's foot, 32 cells south",
    `${Math.round(r.baths.open)} cells of open sea beyond`,
    `a court that varies by ${r.baths.relief} or less`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1, L2, L3] = this.rules(r);
    const open = Math.max(2, Math.ceil(r.baths.open / 4));
    const out: Cand[] = [];
    for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx, level = c.h[i];
      if (!isDry(c, i) || level < r.baths.cliff[0] || level > r.baths.cliff[1]) continue;
      tally.pass(L0);
      // Land under the court's front, sea under the quay, in three columns across the width.
      let foot = true;
      for (const dx of [-4, 0, 4]) if (c.isSea[at(c, gx + dx, gy + 2)] || !c.isSea[at(c, gx + dx, gy + 8)]) foot = false;
      if (!foot) continue;
      tally.pass(L1);
      let clear = true;
      for (let d = 9; d <= 8 + open && clear; d++) for (const dx of [-4, 0, 4]) if (!c.isSea[at(c, gx + dx, gy + d)]) { clear = false; break; }
      if (!clear) continue;
      tally.pass(L2);
      let lo = Infinity, hi = -Infinity, dry = true;
      for (let dy = -2; dy <= 1; dy++) for (let dx = -5; dx <= 5; dx++) {
        const j = at(c, gx + dx, gy + dy), v = c.h[j];
        if (!isDry(c, j)) dry = false;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      // The west bridge stands on the cliff, which the stand then cuts for its arch.
      let west = true;
      for (let dy = -1; dy <= 2 && west; dy++) for (let dx = -7; dx <= -5; dx++) if (!isDry(c, at(c, gx + dx, gy + dy))) west = false;
      if (!dry || !west || hi - lo > r.baths.relief) continue;
      tally.pass(L3);
      const x = 4 * gx + 2, y = 4 * gy + 2;
      out.push({
        x, y, level, height: 31, score: 3 - Math.abs(level - 27) / 5 - (hi - lo) / r.baths.relief,
        box: [x - 29, y - 10, x + 26, y + 38],
        anchors: { quay: [x, y + 29], funicularTop: [x + 20, y + 6], funicularFoot: [x + 20, y + 26] },
        probes: [[x, y, level, 31], [x, y + 20, level * 0.4, 6], [x, y + 33, 0, 3]],
      });
    }
    return out;
  },
  stand(land, w) {
    const seed = hash2(Math.floor(w.x), Math.floor(w.y), land.seed);
    const s = W.thermalBaths(w.level, seed);
    s.x = w.x - 27;
    s.y = w.y - 8;
    s.base = 0;
    // The cliff is cut back under the court and under each terrace, so no crag stands through the paving.
    const lv = W.bathLevels(w.level);
    const cut = (rows: readonly [number, number], level: number, x0: number, x1: number): Conform => ({
      kind: "dredge", x: s.x + (x0 + x1) / 2, y: s.y + (rows[0] + rows[1]) / 2, rx: (x1 - x0) / 2, ry: (rows[1] - rows[0]) / 2,
      round: false, level: level - 0.5, skirt: 1.5, limit: 0,
    });
    const conforms: Conform[] = [cut(W.BATH_ROWS.court, lv.court, 10, 49)];
    for (let k = 0; k < 3; k++) conforms.push(cut(W.BATH_ROWS.pools[k], lv.pools[k], 10, 49));
    conforms.push(cut(W.BATH_ROWS.quay, lv.quay, 9, W.BATH_W - 1));
    // The west bridge's arch: the cliff under columns 1–6, rows 6–17, down to just under the upper pool.
    conforms.push({
      kind: "dredge", x: s.x + 3.5, y: s.y + 11.5, rx: 2.5, ry: 5.5, round: false, level: lv.pools[0] - 1, skirt: 1, limit: 0,
    });
    return { structures: [s], conforms };
  },
};

// ---------------------------------------------------------------------------
// The tide railway: the widest shallow flat between two shores.

// The line runs east or west, or a compass point either side: the camera looks north and sees the trestle side-on.
const RAIL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [0.9238795325112867, 0.3826834323650898], [0.9238795325112867, -0.3826834323650898],
  [-1, 0], [-0.9238795325112867, 0.3826834323650898], [-0.9238795325112867, -0.3826834323650898],
];

const RAILWAY: Kind = {
  rules: (r) => [
    "a low shore to start from",
    `shallows ${Math.round(r.railway.flat)} cells wide, ${r.railway.depth} deep or less`,
    `a far shore within ${Math.round(r.railway.between)} cells`,
    `a halt ${Math.round(r.railway.lone)} cells from any land`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1, L2, L3] = this.rules(r);
    const dist = seaDistance(c);
    const flat = Math.max(3, Math.ceil(r.railway.flat / 4)), reach = Math.ceil(r.railway.between / 4), lone = Math.max(2, Math.ceil(r.railway.lone / 4));
    const out: Cand[] = [];
    for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx;
      if (!isDry(c, i) || c.h[i] > 3 || c.shoreClass[i] === 3) continue;
      for (const [ux, uy] of RAIL_DIRS) {
        const step = (q: number): number => at(c, Math.floor(gx + 0.5 + ux * q), Math.floor(gy + 0.5 + uy * q));
        if (!c.isSea[step(1)] && !c.isSea[step(2)]) continue;
        tally.pass(L0);
        // The run of shallows from the shore.
        let run = 0;
        for (let q = 1; q <= reach; q++) {
          const j = step(q);
          if (!c.isSea[j] || -c.h[j] > r.railway.depth) break;
          run = q;
        }
        if (run < flat) continue;
        tally.pass(L1);
        let far = -1;
        for (let q = run + 1; q <= reach; q++) if (!c.isSea[step(q)]) { far = q; break; }
        if (far < 0) continue;
        tally.pass(L2);
        // The halt stands where the line is furthest from land, as far out as the track may run.
        const most = Math.min(run - 2, Math.floor(r.railway.track[1] / 4)), least = Math.ceil(r.railway.track[0] / 4);
        let end = -1;
        for (let q = least; q <= most; q++) if (dist[step(q)] >= lone && (end < 0 || dist[step(q)] > dist[step(end)])) end = q;
        if (end < 0) continue;
        tally.pass(L3);
        const ax = 4 * gx + 2, ay = 4 * gy + 2, len = 4 * end;
        const bx = ax + ux * len, by = ay + uy * len;
        const east = ux > 0;
        // The far shore is the land node the ray lands on, unwrapped so the track runs straight to it.
        const landed = step(far);
        let fx = 4 * (landed % gN) + 2, fy = 4 * Math.floor(landed / gN) + 2;
        const n = c.n;
        while (fx - ax > n / 2) fx -= n;
        while (ax - fx > n / 2) fx += n;
        while (fy - ay > n / 2) fy -= n;
        while (ay - fy > n / 2) fy += n;
        // The line's whole length must be seen: it stands only a few units over the water.
        const probes: [number, number, number, number][] = [];
        for (let q = 2; q <= end; q += 4) probes.push([ax + ux * 4 * q, ay + uy * 4 * q, 0, 4]);
        probes.push([bx, by + 4, 0, 10]);
        const span = Math.sqrt((fx - bx) * (fx - bx) + (fy - by) * (fy - by));
        for (let d = 12; d < span - 6; d += 16) {
          const t = d / span;
          probes.push([bx + (fx - bx) * t, by + (fy - by) * t, 0, 4]);
        }
        out.push({
          x: bx + (east ? 8 : -8), y: by + 3, level: 0, height: 13,
          score: Math.min(run, 2 * flat) / flat + Math.min(dist[step(end)], 3 * lone) / lone + (far - run <= 2 ? 0.5 : 0) + (uy === 0 ? 0.3 : 0) - c.exposure[i] * 0.5,
          box: [Math.min(ax, bx, fx) - 8, Math.min(ay, by, fy) - 16, Math.max(ax, bx, fx) + 28, Math.max(ay, by, fy) + 16],
          anchors: { shore: [ax, ay], halt: [bx, by], far: [fx, fy] },
          probes,
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const [ax, ay] = w.anchors.shore, [bx, by] = w.anchors.halt, [fx, fy] = w.anchors.far;
    const east = bx > ax;
    // The sag was the plan bow, seen from the south. The rails stay ruled; their height does not change.
    const bow = 0;
    const halt = W.tideHalt(east);
    halt.x = Math.floor(east ? bx : bx - halt.w);
    halt.y = Math.floor(by) - W.HALT_TRACK_ROW;
    halt.base = 0;
    const yLine = halt.y + W.HALT_TRACK_ROW + 0.5;
    const xEnd = halt.x + (east ? W.HALT_RAIL_END : halt.w - 1 - W.HALT_RAIL_END);
    const n = land.c.n;
    let farX = fx, farY = fy;
    while (farX - xEnd > n / 2) farX -= n;
    while (xEnd - farX > n / 2) farX += n;
    while (farY - yLine > n / 2) farY -= n;
    while (yLine - farY > n / 2) farY += n;
    const onward = (farX - xEnd) * (east ? 1 : -1) > 4 ? W.tideTrack(xEnd, yLine, farX, farY, 0) : [];
    // A shallow stripe under both runs and the halt, so the line reads pale against deeper water.
    const conforms: Conform[] = [];
    const wash = (x: number, y: number): void => {
      conforms.push({ kind: "raise", x, y, rx: 3.5, ry: 3.5, round: true, level: -0.4, skirt: 3, limit: 0 });
    };
    const run = (x0: number, y0: number, x1: number, y1: number): void => {
      const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      for (let d = 0; d <= len; d += 6) {
        const t = d / len;
        wash(x0 + dx * t, y0 + dy * t);
      }
    };
    run(ax, ay, bx, Math.floor(by) + 0.5);
    if (onward.length > 0) run(xEnd, yLine, farX, farY);
    for (let i = 0; i < halt.w; i += 6) wash(halt.x + i + 0.5, yLine);
    return { structures: [...W.tideTrack(ax, ay, bx, Math.floor(by) + 0.5, bow), ...onward, halt], conforms };
  },
};

// ---------------------------------------------------------------------------
// The drowned church: a lake wide enough to stand a tower in.

const CHURCH: Kind = {
  rules: (r) => [
    `a lake ${Math.round(r.church.across)} cells across`,
    `water ${Math.round(r.church.shore)} cells from the shore, ${r.church.depth} deep, with room for the nave`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1] = this.rules(r);
    const level = new Map<number, number>();
    for (const l of land.lakes) level.set(l.id, l.level);
    // Each lake's nodes, and its extent measured from its first node so a lake across the seam is not split.
    const nodes = new Map<number, number[]>();
    for (let i = 0; i < gN * gN; i++) {
      const id = c.lakeId[i];
      if (id < 0 || !level.has(id)) continue;
      const list = nodes.get(id);
      if (list) list.push(i);
      else nodes.set(id, [i]);
    }
    const shore = Math.max(2, Math.ceil(r.church.shore / 4));
    const out: Cand[] = [];
    for (const [id, list] of nodes) {
      const fx = list[0] % gN, fy = (list[0] - fx) / gN;
      let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
      for (const i of list) {
        const dx = torusDelta(fx, i % gN, gN), dy = torusDelta(fy, Math.floor(i / gN), gN);
        if (dx < x0) x0 = dx;
        if (dx > x1) x1 = dx;
        if (dy < y0) y0 = dy;
        if (dy > y1) y1 = dy;
      }
      if (4 * Math.max(x1 - x0 + 1, y1 - y0 + 1) < r.church.across) continue;
      tally.pass(L0);
      const lv = level.get(id) as number;
      const inLake = (gx: number, gy: number): boolean => c.lakeId[at(c, gx, gy)] === id;
      for (const i of list) {
        const gx = i % gN, gy = (i - gx) / gN;
        if (lv - c.h[i] < r.church.depth) continue;
        // Water all round the tower to `shore`, and under the nave east of it.
        let room = 0;
        while (room < 3 * shore && inLake(gx + room + 1, gy) && inLake(gx - room - 1, gy) && inLake(gx, gy + room + 1) && inLake(gx, gy - room - 1) &&
          inLake(gx + room + 1, gy + room + 1) && inLake(gx - room - 1, gy + room + 1) && inLake(gx + room + 1, gy - room - 1) && inLake(gx - room - 1, gy - room - 1)) room++;
        if (room < shore) continue;
        let nave = true;
        for (let dy = -3; dy <= 3 && nave; dy++) for (let dx = -3; dx <= 8; dx++) if (!inLake(gx + dx, gy + dy)) { nave = false; break; }
        if (!nave) continue;
        tally.pass(L1);
        const x = 4 * gx + 2, y = 4 * gy + 2;
        out.push({
          x, y, level: lv, height: 31, score: room / shore + list.length / 4000,
          box: [x - W.CHURCH_TOWER[0] - 2, y - W.CHURCH_TOWER[1] - 2, x - W.CHURCH_TOWER[0] + W.CHURCH_W + 2, y - W.CHURCH_TOWER[1] + W.CHURCH_H + 2],
          anchors: { tower: [x, y] },
          probes: [[x, y, lv, 27], [x + 14, y + 3, lv, 4]],
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const s = W.drownedChurch(hash2(Math.floor(w.x), Math.floor(w.y), land.seed));
    s.x = Math.floor(w.x) - W.CHURCH_TOWER[0];
    s.y = Math.floor(w.y) - W.CHURCH_TOWER[1];
    s.base = w.level;
    return { structures: [s], conforms: [] };
  },
};

// ---------------------------------------------------------------------------
// The hotel in the cove: a cove that opens south, with a rock offshore.

const HOTEL: Kind = {
  rules: (r) => [
    "a cove that opens south",
    `a sheltered cove (exposure ≤ ${r.hotel.exposure})`,
    `a rock ${r.hotel.top} high or less within ${Math.round(r.hotel.rock)} cells of its mouth`,
    "open water round the rock for the terrace and the pontoon",
  ],
  candidates(land, r, tally) {
    const { c } = land, n = c.n, [L0, L1, L2, L3] = this.rules(r);
    const out: Cand[] = [];
    for (const cove of land.coves) {
      if (cove.ay > -0.6) continue;
      tally.pass(L0);
      const e = c.exposure[nodeOf(c, cove.x, cove.y)];
      if (e > r.hotel.exposure) continue;
      tally.pass(L1);
      for (const rock of c.stacks) {
        const dx = torusDelta(cove.x, rock.x, n), dy = torusDelta(cove.y, rock.y, n);
        const d = Math.sqrt(dx * dx + dy * dy);
        // Off the mouth or beside it, never up the cove.
        if (d > r.hotel.rock || rock.top > r.hotel.top || dy < -8) continue;
        tally.pass(L2);
        // The hotel's own rock takes in whatever stands within its oval; outside it, nothing but water beside
        // and in front of the hotel, where the terrace, the landing stage and the pontoon go.
        let wet = true;
        for (let oy = -4; oy <= 26 && wet; oy += 4) for (let ox = -22; ox <= 22; ox += 4) {
          if (c.isSea[nodeOf(c, rock.x + ox, rock.y + oy)]) continue;
          if ((ox * ox) / (19 * 19) + (oy * oy) / (10 * 10) > 1) { wet = false; break; }
        }
        if (!wet) continue;
        tally.pass(L3);
        const x = Math.floor(rock.x), y = Math.floor(rock.y);
        const px = x - W.HOTEL_ROCK[0] + W.HOTEL_PONTOON[0], py = y - W.HOTEL_ROCK[1] + W.HOTEL_PONTOON[1];
        out.push({
          x, y, level: 0, height: 31, score: 2 - e - d / r.hotel.rock + cove.width / 40,
          box: [x - W.HOTEL_ROCK[0] - 2, y - W.HOTEL_ROCK[1] - 2, x - W.HOTEL_ROCK[0] + W.HOTEL_W + 2, y - W.HOTEL_ROCK[1] + W.HOTEL_H + 2],
          anchors: { pontoon: [px, py], cove: [cove.x, cove.y] },
          probes: [[x, y + 2, 0, 25], [px, py, 0, 2]],
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const [rock, cliff] = rockAt(land.c, w.x, w.y);
    const s = W.coveHotel(hash2(Math.floor(w.x), Math.floor(w.y), land.seed), rock, cliff);
    s.x = Math.floor(w.x) - W.HOTEL_ROCK[0];
    s.y = Math.floor(w.y) - W.HOTEL_ROCK[1];
    s.base = 0;
    // The hotel's own stack is cut, then raised, so the bake draws the cliff. Any other stack nearby is
    // dredged down, so the hotel leads.
    const conforms: Conform[] = [
      { kind: "dredge", x: w.x, y: w.y, rx: 18, ry: 9, round: true, level: 5, skirt: 2, limit: 0 },
      { kind: "raise", x: w.x, y: w.y, rx: 17, ry: 9, round: true, level: 5.5, skirt: 1.5, limit: 0 },
    ];
    for (const rock of land.c.stacks) {
      const dx = torusDelta(w.x, rock.x, land.c.n), dy = torusDelta(w.y, rock.y, land.c.n);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 4 || d > 25) continue;
      conforms.push({ kind: "dredge", x: rock.x, y: rock.y, rx: rock.r + 1, ry: rock.r + 1, round: true, level: d < 16 ? -1 : 12, skirt: 1, limit: 0 });
    }
    return { structures: [s], conforms };
  },
};

// ---------------------------------------------------------------------------
// The marsh house: a rise in a saltmarsh, with a causeway to firm ground.

/** The middle of the marsh house's yard in its raster. */
const YARD = [16.5, 11.5] as const;

const MARSH: Kind = {
  rules: (r) => [
    "a saltmarsh",
    `marsh and tidal water all round for ${r.marsh.around} cells`,
    `firm ground ${Math.round(r.marsh.causeway[0])}–${Math.round(r.marsh.causeway[1])} cells off across the marsh`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1, L2] = this.rules(r);
    const R = Math.ceil(r.marsh.around / 4);
    const marsh = (j: number): boolean => !c.isSea[j] && c.shoreClass[j] === 6 && c.lakeId[j] < 0 && c.rw[j] === 0;
    const tidal = (j: number): boolean => c.isSea[j] === 1 && c.h[j] > -1.5;
    const firm = (j: number): boolean => isDry(c, j) && c.shoreClass[j] !== 6 && c.h[j] >= 0.5;
    const out: Cand[] = [];
    for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx;
      if (!marsh(i)) continue;
      tally.pass(L0);
      // The yard is marsh and creeks, mostly marsh; round it, marsh and the shallow water of its creeks, with some open water.
      let yard = 0, yardOk = true;
      for (let dy = -3; dy <= 3 && yardOk; dy++) for (let dx = -4; dx <= 4; dx++) {
        const j = at(c, gx + dx, gy + dy);
        if (marsh(j)) yard++;
        else if (!tidal(j)) { yardOk = false; break; }
      }
      if (!yardOk || yard < 50) continue;
      let flat = 0, water = 0, count = 0;
      for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
        if (dx * dx + dy * dy > R * R) continue;
        const j = at(c, gx + dx, gy + dy);
        count++;
        if (marsh(j)) flat++;
        else if (tidal(j)) water++;
      }
      if ((flat + water) / count < 0.6 || water / count < 0.08) continue;
      tally.pass(L1);
      // The causeway leaves the yard on its south side, or east or west, and crosses only marsh and creeks.
      const x = 4 * gx + 2, y = 4 * gy + 2, sx = x - 16, sy = y - 11;
      let best: { k: number; len: number; score: number } | null = null;
      for (let k = 0; k < 16; k++) {
        if (RY[k] < -0.4) continue;
        const [gx0, gy0] = W.marshGate(RX[k], RY[k]);
        const ax = sx + gx0, ay = sy + gy0;
        let len = -1;
        for (let q = 2; q <= r.marsh.causeway[1]; q += 2) {
          const j = nodeOf(c, ax + RX[k] * q, ay + RY[k] * q);
          if (firm(j)) { len = q; break; }
          if (!marsh(j) && !tidal(j)) break;
        }
        if (len < r.marsh.causeway[0]) continue;
        const mid = (r.marsh.causeway[0] + r.marsh.causeway[1]) / 2;
        const score = RY[k] * 0.6 - Math.abs(len - mid) / mid;
        if (!best || score > best.score) best = { k, len, score };
      }
      if (!best) continue;
      tally.pass(L2);
      const [gx0, gy0] = W.marshGate(RX[best.k], RY[best.k]);
      const ax = sx + gx0, ay = sy + gy0, bx = ax + RX[best.k] * best.len, by = ay + RY[best.k] * best.len;
      const lamp = W.marshLamp(hash2(x, y, land.seed));
      out.push({
        x, y, level: W.MARSH_RISE, height: 19, score: (flat + 2 * Math.min(water, 0.3 * count)) / count + best.score,
        box: [Math.min(sx, bx) - 2, Math.min(sy, by) - 2, Math.max(sx + W.MARSH_W, bx) + 3, Math.max(sy + W.MARSH_H, by) + 3],
        anchors: { lamp: [sx + lamp, sy + 13], gate: [ax, ay], firm: [bx, by] },
        probes: [[x, y + 2, W.MARSH_RISE, 15], [(ax + bx) / 2, (ay + by) / 2, 0.5, 2]],
      });
    }
    return out;
  },
  stand(land, w) {
    const seed = hash2(Math.floor(w.x), Math.floor(w.y), land.seed);
    const [ax, ay] = w.anchors.gate, [bx, by] = w.anchors.firm;
    const s = W.marshHouse(seed, bx - ax, by - ay);
    s.x = Math.floor(w.x) - 16;
    s.y = Math.floor(w.y) - 11;
    s.base = W.MARSH_RISE;
    const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    const bow = ((hash2(Math.floor(ax), Math.floor(ay), land.seed) & 1) === 0 ? 1 : -1) * 0.04 * len;
    // The rise is built up out of the marsh; it is never cut.
    const conforms: Conform[] = [
      { kind: "raise", x: s.x + YARD[0], y: s.y + YARD[1], rx: 15.5, ry: 10.5, round: true, level: W.MARSH_RISE, skirt: 9, limit: 0 },
      { kind: "raise", x: s.x + YARD[0] + 6, y: s.y + YARD[1] - 4, rx: 8, ry: 6.5, round: true, level: W.MARSH_RISE, skirt: 5, limit: 0 },
    ];
    for (let y = 18; y <= 23; y++) for (let x = 0; x < s.w; x++) s.paint[y * s.w + x] = M.pastureCool;
    // Water along the south front. The boat sits six cells off the middle, away from the causeway.
    const [glx] = W.marshGate(bx - ax, by - ay);
    const away = glx >= 16.5 ? -1 : 1;
    const poolX = s.x + 16.5, poolY = s.y + 24.6;
    conforms.push({ kind: "dredge", x: poolX, y: poolY, rx: 10, ry: 2.5, round: false, level: -0.6, skirt: 2, limit: 0 });
    const boatX = poolX + away * 6, boatY = poolY;
    let gapX = 16, gapY = 22, gapD = Infinity;
    for (let y = 1; y <= 22; y++) for (let x = 1; x <= 32; x++) {
      const qdx = (x - 16.5) / 15, qdy = (y - 11.5) / 10, q = Math.sqrt(qdx * qdx + qdy * qdy);
      if (q < 0.93 || q > 1.04 || s.top[y * s.w + x] > 0) continue;
      const ox = x - (boatX - s.x), oy = y - (boatY - s.y), d = ox * ox + oy * oy;
      if (d < gapD) { gapD = d; gapX = x; gapY = y; }
    }
    const stepDx = boatX - (s.x + gapX), stepDy = boatY - (s.y + gapY);
    const stepLen = Math.sqrt(stepDx * stepDx + stepDy * stepDy) || 1;
    const su = stepDx / stepLen, sv = stepDy / stepLen;
    const steps = sculpt(9, 9);
    steps.base = 0;
    steps.x = Math.floor(s.x + gapX - 4);
    steps.y = Math.floor(s.y + gapY - 4);
    for (let k = 0; k < 3; k++) {
      const x = 4 + Math.round(su * (k + 1)), y = 4 + Math.round(sv * (k + 1));
      for (let dx = -1; dx <= 1; dx++) put(steps, x + dx, y, [1.6, 1.0, 0.5][k], M.stone, 160 - k * 16);
    }
    const hull = boat(seed);
    hull.x = Math.floor(boatX - 2);
    hull.y = Math.floor(boatY - 1);
    hull.base = 0;
    return { structures: [s, steps, hull, ...W.marshCauseway(ax, ay, bx, by, bow)], conforms };
  },
};

// ---------------------------------------------------------------------------
// The airship mast: an exposed headland.

const MAST: Kind = {
  rules: (r) => [
    `a headland ${r.mast.ground[0]}–${r.mast.ground[1]} high`,
    `an exposed shore (exposure ≥ ${r.mast.exposure})`,
    `the sea on ${r.mast.rays} of 16 sides within ${Math.round(r.mast.reach)} cells`,
    `a pad that varies by ${r.mast.relief} or less`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1, L2, L3] = this.rules(r);
    const reach = Math.max(4, Math.ceil(r.mast.reach / 4));
    const out: Cand[] = [];
    for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx, h = c.h[i];
      if (!isDry(c, i) || h < r.mast.ground[0] || h > r.mast.ground[1]) continue;
      tally.pass(L0);
      if (c.exposure[i] < r.mast.exposure) continue;
      tally.pass(L1);
      let rays = 0;
      for (let k = 0; k < 16 && rays + 16 - k >= r.mast.rays; k++) {
        for (let q = 1; q <= reach; q++) if (c.isSea[at(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q))]) { rays++; break; }
      }
      if (rays < r.mast.rays) continue;
      tally.pass(L2);
      let lo = Infinity, hi = -Infinity, sum = 0, dry = true;
      for (let dy = -2; dy <= 2 && dry; dy++) for (let dx = -5; dx <= 5; dx++) {
        const j = at(c, gx + dx, gy + dy);
        if (!isDry(c, j)) { dry = false; break; }
        const v = land.g[j];
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!dry || hi - lo > r.mast.relief) continue;
      tally.pass(L3);
      const x = 4 * gx + 2, y = 4 * gy + 2, level = sum / 55;
      const fx = x - 19 + W.MAST_FOOT[0], fy = y - 9 + W.MAST_FOOT[1];
      out.push({
        x, y, level, height: W.MAST_TALL,
        score: rays / 16 + c.exposure[i] + Math.min(level, 40) / 40 - (hi - lo) / (2 * r.mast.relief),
        box: [x - 20, y - 10, x + 40, y + 26],
        anchors: { mast: [fx, fy] },
        probes: [[fx, fy, level, W.MAST_TALL], [x + 10, y + 1, level, 6]],
      });
    }
    return out;
  },
  stand(land, w) {
    const s = W.airshipMast(hash2(Math.floor(w.x), Math.floor(w.y), land.seed));
    s.x = Math.floor(w.x) - 19;
    s.y = Math.floor(w.y) - 9;
    s.base = w.level;
    return { structures: [s], conforms: [{ kind: "flat", x: w.x, y: w.y, rx: 20, ry: 8.6, round: true, level: w.level, skirt: 5, limit: 3 }] };
  },
};

/** Rows of water meadow south of the bridge town, kept clear of wood so the arches are seen. */
const MEADOW = 22;

// ---------------------------------------------------------------------------
// The bridge town: a river 3–12 wide among farmland, running north–south so the bridge is seen side-on.

const BRIDGE_TOWN: Kind = {
  rules: (r) => [
    `a river ${r.bridgeTown.width[0]}–${r.bridgeTown.width[1]} wide running north–south`,
    `dry bridgeheads level within ${r.bridgeTown.level}`,
    "one channel under the deck",
    `a deck ${r.bridgeTown.deck[0]}–${r.bridgeTown.deck[1]} over the water`,
    `farmland round it (${Math.round(r.bridgeTown.farm * 100)}% within ${Math.round(r.bridgeTown.within)} cells)`,
  ],
  candidates(land, r, tally) {
    const { c } = land, [L0, L1, L2, L3, L4] = this.rules(r);
    const ring = Math.max(3, Math.ceil(r.bridgeTown.within / 4));
    // Where streams meet: the head of each reach that two or more flow into, and the narrowest of them.
    const into = new Map<number, number>(), count = new Map<number, number>();
    for (const q of c.reaches) {
      if (q.endsIn !== "reach") continue;
      const w = q.vertices[q.vertices.length - 2];
      into.set(q.downstream, Math.min(into.get(q.downstream) ?? Infinity, w));
      count.set(q.downstream, (count.get(q.downstream) ?? 0) + 1);
    }
    const joins: { x: number; y: number; w: number }[] = [];
    for (const q of c.reaches) if ((count.get(q.id) ?? 0) >= 2) joins.push({ x: q.vertices[0], y: q.vertices[1], w: into.get(q.id) as number });
    const out: Cand[] = [];
    for (const reach of c.reaches) {
      const v = reach.vertices;
      let run = 0, last = -Infinity;
      for (let k = 8; k + 12 <= v.length; k += 4) {
        run += Math.sqrt((v[k] - v[k - 4]) * (v[k] - v[k - 4]) + (v[k + 1] - v[k - 3]) * (v[k + 1] - v[k - 3]));
        const wide = v[k + 2];
        if (wide < r.bridgeTown.width[0] - 0.5 || wide > r.bridgeTown.width[1] + 0.5 || run - last < 16) continue;
        const px = v[k], py = v[k + 1];
        const i = nodeOf(c, px, py);
        if (c.isSea[i] || c.lakeId[i] >= 0) continue;
        const tx = v[k + 8] - v[k - 8], ty = v[k + 9] - v[k - 7], tl = Math.sqrt(tx * tx + ty * ty);
        if (tl < 1e-6 || (ty * ty) / (tl * tl) < 0.85) continue;
        tally.pass(L0);
        const water = v[k + 3];
        const wideLen = Math.round(wide + 40);
        const len = wideLen < 44 ? 44 : wideLen > 56 ? 56 : wideLen;
        const xa = Math.floor(px) - len / 2, xb = xa + len - 1, row = Math.floor(py);
        const ha = groundAt(land, xa - 3, row), hb = groundAt(land, xb + 3, row);
        if (!isDry(c, nodeOf(c, xa - 3, row)) || !isDry(c, nodeOf(c, xb + 3, row)) || Math.abs(ha - hb) > r.bridgeTown.level) continue;
        tally.pass(L1);
        // One river in sight of the town: no lake or sea, no stream joining it behind or under the houses (which hide
        // some 20 cells of the land behind them), and no second river joining it anywhere near. A rill is a thin line.
        let one = true;
        for (let y = row - 48; y <= row + 24 && one; y += 4) for (let x = xa - 12; x <= xb + 12; x += 4) {
          const j = nodeOf(c, x, y);
          if (c.isSea[j] || c.lakeId[j] >= 0) { one = false; break; }
        }
        for (const m of joins) {
          if (!one) break;
          const dx = torusDelta(px, m.x, c.n), dy = torusDelta(row, m.y, c.n);
          if (dx < xa - px - 12 || dx > xb - px + 12 || dy < -48 || dy > 24) continue;
          if (m.w >= 2 || (dx >= xa - px - 6 && dx <= xb - px + 6 && dy >= -32 && dy <= 8)) one = false;
        }
        if (!one) continue;
        tally.pass(L2);
        const deck = Math.max(r.bridgeTown.deck[0], Math.max(ha, hb) + 0.6 - water);
        if (deck > r.bridgeTown.deck[1]) continue;
        tally.pass(L3);
        let farm = 0, looked = 0;
        const gx = Math.floor(px / 4), gy = Math.floor(py / 4);
        for (let q = 0; q < 16; q++) for (const d of [ring / 3, (2 * ring) / 3, ring]) {
          const nx = Math.floor(gx + 0.5 + RX[q] * d), ny = Math.floor(gy + 0.5 + RY[q] * d), j = at(c, nx, ny);
          looked++;
          if (isDry(c, j) && c.slope[j] < 0.15 && isFarmable(coverAtNode(c, nx, ny))) farm++;
        }
        if (farm / looked < r.bridgeTown.farm) continue;
        tally.pass(L4);
        last = run;
        const sx = xa - W.BRIDGE_END, sy = row - W.BRIDGE_ROW - 4;
        const up = Math.max(0, k - 48), down = Math.min(v.length - 4, k + 48);
        out.push({
          x: px, y: py, level: water, height: deck + W.BRIDGE_TALL,
          score: (3 * farm) / looked + (ty * ty) / (tl * tl) + Math.min(wide, 12) / 2 - (0.5 * Math.abs(ha - hb)) / r.bridgeTown.level - (deck > 6 ? (deck - 6) / 3 : 0),
          box: [sx - 2, sy - 2, sx + len + 2 * W.BRIDGE_END + 2, sy + W.BRIDGE_H + MEADOW],
          anchors: { west: [xa, row], east: [xb, row], upstream: [v[up], v[up + 1]], downstream: [v[down], v[down + 1]] },
          probes: [[px, py + 4, water, deck + 14], [xa, py + 4, water, deck + 10], [xb, py + 4, water, deck + 10]],
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const { c } = land;
    const [xa, row] = w.anchors.west, [xb] = w.anchors.east;
    const len = xb - xa + 1, deck = w.height - W.BRIDGE_TALL, top = w.level + deck;
    const wet = Math.max(3, c.rw[nodeOf(c, w.x, w.y)]);
    const s = W.bridgeTown(len, wet, deck, hash2(Math.floor(w.x), Math.floor(w.y), land.seed));
    s.x = xa - W.BRIDGE_END;
    s.y = row - W.BRIDGE_ROW - 4;
    s.base = w.level;
    const mid = s.y + W.BRIDGE_ROW + W.BRIDGE_DEPTH / 2;
    // No bank stands through the town, and the road comes up to the deck at either end.
    const conforms: Conform[] = [
      { kind: "dredge", x: xa + len / 2, y: mid, rx: len / 2 + 2, ry: W.BRIDGE_DEPTH / 2 + 1, round: false, level: top - 0.4, skirt: 3, limit: 0 },
      { kind: "flat", x: xa - 4, y: mid, rx: 4, ry: 3, round: false, level: top, skirt: 8, limit: 2.5 },
      { kind: "flat", x: xb + 5, y: mid, rx: 4, ry: 3, round: false, level: top, skirt: 8, limit: 2.5 },
    ];
    const meadow = W.waterMeadow(len + 2 * W.BRIDGE_END + 4, MEADOW, s.x ^ s.y);
    meadow.x = s.x - 2;
    meadow.y = s.y + W.BRIDGE_ROW + W.BRIDGE_DEPTH;
    meadow.base = w.level;
    return { structures: [s, meadow], conforms };
  },
};

// ---------------------------------------------------------------------------
// The great oak: a knoll above a village.

const OAK: Kind = {
  rules: (r) => [
    "a village",
    `a knoll ${Math.round(r.oak.village[0])}–${Math.round(r.oak.village[1])} cells from a village, ${r.oak.above} above it and ${r.oak.prominence} over the land round it`,
    `open ground on its top and ${Math.round(r.oak.open * 100)}% of the ground round it`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1, L2] = this.rules(r);
    const near = Math.ceil(r.oak.village[1] / 4);
    const done = new Uint8Array(gN * gN);
    const out: Cand[] = [];
    for (const v of land.villages) {
      tally.pass(L0);
      const vx = Math.floor(v.x / 4), vy = Math.floor(v.y / 4), below = groundAt(land, v.x, v.y);
      for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) {
        const d = 4 * Math.sqrt(dx * dx + dy * dy);
        if (d < r.oak.village[0] || d > r.oak.village[1]) continue;
        const gx = vx + dx, gy = vy + dy, i = at(c, gx, gy);
        if (done[i]) continue;
        done[i] = 1;
        const level = land.g[i];
        if (!isDry(c, i) || c.slope[i] > 0.2 || level < below + r.oak.above) continue;
        // Nothing higher within 20 cells, and standing over the ring 24–40 cells out.
        let higher = false, sum = 0, count = 0;
        for (let ey = -10; ey <= 10 && !higher; ey++) for (let ex = -10; ex <= 10; ex++) {
          const d2 = ex * ex + ey * ey;
          if (d2 > 100) continue;
          const h = land.g[at(c, gx + ex, gy + ey)];
          if (d2 <= 25 && h > level + 0.3) { higher = true; break; }
          if (d2 >= 36) { sum += h > 0 ? h : 0; count++; }
        }
        if (higher || level - sum / count < r.oak.prominence) continue;
        tally.pass(L1);
        if (!isOpenCover(coverAtNode(c, gx, gy))) continue;
        // A lone tree in open country: the crown must stand clear of woods for the camera to see its shape.
        let open = 0;
        for (let q = 0; q < 16; q++) for (const e of [4, 7, 10]) {
          const nx = Math.floor(gx + 0.5 + RX[q] * e), ny = Math.floor(gy + 0.5 + RY[q] * e);
          if (isOpenCover(coverAtNode(c, nx, ny))) open++;
        }
        if (open / 48 < r.oak.open) continue;
        tally.pass(L2);
        const x = 4 * gx + 2, y = 4 * gy + 2, prom = level - sum / count;
        const ox = x - W.OAK_TRUNK[0], oy = y - W.OAK_TRUNK[1];
        out.push({
          x, y, level, height: W.OAK_TALL,
          // Best a little way up from the village, and behind it as the camera looks, so the village lies at its feet.
          score: Math.min(prom, 10) / 5 + Math.min(level - below, 20) / 12 + (v.y > y + 20 ? 1 : 0) - (1.5 * d) / r.oak.village[1] + (2 * open) / 48,
          box: [ox - 1, oy - 1, ox + W.OAK_W + 1, oy + W.OAK_H + 1],
          anchors: { crown: [x, y], swing: [ox + W.OAK_SWING[0], oy + W.OAK_SWING[1]], village: [v.x, v.y] },
          probes: [[x, y, level, W.OAK_TALL]],
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const s = W.greatOak(hash2(Math.floor(w.x), Math.floor(w.y), land.seed));
    s.x = Math.floor(w.x) - W.OAK_TRUNK[0];
    s.y = Math.floor(w.y) - W.OAK_TRUNK[1];
    s.base = w.level;
    return { structures: [s], conforms: [{ kind: "flat", x: w.x, y: w.y, rx: 4.5, ry: 4, round: true, level: w.level, skirt: 4, limit: 1.5 }] };
  },
};

// ---------------------------------------------------------------------------
// The observatory: the highest summit under the height cap.

/** The terrace's middle in the observatory's raster. */
const OBS_MID = [22.5, 11] as const;

const OBSERVATORY: Kind = {
  rules: (r) => [
    `a summit ${r.observatory.least} high or more, with nothing higher within 32 cells`,
    `ground under the terrace that varies by ${r.observatory.relief} or less`,
  ],
  candidates(land, r, tally) {
    const { c } = land, gN = c.gN, [L0, L1] = this.rules(r);
    const out: Cand[] = [];
    for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
      const i = gy * gN + gx, h = c.h[i];
      if (h < r.observatory.least || !isDry(c, i)) continue;
      let top = true;
      for (let dy = -8; dy <= 8 && top; dy++) for (let dx = -8; dx <= 8; dx++) if ((dx !== 0 || dy !== 0) && c.h[at(c, gx + dx, gy + dy)] > h) { top = false; break; }
      if (!top) continue;
      tally.pass(L0);
      let lo = Infinity, hi = -Infinity, dry = true;
      for (let dy = -3; dy <= 3 && dry; dy++) for (let dx = -6; dx <= 6; dx++) {
        const j = at(c, gx + dx, gy + dy);
        if (!isDry(c, j)) { dry = false; break; }
        const v = land.g[j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!dry || hi - lo > r.observatory.relief) continue;
      tally.pass(L1);
      // The terrace stands under the summit, the top cut away under it, and its wall stands on the slope below.
      const x = 4 * gx + 2, y = 4 * gy + 2, level = Math.max(hi - 8, lo + 0.6 * (hi - lo));
      const ox = Math.floor(x - OBS_MID[0]), oy = Math.floor(y - OBS_MID[1]);
      const domeX = ox + W.OBS_DOME[0], domeY = oy + W.OBS_DOME[1];
      out.push({
        x, y, level, height: W.OBS_TALL, score: level / 10 - (hi - lo) / (4 * r.observatory.relief),
        box: [ox - 1, oy - 1, ox + W.OBS_W + 1, oy + W.OBS_H + 1],
        anchors: { dome: [domeX, domeY] },
        probes: [[domeX, domeY + 7, level, 20], [ox + 40, oy + 14, level, 8]],
      });
    }
    return out;
  },
  stand(land, w) {
    const s = W.observatory(hash2(Math.floor(w.x), Math.floor(w.y), land.seed));
    s.x = Math.floor(w.x - OBS_MID[0]);
    s.y = Math.floor(w.y - OBS_MID[1]);
    s.base = w.level;
    // The summit is cut down under the terrace, so no rock stands through its flags.
    return { structures: [s], conforms: [{ kind: "dredge", x: s.x + OBS_MID[0], y: s.y + OBS_MID[1], rx: 22, ry: 11, round: false, level: w.level + 0.6, skirt: 3, limit: 0 }] };
  },
};

/**
 * The sea-level temperatures each wonder may stand in (design 8), and how much a place's temperature adds to its
 * score: the great oak and the bridge town in temperate or Mediterranean country, the drowned church in a lake that
 * is not frozen, the marsh house off the tundra and the jungle; the baths lean to the cold and the hotel to the warm.
 */
const WONDER_CLIMATE: Readonly<Record<WonderType, { lo: number; hi: number; lean?: (t: number) => number }>> = {
  "great-oak": { lo: 0.44, hi: 0.62 },
  "bridge-town": { lo: 0.44, hi: 0.66 },
  "drowned-church": { lo: 0.32, hi: 1 },
  "marsh-house": { lo: 0.3, hi: 0.75 },
  baths: { lo: 0, hi: 1, lean: (t) => (t < 0.4 ? 1.5 : 0) },
  "cove-hotel": { lo: 0.44, hi: 1, lean: (t) => (t > 0.56 ? 1 : 0) },
  // The tide railway runs over open shallows: it leans to seas the pack ice does not reach.
  railway: { lo: 0, hi: 1, lean: (t) => (t > 0.34 ? 2 : 0) },
  "airship-mast": { lo: 0, hi: 1 },
  observatory: { lo: 0, hi: 1 },
};

const KINDS: Record<WonderType, Kind> = {
  baths: BATHS, railway: RAILWAY, "drowned-church": CHURCH, "cove-hotel": HOTEL,
  "marsh-house": MARSH, "airship-mast": MAST, "bridge-town": BRIDGE_TOWN, "great-oak": OAK, observatory: OBSERVATORY,
};

// ---------------------------------------------------------------------------

export interface WonderOptions {
  /** Site only these types. */
  only?: readonly WonderType[];
}

function free(land: WonderLand, box: readonly [number, number, number, number]): boolean {
  const { c } = land;
  for (let gy = Math.floor(box[1] / 4); gy <= Math.floor((box[3] - 1) / 4); gy++) for (let gx = Math.floor(box[0] / 4); gx <= Math.floor((box[2] - 1) / 4); gx++) {
    if (land.busy[at(c, gx, gy)]) return false;
  }
  return true;
}

/**
 * Sites the wonders on land that is already settled. `taken` is every landmark site: a wonder stands at least
 * `rules.spacing` from each of them and from every other wonder, where nothing is built and no road runs,
 * in the camera's view and under the height cap.
 */
export function placeWonders(land: WonderLand, taken: readonly { x: number; y: number }[], rules: WonderRules = wonderRules(land.c.n), opts: WonderOptions = {}): WondersResult {
  const { c } = land, n = c.n;
  const held: { x: number; y: number }[] = taken.map((t) => ({ x: t.x, y: t.y }));
  const wonders: PlacedWonder[] = [], skipped: string[] = [];
  for (const type of WONDER_ORDER) {
    if (opts.only && !opts.only.includes(type)) continue;
    const kind = KINDS[type], climate = WONDER_CLIMATE[type], bounded = climate.lo > 0 || climate.hi < 1;
    const inClimate = `in its climate (temperature ${climate.lo}–${climate.hi})`;
    const names = bounded ? [...kind.rules(rules), inClimate] : kind.rules(rules);
    const tally = new Tally(names);
    const found = kind.candidates(land, rules, tally);
    // Each keeps to its climate, and leans to the one it likes best.
    const cands: Cand[] = [];
    for (const q of found) {
      const t = tempAt(c, q.x, q.y);
      if (t < climate.lo || t > climate.hi) continue;
      if (bounded) tally.pass(inClimate);
      cands.push(climate.lean ? { ...q, score: q.score + climate.lean(t) } : q);
    }
    // Best first; ties keep the order the land was scanned in, so the order is the same on every run.
    const order = sortIndicesBy(Float64Array.from(cands, (q) => -q.score));
    let why = { spacing: 0, free: 0, seen: 0, cap: 0 };
    let placed = 0;
    // A crowded world may leave a wonder no place at the full spacing; it then takes the best place at half of it.
    for (const reach of [rules.spacing, rules.spacing / 2]) {
    if (placed >= rules.counts[type]) break;
    why = { spacing: 0, free: 0, seen: 0, cap: 0 };
    for (const k of order) {
      const q = cands[k];
      if (placed >= rules.counts[type]) break;
      let apart = true;
      for (const t of held) {
        const dx = torusDelta(t.x, q.x, n), dy = torusDelta(t.y, q.y, n);
        if (dx * dx + dy * dy < reach * reach) { apart = false; break; }
      }
      if (!apart) { why.spacing++; continue; }
      if (!free(land, q.box)) { why.free++; continue; }
      let ok = true;
      for (const [px, py, level, height] of q.probes) if (seen(c, px, py, level, height) < rules.visible) { ok = false; break; }
      if (!ok) { why.seen++; continue; }
      if (q.level + q.height > rules.heightCap) { why.cap++; continue; }
      wonders.push({ id: `${type}-${placed}`, type, x: wrap(q.x, n), y: wrap(q.y, n), level: q.level, height: q.height, box: q.box, anchors: q.anchors, score: q.score });
      held.push({ x: q.x, y: q.y });
      placed++;
    }
    }
    if (placed < rules.counts[type]) {
      const reason = cands.length === 0 ? `nowhere has ${tally.failed()}`
        : `${cands.length} places suit it, but ${why.spacing} are within ${Math.round(rules.spacing / 2)} cells of a landmark or wonder, ${why.free} are built on, ${why.seen} are hidden from the camera and ${why.cap} are over the height cap`;
      skipped.push(`${type}: ${placed} of ${rules.counts[type]} placed: ${reason}`);
    }
  }
  return { wonders, skipped };
}

/** The structures and conforms of one placed wonder. */
export function standWonder(land: WonderLand, w: PlacedWonder): { structures: Structure[]; conforms: Conform[] } {
  return KINDS[w.type].stand(land, w);
}
