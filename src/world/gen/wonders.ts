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
import type { SiteContext } from "./sites.ts";
import * as W from "./wonderworks.ts";

export type WonderType = "baths" | "railway" | "drowned-church" | "cove-hotel";

/** The order wonders are sited in: the one with the fewest places it could go first. */
export const WONDER_ORDER: readonly WonderType[] = ["cove-hotel", "drowned-church", "railway", "baths"];

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
}

export function wonderRules(n: number): WonderRules {
  const k = wonderScale(n);
  return {
    counts: { baths: 1, railway: 1, "drowned-church": 1, "cove-hotel": 1 },
    spacing: 600 * k,
    visible: 0.8,
    heightCap: 152,
    baths: { cliff: [12, 35], open: 120 * k, relief: 9 },
    railway: { flat: 220 * k, depth: 5, track: [150 * k, 300 * k], between: 1600 * k, lone: 40 * k },
    church: { across: 120 * k, shore: 20 * k, depth: 2 },
    hotel: { rock: 160 * k, exposure: 0.66, top: 14 },
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
      if (!dry || hi - lo > r.baths.relief) continue;
      tally.pass(L3);
      const x = 4 * gx + 2, y = 4 * gy + 2;
      out.push({
        x, y, level, height: 22, score: 3 - Math.abs(level - 27) / 5 - (hi - lo) / r.baths.relief,
        box: [x - 20, y - 10, x + 26, y + 38],
        anchors: { quay: [x, y + 35], funicularTop: [x + 20, y + 6], funicularFoot: [x + 20, y + 30] },
        probes: [[x, y, level, 22], [x, y + 20, level * 0.4, 6], [x, y + 33, 0, 3]],
      });
    }
    return out;
  },
  stand(land, w) {
    const seed = hash2(Math.floor(w.x), Math.floor(w.y), land.seed);
    const s = W.thermalBaths(w.level, seed);
    s.x = w.x - 18;
    s.y = w.y - 8;
    s.base = 0;
    // The cliff is cut back under the court and under each terrace, so no crag stands through the paving.
    const lv = W.bathLevels(w.level);
    const cut = (rows: readonly [number, number], level: number, x0: number, x1: number): Conform => ({
      kind: "dredge", x: s.x + (x0 + x1) / 2, y: s.y + (rows[0] + rows[1]) / 2, rx: (x1 - x0) / 2, ry: (rows[1] - rows[0]) / 2,
      round: false, level: level - 0.5, skirt: 1.5, limit: 0,
    });
    const conforms: Conform[] = [cut(W.BATH_ROWS.court, lv.court, 1, 41)];
    for (let k = 0; k < 3; k++) conforms.push(cut(W.BATH_ROWS.pools[k], lv.pools[k], 1, 40));
    conforms.push(cut(W.BATH_ROWS.quay, lv.quay, 0, W.BATH_W));
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
        // The line's whole length must be seen: it stands only a few units over the water.
        const probes: [number, number, number, number][] = [];
        for (let q = 2; q <= end; q += 4) probes.push([ax + ux * 4 * q, ay + uy * 4 * q, 0, 4]);
        probes.push([bx, by + 4, 0, 10]);
        out.push({
          x: bx + (east ? 8 : -8), y: by + 3, level: 0, height: 13,
          score: Math.min(run, 2 * flat) / flat + Math.min(dist[step(end)], 3 * lone) / lone + (far - run <= 2 ? 0.5 : 0) + (uy === 0 ? 0.3 : 0) - c.exposure[i] * 0.5,
          box: [Math.min(ax, bx) - 6, Math.min(ay, by) - 14, Math.max(ax, bx) + 22, Math.max(ay, by) + 14],
          anchors: { shore: [ax, ay], halt: [bx, by] },
          probes,
        });
      }
    }
    return out;
  },
  stand(land, w) {
    const { c } = land;
    const [ax, ay] = w.anchors.shore, [bx, by] = w.anchors.halt;
    const east = bx > ax, len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    // Bowed to one side, whichever keeps it over water; ruled only if neither does.
    const side = (hash2(Math.floor(ax), Math.floor(ay), land.seed) & 1) === 0 ? 1 : -1;
    let bow = 0;
    for (const b of [side * 0.035 * len, -side * 0.035 * len]) {
      let wet = true;
      for (let a = 12; a <= len && wet; a += 4) {
        const o = W.trackBow(b, a / len);
        if (!c.isSea[nodeOf(c, ax + ((bx - ax) * a - (by - ay) * o) / len, ay + ((by - ay) * a + (bx - ax) * o) / len)]) wet = false;
      }
      if (wet) { bow = b; break; }
    }
    const halt = W.tideHalt(east);
    halt.x = Math.floor(east ? bx : bx - halt.w);
    halt.y = Math.floor(by) - W.HALT_TRACK_ROW;
    halt.base = 0;
    return { structures: [...W.tideTrack(ax, ay, bx, Math.floor(by) + 0.5, bow), halt], conforms: [] };
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
    // Whatever rock stands within the hotel's oval is cut to its terrace, so none stands through the floor.
    const conforms: Conform[] = [{ kind: "dredge", x: w.x, y: w.y, rx: 18, ry: 9, round: true, level: 5, skirt: 2, limit: 0 }];
    return { structures: [s], conforms };
  },
};

const KINDS: Record<WonderType, Kind> = { baths: BATHS, railway: RAILWAY, "drowned-church": CHURCH, "cove-hotel": HOTEL };

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
    const kind = KINDS[type], names = kind.rules(rules);
    const tally = new Tally(names);
    const cands = kind.candidates(land, rules, tally);
    // Best first; ties keep the order the land was scanned in, so the order is the same on every run.
    const order = sortIndicesBy(Float64Array.from(cands, (q) => -q.score));
    const why = { spacing: 0, free: 0, seen: 0, cap: 0 };
    let placed = 0;
    for (const k of order) {
      const q = cands[k];
      if (placed >= rules.counts[type]) break;
      let apart = true;
      for (const t of held) {
        const dx = torusDelta(t.x, q.x, n), dy = torusDelta(t.y, q.y, n);
        if (dx * dx + dy * dy < rules.spacing * rules.spacing) { apart = false; break; }
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
    if (placed < rules.counts[type]) {
      const reason = cands.length === 0 ? `nowhere has ${tally.failed()}`
        : `${cands.length} places suit it, but ${why.spacing} are within ${Math.round(rules.spacing)} cells of a landmark or wonder, ${why.free} are built on, ${why.seen} are hidden from the camera and ${why.cap} are over the height cap`;
      skipped.push(`${type}: ${placed} of ${rules.counts[type]} placed: ${reason}`);
    }
  }
  return { wonders, skipped };
}

/** The structures and conforms of one placed wonder. */
export function standWonder(land: WonderLand, w: PlacedWonder): { structures: Structure[]; conforms: Conform[] } {
  return KINDS[w.type].stand(land, w);
}
