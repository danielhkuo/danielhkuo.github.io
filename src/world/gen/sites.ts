// S10 siting (design 5.6): the twelve reserved landmark sites. Candidates are
// scored on G, taken most-constrained type first (abbey with its town, then
// lighthouse, bridge, cathedral, windmill, yew), best score first, under the
// spacing rule. Every site must be seen by the fixed camera and stay under the
// height cap. A type with no passing site throws, naming the rule that failed.
//
// Positions are in cells; G node j sits at cell 4j + 2.

import { cover } from "../cover.ts";
import { sortIndicesBy } from "../core/heap.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import type { CoverInput } from "../look/contract.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { LandmarkType } from "../sites/assign.ts";
import { ARCHETYPE, lengthScale } from "./params.ts";
import { visibility } from "./visibility.ts";

/** What siting reads. Everything is on G unless it says C. */
export interface SiteFields {
  /** World size in cells, and nodes a side of G. */
  n: number;
  gN: number;
  /** Final ground. */
  h: Float64Array;
  isSea: Uint8Array;
  /** −1, or a lake id. */
  lakeId: Int32Array;
  hand: ArrayLike<number>;
  /** Coastal exposure 0–1 of the nearest shore. */
  exposure: ArrayLike<number>;
  shoreClass: Uint8Array;
  /** Talus debris, units. */
  debris: ArrayLike<number>;
  /** 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** C grid (gN / 2 a side): moisture, wind exposure, and six region planes. */
  moisture: ArrayLike<number>;
  wind: ArrayLike<number>;
  regions: ArrayLike<number>;
  /** C grid: sea-level temperature, 0.5 on the temperate plateau (gen/climate.ts). Absent: one temperate climate. */
  temp?: ArrayLike<number>;
  /** C grid: the dry side's share, 0 on the wet side … 1 on the dry (gen/climate.ts). Absent: one side. */
  arid?: ArrayLike<number>;
  reaches: readonly SiteReach[];
  /** Sea stacks from the coast stage, in cells. */
  stacks: readonly { x: number; y: number; r: number; top: number }[];
}

export interface SiteReach {
  id: number;
  downstream: number;
  endsIn: "sea" | "lake" | "reach";
  lake: number;
  fromLake: number;
  /** x, y, width, level per vertex; cells, unwrapped. */
  vertices: ArrayLike<number>;
}

export interface SiteRules {
  /** How many of each type. */
  counts: Record<LandmarkType, number>;
  /** Minimum distance between two sites, cells (the abbey and the town are exempt from each other). */
  spacing: number;
  /** The abbey's river reaches the town's bay within this many channel cells. */
  homeRiver: readonly [number, number];
  /** Share of the pad and of the sprite box that must be unhidden. */
  visible: number;
  /** Ground plus landmark stays under this. */
  heightCap: number;
  abbey: { above: readonly [number, number]; riverWidth: number; within: number; crownSlope: number };
  town: { exposure: number; rise: readonly [number, number]; within: number; mouthWithin: number; beach: number; opening: readonly [number, number]; fetch: number };
  lighthouse: { open: number; exposure: number; cliff: readonly [number, number]; stackTop: number };
  /**
   * `knoll`, when given, also admits a mill among its corn: a rise of at least `prominence` standing `height`
   * or more up, with at least `corn` of the ground within 40 cells gentle and farmable.
   */
  windmill: { prominence: number; wind: number; height: readonly [number, number]; alongSlope: number; knoll?: { prominence: number; height: number; corn: number } };
  /** `clear`: no other reach meets or passes the river within this many cells of the deck. */
  bridge: { width: number; level: number; deck: readonly [number, number]; clear: number };
  cathedral: { hand: number; slope: number; floor: number; hills: number; hillsWithin: number; river: readonly [number, number] };
  yew: { prominence: readonly [number, number]; alone: number };
}

/** Sprite boxes (design 5.9): pad width and depth in cells, landmark height in units. */
export const BOX: Record<LandmarkType, { w: number; d: number; h: number; round: boolean }> = {
  abbey: { w: 30, d: 24, h: 36, round: false },
  town: { w: 160, d: 120, h: 40, round: false },
  lighthouse: { w: 12, d: 12, h: 40, round: true },
  windmill: { w: 12, d: 12, h: 30, round: true },
  bridge: { w: 24, d: 6, h: 14, round: false },
  cathedral: { w: 34, d: 16, h: 26, round: false },
  yew: { w: 20, d: 20, h: 18, round: true },
};

/**
 * The rules of design 5.6 for a world of n cells. Distances that pace the flight scale with a smaller world; a larger
 * world keeps them and holds more landmarks (one abbey and one town in any world).
 */
export function siteRules(n: number): SiteRules {
  const k = lengthScale(n);
  return {
    // One of each, in a world of any size: a project is at the windmill, never at the third lighthouse.
    counts: { abbey: 1, town: 1, lighthouse: 1, bridge: 1, cathedral: 1, windmill: 1, yew: 1 },
    spacing: 1500 * k,
    homeRiver: [1200 * k, 2000 * k],
    visible: 0.8,
    heightCap: 152,
    abbey: { above: [25, 45], riverWidth: 2, within: 160, crownSlope: 0.12 },
    town: { exposure: 0.3, rise: [25, 45], within: 120, mouthWithin: 160, beach: 30, opening: [40, 120], fetch: 400 },
    lighthouse: { open: 220, exposure: 0.6, cliff: [12, 35], stackTop: 4 },
    windmill: { prominence: 8, wind: 0.7, height: [20, 50], alongSlope: 0.1 },
    bridge: { width: 3, level: 2, deck: [1.5, 14], clear: 48 },
    cathedral: { hand: 4, slope: 0.05, floor: 60, hills: 25, hillsWithin: 250, river: [30, 80] },
    yew: { prominence: [6, 15], alone: 120 },
  };
}

/**
 * The rules as the land the generator makes today can meet them. The home
 * island comes out low (its hills are 15–40, not 50) and its rivers short, the
 * wind field is nearly flat at 0.5, and exposed shores are low; each number
 * below is the spec's, loosened only as far as that needs. The spec's own
 * values score highest, so a seed that offers them gets them.
 */
export function builtRules(n: number): SiteRules {
  const k = lengthScale(n), r = siteRules(n);
  return {
    ...r,
    homeRiver: [600 * k, 2000 * k],
    abbey: { ...r.abbey, above: [8, 45] },
    lighthouse: { ...r.lighthouse, open: 180, exposure: 0.5, cliff: [6, 35] },
    // The ridges this land makes stand in heath and wood, far from any corn: a mill may also take a knoll among the fields.
    windmill: { ...r.windmill, prominence: 4, wind: 0.5, height: [12, 60], knoll: { prominence: 2, height: 5, corn: 0.12 } },
    // A true valley floor comes first: the river may be further off and the floor narrower, but hills stand close on both sides.
    cathedral: { hand: 5, slope: 0.1, floor: 32, hills: 12, hillsWithin: 320, river: [20, 320] },
    yew: { prominence: [4, 18], alone: 80 },
    town: { ...r.town, rise: [6, 70], beach: 12, mouthWithin: 400, fetch: 200 },
  };
}

export interface PlacedSite {
  id: string;
  type: LandmarkType;
  /** Pad centre, cells. */
  x: number;
  y: number;
  /** Pad height, units. */
  level: number;
  /** Pad footprint in cells: width (east–west) and depth (north–south); round pads have w = d = 2r. */
  pad: { w: number; d: number; round: boolean };
  /** Unit vector the front faces: the way the approach leaves the pad. */
  facing: readonly [number, number];
  /** Where a road should arrive, cells. `road` is false for a stack-top lighthouse. */
  approach: { x: number; y: number; road: boolean };
  /** Land component the site stands on. */
  island: number;
  score: number;
  /** Abbey: the home river's nearest point and its channel distance to the town's bay. */
  river?: { x: number; y: number; level: number; toBay: number };
  /** Town: the shore point the harbour is cut at, and the river mouth. */
  harbour?: { x: number; y: number; mouthX: number; mouthY: number };
  /** Bridge: the two abutments, the water level and the river's width. */
  span?: { ax: number; ay: number; bx: number; by: number; water: number; width: number };
  /** Lighthouse on a sea stack. */
  stack?: boolean;
}

export interface SitesResult {
  sites: PlacedSite[];
  /** The home island's land component. */
  home: number;
  /** Types that fell short when `strict` was off, with the rule that failed. */
  shortfall: string[];
  /** Kinds that found no ground in their own climate and stand in another, with where. */
  displaced: string[];
}

// Sixteen compass rays, clockwise from east (y runs south): 0 E, 4 S, 8 W, 12 N.
const C1 = 0.9238795325112867, S1 = 0.3826834323650898, D1 = 0.7071067811865476;
const RX = [1, C1, D1, S1, 0, -S1, -D1, -C1, -1, -C1, -D1, -S1, 0, S1, D1, C1];
const RY = [0, S1, D1, C1, 1, C1, D1, S1, 0, -S1, -D1, -C1, -1, -C1, -D1, -S1];

/** The fields siting derives once. */
export interface SiteContext extends SiteFields {
  /** |∇h| in height per cell. */
  slope: Float32Array;
  /** River width at the node (0 none), its water level, and the reach that runs there. */
  rw: Uint8Array;
  rlev: Float32Array;
  rreach: Int32Array;
  /** Channel cells from the node's river point down to the sea, and the reach it reaches the sea by (−1 none). */
  toSea: Float32Array;
  mouth: Int32Array;
  /** Land component per node (−1 on sea), and each component's size in nodes. */
  island: Int32Array;
  islandSize: number[];
  /** The home island. */
  home: number;
  /** Camera horizon: a top must exceed this to be seen. */
  horizon: Float32Array;
}

function landComponents(isSea: Uint8Array, gN: number): { island: Int32Array; size: number[] } {
  const island = new Int32Array(gN * gN).fill(-1);
  const size: number[] = [];
  const stack = new Int32Array(gN * gN);
  for (let s = 0; s < island.length; s++) {
    if (isSea[s] || island[s] >= 0) continue;
    const id = size.length;
    let top = 0, count = 0;
    stack[top++] = s;
    island[s] = id;
    while (top > 0) {
      const i = stack[--top];
      count++;
      const x = i % gN, y = (i - x) / gN;
      for (let k = 0; k < 4; k++) {
        const j = wrap(y + (k === 0 ? 1 : k === 1 ? -1 : 0), gN) * gN + wrap(x + (k === 2 ? 1 : k === 3 ? -1 : 0), gN);
        if (!isSea[j] && island[j] < 0) { island[j] = id; stack[top++] = j; }
      }
    }
    size.push(count);
  }
  return { island, size };
}

export function siteContext(f: SiteFields): SiteContext {
  const { gN, h, isSea } = f;
  const nn = gN * gN;
  const slope = new Float32Array(nn);
  for (let y = 0; y < gN; y++) {
    const yn = wrap(y - 1, gN) * gN, ys = wrap(y + 1, gN) * gN, row = y * gN;
    for (let x = 0; x < gN; x++) {
      const dx = (h[row + wrap(x + 1, gN)] - h[row + wrap(x - 1, gN)]) / 8, dy = (h[ys + x] - h[yn + x]) / 8;
      slope[row + x] = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // Reaches: lengths, the way to the sea, and their footprint on G.
  const byId = new Map<number, SiteReach>();
  for (const r of f.reaches) byId.set(r.id, r);
  const lakeOut = new Map<number, SiteReach>();
  for (const r of f.reaches) if (r.fromLake >= 0) lakeOut.set(r.fromLake, r);
  const len = new Map<number, number>();
  for (const r of f.reaches) {
    let l = 0;
    const v = r.vertices;
    for (let k = 4; k < v.length; k += 4) l += Math.sqrt((v[k] - v[k - 4]) * (v[k] - v[k - 4]) + (v[k + 1] - v[k - 3]) * (v[k + 1] - v[k - 3]));
    len.set(r.id, l);
  }
  // after[r]: channel cells below the reach's end; term[r]: the reach that meets the sea.
  const after = new Map<number, number>(), term = new Map<number, number>();
  const below = (r: SiteReach): SiteReach | undefined => (r.endsIn === "reach" ? byId.get(r.downstream) : r.endsIn === "lake" ? lakeOut.get(r.lake) : undefined);
  const resolve = (r: SiteReach): void => {
    const chain: SiteReach[] = [];
    let cur: SiteReach | undefined = r;
    while (cur && !after.has(cur.id) && chain.length <= f.reaches.length) {
      chain.push(cur);
      cur = below(cur);
    }
    const last = chain[chain.length - 1];
    let a = Infinity, t = -1;
    if (last.endsIn === "sea") { a = 0; t = last.id; }
    else if (cur && after.has(cur.id)) { a = (len.get(cur.id) as number) + (after.get(cur.id) as number); t = term.get(cur.id) as number; }
    after.set(last.id, a);
    term.set(last.id, t);
    for (let k = chain.length - 2; k >= 0; k--) {
      a += len.get(chain[k + 1].id) as number;
      after.set(chain[k].id, a);
      term.set(chain[k].id, t);
    }
  };
  for (const r of f.reaches) if (!after.has(r.id)) resolve(r);

  const rw = new Uint8Array(nn), rlev = new Float32Array(nn), rreach = new Int32Array(nn).fill(-1);
  const toSea = new Float32Array(nn).fill(Infinity), mouth = new Int32Array(nn).fill(-1);
  for (const r of f.reaches) {
    const v = r.vertices, total = len.get(r.id) as number, below = after.get(r.id) as number, t = term.get(r.id) as number;
    let run = 0;
    for (let k = 0; k + 4 <= v.length; k += 4) {
      const last = k + 8 > v.length;
      const ax = v[k], ay = v[k + 1];
      const bx = last ? ax : v[k + 4], by = last ? ay : v[k + 5];
      const seg = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      const steps = Math.max(1, Math.ceil(seg / 2));
      for (let s = 0; s < steps; s++) {
        const q = s / steps;
        const i = wrap(Math.floor((ay + q * (by - ay)) / 4), gN) * gN + wrap(Math.floor((ax + q * (bx - ax)) / 4), gN);
        const w = Math.max(1, Math.min(6, Math.floor(v[k + 2] + 0.5)));
        if (w >= rw[i]) {
          rw[i] = w;
          rlev[i] = v[k + 3];
          rreach[i] = r.id;
          toSea[i] = total - (run + q * seg) + below;
          mouth[i] = t;
        }
      }
      run += seg;
    }
  }

  const { island, size } = landComponents(isSea, gN);
  // Home: the island holding the most ground of the home archetype.
  const cN = gN / 2, plane = ARCHETYPE.home * cN * cN;
  const votes = new Float64Array(size.length);
  for (let y = 0; y < gN; y++) for (let x = 0; x < gN; x++) {
    const i = y * gN + x;
    if (island[i] >= 0 && f.regions[plane + (y >> 1) * cN + (x >> 1)] > 0.5) votes[island[i]]++;
  }
  let home = 0;
  for (let k = 1; k < size.length; k++) if (votes[k] > votes[home] || (votes[home] === 0 && size[k] > size[home])) home = k;

  // The camera's horizon over the land with water at its surface.
  const top = new Float32Array(nn);
  for (let i = 0; i < nn; i++) top[i] = h[i] > 0 ? h[i] : 0;
  const horizon = visibility(top, gN, 3.2, 50).horizon;

  return { ...f, slope, rw, rlev, rreach, toSea, mouth, island, islandSize: size, home, horizon };
}

interface Cand {
  /** Node. */
  gx: number;
  gy: number;
  /** Pad centre in cells, when it is not the node's centre. */
  x: number;
  y: number;
  level: number;
  score: number;
  /** Town: the reach that meets the sea in its bay. */
  mouthReach?: number;
  extra?: Partial<PlacedSite>;
}

/** Why a type's candidates ran out: how many nodes passed each rule, in order. */
class Tally {
  readonly steps: [string, number][] = [];
  private index = new Map<string, number>();
  pass(rule: string): void {
    let k = this.index.get(rule);
    if (k === undefined) { k = this.steps.length; this.index.set(rule, k); this.steps.push([rule, 0]); }
    this.steps[k][1]++;
  }
  declare(rule: string): void {
    if (!this.index.has(rule)) { this.index.set(rule, this.steps.length); this.steps.push([rule, 0]); }
  }
  /** The first rule nothing passed, or the last one. */
  failed(): string {
    for (const [rule, count] of this.steps) if (count === 0) return rule;
    return "too few places pass every rule";
  }
}

function idx(c: SiteContext, gx: number, gy: number): number {
  return wrap(gy, c.gN) * c.gN + wrap(gx, c.gN);
}

/** Ground at a cell position, bilinear on G. */
export function heightAt(c: { h: ArrayLike<number>; gN: number }, x: number, y: number): number {
  const u = x / 4 - 0.5, v = y / 4 - 0.5;
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, gN = c.gN;
  const r0 = wrap(j, gN) * gN, r1 = wrap(j + 1, gN) * gN, x0 = wrap(i, gN), x1 = wrap(i + 1, gN);
  return (c.h[r0 + x0] * (1 - fx) + c.h[r0 + x1] * fx) * (1 - fy) + (c.h[r1 + x0] * (1 - fx) + c.h[r1 + x1] * fx) * fy;
}

/**
 * Share of a pad and of the landmark's box the camera sees. The pad is the
 * node rectangle of half-sizes (hw, hd) round (gx, gy) at `level`; the box
 * stands `boxH` over its south edge.
 */
export function seenShare(c: SiteContext, gx: number, gy: number, hw: number, hd: number, level: number, boxH: number): { pad: number; box: number } {
  let pad = 0, count = 0;
  for (let dy = -hd; dy <= hd; dy++) for (let dx = -hw; dx <= hw; dx++) {
    count++;
    // The pad's own ground to the south is flattened to `level`, so only ground beyond it can hide a node.
    if (level > c.horizon[idx(c, gx + dx, gy + dy)] || dy < hd && hides(c, gx + dx, gy + dy, gy + hd, level)) pad++;
  }
  let box = 0;
  for (let dx = -hw; dx <= hw; dx++) {
    const over = c.horizon[idx(c, gx + dx, gy + hd)] - level;
    box += 1 - (over <= 0 ? 0 : over >= boxH ? 1 : over / boxH);
  }
  return { pad: pad / count, box: box / (2 * hw + 1) };
}

/** True when the node (gx, gy) at `level` is hidden only by pad ground between it and the pad's south edge row. */
function hides(c: SiteContext, gx: number, gy: number, south: number, level: number): boolean {
  // Seen past the pad if the horizon measured from the pad's south edge, carried north, lies under the level.
  const k = south - gy;
  return level > c.horizon[idx(c, gx, south)] - 3.2 * k;
}

const FLAT_MASK = new Uint8Array(65536).fill(128);
const region6 = new Float32Array(6);

/** The cover the bake would give this node, without jitter. */
export function coverAtNode(c: SiteContext, gx: number, gy: number): number {
  const gN = c.gN, cN = gN / 2;
  const i = idx(c, gx, gy);
  const ci = (wrap(gy, gN) >> 1) * cN + (wrap(gx, gN) >> 1);
  const dy = (c.h[idx(c, gx, gy + 1)] - c.h[idx(c, gx, gy - 1)]) / 8;
  const s = c.slope[i];
  for (let a = 0; a < 6; a++) region6[a] = c.regions[a * cN * cN + ci];
  const d = c.debris[i] / 3;
  const inp: CoverInput = {
    x: 4 * wrap(gx, gN) + 2, y: 4 * wrap(gy, gN) + 2, e: c.h[i], slope: s, northness: s > 1e-6 ? dy / s : 0,
    hand: c.hand[i], moisture: c.moisture[ci], wind: c.wind[ci], exposure: c.exposure[i], debris: d > 1 ? 1 : d,
    rock: c.rock[i], region: region6, water: 0, shore: c.shoreClass[i],
    temp: c.temp ? c.temp[ci] : undefined,
    arid: c.arid ? c.arid[ci] : undefined,
  };
  return cover(inp, FLAT_MASK, c.n);
}

/** Open ground a building can stand in: grass, heath, moor, scrub or crops. */
export function isOpenCover(m: number): boolean {
  return (m >= M.alpineCool && m <= M.moorWarm) || (m >= M.wheat && m <= M.vine) || (m >= M.meadowCool && m <= M.scrubWarm) || (m >= M.wheatRow && m <= M.stubbleRow) ||
    // The open ground of the other climates: tundra, steppe and savanna grass, garrigue, worn earth.
    (m >= M.tundraCool && m <= M.sedge) || (m >= M.steppeCool && m <= M.steppeWarm) || (m >= M.savannaCool && m <= M.savannaWarm) || m === M.garrigue || m === M.earthPale;
}

/** Ground a plough could work: meadow, pasture or crops; never heath, moor, scrub or wood. */
export function isFarmable(m: number): boolean {
  return (m >= M.wheat && m <= M.vine) || (m >= M.meadowCool && m <= M.pastureWarm) || (m >= M.wheatRow && m <= M.stubbleRow);
}

/** Mean slope and height range of the node block of half-sizes (hw, hd). */
function blockShape(c: SiteContext, gx: number, gy: number, hw: number, hd: number): { slope: number; range: number; land: boolean } {
  let s = 0, lo = Infinity, hi = -Infinity, land = true, count = 0;
  for (let dy = -hd; dy <= hd; dy++) for (let dx = -hw; dx <= hw; dx++) {
    const i = idx(c, gx + dx, gy + dy);
    if (c.isSea[i] || c.lakeId[i] >= 0 || c.rw[i] > 0) land = false;
    s += c.slope[i];
    const v = c.h[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    count++;
  }
  return { slope: s / count, range: hi - lo, land };
}

/** Sea nodes among the 16 rays at `r` nodes: a share of the circle. */
function openSea(c: SiteContext, gx: number, gy: number, r: number): number {
  let open = 0;
  for (let k = 0; k < 16; k++) {
    if (c.isSea[idx(c, Math.floor(gx + 0.5 + RX[k] * r), Math.floor(gy + 0.5 + RY[k] * r))] &&
      c.isSea[idx(c, Math.floor(gx + 0.5 + RX[k] * r * 0.6), Math.floor(gy + 0.5 + RY[k] * r * 0.6))]) open++;
  }
  return open / 16;
}

function cellOf(g: number): number {
  return 4 * g + 2;
}

// ---------------------------------------------------------------------------
// Town and abbey: chosen together, because the abbey's river must reach the town's bay.

function townCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const { gN } = c;
  const out: Cand[] = [];
  const L = {
    mouth: `a river mouth on the home island whose river runs ${Math.round(r.homeRiver[0])} channel cells at w ≥ ${r.abbey.riverWidth}`,
    shore: `sheltered south-facing shore (E ≤ ${r.town.exposure}) within ${r.town.mouthWithin} of the mouth`,
    rise: `hillside rising ${r.town.rise[0]}–${r.town.rise[1]} within ${r.town.within}`,
    bay: "bay opening to the south or south-east",
    beach: `beach ≥ ${r.town.beach}`,
    seen: `visibility ≥ ${r.visible}`,
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const span = Math.ceil(r.town.mouthWithin / 4), hill = Math.ceil(r.town.within / 4);
  // How far up each river system a channel of the abbey's width runs.
  const runs = new Map<number, number>();
  for (let i = 0; i < gN * gN; i++) {
    if (c.rw[i] >= r.abbey.riverWidth && c.mouth[i] >= 0 && c.toSea[i] <= r.homeRiver[1] && c.toSea[i] > (runs.get(c.mouth[i]) ?? 0)) runs.set(c.mouth[i], c.toSea[i]);
  }
  for (const reach of c.reaches) {
    if (reach.endsIn !== "sea" || reach.vertices.length < 8) continue;
    const v = reach.vertices, e = v.length - 4;
    const mx = Math.floor(v[e] / 4), my = Math.floor(v[e + 1] / 4);
    // The mouth's island: the last land node the reach crosses.
    let isl = -1;
    for (let k = e; k >= 0 && isl < 0; k -= 4) isl = c.island[idx(c, Math.floor(v[k] / 4), Math.floor(v[k + 1] / 4))];
    if (isl !== c.home || (r.counts.abbey > 0 && (runs.get(reach.id) ?? 0) < r.homeRiver[0])) continue;
    tally.pass(L.mouth);
    let best: Cand | null = null;
    for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
      const sx = mx + dx, sy = my + dy, s = idx(c, sx, sy);
      // A south-facing shore: land with the sea one and two nodes south.
      if (c.isSea[s] || c.island[s] !== c.home || !c.isSea[idx(c, sx, sy + 1)] || !c.isSea[idx(c, sx, sy + 2)]) continue;
      // The river enters beside the town, not through its middle.
      if (dx > -8 && dx < 8 && dy > -30 && dy < 6) continue;
      if (c.exposure[s] > r.town.exposure) continue;
      tally.pass(L.shore);
      // The hillside behind: the mean height of each row of the town's width, rising to the north.
      let rise = 0, landRows = 0, back = 0;
      for (let k = 1; k <= hill; k++) {
        let sum = 0, land = 0;
        for (let q = -12; q <= 12; q += 3) {
          const j = idx(c, sx + q, sy - k);
          if (!c.isSea[j] && c.lakeId[j] < 0) { land++; sum += c.h[j]; }
        }
        if (land >= 8) landRows++;
        const mean = land ? sum / land : 0;
        if (mean > rise) rise = mean;
        if (k === hill) back = mean;
      }
      if (landRows < 0.8 * hill || rise < r.town.rise[0] || rise > r.town.rise[1] || back < rise * 0.4) continue;
      tally.pass(L.rise);
      // The bay's opening: rays from just offshore that run `fetch` cells without meeting land.
      let open = 0, ox = 0, oy = 0;
      for (let k = 0; k < 16; k++) {
        let clear = true;
        for (let d = 3; d <= r.town.fetch / 4 && clear; d += 3) if (!c.isSea[idx(c, Math.floor(sx + 0.5 + RX[k] * d), Math.floor(sy + 3.5 + RY[k] * d))]) clear = false;
        if (clear) { open++; ox += RX[k]; oy += RY[k]; }
      }
      const arc = open * 22.5;
      // Opening somewhere between south-west and east, and no wider than a half circle.
      if (open === 0 || arc > 180 || oy <= 0 || ox < -0.6 * oy) continue;
      tally.pass(L.bay);
      let beach = 0;
      for (let q = -20; q <= 20; q++) for (let k = -6; k <= 3; k++) if (c.shoreClass[idx(c, sx + q, sy + k)] === 1) beach++;
      if (beach * 4 < r.town.beach) continue;
      tally.pass(L.beach);
      // No river through the town itself.
      let wet = false;
      for (let k = 0; k <= 26 && !wet; k += 2) for (let q = -18; q <= 18; q += 2) if (c.rw[idx(c, sx + q, sy - k)] > 1 || c.lakeId[idx(c, sx + q, sy - k)] >= 0) { wet = true; break; }
      if (wet) continue;
      // The pad: 160 × 120 cells reaching north from the shore; the bell tower stands a third of the way up.
      const cy = sy - 13, level = c.h[idx(c, sx, sy - 9)];
      const seen = seenShare(c, sx, sy - 9, 1, 1, level, BOX.town.h);
      const padSeen = seenShare(c, sx, cy, 18, 13, c.h[idx(c, sx, cy)], 1);
      if (seen.box < r.visible || padSeen.pad < 0.6) continue;
      tally.pass(L.seen);
      if (level + BOX.town.h > r.heightCap) continue;
      tally.pass(L.cap);
      const inArc = arc >= r.town.opening[0] && arc <= r.town.opening[1] ? 1 : 0.4;
      const southEast = ox >= -0.2 * oy ? 1 : 0.5;
      const inRise = rise >= 25 ? 1 : rise / 25;
      const score = 2 * (1 - c.exposure[s]) + 2 * inArc + southEast + 2 * inRise + Math.min(1, beach / 40) + seen.box - Math.sqrt(dx * dx + dy * dy) / span * 0.5;
      if (!best || score > best.score) {
        best = {
          gx: sx, gy: cy, x: cellOf(sx), y: cellOf(cy), level, score,
          mouthReach: reach.id,
          extra: { harbour: { x: cellOf(sx), y: cellOf(sy), mouthX: v[e], mouthY: v[e + 1] } },
        };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function abbeyCandidates(c: SiteContext, r: SiteRules, mouthReach: number, tally: Tally): Cand[] {
  const { gN } = c;
  const L = {
    river: `home river ${Math.round(r.homeRiver[0])}–${Math.round(r.homeRiver[1])} channel cells from the bay at w ≥ ${r.abbey.riverWidth}`,
    spur: `spur ${r.abbey.above[0]}–${r.abbey.above[1]} above the river within ${r.abbey.within}`,
    crown: `crown slope < ${r.abbey.crownSlope}`,
    seen: `visibility ≥ ${r.visible}`,
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const reachN = Math.ceil(r.abbey.within / 4);
  const best = new Map<number, Cand>();
  for (let i = 0; i < gN * gN; i++) {
    if (c.rw[i] < r.abbey.riverWidth || c.mouth[i] !== mouthReach) continue;
    const d = c.toSea[i];
    if (d < r.homeRiver[0] || d > r.homeRiver[1]) continue;
    tally.pass(L.river);
    const rx = i % gN, ry = (i - rx) / gN, water = c.rlev[i];
    for (let dy = -reachN; dy <= reachN; dy++) for (let dx = -reachN; dx <= reachN; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > reachN * reachN || d2 < 36) continue;
      const gx = rx + dx, gy = ry + dy, j = idx(c, gx, gy);
      if (c.island[j] !== c.home) continue;
      const above = c.h[j] - water;
      if (above < r.abbey.above[0] || above > r.abbey.above[1]) continue;
      tally.pass(L.spur);
      const shape = blockShape(c, gx, gy, 4, 3);
      if (!shape.land || shape.slope > r.abbey.crownSlope || shape.range > 9) continue;
      tally.pass(L.crown);
      const level = c.h[j];
      const seen = seenShare(c, gx, gy, 4, 3, level, BOX.abbey.h);
      if (seen.pad < r.visible || seen.box < r.visible) continue;
      tally.pass(L.seen);
      if (level + BOX.abbey.h > r.heightCap) continue;
      tally.pass(L.cap);
      // Inside a meander: the river on several sides.
      let sides = 0;
      for (let k = 0; k < 16; k++) {
        let hit = false;
        for (let q = 4; q <= 40 && !hit; q += 2) if (c.rw[idx(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q))] >= r.abbey.riverWidth) hit = true;
        if (hit) sides++;
      }
      // Best with the river to the south, where the camera sees the abbey over it, and near enough to read as one scene.
      const south = dy < 0 ? -dy / Math.sqrt(d2) : 0;
      const score = sides / 8 + south + (1 - shape.slope / r.abbey.crownSlope) + seen.box - Math.sqrt(d2) / reachN * 0.5 + (above >= 25 ? 1 : above / 25) + d / r.homeRiver[1];
      const key = wrap(gy, gN) * gN + wrap(gx, gN);
      const old = best.get(key);
      if (!old || score > old.score) {
        best.set(key, {
          gx, gy, x: cellOf(gx), y: cellOf(gy), level, score,
          extra: { river: { x: cellOf(rx), y: cellOf(ry), level: water, toBay: d } },
        });
      }
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------

function lighthouseCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const { gN } = c;
  const out: Cand[] = [];
  const L = {
    shore: `exposed shore (E ≥ ${r.lighthouse.exposure})`,
    cliff: `cliff of ${r.lighthouse.cliff[0]}–${r.lighthouse.cliff[1]}`,
    open: `${r.lighthouse.open}° of open sea within 40 cells`,
    face: "south- or south-west-facing",
    seen: `visibility ≥ ${r.visible}`,
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const i = gy * gN + gx;
    if (c.isSea[i] || c.exposure[i] < r.lighthouse.exposure) continue;
    // Within two nodes of the sea.
    let near = false;
    for (let k = 0; k < 16 && !near; k += 2) if (c.isSea[idx(c, Math.floor(gx + 0.5 + RX[k] * 2), Math.floor(gy + 0.5 + RY[k] * 2))]) near = true;
    if (!near) continue;
    tally.pass(L.shore);
    const level = c.h[i];
    if (level < r.lighthouse.cliff[0] || level > r.lighthouse.cliff[1]) continue;
    tally.pass(L.cliff);
    const open = openSea(c, gx, gy, 10);
    if (open * 360 < r.lighthouse.open) continue;
    tally.pass(L.open);
    // Sea to the south or south-west within 16 cells: the cliff the camera sees.
    let face = 0;
    for (let k = 3; k <= 7; k++) for (let q = 1; q <= 4; q++) if (c.isSea[idx(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q))]) { face++; break; }
    if (face < 2) continue;
    tally.pass(L.face);
    const seen = seenShare(c, gx, gy, 1, 1, level, BOX.lighthouse.h);
    if (seen.box < r.visible || seen.pad < r.visible) continue;
    tally.pass(L.seen);
    if (level + BOX.lighthouse.h > r.heightCap) continue;
    tally.pass(L.cap);
    out.push({ gx, gy, x: cellOf(gx), y: cellOf(gy), level, score: open * 2 + c.exposure[i] + face / 5 - Math.abs(level - 22) / 40 - (c.islandSize[c.island[i]] < 400 ? 2 : 0) });
  }
  // A headland a path can reach comes first: a skerry too small for a road scores as a stack does.
  // Stacks with a top wide enough carry a lighthouse and no road.
  for (const s of c.stacks) {
    if (0.6 * s.r < r.lighthouse.stackTop || s.top < 8 || s.top + BOX.lighthouse.h > r.heightCap) continue;
    const gx = Math.floor(s.x / 4), gy = Math.floor(s.y / 4);
    // A stack within sight of a real shore comes before one alone in open water, where a view shows the tower and nothing else.
    let shore = false;
    for (let d = 8; d <= 32 && !shore; d += 8) for (let k = 0; k < 16; k++) {
      const j = idx(c, Math.floor(gx + 0.5 + RX[k] * d), Math.floor(gy + 0.5 + RY[k] * d));
      if (!c.isSea[j] && c.islandSize[c.island[j]] >= 400) { shore = true; break; }
    }
    out.push({ gx, gy, x: s.x, y: s.y, level: s.top, score: shore ? 1.2 : 0.2, extra: { stack: true } });
  }
  return out;
}

function windmillCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const { gN } = c, cN = gN / 2;
  const out: Cand[] = [];
  const L = {
    height: `height ${r.windmill.height[0]}–${r.windmill.height[1]}`,
    wind: `wind X ≥ ${r.windmill.wind}`,
    crest: `ridge crest ≥ ${r.windmill.prominence} above the mean within 30`,
    along: `along-ridge slope < ${r.windmill.alongSlope}`,
    cover: "pasture or heath",
    seen: `visibility ≥ ${r.visible}`,
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const knoll = r.windmill.knoll;
  // Corn to grind: the share of the ground within 40 cells that is gentle and farmable.
  const cornBy = (gx: number, gy: number): number => {
    let corn = 0;
    for (let k = 0; k < 16; k++) for (const q of [4, 7, 10]) {
      const nx = Math.floor(gx + 0.5 + RX[k] * q), ny = Math.floor(gy + 0.5 + RY[k] * q), j = idx(c, nx, ny);
      if (!c.isSea[j] && c.lakeId[j] < 0 && c.rw[j] === 0 && c.slope[j] < 0.12 && isFarmable(coverAtNode(c, nx, ny))) corn++;
    }
    return corn / 48;
  };
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const i = gy * gN + gx;
    const level = c.h[i];
    if (c.isSea[i] || level < (knoll ? Math.min(knoll.height, r.windmill.height[0]) : r.windmill.height[0]) || level > r.windmill.height[1] || c.rw[i] > 0 || c.lakeId[i] >= 0) continue;
    const ridge = level >= r.windmill.height[0];
    if (ridge) tally.pass(L.height);
    if (c.wind[(gy >> 1) * cN + (gx >> 1)] < r.windmill.wind) continue;
    if (ridge) tally.pass(L.wind);
    let sum = 0, count = 0, higher = false;
    for (let dy = -7; dy <= 7 && !higher; dy++) for (let dx = -7; dx <= 7; dx++) {
      if (dx * dx + dy * dy > 56) continue;
      const v = c.h[idx(c, gx + dx, gy + dy)];
      if (v > level + 0.5 && dx * dx + dy * dy <= 9) { higher = true; break; }
      sum += v > 0 ? v : 0;
      count++;
    }
    if (higher) continue;
    const prom = level - sum / count;
    const crest = ridge && prom >= r.windmill.prominence;
    let corn = -1;
    if (!crest) {
      // Not a ridge crest: a knoll among cornland will do.
      if (!knoll || prom < knoll.prominence) continue;
      corn = cornBy(gx, gy);
      if (corn < knoll.corn) continue;
    }
    tally.pass(L.crest);
    let along = Infinity;
    for (let k = 0; k < 8; k++) {
      const ax = Math.floor(gx + 0.5 + RX[k] * 3), ay = Math.floor(gy + 0.5 + RY[k] * 3), bx = Math.floor(gx + 0.5 - RX[k] * 3), by = Math.floor(gy + 0.5 - RY[k] * 3);
      const s = Math.max(Math.abs(c.h[idx(c, ax, ay)] - level), Math.abs(c.h[idx(c, bx, by)] - level)) / 12;
      if (s < along) along = s;
    }
    if (along >= r.windmill.alongSlope) continue;
    tally.pass(L.along);
    if (!isOpenCover(coverAtNode(c, gx, gy))) continue;
    tally.pass(L.cover);
    const seen = seenShare(c, gx, gy, 1, 1, level, BOX.windmill.h);
    if (seen.box < r.visible || seen.pad < r.visible) continue;
    tally.pass(L.seen);
    if (level + BOX.windmill.h > r.heightCap) continue;
    tally.pass(L.cap);
    if (corn < 0) corn = cornBy(gx, gy);
    // A mill with corn round it comes before one on a bare ridge, however fine the crest.
    out.push({ gx, gy, x: cellOf(gx), y: cellOf(gy), level, score: Math.min(1.5, prom / 8) + c.wind[(gy >> 1) * cN + (gx >> 1)] + (1 - along / r.windmill.alongSlope) + 4 * corn });
  }
  return out;
}

function cathedralCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const { gN } = c;
  const out: Cand[] = [];
  const L = {
    floor: `valley floor (HAND < ${r.cathedral.hand}, s < ${r.cathedral.slope})`,
    wide: `floor at least ${r.cathedral.floor} wide, 100 from the sea`,
    river: `river ${r.cathedral.river[0]}–${r.cathedral.river[1]} away`,
    hills: `hills ≥ ${r.cathedral.hills} on both sides within ${r.cathedral.hillsWithin}`,
    seen: "no ground to the south hides it",
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const fr = Math.ceil(r.cathedral.floor / 8), far = Math.ceil(r.cathedral.hillsWithin / 4);
  const near = r.cathedral.river[0] / 4, away = r.cathedral.river[1] / 4, reachN = Math.ceil(away);
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const i = gy * gN + gx;
    if (c.isSea[i] || c.lakeId[i] >= 0 || c.rw[i] > 0 || c.hand[i] >= r.cathedral.hand || c.slope[i] >= r.cathedral.slope || c.h[i] < 3) continue;
    tally.pass(L.floor);
    let floor = 0, count = 0;
    for (let dy = -fr; dy <= fr; dy++) for (let dx = -fr; dx <= fr; dx++) {
      if (dx * dx + dy * dy > fr * fr) continue;
      count++;
      const j = idx(c, gx + dx, gy + dy);
      if (!c.isSea[j] && c.lakeId[j] < 0 && c.hand[j] < r.cathedral.hand + 2 && c.slope[j] < 2 * r.cathedral.slope) floor++;
    }
    if (floor < 0.8 * count) continue;
    // Inland: a valley, not a shore.
    let shore = false;
    for (let q = 8; q <= 24 && !shore; q += 8) for (let k = 0; k < 16; k++) if (c.isSea[idx(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q))]) { shore = true; break; }
    if (shore) continue;
    tally.pass(L.wide);
    let river = Infinity, rdx = 0, rdy = 0;
    for (let dy = -reachN; dy <= reachN; dy++) for (let dx = -reachN; dx <= reachN; dx++) {
      if (c.rw[idx(c, gx + dx, gy + dy)] === 0) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < river) { river = d; rdx = dx; rdy = dy; }
    }
    if (river < near || river > away) continue;
    tally.pass(L.river);
    const level = c.h[i];
    let walls = 0;
    for (let k = 0; k < 8; k++) {
      let a = 0, b = 0;
      for (let q = 6; q <= far; q += 2) {
        a = Math.max(a, c.h[idx(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q))]);
        b = Math.max(b, c.h[idx(c, Math.floor(gx + 0.5 - RX[k] * q), Math.floor(gy + 0.5 - RY[k] * q))]);
      }
      walls = Math.max(walls, Math.min(a, b) - level);
    }
    if (walls < r.cathedral.hills) continue;
    tally.pass(L.hills);
    const seen = seenShare(c, gx, gy, 4, 2, level, BOX.cathedral.h);
    if (seen.box < 0.95 || seen.pad < 0.95) continue;
    tally.pass(L.seen);
    if (level + BOX.cathedral.h > r.heightCap) continue;
    tally.pass(L.cap);
    out.push({
      gx, gy, x: cellOf(gx), y: cellOf(gy), level,
      score: floor / count + Math.min(2, walls / 25) + (rdy > 0 ? 0.5 : 0) + 1 - c.slope[i] / r.cathedral.slope,
      extra: { river: { x: cellOf(gx + rdx), y: cellOf(gy + rdy), level: c.rlev[idx(c, gx + rdx, gy + rdy)], toBay: 0 } },
    });
  }
  return out;
}

function yewCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const { gN } = c;
  const out: Cand[] = [];
  const L = {
    knoll: `knoll: nothing higher within ${r.yew.alone}`,
    prom: `prominence ${r.yew.prominence[0]}–${r.yew.prominence[1]} over a radius of 15–40`,
    cover: "meadow or pasture",
    seen: `visibility ≥ ${r.visible}`,
    cap: `height ≤ ${r.heightCap}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const alone = Math.ceil(r.yew.alone / 4);
  for (let gy = 0; gy < gN; gy++) for (let gx = 0; gx < gN; gx++) {
    const i = gy * gN + gx;
    const level = c.h[i];
    if (c.isSea[i] || level < 4 || c.rw[i] > 0 || c.lakeId[i] >= 0) continue;
    // A quick reject before the wide scan: the top of its 3 × 3.
    let top = true;
    for (let k = 0; k < 16 && top; k += 2) if (c.h[idx(c, Math.floor(gx + 0.5 + RX[k] * 1.5), Math.floor(gy + 0.5 + RY[k] * 1.5))] > level) top = false;
    if (!top) continue;
    for (let dy = -alone; dy <= alone && top; dy++) for (let dx = -alone; dx <= alone; dx++) {
      if (dx * dx + dy * dy <= alone * alone && c.h[idx(c, gx + dx, gy + dy)] > level) { top = false; break; }
    }
    if (!top) continue;
    tally.pass(L.knoll);
    // Prominence over the ring where the knoll meets the fields: the best of radii 16–40 cells.
    let prom = 0, sea = false;
    for (let q = 4; q <= 10; q += 2) {
      let sum = 0;
      for (let k = 0; k < 16; k++) {
        const j = idx(c, Math.floor(gx + 0.5 + RX[k] * q), Math.floor(gy + 0.5 + RY[k] * q));
        if (c.isSea[j]) sea = true;
        sum += c.h[j];
      }
      prom = Math.max(prom, level - sum / 16);
    }
    if (sea || prom < r.yew.prominence[0] || prom > r.yew.prominence[1]) continue;
    tally.pass(L.prom);
    if (!isOpenCover(coverAtNode(c, gx, gy))) continue;
    tally.pass(L.cover);
    const seen = seenShare(c, gx, gy, 2, 2, level, BOX.yew.h);
    if (seen.box < r.visible || seen.pad < r.visible) continue;
    tally.pass(L.seen);
    if (level + BOX.yew.h > r.heightCap) continue;
    tally.pass(L.cap);
    out.push({ gx, gy, x: cellOf(gx), y: cellOf(gy), level, score: 2 - Math.abs(prom - 10) / 5 + seen.box });
  }
  return out;
}

/** Where reaches meet: the point, and the width of the lesser stream that joins there (0 when only one reach arrives). */
function confluences(c: SiteContext): { x: number; y: number; minor: number }[] {
  const first = new Map<number, number>(), second = new Map<number, number>(), at = new Map<number, [number, number]>();
  for (const r of c.reaches) {
    if (r.endsIn !== "reach" || r.vertices.length < 4) continue;
    const e = r.vertices.length - 4, w = r.vertices[e + 2], a = first.get(r.downstream);
    if (a === undefined) { first.set(r.downstream, w); at.set(r.downstream, [r.vertices[e], r.vertices[e + 1]]); }
    else if (w > a) { second.set(r.downstream, a); first.set(r.downstream, w); }
    else if (w > (second.get(r.downstream) ?? 0)) second.set(r.downstream, w);
  }
  const out: { x: number; y: number; minor: number }[] = [];
  for (const [id, p] of at) out.push({ x: p[0], y: p[1], minor: second.get(id) ?? 0 });
  return out;
}

/** How many separate channels cross the square ring of half-side `r` nodes round a node: two for a single river passing through. */
function channelsRound(c: SiteContext, gx: number, gy: number, r: number): number {
  const wet: number[] = [];
  for (let k = -r; k < r; k++) wet.push(c.rw[idx(c, gx + k, gy - r)]);
  for (let k = -r; k < r; k++) wet.push(c.rw[idx(c, gx + r, gy + k)]);
  for (let k = r; k > -r; k--) wet.push(c.rw[idx(c, gx + k, gy + r)]);
  for (let k = r; k > -r; k--) wet.push(c.rw[idx(c, gx - r, gy + k)]);
  let runs = 0;
  for (let k = 0; k < wet.length; k++) if (wet[k] > 0 && wet[(k + wet.length - 1) % wet.length] === 0) runs++;
  return runs;
}

function bridgeCandidates(c: SiteContext, r: SiteRules, tally: Tally): Cand[] {
  const out: Cand[] = [];
  const L = {
    river: `river of w ≥ ${r.bridge.width} running north–south, so the deck is seen side-on`,
    dry: "abutments on dry land",
    single: `a single reach: no confluence within ${r.bridge.clear}`,
    level: `abutments level within ${r.bridge.level}`,
    deck: `deck ${r.bridge.deck[0]}–${r.bridge.deck[1]} above the water`,
    seen: `visibility ≥ ${r.visible}`,
  };
  for (const rule of Object.values(L)) tally.declare(rule);
  const meets = confluences(c);
  for (const reach of c.reaches) {
    const v = reach.vertices;
    let run = 0, lastPick = -Infinity;
    for (let k = 8; k + 12 <= v.length; k += 4) {
      run += Math.sqrt((v[k] - v[k - 4]) * (v[k] - v[k - 4]) + (v[k + 1] - v[k - 3]) * (v[k + 1] - v[k - 3]));
      const w = Math.floor(v[k + 2] + 0.5);
      // A river one class narrower will do where the land offers too few of the full width: it scores well below them.
      if (w < r.bridge.width - 1 || w < 2 || run - lastPick < 12) continue;
      const px = v[k], py = v[k + 1];
      const node = idx(c, Math.floor(px / 4), Math.floor(py / 4));
      if (c.isSea[node] || c.lakeId[node] >= 0 || c.toSea[node] < 120) continue;
      let tx = v[k + 8] - v[k - 8], ty = v[k + 9] - v[k - 7];
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl < 1e-6) continue;
      tx /= tl; ty /= tl;
      // The deck runs across the flow; keep the abutment with the smaller x first.
      let nx = -ty, ny = tx;
      if (nx < 0) { nx = -nx; ny = -ny; }
      if (nx * nx < 0.6) continue;
      const half = w / 2 + 10;
      tally.pass(L.river);
      const ax = px - nx * half, ay = py - ny * half, bx = px + nx * half, by = py + ny * half;
      const ia = idx(c, Math.floor(ax / 4), Math.floor(ay / 4)), ib = idx(c, Math.floor(bx / 4), Math.floor(by / 4));
      if (c.isSea[ia] || c.isSea[ib] || c.lakeId[ia] >= 0 || c.lakeId[ib] >= 0) continue;
      // The far banks must be dry too: a second channel there would need a second bridge.
      const fa = idx(c, Math.floor((ax - nx * 8) / 4), Math.floor((ay - ny * 8) / 4)), fb = idx(c, Math.floor((bx + nx * 8) / 4), Math.floor((by + ny * 8) / 4));
      if (c.rw[fa] > 0 || c.rw[fb] > 0 || c.isSea[fa] || c.isSea[fb]) continue;
      tally.pass(L.dry);
      // One river under the deck: no tributary joins within `clear`, no rill within sight of the arches,
      // and few rills in that stretch.
      // `apart` is measured out to four times `clear`: the further from any confluence, the better the site scores.
      const far = 4 * r.bridge.clear;
      let apart = far, rills = 0;
      for (const m of meets) {
        const dx = torusDelta(px, m.x, c.n), dy = torusDelta(py, m.y, c.n);
        if (dx > far || dx < -far || dy > far || dy < -far || m.minor <= 0) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= far) continue;
        if (d < r.bridge.clear) rills++;
        // A rill is a thin line: it counts only close by.
        const eff = m.minor >= 1.15 ? d : 4 * d;
        if (eff < apart) apart = eff;
      }
      if (apart < r.bridge.clear || rills > 4) continue;
      // And by the water itself, whatever the reaches are called (a braid, a lake's outflow): one channel in, one out.
      const bgx = Math.floor(px / 4), bgy = Math.floor(py / 4);
      if (channelsRound(c, bgx, bgy, 4) > 2 || channelsRound(c, bgx, bgy, 7) > 2) continue;
      tally.pass(L.single);
      const ha = heightAt(c, ax, ay), hb = heightAt(c, bx, by), water = v[k + 3];
      if (Math.abs(ha - hb) > r.bridge.level) continue;
      tally.pass(L.level);
      // Low banks are no bar: the deck is humped clear of the water whatever they stand at.
      const deck = Math.max(r.bridge.deck[0], Math.max(ha, hb) + 1 - water);
      // Banks a road can come down: gentle ones first, a gorge's sides only when the land offers nothing else.
      const bank = Math.max(c.slope[fa], c.slope[fb]);
      if (deck < r.bridge.deck[0] || deck > r.bridge.deck[1] || bank > 0.6) continue;
      tally.pass(L.deck);
      const gx = Math.floor(px / 4), gy = Math.floor(py / 4);
      const seen = seenShare(c, gx, gy, 3, 1, water, deck);
      if (seen.box < r.visible) continue;
      tally.pass(L.seen);
      lastPick = run;
      // A bridge is a small thing: it reads in open country and is lost in a wooded gorge. The share of open
      // cover round it and to its south, and the relief the camera looks across, go into its score.
      let open = 0, looked = 0, lo = Infinity, hi = -Infinity;
      for (let dy = -6; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
        const j = idx(c, gx + dx, gy + dy);
        if (c.isSea[j] || c.lakeId[j] >= 0 || c.rw[j] > 0) continue;
        looked++;
        if (isOpenCover(coverAtNode(c, gx + dx, gy + dy))) open++;
        if (c.h[j] < lo) lo = c.h[j];
        if (c.h[j] > hi) hi = c.h[j];
      }
      const openShare = looked > 0 ? open / looked : 0, relief = looked > 0 ? hi - lo : 0;
      out.push({
        gx, gy, x: px, y: py, level: water + deck,
        // Best side-on to the camera: a deck running east–west shows its arches.
        score: w / 3 + 2 * nx * nx + 1 - Math.abs(ha - hb) / r.bridge.level + seen.box - (deck > 8 ? (deck - 8) / 6 : 0) + 3 * Math.min(1, apart / (4 * r.bridge.clear)) - (bank > 0.35 ? 1 + 4 * (bank - 0.35) : 0) - 1.5 * Math.max(0, channelsRound(c, gx, gy, 11) - 2) + 3 * openShare - (relief > 25 ? Math.min(3, (relief - 25) / 15) : 0) - (w < r.bridge.width ? 3 : 0),
        extra: { span: { ax, ay, bx, by, water, width: w } },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

/** The best candidates, thinned so no two lie within `apart` cells; best first. */
function thin(c: SiteContext, cands: Cand[], apart: number, keep: number): Cand[] {
  const order = sortIndicesBy(cands.map((q) => -q.score));
  const out: Cand[] = [];
  for (let k = 0; k < order.length && out.length < keep; k++) {
    const q = cands[order[k]];
    let ok = true;
    for (const o of out) {
      const dx = torusDelta(q.x, o.x, c.n), dy = torusDelta(q.y, o.y, c.n);
      if (dx * dx + dy * dy < apart * apart) { ok = false; break; }
    }
    if (ok) out.push(q);
  }
  return out;
}

/** Where the road leaves the pad: the gentlest way out, with a lean to the south, where the camera sees it. */
function approachOf(c: SiteContext, x: number, y: number, level: number, pad: { w: number; d: number }, southOnly = false): { facing: readonly [number, number]; x: number; y: number } {
  let best = 4, bestCost = Infinity;
  // A building whose door or gate faces the camera is reached from the south-east, south or south-west.
  for (let k = southOnly ? 2 : 0; k < (southOnly ? 8 : 16); k += 2) {
    const edge = Math.abs(RX[k]) * pad.w / 2 + Math.abs(RY[k]) * pad.d / 2;
    let cost = 0;
    for (let q = 1; q <= 5; q++) {
      const px = x + RX[k] * (edge + 8 * q), py = y + RY[k] * (edge + 8 * q);
      const j = idx(c, Math.floor(px / 4), Math.floor(py / 4));
      if (c.isSea[j] || c.lakeId[j] >= 0) { cost += 40; continue; }
      cost += Math.abs(c.h[j] - level) / q + (c.rw[j] > 1 ? 6 : 0);
    }
    // South is free; north costs most.
    cost += 2 * (1 - RY[k]);
    if (cost < bestCost) { bestCost = cost; best = k; }
  }
  const edge = Math.abs(RX[best]) * pad.w / 2 + Math.abs(RY[best]) * pad.d / 2 + 3;
  return { facing: [RX[best], RY[best]], x: x + RX[best] * edge, y: y + RY[best] * edge };
}

function place(c: SiteContext, type: LandmarkType, k: number, q: Cand): PlacedSite {
  const box = BOX[type];
  let pad = { w: box.w, d: box.d, round: box.round };
  let facing: readonly [number, number] = [0, 1];
  let approach = { x: q.x, y: q.y + box.d / 2 + 3, road: true };
  const extra = q.extra ?? {};
  if (type === "bridge" && extra.span) {
    const s = extra.span;
    const len = Math.sqrt((s.bx - s.ax) * (s.bx - s.ax) + (s.by - s.ay) * (s.by - s.ay));
    pad = { w: Math.ceil(len), d: 6, round: false };
    facing = [(s.ax - s.bx) / len, (s.ay - s.by) / len];
    approach = { x: wrap(s.ax, c.n), y: wrap(s.ay, c.n), road: true };
  } else if (type === "town" && extra.harbour) {
    // The coast road comes in along the shore from the river's side.
    const side = torusDelta(q.x, extra.harbour.mouthX, c.n) < 0 ? -1 : 1;
    facing = [0, 1];
    approach = { x: wrap(q.x + side * (box.w / 2 - 6), c.n), y: wrap(extra.harbour.y - 14, c.n), road: true };
  } else if (extra.stack) {
    approach = { x: q.x, y: q.y, road: false };
  } else {
    const a = approachOf(c, q.x, q.y, q.level, pad, type === "yew" || type === "windmill" || type === "cathedral");
    facing = a.facing;
    approach = { x: a.x, y: a.y, road: true };
  }
  const island = c.island[idx(c, Math.floor(approach.x / 4), Math.floor(approach.y / 4))];
  return {
    id: `${type}-${k}`, type, x: wrap(q.x, c.n), y: wrap(q.y, c.n), level: q.level, pad, facing, approach,
    island: island >= 0 ? island : c.island[idx(c, q.gx, q.gy)], score: q.score, ...extra,
  };
}

export interface PlaceOptions {
  /** Throw when a type falls short (default). When false, the shortfall is reported and the rest are placed. */
  strict?: boolean;
  /** Receives, per type, how many candidates passed each rule. */
  log?: (line: string) => void;
}

/** Order the types are taken in after the abbey and the town. */
export const SITE_ORDER: readonly LandmarkType[] = ["lighthouse", "bridge", "cathedral", "windmill", "yew"];

/** Where a kind stands: the sea-level temperature of its site (gen/climate.ts: 0.5 is the temperate plateau), and its side of the world. */
export interface SiteClimate {
  temp: readonly [number, number];
  /** The wet side is the route from pole to equator through home; the dry side the other. Absent: either. */
  side?: "wet" | "dry";
  /** Not on the home island, which has the abbey and the town. */
  away?: boolean;
}

/**
 * Each kind in a climate that suits it, so that the seven are told apart by their ground as well as their shape:
 * the lighthouse on the cold coast by the pack ice, the yew in temperate country on another island than home, the
 * ruined cathedral in the jungle, the old bridge in the Mediterranean and the windmill on the steppe. The abbey
 * and the town are on the home island, which is temperate by rule.
 */
export const SITE_CLIMATE: Readonly<Record<LandmarkType, SiteClimate>> = {
  abbey: { temp: [0, 1] }, town: { temp: [0, 1] },
  lighthouse: { temp: [0.18, 0.42] },
  yew: { temp: [0.47, 0.53], side: "wet", away: true },
  cathedral: { temp: [0.82, 1] },
  bridge: { temp: [0.52, 0.7], side: "dry" },
  windmill: { temp: [0.3, 0.5], side: "dry" },
};

/** How far each end of a kind's temperatures is let out when its own climate has no ground that passes its rule. */
const CLIMATE_SLACK = 0.12;

/** Sea-level temperature at a cell: the temperate plateau's where the world has no climates. */
export function tempAt(c: Pick<SiteContext, "gN" | "temp">, x: number, y: number): number {
  if (!c.temp) return 0.5;
  const cN = c.gN / 2;
  return c.temp[wrap(Math.floor(y / 8), cN) * cN + wrap(Math.floor(x / 8), cN)];
}

/** The dry side's share at a cell (gen/climate.ts): 0 where the world has one side. */
export function aridAt(c: Pick<SiteContext, "gN" | "arid">, x: number, y: number): number {
  if (!c.arid) return 0;
  const cN = c.gN / 2;
  return c.arid[wrap(Math.floor(y / 8), cN) * cN + wrap(Math.floor(x / 8), cN)];
}

export class SitingError extends Error {
  rule: string;
  constructor(type: string, rule: string) {
    super(`siting failed: ${type}: ${rule}`);
    this.name = "SitingError";
    this.rule = rule;
  }
}

/** Places the reserved sites. Throws a SitingError naming the failed rule unless `strict` is off. */
export function placeSites(fields: SiteFields, rules: SiteRules = siteRules(fields.n), opts: PlaceOptions = {}): SitesResult {
  return placeSitesOn(siteContext(fields), rules, opts);
}

/** The same, on fields already derived. */
export function placeSitesOn(c: SiteContext, rules: SiteRules, opts: PlaceOptions = {}): SitesResult {
  const strict = opts.strict !== false;
  const shortfall: string[] = [];
  const fail = (type: string, rule: string): void => {
    if (strict) throw new SitingError(type, rule);
    shortfall.push(`${type}: ${rule}`);
  };
  const placed: PlacedSite[] = [];

  // Abbey and town, jointly: the best pair over every bay the home island offers.
  if (rules.counts.town > 0 || rules.counts.abbey > 0) {
    const townTally = new Tally(), abbeyTally = new Tally();
    const towns = thin(c, townCandidates(c, rules, townTally), 0, 40);
    let pair: [Cand, Cand] | null = null, lone: Cand | null = null;
    for (const t of towns) {
      if (!lone) lone = t;
      if (rules.counts.abbey === 0) break;
      const abbeys = thin(c, abbeyCandidates(c, rules, t.mouthReach as number, abbeyTally), 0, 1);
      if (abbeys.length && (!pair || t.score + abbeys[0].score > pair[0].score + pair[1].score)) pair = [t, abbeys[0]];
    }
    opts.log?.(`town: ${townTally.steps.map(([r2, k]) => `${r2} ${k}`).join("; ")} → ${towns.length}`);
    opts.log?.(`abbey: ${abbeyTally.steps.map(([r2, k]) => `${r2} ${k}`).join("; ")}`);
    if (rules.counts.town > 0 && !lone) fail("town", townTally.failed());
    else if (rules.counts.abbey > 0 && !pair) {
      fail("abbey", towns.length ? abbeyTally.failed() : "no town bay for the home river to reach");
      if (lone && rules.counts.town > 0) placed.push(place(c, "town", 0, lone));
    } else if (pair) {
      placed.push(place(c, "abbey", 0, pair[1]));
      if (rules.counts.town > 0) placed.push(place(c, "town", 0, pair[0]));
    } else if (lone) placed.push(place(c, "town", 0, lone));
  }

  // The rest: a depth-first search over each type's best candidates, so an early pick cannot starve a later type.
  const lists = new Map<LandmarkType, Cand[]>(), tallies = new Map<LandmarkType, Tally>(), every = new Map<LandmarkType, Cand[]>();
  const displaced: string[] = [];
  let slots: LandmarkType[] = [];
  for (const type of SITE_ORDER) {
    const count = rules.counts[type];
    if (count <= 0) continue;
    const tally = new Tally();
    const all = type === "lighthouse" ? lighthouseCandidates(c, rules, tally) : type === "bridge" ? bridgeCandidates(c, rules, tally)
      : type === "cathedral" ? cathedralCandidates(c, rules, tally) : type === "windmill" ? windmillCandidates(c, rules, tally) : yewCandidates(c, rules, tally);
    // Each kind keeps to its own climate. A kind is never dropped for want of ground there: its climate is let out
    // by steps (a little warmer and colder; then either side of the world; then anywhere) until some ground passes.
    if (c.temp && all.length > 0) {
      const want = SITE_CLIMATE[type], [lo, hi] = want.temp;
      const side = (q: Cand): boolean => want.side === undefined || (aridAt(c, q.x, q.y) > 0.5) === (want.side === "dry");
      const tiers: [string, (q: Cand, t: number) => boolean][] = [
        [`in its own climate (temperature ${lo}–${hi}${want.side ? `, the ${want.side} side` : ""}${want.away ? ", off the home island" : ""})`,
          (q, t) => t >= lo && t <= hi && side(q) && !(want.away && c.island[idx(c, q.gx, q.gy)] === c.home)],
        ["near its own climate", (q, t) => t >= lo - CLIMATE_SLACK && t <= hi + CLIMATE_SLACK && side(q)],
        ["on either side of the world", (_q, t) => t >= lo - CLIMATE_SLACK && t <= hi + CLIMATE_SLACK],
      ];
      for (let k = 0; k < tiers.length; k++) {
        const kept: Cand[] = [];
        for (const q of all) if (tiers[k][1](q, tempAt(c, q.x, q.y))) kept.push(q);
        tally.declare(tiers[k][0]);
        for (let q = 0; q < kept.length; q++) tally.pass(tiers[k][0]);
        if (kept.length > 0 || k === tiers.length - 1) {
          // With none even at the last step the kind stands wherever its rule passes.
          if (kept.length > 0) {
            all.length = 0;
            for (const q of kept) all.push(q);
          }
          if (k > 0 || kept.length === 0) displaced.push(`${type}: no ground ${tiers[0][0]}; placed ${kept.length > 0 ? tiers[k][0] : "wherever its rule passes"}`);
          break;
        }
      }
    }
    every.set(type, all);
    lists.set(type, thin(c, all, rules.spacing / 12, 90));
    tallies.set(type, tally);
    opts.log?.(`${type}: ${tally.steps.map(([r2, k]) => `${r2} ${k}`).join("; ")} → ${all.length}, thinned ${(lists.get(type) as Cand[]).length}`);
    for (let k = 0; k < count; k++) slots.push(type);
  }
  const fixed = placed.map((s) => ({ x: s.x, y: s.y }));
  const chosen: Cand[] = [];
  const far = (q: Cand): boolean => {
    for (const o of fixed) {
      const dx = torusDelta(q.x, o.x, c.n), dy = torusDelta(q.y, o.y, c.n);
      if (dx * dx + dy * dy < rules.spacing * rules.spacing) return false;
    }
    for (const o of chosen) {
      const dx = torusDelta(q.x, o.x, c.n), dy = torusDelta(q.y, o.y, c.n);
      if (dx * dx + dy * dy < rules.spacing * rules.spacing) return false;
    }
    return true;
  };
  // Forward check: every later slot still has enough candidates clear of what is chosen.
  // It counts candidates, not whether they clear each other: a cheap bound that prunes most dead ends.
  let blame: LandmarkType | null = null;
  const feasible = (slot: number): boolean => {
    let k = slot;
    while (k < slots.length) {
      const type = slots[k];
      let need = 0;
      while (k < slots.length && slots[k] === type) { need++; k++; }
      let have = 0;
      for (const q of lists.get(type) as Cand[]) if (far(q) && ++have >= need) break;
      if (have < need) {
        if (slot >= deepest) blame = type;
        return false;
      }
    }
    return true;
  };
  let budget = 400000, deepest = 0;
  const search = (slot: number, from: number): boolean => {
    if (slot > deepest) { deepest = slot; blame = null; }
    if (slot === slots.length) return true;
    const list = lists.get(slots[slot]) as Cand[];
    // Two sites of a type are an unordered pair: the second starts after the first.
    const start = slot > 0 && slots[slot - 1] === slots[slot] ? from : 0;
    for (let k = start; k < list.length; k++) {
      if (budget-- <= 0) return false;
      if (!far(list[k])) continue;
      chosen.push(list[k]);
      if (feasible(slot + 1) && search(slot + 1, k + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  // When a slot cannot be filled, strict siting stops there; otherwise the slot is dropped and the rest are placed.
  // Each round tries the spec's order on a coarse thinning of the candidates, then a finer thinning, then
  // the scarcest type first: three cheap searches find a layout that one long one misses.
  for (;;) {
    let found = false;
    const order = slots.slice();
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
      if (attempt >= 1) for (const [type, all] of every) lists.set(type, thin(c, all, rules.spacing / 30, 160));
      else for (const [type, all] of every) lists.set(type, thin(c, all, rules.spacing / 12, 90));
      slots = order.slice();
      if (attempt === 2) {
        // Stable insertion sort by how many candidates the type has.
        for (let a = 1; a < slots.length; a++) {
          const t = slots[a];
          let b = a - 1;
          while (b >= 0 && (lists.get(slots[b]) as Cand[]).length > (lists.get(t) as Cand[]).length) { slots[b + 1] = slots[b]; b--; }
          slots[b + 1] = t;
        }
      }
      chosen.length = 0;
      budget = 2000000;
      deepest = 0;
      blame = null;
      found = feasible(0) && search(0, 0);
    }
    if (found) break;
    const type: LandmarkType = blame ?? slots[deepest];
    const list = lists.get(type) as Cand[];
    fail(type, list.length < rules.counts[type] ? (tallies.get(type) as Tally).failed() : `minimum spacing of ${Math.round(rules.spacing)} cells`);
    slots.splice(slots.lastIndexOf(type), 1);
  }
  const counts = new Map<LandmarkType, number>();
  for (let k = 0; k < chosen.length; k++) {
    const type = slots[k], j = counts.get(type) ?? 0;
    counts.set(type, j + 1);
    placed.push(place(c, type, j, chosen[k]));
  }
  return { sites: placed, home: c.home, shortfall, displaced };
}
