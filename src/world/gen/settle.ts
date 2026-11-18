// S10: what people built. The reserved sites are placed (gen/sites.ts), their
// pads are levelled, the landmarks and the town are stood on them, hamlets are
// scattered between, and lanes join them island by island. The result is a
// list of structures, conforms and road lines the bake reads (gen/built.ts),
// and the ground on G with the pads cut in.

import { hash2 } from "../core/hash.ts";
import { MinHeap, sortIndicesBy } from "../core/heap.ts";
import { boxBlur } from "./field.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import type { CoverInput } from "../look/contract.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { furrowAt, newParcel, parcelAt } from "../parcels.ts";
import { featureFor, type LandmarkType } from "../sites/assign.ts";
import { type Built, type Conform, conformed, conformGrid, ROAD_PIECE, type RoadLine, type Structure } from "./built.ts";
import { ARCHETYPE } from "./params.ts";
import { type RoadParams, roadNetwork } from "./roads.ts";
import type { Terrain } from "./pipeline.ts";
import { builtRules, coverAtNode, heightAt, isFarmable, type PlacedSite, placeSitesOn, type PlaceOptions, type SiteContext, siteContext, type SiteFields, type SiteRules } from "./sites.ts";
import * as S from "./structures.ts";

/** The fields siting reads, from the generator's stages. */
export function siteFieldsOf(t: Terrain): SiteFields {
  const { land, hydro, rivers, climate } = t;
  const stacks: { x: number; y: number; r: number; top: number }[] = [];
  for (const s of land.stamps) if (s.kind === "stack") stacks.push({ x: s.x, y: s.y, r: s.r, top: s.top });
  return {
    n: land.p.n, gN: land.p.gN, h: rivers.ground, isSea: land.isSea, lakeId: hydro.lakeId, hand: hydro.hand,
    exposure: land.exposure, shoreClass: land.shoreClass, debris: land.debris, rock: land.rock,
    moisture: climate.moisture, wind: climate.wind, regions: land.plan.regions,
    reaches: rivers.reaches, stacks,
  };
}

export interface Hamlet {
  /** Centre, cells. */
  x: number;
  y: number;
  houses: number;
  island: number;
  /** A slate quarry with its row of cottages stands by it. */
  quarry: boolean;
}

export interface Settlement {
  sites: PlacedSite[];
  /** Types siting could not place, with the rule that failed; empty when all twelve stand. */
  shortfall: string[];
  /** The home island's land component. */
  home: number;
  hamlets: Hamlet[];
  built: Built;
  /** Ground on G with pads, quays and the harbour cut in. */
  ground: Float64Array;
}

export interface SettleOptions extends PlaceOptions {
  rules?: SiteRules;
  /** Ids of the sites that hold a project's landmark; the rest hold a small unnamed feature. Absent: every site holds its landmark. */
  occupied?: ReadonlySet<string>;
  /** Lay the road network (default). Off, sites and buildings are placed without it: quick, for tuning their look. */
  lanes?: boolean;
}

const MATS = { path: M.path, road: M.road, retaining: M.stone, yard: M.pastureWarm, vine: M.vine };

interface Work {
  c: SiteContext;
  /** Ground on G as it is being conformed. */
  g: Float64Array;
  seed: number;
  structures: Structure[];
  conforms: Conform[];
  /** Conforms that exist only at cell size (street terraces). */
  terraces: Conform[];
  /** G nodes a lane may not cross: pads and yards. */
  blocked: Uint8Array;
  /** Where each path node already laid ended up after smoothing, so lanes that share a way share one line. */
  laid: Map<number, [number, number]>;
  /** Short ways laid with the buildings: from where a lane arrives to a door or a gate. */
  spurs: RoadLine[];
  /** The town, once it stands: its quay's middle on the shore line, and the boxes its buildings and square take up (x0, y0, x1, y1). */
  town: { hx: number; shore: number; taken: [number, number, number, number][] } | null;
}

function node(c: SiteContext, x: number, y: number): number {
  return wrap(Math.floor(y / 4), c.gN) * c.gN + wrap(Math.floor(x / 4), c.gN);
}

/** Ground at a cell: G bilinear, then the cell-size terraces. */
function groundAt(w: Work, x: number, y: number): number {
  let v = heightAt({ h: w.g, gN: w.c.gN }, x, y);
  for (const t of w.terraces) v = conformed(t, v, torusDelta(t.x, x, w.c.n), torusDelta(t.y, y, w.c.n));
  return v;
}

function dry(w: Work, x: number, y: number): boolean {
  const i = node(w.c, x, y);
  return !w.c.isSea[i] && w.c.lakeId[i] < 0 && w.c.rw[i] === 0;
}

function addConform(w: Work, cf: Conform): void {
  w.conforms.push(cf);
  if (cf.kind === "terrace") w.terraces.push(cf);
  else conformGrid(w.g, w.c.gN, 4, [cf]);
}

function block(w: Work, x: number, y: number, rx: number, ry: number): void {
  for (let j = Math.floor((y - ry) / 4); j <= Math.floor((y + ry) / 4); j++) for (let i = Math.floor((x - rx) / 4); i <= Math.floor((x + rx) / 4); i++) {
    w.blocked[wrap(j, w.c.gN) * w.c.gN + wrap(i, w.c.gN)] = 1;
  }
}

/** A short way from (ax, ay) to (bx, by), bowed a little so it is not ruled. */
function spur(w: Work, ax: number, ay: number, bx: number, by: number, width = 1): void {
  const dx = torusDelta(ax, bx, w.c.n), dy = torusDelta(ay, by, w.c.n), len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1.5) return;
  const bow = ((hash2(Math.floor(ax), Math.floor(ay), w.seed) & 7) - 3.5) * 0.04 * len;
  w.spurs.push(curve([ax, ay, ax + dx / 2 - (dy / len) * bow, ay + dy / 2 + (dx / len) * bow, ax + dx, ay + dy], width));
}

/** The lowest ground under a footprint of half-sizes (rx, ry): what stands on it has no air under any wall. */
function footing(w: Work, x: number, y: number, rx: number, ry: number): number {
  let lo = Infinity;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const v = groundAt(w, x + i * rx, y + j * ry);
    if (v < lo) lo = v;
  }
  return lo;
}

function flat(x: number, y: number, rx: number, ry: number, round: boolean, level: number, skirt: number, limit = 3): Conform {
  return { kind: "flat", x, y, rx, ry, round, level, skirt, limit };
}

// ---------------------------------------------------------------------------
// Bridges.

/**
 * A stone bridge from (ax, ay) to (bx, by): a deck three cells wide with parapets, humped over the water,
 * and arches drawn on its south face where the deck stands high enough.
 */
export function bridge(ax: number, ay: number, bx: number, by: number, water: number, deckA: number, deckB: number, wet: number, rise = 3): Structure {
  const x0 = Math.floor(Math.min(ax, bx)) - 3, y0 = Math.floor(Math.min(ay, by)) - 3;
  const w = Math.ceil(Math.max(ax, bx)) + 4 - x0, h = Math.ceil(Math.max(ay, by)) + 4 - y0;
  const s = S.sculpt(w, h);
  s.x = x0;
  s.y = y0;
  s.base = water;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
  // Humped so the crown stands `rise` clear of the water: that is what makes room for arches.
  const hump = Math.max(len >= 10 ? 1.4 : 0.6, water + rise - (deckA + deckB) / 2);
  const tAt = new Float32Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const px = x0 + i + 0.5 - ax, py = y0 + j + 0.5 - ay;
    const t = (px * dx + py * dy) / len2;
    if (t < -0.06 || t > 1.06) continue;
    const off = Math.abs(px * dy - py * dx) / len;
    if (off > 1.75) continue;
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const deck = deckA + (deckB - deckA) * tc + hump * 4 * tc * (1 - tc) - water;
    if (deck <= 0.3) continue;
    tAt[j * w + i] = tc;
    if (off > 0.95) S.put(s, i, j, deck + 0.9, M.stone, S.T_FLAT);
    else S.put(s, i, j, deck, M.road, 150);
  }
  // The south face, column by column: stone under a string course, with one to three round arches cut as
  // shade and the river showing at their feet.
  const wetLen = Math.min(len - 2, wet + 2), count = Math.max(1, Math.min(3, Math.floor(wetLen / 8 + 0.5))), bay = wetLen / count, a = bay / 2 - 0.9;
  for (let i = 0; i < w; i++) {
    const j = S.faceRow(s, i);
    if (j < 0) continue;
    const k = j * w + i;
    s.mat[k] = M.stone;
    s.tone[k] = S.T_WALL;
    const top = s.top[k];
    if (top >= 4.5) S.mark(s, i, j, Math.floor(top - 1), M.stoneDark, 108);
    const along = (tAt[k] - 0.5) * len + wetLen / 2;
    if (along < 0 || along > wetLen || a < 1.2) continue;
    const v = along - (Math.floor(along / bay) + 0.5) * bay;
    if (Math.abs(v) > a) continue;
    // A semicircle on a short springing, kept clear of the parapet.
    const rise = Math.min(top - 2.6, 1 + a * Math.sqrt(1 - (v * v) / (a * a)));
    if (rise < 2) continue;
    S.mark(s, i, j, 1, M.river, 0);
    for (let z = 2; z <= rise; z++) S.mark(s, i, j, z, M.opening, z >= rise - 1 ? 128 : 104);
  }
  return s;
}

// ---------------------------------------------------------------------------
// The sites.

/** Mean ground over a pad of half-sizes (rx, ry): the level that cuts as much as it fills. */
function padLevel(w: Work, x: number, y: number, rx: number, ry: number): number {
  let sum = 0, count = 0;
  for (let dy = -ry; dy <= ry; dy += 4) for (let dx = -rx; dx <= rx; dx += 4) {
    // Sea bed under a headland's pad is no part of its level.
    if (w.c.isSea[node(w.c, x + dx, y + dy)]) continue;
    sum += heightAt({ h: w.g, gN: w.c.gN }, x + dx, y + dy);
    count++;
  }
  return count ? sum / count : heightAt({ h: w.g, gN: w.c.gN }, x, y);
}

function standLandmark(w: Work, site: PlacedSite, occupied: boolean): void {
  const { x, y } = site;
  const box = site.pad;
  // Within 3 of the ground the site was scored at, so the pad stays the place that passed the rules.
  const level = site.type === "bridge" || site.type === "town" || site.stack ? site.level : Math.max(site.level - 3, Math.min(site.level + 3, padLevel(w, x, y, box.w / 2, box.d / 2)));
  site.level = level;
  const seed = hash2(Math.floor(x), Math.floor(y), w.seed);
  if (site.type === "bridge" && site.span) {
    // The bridge is the road's, whoever holds the site.
    const sp = site.span;
    const half = Math.sqrt((sp.bx - sp.ax) * (sp.bx - sp.ax) + (sp.by - sp.ay) * (sp.by - sp.ay)) / 2;
    const deckA = Math.max(groundAt(w, sp.ax, sp.ay), sp.water + 2) + 0.4, deckB = Math.max(groundAt(w, sp.bx, sp.by), sp.water + 2) + 0.4;
    w.structures.push(bridge(sp.ax, sp.ay, sp.bx, sp.by, sp.water, deckA, deckB, 2 * half - 5, 8.5));
    if (!occupied) standFeature(w, site, sp.ax + (sp.ax < sp.bx ? -9 : 9), sp.ay + 6);
    return;
  }
  if (site.stack) {
    w.structures.push(S.standAt(occupied ? S.lighthouse() : S.waysideCross(), x, y, level));
    return;
  }
  if (!occupied) {
    if (site.type === "town" && site.harbour) {
      // A free town site keeps its shore: a jetty where the harbour would be.
      standFeature(w, site, site.harbour.x, site.harbour.y - 6);
      return;
    }
    addConform(w, flat(x, y, 6, 6, true, level, 5));
    block(w, x, y, 6, 6);
    standFeature(w, site, x, y);
    return;
  }
  // Which of its kind this is: the second ruin and the second churchyard are built to a different plan from the first.
  const index = Number(site.id.slice(site.id.lastIndexOf("-") + 1)) || 0;
  const [fx, fy] = site.facing;
  switch (site.type) {
    case "abbey":
      addConform(w, flat(x, y, 17, 14, false, level, 10));
      block(w, x, y, 15, 12);
      // Woods to the north, an orchard on the slope to the south; the abbey last, so nothing overgrows it.
      w.structures.push(S.standAt(S.grove(52, 16, seed), x - 2, y - 23, 0));
      w.structures.push(S.standAt(S.orchard(38, 15, seed), x - 1, y + 24, 0));
      w.structures.push(S.standAt(S.abbey(), x, y, level));
      break;
    case "lighthouse": {
      addConform(w, flat(x, y, 7, 7, true, level, 5));
      block(w, x, y, 5, 5);
      w.structures.push(S.standAt(S.lighthouse(), x, y - 1, level));
      // The keeper's cottage, on whichever side has ground for it.
      for (const side of [1, -1]) {
        const cx = x + side * 10, cy = y + 1;
        if (!dry(w, cx, cy) || Math.abs(groundAt(w, cx, cy) - level) > 2.5) continue;
        addConform(w, flat(cx, cy, 4, 3.5, false, groundAt(w, cx, cy), 3, 1.5));
        w.structures.push(S.standAt(S.cottage(seed), cx, cy, groundAt(w, cx, cy)));
        break;
      }
      spur(w, site.approach.x, site.approach.y, x + fx * 4, y + fy * 4);
      break;
    }
    case "windmill": {
      // A small pad: the mill stands on the ridge as it is, on the lowest ground under its roundhouse.
      addConform(w, flat(x, y, 4.5, 4.5, true, level, 5, 3));
      block(w, x, y, 5, 5);
      cornBy(w, x, y, seed);
      w.structures.push(S.standAt(S.windmill(), x, y, footing(w, x, y - 1, 3.5, 3.5) - 0.2));
      // The miller's cottage on the lee side, where the ground allows it.
      for (const [ox, oy] of [[-11, 3], [11, 3], [-9, 9], [9, 9]]) {
        const cx = x + ox, cy = y + oy;
        if (!dry(w, cx, cy) || w.c.slope[node(w.c, cx, cy)] > 0.3 || Math.abs(groundAt(w, cx, cy) - level) > 4) continue;
        const base = groundAt(w, cx, cy);
        addConform(w, flat(cx, cy, 4, 3.5, false, base, 3, 1.5));
        w.structures.push(S.standAt(S.cottage(seed >>> 3), cx, cy, footing(w, cx, cy, 3, 2.5)));
        break;
      }
      spur(w, site.approach.x, site.approach.y, x, y + 4);
      break;
    }
    case "cathedral": {
      addConform(w, flat(x, y, 19, 10, false, level, 9));
      block(w, x, y, 18, 9);
      // What is left of its close: broken walls and old trees, the way in on the side the lane comes from.
      w.structures.push(S.standAt(S.precinct(66, 46, 34, 16, seed, fx, fy), x, y, 0));
      w.structures.push(S.standAt(S.ruinedCathedral(seed, index), x, y, level));
      spur(w, site.approach.x, site.approach.y, x + fx * (Math.abs(fx) * 15 + Math.abs(fy) * 7), y + fy * (Math.abs(fx) * 15 + Math.abs(fy) * 7));
      break;
    }
    case "yew": {
      addConform(w, flat(x, y, 15, 12, true, level, 9));
      block(w, x, y, 14, 11);
      w.structures.push(S.standAt(S.copse(58, 46, 18, 12, seed), x, y, 0));
      const yard = S.standAt(S.churchyard(seed, index), x, y, level);
      w.structures.push(yard);
      // The lane ends at the gate.
      const gate = S.gateOf(yard);
      if (gate) spur(w, site.approach.x, site.approach.y, yard.x + gate[0] + 0.5, yard.y + gate[1] + 1.5);
      break;
    }
    case "town":
      standTown(w, site);
      break;
    default:
      break;
  }
}

const FLAT6 = new Float32Array(6);

/**
 * Corn by a mill: the fields the land itself offers within 46 cells of it. A cell is corn only on gentle,
 * farmable ground (never heath, wood or a steep flank); the fields are the cover's own parcels there
 * (parcels.ts), so they are shaped by the slope and bounded like every other field, and the two or three
 * that hold most ground near the mill are sown. A mill with no such ground stands alone.
 */
function cornBy(w: Work, x: number, y: number, seed: number): void {
  const c = w.c, R = 46, side = 2 * R + 1;
  const x0 = Math.floor(x) - R, y0 = Math.floor(y) - R + 10;
  const id = new Int32Array(side * side), axis = new Uint8Array(side * side), ok = new Uint8Array(side * side);
  const gh = { h: w.g, gN: c.gN };
  const farm = new Map<number, boolean>();
  const inp: CoverInput = { x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0, rock: 0, region: FLAT6, water: 0, shore: 0, westness: 0 };
  const parcel = newParcel();
  const count = new Map<number, number>(), near = new Map<number, number>();
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
    const px = x0 + i + 0.5, py = y0 + j + 0.5, dx = px - x, dy = py - y, d2 = dx * dx + dy * dy;
    if (d2 < 81 || d2 > R * R) continue;
    const ni = node(c, px, py);
    if (!dry(w, px, py) || w.blocked[ni] || c.slope[ni] > 0.14) continue;
    let f = farm.get(ni);
    if (f === undefined) { f = isFarmable(coverAtNode(c, ni % c.gN, Math.floor(ni / c.gN))); farm.set(ni, f); }
    if (!f) continue;
    const sx = (heightAt(gh, px + 2, py) - heightAt(gh, px - 2, py)) / 4, sy = (heightAt(gh, px, py + 2) - heightAt(gh, px, py - 2)) / 4;
    const sl = Math.sqrt(sx * sx + sy * sy);
    if (sl > 0.13) continue;
    inp.x = wrap(Math.floor(px), c.n);
    inp.y = wrap(Math.floor(py), c.n);
    inp.slope = sl;
    inp.northness = sl > 1e-6 ? sy / sl : 0;
    inp.westness = sl > 1e-6 ? sx / sl : 0;
    parcelAt(inp, c.n, parcel);
    if (parcel.edge < 1.1) continue;
    const k = j * side + i;
    ok[k] = 1;
    id[k] = parcel.id;
    axis[k] = parcel.axis;
    count.set(parcel.id, (count.get(parcel.id) ?? 0) + 1);
    near.set(parcel.id, (near.get(parcel.id) ?? 0) + 1 / (1 + d2 / 400));
  }
  // The two or three fields with most ground near the mill; a scrap of a field is not sown.
  const crops = new Map<number, number>();
  for (let pick = 0; pick < 3; pick++) {
    let best = 0, bestScore = 0;
    for (const [pid, cells] of count) {
      if (cells < 90 || crops.has(pid)) continue;
      const sc = near.get(pid) as number;
      if (sc > bestScore) { bestScore = sc; best = pid; }
    }
    if (bestScore === 0) break;
    crops.set(best, pick);
  }
  if (crops.size === 0) return;
  const s = S.sculpt(side, side);
  s.x = x0;
  s.y = y0;
  s.base = 0;
  const first = (seed & 1) === 0;
  for (let j = 1; j < side - 1; j++) for (let i = 1; i < side - 1; i++) {
    const k = j * side + i;
    const crop = ok[k] ? crops.get(id[k]) : undefined;
    if (crop === undefined) continue;
    // No single cells: a field's edge is a line, not a scatter.
    if (ok[k - 1] + ok[k + 1] + ok[k - side] + ok[k + side] < 3) continue;
    const wheat = (crop === 1) !== first;
    const row = furrowAt(wrap(x0 + i, c.n), wrap(y0 + j, c.n), axis[k]) % 4 === 0;
    s.paint[k] = wheat ? (row ? M.wheatRow : M.wheat) : row ? M.barleyRow : M.barley;
  }
  w.structures.push(s);
}

/** The small unnamed thing a free site holds: a wayside cross, a sheepfold, or a jetty where there is water to the south. */
function standFeature(w: Work, site: PlacedSite, x: number, y: number): void {
  const kind = featureFor(site.type);
  if (kind === "jetty") {
    // The nearest shore with water to its south, within 60 cells.
    for (let d = 0; d <= 60; d += 4) for (const side of [0, 1, -1]) {
      const px = x + side * d * 0.7, py = y + d;
      if (dry(w, px, py) && w.c.isSea[node(w.c, px, py + 6)] && w.c.isSea[node(w.c, px, py + 10)]) {
        w.structures.push(S.standAt(S.jetty(10), px, py + 7, 0));
        return;
      }
    }
    w.structures.push(S.standAt(S.waysideCross(), x, y, groundAt(w, x, y)));
    return;
  }
  w.structures.push(S.standAt(kind === "sheepfold" ? S.sheepfold() : S.waysideCross(), x, y, groundAt(w, x, y)));
}

/** The harbour's raster: its size, the column of the quay's middle and the row of the shore line. */
const HB = { w: 98, h: 44, x: 49, y: 3 };
/**
 * The basin: a round cove with a lobe on its sheltered side, as ellipses (centre x, centre y, rx, ry) in cells
 * from the quay's middle on the shore line, y to the south. The lobe's x is given for the river on the east.
 */
const BASIN: readonly (readonly [number, number, number, number])[] = [[0, 14, 32, 12], [-13, 17, 20, 10]];
/** The mole follows an ellipse round the basin, centred on the first ellipse's centre. */
const MOLE = { y: 14, rx: 40, ry: 19 };

/** True inside the basin, its ellipses grown by `grow` cells. (lx, ly) are cells from the quay's middle on the shore line. */
export function inBasin(lx: number, ly: number, river: number, grow: number): boolean {
  for (let k = 0; k < BASIN.length; k++) {
    const b = BASIN[k], dx = (lx - (k === 0 ? b[0] : river * b[0])) / (b[2] + grow), dy = (ly - b[1]) / (b[3] + grow);
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}

/**
 * The harbour's stonework (98 × 44; the quay's middle at local x 49, the shore line at local y 3): a quay wall
 * that follows the round of the basin along the town's front, with bollards and a cobbled slipway running down
 * into the water; a mole that springs from the sheltered end and curves round the basin to a head with a light,
 * a parapet on its seaward side; and a short pier from the river's end, so the mouth lies between the two.
 * `river` is −1 or 1: the side the river is on. Mole and pier are left out wherever `land` says the ground
 * already stands (local raster cells): there the shore itself closes the basin.
 */
export function harbourWorks(river: number, land?: (i: number, j: number) => boolean): Structure {
  const W = HB.w, H = HB.h, s = S.sculpt(W, H);
  // The mole's head: where the ellipse is met by a ray most of the way round to the river's side.
  const hu = -0.55, hv = 0.45, hk = 1 / Math.sqrt((hu * hu) / (MOLE.rx * MOLE.rx) + (hv * hv) / (MOLE.ry * MOLE.ry));
  const headX = -river * hu * hk, headY = MOLE.y + hv * hk;
  const slip = river * 13;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const lx = i + 0.5 - HB.x, ly = j + 0.5 - HB.y;
    if (inBasin(lx, ly, river, 0)) {
      // The slipway: cobbles sloping from the quay into the water.
      if (Math.abs(lx - slip) > 2.5 || ly > MOLE.y) continue;
      const edge = BASIN[0][1] - BASIN[0][3] * Math.sqrt(1 - (lx * lx) / (BASIN[0][2] * BASIN[0][2]));
      const top = 2.3 - 0.26 * (ly - edge);
      if (top >= 0.3) S.put(s, i, j, top, (j & 1) === 0 ? M.cobble : M.stone, 136);
      continue;
    }
    // The quay wall: the ring of stone round the basin's northern half.
    if (ly < MOLE.y - 1 && Math.abs(lx) < 35 && inBasin(lx, ly, river, 2.2)) {
      const front = inBasin(lx, ly + 1.2, river, 0);
      if (front && i % 7 === 3 && Math.abs(lx - slip) > 4) S.put(s, i, j, 3.3, M.stoneDark, S.T_WALL);
      else S.put(s, i, j, 2.4, M.stone, S.T_FLAT);
      continue;
    }
    // Round the mole's ellipse: `a` runs from 0 at the sheltered end through 1 due south to 2 at the river's end.
    const u = -river * lx, v = ly - MOLE.y, len = Math.sqrt(u * u + v * v);
    const q = Math.sqrt((u * u) / (MOLE.rx * MOLE.rx) + (v * v) / (MOLE.ry * MOLE.ry));
    if (q < 0.5) continue;
    const d = len * (1 - 1 / q);
    const a = v >= 0 ? 1 - u / (Math.abs(u) + v) : u > 0 ? u / (u - v) - 1 : -3;
    const head = Math.sqrt((lx - headX) * (lx - headX) + (ly - headY) * (ly - headY));
    const mole = (Math.abs(d) <= 2.3 && a >= -0.25 && a <= 1.55) || head <= 3.3;
    const pier = Math.abs(d) <= 1.9 && ((v >= 0 && a >= 1.8) || (v < 0 && u < 0 && v > -5));
    if (!mole && !pier) continue;
    if (land && land(i, j)) continue;
    const sea = mole && head > 3.3 && d > 0.9;
    S.put(s, i, j, sea ? 3.6 : 2.6, M.stone, sea ? 156 : S.T_FLAT);
  }
  // The light on the mole's head.
  const li = Math.floor(headX + HB.x), lj = Math.floor(headY + HB.y);
  if (s.top[lj * W + li] > 0) {
    S.put(s, li, lj, 6.5, M.stone, S.T_WALL);
    S.mark(s, li, lj, 7, M.lantern, 170);
    S.mark(s, li, lj, 8, M.roofSlate, 110);
  }
  // Every face that looks south is wall, with a dark course where it meets the water.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, t = s.top[k];
    if (t <= 0 || s.mat[k] === M.cobble) continue;
    const south = j + 1 < H ? s.top[k + W] : 0;
    if (t - south < 0.7) continue;
    s.tone[k] = S.T_WALL;
    if (south === 0 && t >= 2) S.mark(s, i, j, 1, M.stoneDark, 96);
  }
  return s;
}

/**
 * The town: a quay round a cove deepened into a basin, closed by a curved mole; warehouses on the quay; the
 * church, its bell tower and a palazzo on a square a little up from it; and houses of many sizes in rows along
 * street terraces up the hillside. Each row runs as far as its houses and no further, so the terraces end
 * raggedly; stepped lanes climb between the houses from the quay to the top rows, jogging at the streets;
 * garden plots and vines fill the gaps. (The orchards round it are planted once the roads are laid: greenBelt.)
 */
function standTown(w: Work, site: PlacedSite): void {
  const hb = site.harbour;
  if (!hb) return;
  const n = w.c.n;
  const hx = Math.floor(hb.x), shore = Math.floor(hb.y) + 2;
  const rnd = (a: number, b: number): number => (hash2(a, b, w.seed ^ 0x70a1) & 1023) / 1024;
  // The river's side; the mole shelters the other.
  const river = torusDelta(hx, hb.mouthX, n) < 0 ? -1 : 1;
  // What stood here before anything was built: where the shore itself already closes the basin, no mole is needed.
  const natural = Float64Array.from(w.g);
  // The quay and the low ground behind it, built up clear of the tide as far as the first street; then the
  // basin, cut out of it.
  addConform(w, { kind: "raise", x: hx, y: shore - 4, rx: 50, ry: 18, round: true, level: 1.8, skirt: 3, limit: 0 });
  BASIN.forEach((b, k) => addConform(w, { kind: "dredge", x: hx + (k === 0 ? b[0] : river * b[0]), y: shore + b[1], rx: b[2], ry: b[3], round: true, level: -3, skirt: 2, limit: 0 }));
  block(w, hx, shore - 40, 60, 44);
  const taken: [number, number, number, number][] = [];
  w.town = { hx, shore, taken };

  // The church square, levelled before the terraces are cut round it.
  const tx = hx - river * 6, sqY = shore - 28;
  addConform(w, flat(tx, sqY, 13, 8, false, groundAt(w, tx, sqY), 3, 2.5));
  taken.push([tx - 14, sqY - 9, tx + 14, sqY + 9]);

  // The ground as a street terrace leaves it: stepped every 2.5 units. Terraces are cut only where houses
  // stand (below), and a house's floor is the step its doorway lies on.
  const gh = { h: w.g, gN: w.c.gN };
  const tg = (x: number, y: number): number => {
    const v = heightAt(gh, x, y);
    if (v < 1.2) return v;
    const q = 1.8 + 2.5 * Math.floor((v - 1.8) / 2.5 + 0.5);
    return q < 1.2 ? 1.2 : q;
  };
  // A rill may run under the town in a culvert; the sea, a lake or a river may not.
  const firm = (x: number, y: number): boolean => {
    const i = node(w.c, x, y);
    return !w.c.isSea[i] && w.c.lakeId[i] < 0 && w.c.rw[i] <= 1;
  };
  const runs: [number, number, number][] = [];
  // Rows of houses: widest low down, shorter and shifted up the hill.
  const ROWS = 8;
  const rows: { south: number; xl: number; xr: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    const south = shore - 12 - 12 * r;
    const yrel = (south - (shore - 44)) / 66;
    const half = 76 * Math.sqrt(Math.max(0.05, 1 - yrel * yrel));
    const lean = (rnd(r, 3) - 0.5) * 24 * (r / (ROWS - 1));
    const xl = Math.floor(hx + lean - half * (0.72 + 0.32 * rnd(r, 1))), xr = Math.floor(hx + lean + half * (0.72 + 0.32 * rnd(r, 2)));
    rows.push({ south, xl, xr });
  }

  // One raster for the town's paving, lanes and gardens.
  const pw = 184, ph = 140, px0 = hx - 92, py0 = shore - 122;
  const pave = S.sculpt(pw, ph);
  pave.x = px0;
  pave.y = py0;
  pave.base = 0;
  const paveAt = (x: number, y: number, ww: number, hh: number, mat: number = M.cobble): void => S.paint(pave, Math.floor(x) - px0, Math.floor(y) - py0, ww, hh, mat);
  // The quay: cobbles from the first street down to the wall, round the basin's head.
  for (let y = shore - 9; y < shore + 15; y++) for (let x = hx - 42; x < hx + 42; x++) {
    const lx = x + 0.5 - hx, ly = y + 0.5 - shore;
    if (inBasin(lx, ly, river, 0) || (lx * lx) / (46 * 46) + ((ly + 4) * (ly + 4)) / (17 * 17) >= 1) continue;
    paveAt(x, y, 1, 1);
  }

  // The harbour: quay wall, slipway, mole and pier, and boats in the basin.
  const worksX = hx - HB.x, worksY = shore - HB.y;
  const works = harbourWorks(river, (i, j) => heightAt({ h: natural, gN: w.c.gN }, worksX + i + 0.5, worksY + j + 0.5) > 0.6);
  works.x = worksX;
  works.y = worksY;
  works.base = 0;
  w.structures.push(works);
  let afloat = 0;
  for (let k = 0; k < 24 && afloat < 9; k++) {
    const hsh = hash2(k, 77, w.seed);
    const bx = hx - 30 + (hsh % 60), by = shore + 4 + ((hsh >>> 8) % 23);
    let clear = inBasin(bx - hx - 3, by - shore, river, -2.5) && inBasin(bx - hx + 3, by - shore, river, -2.5) && inBasin(bx - hx, by - shore - 2, river, -2.5) && inBasin(bx - hx, by - shore + 2, river, -2.5);
    for (let j = -2; j <= 2 && clear; j++) for (let i = -4; i <= 4; i++) {
      const lx = bx + i - works.x, ly = by + j - works.y;
      if (lx >= 0 && ly >= 0 && lx < works.w && ly < works.h && works.top[ly * works.w + lx] > 0) { clear = false; break; }
    }
    if (!clear) continue;
    w.structures.push(S.standAt(S.boat(hsh >>> 12), bx, by, 0));
    afloat++;
  }
  // A boat hauled out on the slipway.
  w.structures.push(S.standAt(S.boat(5), hx + river * 13, shore + 4, 1.4));

  // Warehouses on the quay, one towards either end, clear of the street down from the square.
  for (const side of [-1, 1]) {
    const cx = hx + side * 27, cy = shore - 4;
    const base = groundAt(w, cx, cy);
    if (base > 4 || base < 1.2 || !firm(cx - 6, cy) || !firm(cx + 6, cy) || Math.abs(groundAt(w, cx - 6, cy) - groundAt(w, cx + 6, cy)) > 1.5) continue;
    w.structures.push(S.standAt(S.warehouse(hash2(side, 5, w.seed)), cx, cy, base));
    taken.push([cx - 7, cy - 3, cx + 7, cy + 3]);
  }

  // The palazzo, beside the square on the river's side.
  const pzX = tx + river * 23, pzY = sqY + 2;
  const palazzo = firm(pzX - 8, pzY) && firm(pzX + 8, pzY) && firm(pzX, pzY - 5) && Math.abs(tg(pzX - 7, pzY) - tg(pzX + 7, pzY)) < 5 && tg(pzX, pzY) > 1.3;
  if (palazzo) {
    addConform(w, flat(pzX, pzY, 9, 5, false, groundAt(w, pzX, pzY), 3, 2.5));
    taken.push([pzX - 9, pzY - 5, pzX + 9, pzY + 5]);
  }

  // The boxes houses and lanes keep clear of: the square, the warehouses and the palazzo.
  const fixedBoxes = taken.length;
  const reserved = (x0: number, x1: number, south: number, depth: number): boolean => {
    for (let k = 0; k < fixedBoxes; k++) { const [ax, ay, bx, by] = taken[k]; if (x1 > ax && x0 < bx && south > ay && south - depth < by) return true; }
    return false;
  };

  // Stepped lanes: four ways up the hill, each jogging a little every second street.
  const LANES = 4;
  const laneBase: number[] = [];
  for (let j = 0; j < LANES; j++) laneBase.push(hx - 43 + 28 * j + Math.floor(rnd(j, 9) * 9) - 4);
  const laneX = (j: number, r: number): number => laneBase[j] + Math.floor(rnd(j * 8 + (r >> 1), 11) * 5) - 2;

  for (let r = 0; r < ROWS; r++) {
    const { south, xl, xr } = rows[r];
    const mid = (xl + xr) / 2, halfW = (xr - xl) / 2;
    let x = xl + (hash2(r, 3, w.seed) % 4), first = Infinity, last = -Infinity, runFrom = Infinity, runTo = -Infinity;
    while (x < xr) {
      const hsh = hash2(x, south, w.seed);
      // The better houses stand low down and near the middle; cottages at the top and the edges.
      const hs = S.townHouse(hsh, r / (ROWS - 1) + Math.abs(x - mid) / (2 * halfW));
      // No house stands in a lane.
      let lane = -Infinity;
      for (let j = 0; j < LANES; j++) { const lx = laneX(j, r); if (x < lx + 3 && x + hs.w > lx - 1) lane = lx; }
      if (lane > -Infinity) { x = lane + 3; continue; }
      const cx = x + hs.w / 2, q = Math.abs(cx - mid) / halfW;
      const gap = (hsh >>> 20) % 8 === 0 ? 3 : (hsh >>> 23) % 3 === 0 ? 1 : 0;
      // The street from the quay to the square is kept open through the first row.
      const open = reserved(x, x + hs.w, south + 1, hs.h + 1) || (r === 0 && x < tx + 3 && x + hs.w > tx - 3);
      const base = tg(cx, south);
      const back = tg(cx, south - hs.h);
      const fits = !open && base > 1.3 && back - base < 6 &&
        firm(x, south) && firm(x + hs.w, south) && firm(cx, south - hs.h) &&
        Math.abs(tg(x + 0.5, south) - tg(x + hs.w - 0.5, south)) < 2;
      if (fits && ((hsh >>> 26) & 31) / 32 > q * q * 0.75 - 0.15) {
        hs.x = x;
        hs.y = south - hs.h + 1;
        hs.base = base;
        w.structures.push(hs);
        taken.push([x - 1, hs.y - 1, x + hs.w + 1, south + 2]);
        if (x < first) first = x;
        if (x + hs.w > last) last = x + hs.w;
        // A run of houses shares one terrace; a gap of more than a house's width ends it.
        if (x - runTo > 9 && runTo > runFrom) { runs.push([runFrom, runTo, south]); runFrom = x; }
        if (x < runFrom) runFrom = x;
        runTo = x + hs.w;
        x += hs.w + gap;
      } else if (fits && ((hsh >>> 16) & 7) < 3) {
        // A plot where no house stands: vines in rows, a kitchen garden in beds, or a few fruit trees.
        const gw = 5 + ((hsh >>> 18) & 3), kind = (hsh >>> 12) % 3;
        if (kind === 2) w.structures.push(S.standAt(S.orchard(gw + 2, 7, hsh), x + gw / 2, south - 2, 0));
        else for (let gy = south - 4; gy <= south; gy++) for (let gx = x; gx < x + gw; gx++) {
          const mat = kind === 0 ? (Math.floor((4 * gy) / 5) & 1 ? M.vineRow : M.vine) : (gx - x) % 3 === 2 ? M.plough : gy === south - 2 ? M.plough : M.ley;
          paveAt(gx, gy, 1, 1, mat);
        }
        taken.push([x - 1, south - 6, x + gw + 2, south + 1]);
        x += gw + 1;
      } else x += 3 + (hsh & 3);
    }
    if (runTo > runFrom) runs.push([runFrom, runTo, south]);
    // The street along the row runs from its first door to its last, and no further.
    if (last > first) paveAt(first - 1, south + 1, last - first + 2, 2);
    // The lanes climb from this street to the next: stone steps, a dark riser every third row.
    for (let j = 0; j < LANES; j++) {
      const lx = laneX(j, r);
      if (lx < xl + 2 || lx > xr - 3) continue;
      for (let y = south - 10; y <= south + 2; y++) {
        if (reserved(lx, lx + 2, y + 1, 1) || !dry(w, lx, y)) continue;
        paveAt(lx, y, 2, 1, Math.floor((4 * y) / 5) % 3 === 0 ? M.stoneDark : M.cobble);
      }
    }
    // The coast road meets the first street.
    if (r === 0 && last > first) {
      const side = site.approach.x < hx ? -1 : 1;
      spur(w, site.approach.x, site.approach.y, side < 0 ? first : last, south + 1.5, 2);
    }
  }
  // The terraces: one under each run of houses and one under the square, ending where the houses end.
  addConform(w, { kind: "terrace", x: tx, y: sqY, rx: 13, ry: 8, round: false, level: 1.8, skirt: 2, limit: 2.5 });
  if (palazzo) addConform(w, { kind: "terrace", x: pzX, y: pzY, rx: 9, ry: 5, round: false, level: 1.8, skirt: 2, limit: 2.5 });
  for (const [x0, x1, south] of runs) {
    addConform(w, { kind: "terrace", x: (x0 + x1) / 2, y: south - 5, rx: (x1 - x0) / 2 + 3, ry: 6.5, round: false, level: 1.8, skirt: 4, limit: 2.5 });
  }
  // The square: the bell tower at its west end, the church along its north side, a cross in the middle,
  // and a street down to the quay.
  paveAt(tx - 13, sqY - 8, 27, 17);
  paveAt(tx - 2, sqY + 8, 4, shore - 9 - (sqY + 8));
  w.structures.push(S.standAt(S.bellTower(), tx - 8, sqY - 1, footing(w, tx - 8, sqY - 1, 3, 3)));
  w.structures.push(S.standAt(S.parishChurch(), tx + 4, sqY - 3, footing(w, tx + 4, sqY - 3, 7, 3.5)));
  w.structures.push(S.standAt(S.waysideCross(), tx + 3, sqY + 5, groundAt(w, tx + 3, sqY + 5)));
  if (palazzo) {
    paveAt(pzX - 9, pzY + 4, 19, 3);
    w.structures.push(S.standAt(S.palazzo(hash2(7, 7, w.seed)), pzX, pzY, footing(w, pzX, pzY, 7, 3.5)));
  }
  w.structures.push(pave);
}

/**
 * The green belt: orchards, olive groves, vines and kitchen gardens in a ring between the town's houses and the
 * woods, and in the larger gaps among the houses. Planted after the roads are laid, so no plot lies across one.
 */
function greenBelt(w: Work, roads: readonly RoadLine[]): void {
  const t = w.town;
  if (!t) return;
  const c = w.c, n = c.n;
  const cx = t.hx, cy = t.shore - 54, ra = 122, rb = 86;
  // Road cells near the town, in buckets of three cells.
  const way = new Set<number>();
  for (const r of roads) for (let k = 0; k < r.vertices.length; k += 2) {
    const dx = torusDelta(cx, r.vertices[k], n), dy = torusDelta(cy, r.vertices[k + 1], n);
    if (Math.abs(dx) > ra + 12 || Math.abs(dy) > rb + 12) continue;
    way.add(Math.floor((dy + 512) / 3) * 4096 + Math.floor((dx + 512) / 3));
  }
  const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
    for (const [ax, ay, bx, by] of t.taken) if (x1 > ax - 1 && x0 < bx + 1 && y1 > ay - 1 && y0 < by + 1) return false;
    for (let by = Math.floor((y0 - cy + 510) / 3); by <= Math.floor((y1 - cy + 514) / 3); by++) for (let bx = Math.floor((x0 - cx + 510) / 3); bx <= Math.floor((x1 - cx + 514) / 3); bx++) {
      if (way.has(by * 4096 + bx)) return false;
    }
    return true;
  };
  // First the woods are cleared back from the town: a clearing in tall trees shows only if it is one open sweep
  // from the houses outward, so wherever wood would stand inside the ring there is pasture instead. Its edge wanders.
  const bw = 2 * ra + 1, bh = 2 * rb + 1;
  const lawn = S.sculpt(bw, bh);
  lawn.x = cx - ra;
  lawn.y = cy - rb;
  lawn.onGround = true;
  const wood = new Map<number, boolean>();
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const dx = i - ra, dy = j - rb, x = cx + dx + 0.5, y = cy + dy + 0.5;
    if ((dx * dx) / (ra * ra) + (dy * dy) / (rb * rb) + 0.2 * drift(x, y, 28 * (n / 6400), n, w.seed ^ 0x77b1) > 0.94) continue;
    const ni = node(c, x, y);
    if (c.isSea[ni] || c.lakeId[ni] >= 0 || c.rw[ni] > 0) continue;
    let f = wood.get(ni);
    if (f === undefined) {
      const m = coverAtNode(c, ni % c.gN, Math.floor(ni / c.gN));
      f = m >= M.floorBroadleaf && m <= M.shrub;
      wood.set(ni, f);
    }
    if (!f || way.has(Math.floor((dy + 512) / 3) * 4096 + Math.floor((dx + 512) / 3))) continue;
    let inside = false;
    for (const [ax, ay, bx, by] of t.taken) if (x > ax - 1 && x < bx + 1 && y > ay - 1 && y < by + 1) { inside = true; break; }
    if (inside) continue;
    lawn.paint[j * bw + i] = (hash2(Math.floor(x / 9), Math.floor(y / 7), w.seed ^ 0x1a9) & 3) === 0 ? M.ley : M.hay;
  }
  w.structures.push(lawn);
  for (let gy = -rb; gy < rb; gy += 11) for (let gx = -ra; gx < ra; gx += 16) {
    const hsh = hash2(gx, gy, w.seed ^ 0x6b17);
    const pw = 11 + (hsh & 3), pd = 8 + ((hsh >>> 2) & 1);
    const x = cx + gx + ((hsh >>> 4) & 3), y = cy + gy + ((hsh >>> 6) & 3);
    const q = (gx * gx) / (ra * ra) + (gy * gy) / (rb * rb);
    // The ring thins out at its outer edge.
    if (q > 1 || (q > 0.7 && ((hsh >>> 8) & 3) === 0) || y + pd / 2 > t.shore - 11) continue;
    if (!free(x - pw / 2, y - pd / 2, x + pw / 2, y + pd / 2)) continue;
    let ok = true, lo = Infinity, hi = -Infinity;
    for (const [ox, oy] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const px = x + ox * pw, py = y + oy * pd;
      const ni = node(c, px, py);
      // A rill may run through an orchard; a river, a lake or the sea may not.
      if (c.isSea[ni] || c.lakeId[ni] >= 0 || c.rw[ni] > 1 || c.slope[ni] > 0.7) { ok = false; break; }
      const v = groundAt(w, px, py);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!ok || lo < 1.6 || hi - lo > 14) continue;
    const kind = (hsh >>> 10) % 8;
    if (kind < 3) w.structures.push(S.standAt(S.orchard(pw, pd, hsh, M.broadleafWarm, 3), x, y, 0));
    else if (kind < 6) w.structures.push(S.standAt(S.oliveGrove(pw + 1, pd, hsh), x, y, 0));
    else w.structures.push(S.standAt(S.gardenPlot(pw - 2, pd - 2, hsh), x, y, 0));
    t.taken.push([x - pw / 2, y - pd / 2, x + pw / 2, y + pd / 2]);
  }
}

// ---------------------------------------------------------------------------
// Hamlets.

function isSlate(c: SiteContext, i: number): boolean {
  const cN = c.gN / 2, gx = i % c.gN, gy = (i - gx) / c.gN, ci = (gy >> 1) * cN + (gx >> 1), cc = cN * cN;
  return c.regions[ARCHETYPE.slate * cc + ci] + c.regions[ARCHETYPE.highland * cc + ci] + c.regions[ARCHETYPE.lakes * cc + ci] > 0.5;
}

function pickHamlets(w: Work, sites: readonly PlacedSite[]): Hamlet[] {
  const c = w.c, gN = c.gN, k = c.n / 6400;
  const xs: number[] = [], ys: number[] = [], score: number[] = [];
  for (let gy = 0; gy < gN; gy += 2) for (let gx = 0; gx < gN; gx += 2) {
    const i = gy * gN + gx;
    if (c.isSea[i] || c.lakeId[i] >= 0 || c.rw[i] > 0 || c.slope[i] > 0.14 || c.h[i] < 1.5 || c.hand[i] > 14 || c.islandSize[c.island[i]] < 500) continue;
    let s = 0, wet = false;
    for (let dy = -2; dy <= 2 && !wet; dy++) for (let dx = -2; dx <= 2; dx++) {
      const j = wrap(gy + dy, gN) * gN + wrap(gx + dx, gN);
      if (c.isSea[j] || c.lakeId[j] >= 0 || c.rw[j] > 0) { wet = true; break; }
      s += c.slope[j];
    }
    if (wet || s / 25 > 0.16) continue;
    // By a river or a sheltered shore: where a road would cross or end.
    let water = 0;
    for (let d = 3; d <= 9 && water === 0; d += 2) for (let q = 0; q < 8; q++) {
      const j = wrap(gy + Math.floor(d * (q === 0 || q === 1 || q === 7 ? 1 : q === 3 || q === 4 || q === 5 ? -1 : 0) * 0.8 + 0.5), gN) * gN +
        wrap(gx + Math.floor(d * (q === 1 || q === 2 || q === 3 ? 1 : q === 5 || q === 6 || q === 7 ? -1 : 0) * 0.8 + 0.5), gN);
      if (c.rw[j] >= 2) water = Math.max(water, 1.5);
      else if (c.rw[j] === 1) water = Math.max(water, 0.8);
      else if (c.isSea[j] && c.exposure[i] < 0.4) water = Math.max(water, 0.7);
    }
    xs.push(4 * gx + 2);
    ys.push(4 * gy + 2);
    score.push(1 - (s / 25) / 0.16 + water + (hash2(gx, gy, w.seed) & 255) / 512);
  }
  const order = sortIndicesBy(score.map((v) => -v));
  const out: Hamlet[] = [];
  const apart = 420 * k, clear = 240 * k;
  for (let q = 0; q < order.length && out.length < 120; q++) {
    const x = xs[order[q]], y = ys[order[q]];
    let ok = true;
    for (const s of sites) {
      const dx = torusDelta(x, s.x, c.n), dy = torusDelta(y, s.y, c.n);
      if (dx * dx + dy * dy < (s.type === "town" ? 4 : 1) * clear * clear) { ok = false; break; }
    }
    for (let j = 0; j < out.length && ok; j++) {
      const dx = torusDelta(x, out[j].x, c.n), dy = torusDelta(y, out[j].y, c.n);
      if (dx * dx + dy * dy < apart * apart) ok = false;
    }
    if (!ok) continue;
    const i = node(c, x, y);
    out.push({ x, y, houses: 3 + (hash2(x, y, w.seed ^ 0x51) % 6), island: c.island[i], quarry: false });
  }
  return out;
}

function standHamlet(w: Work, hm: Hamlet): void {
  const c = w.c, gh = { h: w.g, gN: c.gN };
  // The street runs along the contour.
  const gx = (heightAt(gh, hm.x + 6, hm.y) - heightAt(gh, hm.x - 6, hm.y)) / 12, gy = (heightAt(gh, hm.x, hm.y + 6) - heightAt(gh, hm.x, hm.y - 6)) / 12;
  const gl = Math.sqrt(gx * gx + gy * gy);
  let ax = 1, ay = 0;
  if (gl > 0.02) { ax = -gy / gl; ay = gx / gl; if (ax < 0) { ax = -ax; ay = -ay; } }
  const slate = isSlate(c, node(c, hm.x, hm.y));
  let stood = 0;
  for (let k = 0; k < hm.houses + 3 && stood < hm.houses; k++) {
    const t = (k - (hm.houses - 1) / 2) * 10, side = (k & 1) === 0 ? -5.5 : 5.5;
    const hsh = hash2(k, Math.floor(hm.x) + 7919 * Math.floor(hm.y), w.seed);
    const cx = Math.floor(hm.x + ax * t - ay * side + ((hsh & 3) - 1.5)), cy = Math.floor(hm.y + ay * t + ax * side + (((hsh >>> 2) & 3) - 1.5));
    if (!dry(w, cx, cy) || !dry(w, cx - 4, cy) || !dry(w, cx + 4, cy) || !dry(w, cx, cy + 4) || c.slope[node(c, cx, cy)] > 0.3) continue;
    const hs = S.countryHouse(hsh >>> 4, slate);
    const base = groundAt(w, cx, cy + hs.h / 2);
    if (base < 1) continue;
    addConform(w, flat(cx, cy, hs.w / 2 + 1, hs.h / 2 + 1, false, base, 3, 1.5));
    w.structures.push(S.standAt(hs, cx, cy, base));
    stood++;
  }
  hm.houses = stood;
  block(w, hm.x, hm.y, 4, 4);
}

/** A slate quarry by a hamlet of the slate country: a bench cut into a south-facing slope, spoil below it, a row of cottages. */
function standQuarry(w: Work, hm: Hamlet): boolean {
  const c = w.c, gN = c.gN;
  const hx = Math.floor(hm.x / 4), hy = Math.floor(hm.y / 4);
  let best = -1, bestScore = 0;
  for (let dy = -22; dy <= 22; dy++) for (let dx = -22; dx <= 22; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 < 64 || d2 > 484) continue;
    const i = wrap(hy + dy, gN) * gN + wrap(hx + dx, gN);
    if (c.isSea[i] || c.lakeId[i] >= 0 || c.rw[i] > 0 || w.blocked[i] || c.slope[i] < 0.3 || c.slope[i] > 0.9) continue;
    // South-facing: the ground rises to the north.
    const rise = (c.h[wrap(hy + dy - 2, gN) * gN + wrap(hx + dx, gN)] - c.h[wrap(hy + dy + 2, gN) * gN + wrap(hx + dx, gN)]) / 16;
    if (rise < 0.25) continue;
    const s = rise + (hash2(dx, dy, w.seed) & 255) / 1024;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  if (best < 0) return false;
  const qx = 4 * (best % gN) + 2, qy = 4 * Math.floor(best / gN) + 2;
  // The floor is cut level into the hill; above it two benches step back, each a face of fresh slate.
  const level = groundAt(w, qx, qy + 9);
  // Not on a shore: the floor must stand clear of the sea, on dry ground all round.
  if (level < 3 || !dry(w, qx - 15, qy + 12) || !dry(w, qx + 15, qy + 12) || !dry(w, qx - 15, qy - 10) || !dry(w, qx + 15, qy - 10)) return false;
  addConform(w, flat(qx, qy, 15, 10, false, level, 3, 16));
  block(w, qx, qy, 16, 12);
  const s = S.sculpt(34, 30);
  for (let y = 0; y < 24; y++) for (let x = 1; x < 33; x++) {
    if (Math.min(x - 1, 32 - x) < (hash2(x >> 1, y >> 2, w.seed) & 1)) continue;
    s.paint[y * 34 + x] = M.quarry;
  }
  const bench = (x0: number, x1: number, y0: number, y1: number, top: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ragged = top - ((hash2(x, y, w.seed) & 7) === 0 ? 1 : 0);
      S.put(s, x, y, ragged, y === y1 ? M.cliffSlate : M.quarry, y === y1 ? 104 : 150);
    }
    // Joints in the face.
    for (let x = x0 + 1; x <= x1; x += 2 + (hash2(x, y1, w.seed) & 3)) for (let z = 1; z < top; z++) S.mark(s, x, y1, z, M.opening, 110);
  };
  bench(3, 30, 6, 11, 4);
  bench(7, 27, 1, 5, 8);
  // Spoil tipped over the lip.
  for (let k = 0; k < 5; k++) {
    const hsh = hash2(k, qx + qy, w.seed);
    const lx = 4 + k * 6 + (hsh & 3), ly = 25 + ((hsh >>> 2) & 1), r = 2.4 + ((hsh >>> 4) & 3) * 0.4;
    for (let y = Math.floor(ly - r); y <= Math.ceil(ly + r); y++) for (let x = Math.floor(lx - r); x <= Math.ceil(lx + r); x++) {
      const d2 = (x - lx) * (x - lx) + (y - ly) * (y - ly);
      if (d2 <= r * r && 0.6 + 2.6 * Math.sqrt(1 - d2 / (r * r)) > s.top[y * 34 + x]) S.put(s, x, y, 0.6 + 2.6 * Math.sqrt(1 - d2 / (r * r)), M.screeSlate, 0);
    }
  }
  // Cut blocks on the floor.
  for (let k = 0; k < 7; k++) {
    const hsh = hash2(k, qx - qy, w.seed);
    const bx = 5 + (hsh % 24), by = 14 + ((hsh >>> 6) % 7);
    S.put(s, bx, by, 1 + ((hsh >>> 10) & 1), M.rockSlate, S.T_WALL);
    if ((hsh >>> 12) & 1) S.put(s, bx + 1, by, 1, M.rockSlate, S.T_WALL);
  }
  w.structures.push(S.standAt(s, qx, qy + 3, level - 0.01));
  w.structures.push(S.standAt(S.derrick(), qx - 6, qy + 1, level + 4));
  // A row of quarrymen's cottages on the first level ground near the tips.
  for (const [ox, oy] of [[-4, 26], [-22, 22], [16, 24], [-30, 8], [32, 8], [0, 36], [-24, 34], [22, 34]]) {
    const rx = qx + ox, ry = qy + oy;
    let ok = true, lo = Infinity, hi = -Infinity;
    for (let dx = -10; dx <= 10 && ok; dx += 5) for (const dy of [-3, 3]) {
      if (!dry(w, rx + dx, ry + dy) || w.blocked[node(w.c, rx + dx, ry + dy)]) { ok = false; break; }
      const g = groundAt(w, rx + dx, ry + dy);
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    if (!ok || hi - lo > 5 || lo < 1) continue;
    const base = (lo + hi) / 2;
    addConform(w, flat(rx, ry, 12, 4, false, base, 3, 3));
    const row = S.sculpt(20, 5);
    S.house(row, 0, 0, 20, 5, 3, 3, { gable: 0, wallMat: M.stoneDark, roofMat: M.roofSlate, openings: 0, chimney: false });
    for (let k = 0; k < 4; k++) {
      S.mark(row, 1 + k * 5, 4, 1, M.timber, 92);
      S.mark(row, 1 + k * 5, 4, 2, M.timber, 92);
      S.mark(row, 3 + k * 5, 4, 2, M.opening);
      S.put(row, 4 + k * 5, 1, row.top[1 * 20 + 4 + k * 5] + 2, M.stoneDark, S.T_WALL);
    }
    w.structures.push(S.standAt(row, rx, ry, base));
    block(w, rx, ry, 11, 4);
    break;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lanes: the road network of gen/roads.ts over the sites and hamlets of each island, with a bridge wherever a
// lane crosses a river of w ≥ 2. findPath is a looser pathfinder for the stops that network cannot reach.

interface Stop {
  x: number;
  y: number;
  island: number;
  /** 2 a road end (town, abbey, hamlet, bridge), 1 a path end (lighthouse, windmill, yew, cathedral). */
  width: number;
  /** Bridge abutments carry their bridge's id; the lane between the two is the deck. */
  pair: number;
}

const STEP_X = [1, 1, 0, -1, -1, -1, 0, 1], STEP_Y = [0, 1, 1, 1, 0, -1, -1, -1];

/** Node path from a to b (unwrapped node coordinates in a's frame), or null. */
function findPath(w: Work, ax: number, ay: number, bx: number, by: number): number[] | null {
  const c = w.c, gN = c.gN, g = w.g;
  const margin = 40;
  const x0 = Math.min(ax, bx) - margin, y0 = Math.min(ay, by) - margin;
  const ww = Math.abs(ax - bx) + 2 * margin + 1, hh = Math.abs(ay - by) + 2 * margin + 1;
  if (ww > gN || hh > gN) return null;
  const dist = new Float64Array(ww * hh).fill(Infinity), from = new Int32Array(ww * hh).fill(-1);
  const heap = new MinHeap(ww * hh * 8 + 8);
  const start = (ay - y0) * ww + (ax - x0), goal = (by - y0) * ww + (bx - x0);
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const key = heap.peekKey();
    const u = heap.pop();
    const ux = u % ww, uy = (u - ux) / ww;
    const est = 4 * Math.sqrt((ux + x0 - bx) * (ux + x0 - bx) + (uy + y0 - by) * (uy + y0 - by));
    if (key > dist[u] + est + 1e-9) continue;
    if (u === goal) break;
    const ui = wrap(uy + y0, gN) * gN + wrap(ux + x0, gN);
    for (let k = 0; k < 8; k++) {
      const vx = ux + STEP_X[k], vy = uy + STEP_Y[k];
      if (vx < 0 || vy < 0 || vx >= ww || vy >= hh) continue;
      const v = vy * ww + vx, vi = wrap(vy + y0, gN) * gN + wrap(vx + x0, gN);
      if (c.isSea[vi] || c.lakeId[vi] >= 0 || c.rw[vi] > 4) continue;
      const len = (k & 1) === 0 ? 4 : 5.656854249492381;
      const grade = Math.abs(g[vi] - g[ui]) / len;
      if (grade > 0.3) continue;
      let cost = len * (1 + 40 * grade * grade);
      // South-facing flanks are cheaper: switchbacks show there.
      if (g[wrap(vy + y0 - 1, gN) * gN + wrap(vx + x0, gN)] > g[wrap(vy + y0 + 1, gN) * gN + wrap(vx + x0, gN)] + 0.4) cost *= 0.85;
      // A crossing is paid for on entry, and again for every node of water: a lane crosses square, and never wades along.
      if (c.rw[vi] > 0) cost += (c.rw[ui] === 0 ? (c.rw[vi] === 1 ? 8 : 50) : 0) + (c.rw[vi] === 1 ? 10 : 40);
      if (w.blocked[vi] && v !== goal) cost += 60;
      const nd = dist[u] + cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        from[v] = u;
        heap.push(nd + 4 * Math.sqrt((vx + x0 - bx) * (vx + x0 - bx) + (vy + y0 - by) * (vy + y0 - by)), v);
      }
    }
  }
  if (!(dist[goal] < Infinity)) return null;
  const out: number[] = [];
  for (let u = goal; u !== -1; u = from[u]) out.push((u % ww) + x0, Math.floor(u / ww) + y0);
  // Reverse the pairs: a first.
  const path: number[] = [];
  for (let k = out.length - 2; k >= 0; k -= 2) path.push(out[k], out[k + 1]);
  return path;
}

/** A polyline with no piece longer than ROAD_PIECE. */
function subdivide(pts: number[], width: number): RoadLine {
  const v: number[] = [pts[0], pts[1]];
  for (let k = 2; k < pts.length; k += 2) {
    const dx = pts[k] - pts[k - 2], dy = pts[k + 1] - pts[k - 1];
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / ROAD_PIECE));
    for (let s = 1; s <= steps; s++) v.push(pts[k - 2] + (dx * s) / steps, pts[k - 1] + (dy * s) / steps);
  }
  return { width, vertices: v };
}

/** A smooth line through the points (a Catmull–Rom spline), in pieces of about three cells. */
function curve(pts: number[], width: number): RoadLine {
  const m = pts.length / 2;
  if (m < 3) return subdivide(pts, width);
  const v: number[] = [pts[0], pts[1]];
  for (let k = 0; k + 1 < m; k++) {
    const a = 2 * Math.max(0, k - 1), b = 2 * k, cc = 2 * (k + 1), d = 2 * Math.min(m - 1, k + 2);
    const dx = pts[cc] - pts[b], dy = pts[cc + 1] - pts[b + 1];
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 3));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const w0 = -0.5 * t3 + t2 - 0.5 * t, w1 = 1.5 * t3 - 2.5 * t2 + 1, w2 = -1.5 * t3 + 2 * t2 + 0.5 * t, w3 = 0.5 * t3 - 0.5 * t2;
      v.push(w0 * pts[a] + w1 * pts[b] + w2 * pts[cc] + w3 * pts[d], w0 * pts[a + 1] + w1 * pts[b + 1] + w2 * pts[cc + 1] + w3 * pts[d + 1]);
    }
  }
  return { width, vertices: v };
}

/** The darker verge of a main road: the same line a cell to one side, so the road draws two pixels wide with a lighter crown. */
function verge(r: RoadLine): RoadLine {
  const v = r.vertices, m = v.length / 2, out: number[] = [];
  for (let k = 0; k < m; k++) {
    const a = 2 * Math.max(0, k - 1), b = 2 * Math.min(m - 1, k + 1);
    const tx = v[b] - v[a], ty = v[b + 1] - v[a + 1], tl = Math.sqrt(tx * tx + ty * ty) || 1;
    // To the south or east of the crown; a row of cells is 0.8 of a pixel deep, so the offset is longer north–south.
    let ux = -ty / tl, uy = tx / tl;
    if (uy < 0 || (uy === 0 && ux < 0)) { ux = -ux; uy = -uy; }
    const d = 1 + 0.35 * uy;
    out.push(v[2 * k] + ux * d, v[2 * k + 1] + uy * d);
  }
  return { width: 1, vertices: out };
}

/** Smooth noise in [−1, 1] on a lattice of `cells`, wrapped with the world: the slow drift that bends a ruled road. */
function drift(x: number, y: number, cells: number, n: number, seed: number): number {
  const period = Math.max(1, Math.floor(n / cells + 0.5)), size = n / period;
  const u = x / size, v = y / size, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number): number => hash2(wrap(a, period), wrap(b, period), seed) / 2147483648 - 1;
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
  return top + (bot - top) * sy;
}

/** Crest and valley, for the road network: nodes standing more than CREST[0] over the mean ground within CREST_R nodes cost more, up to 1 + CREST[2] at CREST[1]; ones as far under it cost VALLEY. Woods cost WOOD. */
const CREST_R = 4;
const CREST: readonly [number, number, number] = [2, 12, 1.4];
const VALLEY = 0.8;
const WOOD = 1.3;
/** A road's free points are carried up to WANDER cells (of the 6400 world) by a drift of WANDER_CELLS, less on steep ground. */
const WANDER = 9;
const WANDER_CELLS = 110;

/** gen/roads.ts parameters (design S10). */
export const ROAD_PARAMS: RoadParams = { gradeMax: 0.12, slopeCost: 40, southBonus: 0.15, bridgeCost: 50, maxBridgeWidth: 4, turnCost: 2, extraEdges: 0 };

/**
 * The road network over the stops (gen/roads.ts: a spanning tree plus a fifth more edges per island), turned
 * into road lines and bridges. The two ends of a reserved bridge are always joined by its deck. A stop the
 * network cannot reach under the 12 % grade limit is joined by the stand-in pathfinder, which allows steeper lanes.
 */
function layLanes(w: Work, stops: Stop[]): RoadLine[] {
  const c = w.c, gN = c.gN, n = c.n;
  const roads: RoadLine[] = [];
  // The network is found on C (8 cells a node): on G it takes minutes for a world's hundred stops.
  const cN = gN / 2;
  const h = new Float64Array(cN * cN), isSea = new Uint8Array(cN * cN), lake = new Uint8Array(cN * cN), riverWidth = new Uint8Array(cN * cN);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const k = y * cN + x;
    let land = 0;
    for (let q = 0; q < 4; q++) {
      const i = (2 * y + (q >> 1)) * gN + 2 * x + (q & 1);
      if (c.isSea[i]) continue;
      land++;
      h[k] += w.g[i];
      if (c.lakeId[i] >= 0) lake[k] = 1;
      if (c.rw[i] > riverWidth[k]) riverWidth[k] = c.rw[i];
    }
    if (land < 3) isSea[k] = 1;
    else h[k] /= land;
  }
  // A stop on a node the coarse grid calls sea moves to the nearest land node.
  const points = stops.map((s) => {
    const sx = wrap(Math.floor(s.x / 8), cN), sy = wrap(Math.floor(s.y / 8), cN);
    for (let d = 0; d <= 3; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const k = wrap(sy + dy, cN) * cN + wrap(sx + dx, cN);
      if (!isSea[k] && !lake[k]) return k;
    }
    return sy * cN + sx;
  });
  // Where a road would rather run: valley floors and saddles are cheap, crests dear, woods a little dearer than open ground.
  const land = new Float32Array(cN * cN), hl = new Float32Array(cN * cN);
  for (let k = 0; k < cN * cN; k++) if (!isSea[k]) { land[k] = 1; hl[k] = h[k]; }
  const near = boxBlur(hl, cN, CREST_R, 1), share = boxBlur(land, cN, CREST_R, 1);
  const bias = new Float32Array(cN * cN).fill(1);
  for (let y = 0; y < cN; y++) for (let x = 0; x < cN; x++) {
    const k = y * cN + x;
    if (isSea[k] || share[k] <= 0) continue;
    // How far the node stands over the ground round it.
    const over = h[k] - near[k] / share[k];
    let b = over > CREST[0] ? 1 + CREST[2] * Math.min(1, (over - CREST[0]) / (CREST[1] - CREST[0])) : over < -CREST[0] ? VALLEY : 1;
    const m = coverAtNode(c, 2 * x + 1, 2 * y + 1);
    if (m >= M.floorBroadleaf && m <= M.coniferWarm) b *= WOOD;
    bias[k] = b;
  }
  const net = roadNetwork({ n: cN, cellsPerNode: 8, h, isSea, lake, riverWidth, bias }, ROAD_PARAMS, points);
  // Union-find over the stops, to see which the network left out.
  const parent = stops.map((_, k) => k);
  const find = (k: number): number => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  for (const r of net) {
    const a = stops[r.a], b = stops[r.b];
    parent[find(r.a)] = find(r.b);
    if (a.pair >= 0 && a.pair === b.pair) continue;
    // Unwrap the node path, as cells.
    const path: number[] = [];
    let px = r.path[0] % cN, py = Math.floor(r.path[0] / cN);
    path.push(8 * px + 4, 8 * py + 4);
    for (let k = 1; k < r.path.length; k++) {
      const x = r.path[k] % cN, y = Math.floor(r.path[k] / cN);
      px += torusDelta(wrap(px, cN), x, cN);
      py += torusDelta(wrap(py, cN), y, cN);
      path.push(8 * px + 4, 8 * py + 4);
    }
    lanesOf(w, path, a, b, Math.min(a.width, b.width), roads);
  }
  stops.forEach((a, k) => {
    if (a.pair < 0) return;
    for (let j = k + 1; j < stops.length; j++) {
      const b = stops[j];
      if (b.pair !== a.pair) continue;
      roads.push(subdivide([a.x, a.y, a.x + torusDelta(a.x, b.x, n), a.y + torusDelta(a.y, b.y, n)], 2));
      parent[find(k)] = find(j);
    }
  });
  // Stragglers: each joins the nearest stop of its island that is in another group.
  for (let k = 0; k < stops.length; k++) {
    const a = stops[k];
    let best = -1, bd = Infinity, alone = true;
    for (let j = 0; j < stops.length; j++) if (j !== k && find(j) === find(k)) { alone = false; break; }
    if (!alone || a.island < 0) continue;
    for (let j = 0; j < stops.length; j++) {
      const b = stops[j];
      if (j === k || b.island !== a.island) continue;
      const dx = torusDelta(a.x, b.x, n), dy = torusDelta(a.y, b.y, n);
      if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = j; }
    }
    if (best < 0 || bd > 900 * 900) continue;
    const b = stops[best];
    const ax = Math.floor(a.x / 4), ay = Math.floor(a.y / 4);
    const path = findPath(w, ax, ay, ax + Math.floor(torusDelta(a.x, b.x, n) / 4 + 0.5), ay + Math.floor(torusDelta(a.y, b.y, n) / 4 + 0.5));
    if (path) { lanesOf(w, path.map((v) => 4 * v + 2), a, b, Math.min(a.width, b.width), roads); parent[find(k)] = find(best); }
  }
  // A stop still on its own (an islet's lighthouse, a mill with no neighbour) is reached by water: a path
  // down to the nearest shore that has the sea to its south, and a jetty there.
  for (let k = 0; k < stops.length; k++) {
    const a = stops[k];
    let alone = true;
    for (let j = 0; j < stops.length; j++) if (j !== k && find(j) === find(k)) { alone = false; break; }
    if (!alone || a.island < 0) continue;
    const ax = Math.floor(a.x / 4), ay = Math.floor(a.y / 4);
    // Shore nodes of the stop's island, best first; the first few are tried until a path reaches one.
    const shores: number[] = [], dist: number[] = [];
    for (let dy = -70; dy <= 70; dy++) for (let dx = -70; dx <= 70; dx++) {
      const i = wrap(ay + dy, gN) * gN + wrap(ax + dx, gN);
      if (c.isSea[i] || c.island[i] !== a.island || c.lakeId[i] >= 0 || c.rw[i] > 0 || w.g[i] > 12 || w.blocked[i]) continue;
      const south = c.isSea[wrap(ay + dy + 1, gN) * gN + wrap(ax + dx, gN)] && c.isSea[wrap(ay + dy + 2, gN) * gN + wrap(ax + dx, gN)];
      if (!south && !c.isSea[wrap(ay + dy - 1, gN) * gN + wrap(ax + dx, gN)] && !c.isSea[wrap(ay + dy, gN) * gN + wrap(ax + dx + 1, gN)] && !c.isSea[wrap(ay + dy, gN) * gN + wrap(ax + dx - 1, gN)]) continue;
      shores.push((dy + 70) * 141 + dx + 70);
      // A low, sheltered shore the camera sees comes first.
      dist.push(dx * dx + dy * dy + (c.exposure[i] > 0.5 ? 400 : 0) + (south ? 0 : 900) + 40 * w.g[i]);
    }
    const order = sortIndicesBy(dist);
    for (let q = 0; q < order.length && q < 6; q++) {
      const s = shores[order[q]], sx = ax + (s % 141) - 70, sy = ay + Math.floor(s / 141) - 70;
      const path = findPath(w, ax, ay, sx, sy);
      if (!path) continue;
      const end: Stop = { x: 4 * sx + 2, y: 4 * sy + 3.5, island: a.island, width: 1, pair: -1 };
      lanesOf(w, path.map((v) => 4 * v + 2), a, end, 1, roads);
      if (w.g[wrap(sy, gN) * gN + wrap(sx, gN)] <= 3.5 && c.isSea[wrap(sy + 1, gN) * gN + wrap(sx, gN)] && c.isSea[wrap(sy + 2, gN) * gN + wrap(sx, gN)]) w.structures.push(S.standAt(S.jetty(10), end.x, end.y + 5.5, 0));
      break;
    }
  }
  return roads;
}

/** Turns a path of cell positions (node centres, unwrapped) into road lines, with a bridge over every river of w ≥ 2 it crosses. */
function lanesOf(w: Work, path: number[], a: Stop, b: Stop, width: number, roads: RoadLine[]): void {
  const c = w.c, n = c.n;
  const m = path.length / 2;
  const px = new Float64Array(m), py = new Float64Array(m), fixed = new Uint8Array(m);
  for (let k = 0; k < m; k++) { px[k] = path[2 * k]; py[k] = path[2 * k + 1]; }
  // The ends meet the stops themselves.
  px[0] += torusDelta(px[0], a.x, n); py[0] += torusDelta(py[0], a.y, n);
  px[m - 1] = px[0] + torusDelta(a.x, b.x, n); py[m - 1] = py[0] + torusDelta(a.y, b.y, n);
  fixed[0] = fixed[m - 1] = 1;
  // A node an earlier lane passed through keeps that lane's line.
  const keyOf = (k: number): number => wrap(Math.floor(path[2 * k + 1]), n) * n + wrap(Math.floor(path[2 * k]), n);
  for (let k = 1; k < m - 1; k++) {
    const at = w.laid.get(keyOf(k));
    if (!at) continue;
    px[k] += torusDelta(px[k], at[0], n);
    py[k] += torusDelta(py[k], at[1], n);
    fixed[k] = 2;
  }
  // The widest river within a node's reach of the path point: the path may come from the coarse grid.
  const riverAt = (k: number): number => {
    let best = -1, bw = 0;
    for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
      const i = node(c, path[2 * k] + dx, path[2 * k + 1] + dy);
      if (c.rw[i] > bw) { bw = c.rw[i]; best = i; }
    }
    return best;
  };
  const wet = (k: number): number => { const i = riverAt(k); return i < 0 ? 0 : c.rw[i]; };
  // Bridges: each run of river nodes of w ≥ 2, from the bank node before it to the bank node after.
  const cuts: [number, number][] = [];
  for (let k = 1; k < m - 1; k++) {
    if (wet(k) < 2) continue;
    let e = k;
    while (e + 1 < m - 1 && wet(e + 1) >= 1) e++;
    const i0 = k - 1, i1 = e + 1;
    fixed[i0] = fixed[i1] = 1;
    cuts.push([i0, i1]);
    const water = c.rlev[riverAt(k)];
    const span = Math.sqrt((px[i1] - px[i0]) * (px[i1] - px[i0]) + (py[i1] - py[i0]) * (py[i1] - py[i0]));
    w.structures.push(bridge(px[i0], py[i0], px[i1], py[i1], water,
      Math.max(groundAt(w, px[i0], py[i0]), water + 1.6) + 0.3, Math.max(groundAt(w, px[i1], py[i1]), water + 1.6) + 0.3, Math.max(2, span - 8)));
    k = e + 1;
  }
  // A point may move only onto dry ground that nothing stands on.
  const open = (x: number, y: number): boolean => dry(w, x, y) && !w.blocked[node(c, x, y)];
  // The grid's path is ruled between its turns. First the whole map drifts a little under it, so a long straight
  // bends; the drift is a function of the place, so two lanes through one node still agree.
  const amp = WANDER * (n / 6400);
  for (let k = 1; k < m - 1; k++) {
    if (fixed[k]) continue;
    const ease = c.slope[node(c, px[k], py[k])] > 0.25 ? 0.4 : 1;
    const dx = amp * ease * drift(px[k], py[k], WANDER_CELLS * (n / 6400), n, w.seed ^ 0x3a71), dy = amp * ease * drift(px[k], py[k], WANDER_CELLS * (n / 6400), n, w.seed ^ 0x3a72);
    for (const f of [1, 0.5]) if (open(px[k] + f * dx, py[k] + f * dy)) { px[k] += f * dx; py[k] += f * dy; break; }
  }
  // Then the stairs are smoothed out, and on a slope each point slides along it to the height halfway between
  // its neighbours': the road keeps an even grade and so follows the contours round every spur and hollow.
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 1; k < m - 1; k++) {
      if (fixed[k]) continue;
      const sx = 0.25 * px[k - 1] + 0.5 * px[k] + 0.25 * px[k + 1], sy = 0.25 * py[k - 1] + 0.5 * py[k] + 0.25 * py[k + 1];
      let nx = sx, ny = sy;
      const tx = px[k + 1] - px[k - 1], ty = py[k + 1] - py[k - 1], tl = Math.sqrt(tx * tx + ty * ty);
      if (tl > 1e-6) {
        const ux = -ty / tl, uy = tx / tl;
        const across = (groundAt(w, sx + 3 * ux, sy + 3 * uy) - groundAt(w, sx - 3 * ux, sy - 3 * uy)) / 6;
        if (Math.abs(across) > 0.04) {
          const want = 0.5 * (groundAt(w, px[k - 1], py[k - 1]) + groundAt(w, px[k + 1], py[k + 1])) - groundAt(w, sx, sy);
          const d = 0.6 * Math.max(-2.5, Math.min(2.5, want / across));
          nx += ux * d;
          ny += uy * d;
        }
      }
      if (open(nx, ny)) { px[k] = nx; py[k] = ny; }
      else if (open(sx, sy)) { px[k] = sx; py[k] = sy; }
    }
  }
  for (let k = 1; k < m - 1; k++) if (fixed[k] !== 2) w.laid.set(keyOf(k), [px[k], py[k]]);
  let from = 0;
  // Stretches already laid by an earlier lane are not drawn twice.
  const flush = (to: number): void => {
    let pts: number[] = [];
    for (let k = from; k <= to; k++) {
      const shared = k > from && fixed[k] === 2 && fixed[k - 1] === 2;
      if (shared) {
        if (pts.length >= 4) roads.push(curve(pts, width));
        pts = [];
      }
      pts.push(px[k], py[k]);
    }
    if (pts.length >= 4) roads.push(curve(pts, width));
  };
  for (const [i0, i1] of cuts) {
    flush(i0);
    // The deck itself.
    roads.push(subdivide([px[i0], py[i0], px[i1], py[i1]], 2));
    from = i1;
  }
  flush(m - 1);
}

// ---------------------------------------------------------------------------

/** Places the sites and builds on them. */
export function settle(t: Terrain, opts: SettleOptions = {}): Settlement {
  const fields = siteFieldsOf(t);
  const c = siteContext(fields);
  const rules = opts.rules ?? builtRules(fields.n);
  const placed = placeSitesOn(c, rules, opts);
  const w: Work = {
    c, g: Float64Array.from(fields.h), seed: t.land.seed, structures: [], conforms: [], terraces: [],
    blocked: new Uint8Array(c.gN * c.gN), laid: new Map(), spurs: [], town: null,
  };
  for (const site of placed.sites) standLandmark(w, site, !opts.occupied || opts.occupied.has(site.id) || site.type === "abbey");

  // Hamlets: one at the abbey's river crossing, the rest where the land is level and near water.
  const hamlets = pickHamlets(w, placed.sites);
  // The abbey's own hamlet, at the foot of its road where the home river is crossed.
  const abbey = placed.sites.find((q) => q.type === "abbey");
  let farBank: Stop | null = null, nearBank: Stop | null = null;
  if (abbey && abbey.river) {
    const dx = torusDelta(abbey.river.x, abbey.x, c.n), dy = torusDelta(abbey.river.y, abbey.y, c.n), dl = Math.sqrt(dx * dx + dy * dy) || 1;
    for (const d of [20, 26, 32, 14]) {
      const hx = abbey.river.x + (dx / dl) * d, hy = abbey.river.y + (dy / dl) * d;
      if (!dry(w, hx, hy) || c.slope[node(c, hx, hy)] > 0.3) continue;
      for (let k = hamlets.length - 1; k >= 0; k--) {
        const ex = torusDelta(hx, hamlets[k].x, c.n), ey = torusDelta(hy, hamlets[k].y, c.n);
        if (ex * ex + ey * ey < 200 * 200) hamlets.splice(k, 1);
      }
      hamlets.unshift({ x: Math.floor(hx), y: Math.floor(hy), houses: 6, island: c.island[node(c, hx, hy)], quarry: false });
      // The stone bridge at its foot: bank to bank across the home river, its two ends stops of the road network.
      const half = c.rw[node(c, abbey.river.x, abbey.river.y)] / 2 + 6;
      const land = (px: number, py: number): boolean => !c.isSea[node(c, px, py)] && c.lakeId[node(c, px, py)] < 0;
      const ax = abbey.river.x + (dx / dl) * half, ay = abbey.river.y + (dy / dl) * half;
      const fx = abbey.river.x - (dx / dl) * half, fy = abbey.river.y - (dy / dl) * half;
      if (land(ax, ay) && land(fx, fy)) {
        const water = abbey.river.level;
        w.structures.push(bridge(ax, ay, fx, fy, water, Math.max(groundAt(w, ax, ay), water + 2) + 0.4, Math.max(groundAt(w, fx, fy), water + 2) + 0.4, 2 * half - 6, 6));
        nearBank = { x: ax, y: ay, island: c.island[node(c, ax, ay)], width: 2, pair: 9999 };
        farBank = { x: fx, y: fy, island: c.island[node(c, fx, fy)], width: 2, pair: 9999 };
      }
      break;
    }
  }
  const slateIslands = new Set<number>();
  for (const hm of hamlets) {
    standHamlet(w, hm);
    if (hm.houses >= 3 && isSlate(c, node(c, hm.x, hm.y)) && !slateIslands.has(hm.island) && standQuarry(w, hm)) {
      hm.quarry = true;
      slateIslands.add(hm.island);
    }
  }

  const stops: Stop[] = [];
  const wide: Record<LandmarkType, number> = { abbey: 2, town: 2, bridge: 2, lighthouse: 1, windmill: 1, cathedral: 1, yew: 1 };
  placed.sites.forEach((s, k) => {
    if (!s.approach.road) return;
    const island = c.island[node(c, s.approach.x, s.approach.y)];
    stops.push({ x: s.approach.x, y: s.approach.y, island, width: wide[s.type], pair: s.span ? k : -1 });
    if (s.span) stops.push({ x: s.span.bx, y: s.span.by, island: c.island[node(c, s.span.bx, s.span.by)], width: 2, pair: k });
  });
  for (const hm of hamlets) if (hm.houses > 0) stops.push({ x: hm.x, y: hm.y, island: hm.island, width: 2, pair: -1 });
  if (nearBank) stops.push(nearBank);
  if (farBank) stops.push(farBank);
  const lanes = (opts.lanes === false ? [] : layLanes(w, stops)).concat(w.spurs);
  greenBelt(w, lanes);
  // A main road is two pixels wide: its crown, and a darker verge beside it.
  const roads = lanes.concat(lanes.filter((r) => r.width >= 2).map(verge));

  return {
    sites: placed.sites, shortfall: placed.shortfall, home: placed.home, hamlets: hamlets.filter((h) => h.houses > 0),
    built: { structures: w.structures, conforms: w.conforms, roads, mats: MATS }, ground: w.g,
  };
}
