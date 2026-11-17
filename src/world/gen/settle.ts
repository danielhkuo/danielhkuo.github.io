// S10: what people built. The reserved sites are placed (gen/sites.ts), their
// pads are levelled, the landmarks and the town are stood on them, hamlets are
// scattered between, and lanes join them island by island. The result is a
// list of structures, conforms and road lines the bake reads (gen/built.ts),
// and the ground on G with the pads cut in.

import { hash2 } from "../core/hash.ts";
import { MinHeap, sortIndicesBy } from "../core/heap.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import { MATERIAL as M } from "../look/materials.ts";
import { featureFor, type LandmarkType } from "../sites/assign.ts";
import { type Built, type Conform, conformed, conformGrid, ROAD_PIECE, type RoadLine, type Structure } from "./built.ts";
import { ARCHETYPE } from "./params.ts";
import { type RoadParams, roadNetwork } from "./roads.ts";
import type { Terrain } from "./pipeline.ts";
import { builtRules, heightAt, type PlacedSite, placeSitesOn, type PlaceOptions, type SiteContext, siteContext, type SiteFields, type SiteRules } from "./sites.ts";
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
  // The south face, column by column: stone, with the arches cut as shade.
  const wetLen = wet + 2, count = Math.max(1, Math.floor(wetLen / 8 + 0.5)), bay = wetLen / count, a = bay / 2 - 0.8;
  for (let i = 0; i < w; i++) {
    const j = S.faceRow(s, i);
    if (j < 0) continue;
    const k = j * w + i;
    s.mat[k] = M.stone;
    s.tone[k] = S.T_WALL;
    const along = (tAt[k] - 0.5) * len + wetLen / 2;
    if (along < 0 || along > wetLen || a < 1) continue;
    const v = along - (Math.floor(along / bay) + 0.5) * bay;
    if (Math.abs(v) > a) continue;
    const rise = (s.top[k] - 2.4) * Math.sqrt(1 - (v * v) / (a * a));
    for (let z = 1; z <= rise; z++) S.mark(s, i, j, z, M.opening, 120);
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
    w.structures.push(bridge(sp.ax, sp.ay, sp.bx, sp.by, sp.water, deckA, deckB, 2 * half - 10, 7.5));
    if (!occupied) standFeature(w, site, sp.ax + (sp.ax < sp.bx ? -9 : 9), sp.ay + 6);
    return;
  }
  if (site.stack) {
    w.structures.push(S.standAt(occupied ? S.lighthouse() : S.waysideCross(), x, y, level));
    return;
  }
  if (!occupied) {
    addConform(w, flat(x, y, 6, 6, true, level, 5));
    block(w, x, y, 6, 6);
    standFeature(w, site, x, y);
    return;
  }
  switch (site.type) {
    case "abbey":
      addConform(w, flat(x, y, 16, 13, false, level, 9));
      block(w, x, y, 15, 12);
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
      break;
    }
    case "windmill":
      addConform(w, flat(x, y, 7, 7, true, level, 6));
      block(w, x, y, 5, 5);
      w.structures.push(S.standAt(S.windmill(), x, y, level));
      break;
    case "cathedral":
      addConform(w, flat(x, y, 19, 10, false, level, 9));
      block(w, x, y, 18, 9);
      w.structures.push(S.standAt(S.ruinedCathedral(seed), x, y, level));
      break;
    case "yew":
      addConform(w, flat(x, y, 15, 12, true, level, 9));
      block(w, x, y, 14, 11);
      w.structures.push(S.standAt(S.churchyard(seed), x, y, level));
      break;
    case "town":
      standTown(w, site);
      break;
    default:
      break;
  }
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

/**
 * The town: a quay along the shore, a dredged harbour behind a mole, street terraces up the hillside,
 * rows of houses on them and the bell tower on its piazza.
 */
function standTown(w: Work, site: PlacedSite): void {
  const hb = site.harbour;
  if (!hb) return;
  const n = w.c.n;
  const hx = hb.x, shore = hb.y + 2;
  // The river's side; the mole shelters the other.
  const river = torusDelta(hx, hb.mouthX, n) < 0 ? -1 : 1;
  addConform(w, { kind: "dredge", x: hx, y: shore + 12, rx: 30, ry: 10, round: false, level: -3, skirt: 3, limit: 0 });
  addConform(w, { kind: "raise", x: hx, y: shore - 4, rx: 36, ry: 5, round: false, level: 1.8, skirt: 1.5, limit: 0 });
  addConform(w, { kind: "terrace", x: hx, y: shore - 62, rx: 80, ry: 58, round: true, level: 1.8, skirt: 12, limit: 2.5 });
  block(w, hx, shore - 40, 60, 44);

  // One raster for the town's paving and its quay wall.
  const pw = 170, ph = 150, px0 = Math.floor(hx) - 85, py0 = Math.floor(shore) - 118;
  const pave = S.sculpt(pw, ph);
  pave.x = px0;
  pave.y = py0;
  pave.base = 0;
  const paveAt = (x: number, y: number, ww: number, hh: number): void => S.paint(pave, Math.floor(x) - px0, Math.floor(y) - py0, ww, hh, M.cobble);
  paveAt(hx - 36, shore - 9, 72, 10);
  for (let x = -36; x < 36; x++) S.put(pave, Math.floor(hx) + x - px0, Math.floor(shore) + 1 - py0, 2, M.stone, S.T_WALL);

  // The mole: out from the quay's sheltered end, then a dog-leg across the harbour mouth, with a light on its head.
  const mole = S.sculpt(34, 30);
  const mx0 = river < 0 ? Math.floor(hx) + 8 : Math.floor(hx) - 41;
  mole.x = mx0;
  mole.y = Math.floor(shore) + 1;
  mole.base = 0;
  const arm = river < 0 ? 29 : 2;
  for (let j = 0; j < 26; j++) for (let i = 0; i < 3; i++) S.put(mole, arm + i, j, 2.2, M.stone, j === 25 ? S.T_WALL : S.T_FLAT);
  for (let i = 0; i < 20; i++) for (let j = 23; j < 26; j++) S.put(mole, river < 0 ? arm - i : arm + 2 + i, j, 2.2, M.stone, j === 25 ? S.T_WALL : S.T_FLAT);
  const tip = river < 0 ? arm - 19 : arm + 21;
  S.put(mole, tip, 24, 6, M.stone, S.T_WALL);
  S.mark(mole, tip, 24, 7, M.lantern, 170);
  S.mark(mole, tip, 24, 8, M.roofSlate, 110);
  w.structures.push(mole);

  // Jetties and boats in the basin.
  for (const jx of [-14, 9]) w.structures.push(S.standAt(S.jetty(9), hx + jx, shore + 6.5, 0));
  for (let k = 0; k < 7; k++) {
    const hsh = hash2(k, 77, w.seed);
    const bx = hx - 24 + (hsh % 48), by = shore + 5 + ((hsh >>> 8) % 12);
    if (Math.abs(bx - (hx - 14)) < 5 || Math.abs(bx - (hx + 9)) < 5) continue;
    w.structures.push(S.standAt(S.boat(hsh >>> 12), bx, by, 0));
  }

  // The bell tower on its piazza, a little up from the quay.
  const tx = hx - river * 6, ty = shore - 20;
  const tBase = groundAt(w, tx, ty);
  addConform(w, flat(tx, ty + 2, 9, 7, false, tBase, 3, 2));
  paveAt(tx - 9, ty - 4, 19, 13);
  w.structures.push(S.standAt(S.bellTower(), tx, ty, tBase));

  // Houses in rows along the terraces: densest by the quay, thinning up the hill and to the sides.
  for (let row = 0; row < 8; row++) {
    const south = Math.floor(shore) - 12 - 12 * row;
    let x = Math.floor(hx) - 74 + (hash2(row, 3, w.seed) % 5);
    while (x < hx + 74) {
      const hsh = hash2(x, south, w.seed);
      const hs = S.townHouse(hsh);
      const q = Math.sqrt(((x + hs.w / 2 - hx) * (x + hs.w / 2 - hx)) / (76 * 76) + ((south - (shore - 44)) * (south - (shore - 44))) / (66 * 66));
      const gap = (hsh >>> 20) % 8 === 0 ? 3 : (hsh >>> 23) % 3 === 0 ? 1 : 0;
      const cx = x + hs.w / 2;
      const onPiazza = Math.abs(cx - tx) < 10 + hs.w / 2 && south > ty - 7 && south - hs.h < ty + 10;
      const base = groundAt(w, cx, south);
      const back = groundAt(w, cx, south - hs.h);
      const ok = q < 1 && ((hsh >>> 26) & 31) / 32 > q * q * 0.8 - 0.1 && !onPiazza && base > 1.3 && back - base < 6 &&
        dry(w, x, south) && dry(w, x + hs.w, south) && dry(w, cx, south - hs.h) &&
        Math.abs(groundAt(w, x + 0.5, south) - groundAt(w, x + hs.w - 0.5, south)) < 2;
      if (ok) {
        hs.x = x;
        hs.y = south - hs.h + 1;
        hs.base = base;
        w.structures.push(hs);
        paveAt(x - 1, south + 1, hs.w + 2, 2);
        x += hs.w + gap;
      } else x += 3 + (hsh & 3);
    }
  }
  w.structures.push(pave);
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
  const level = groundAt(w, qx, qy + 7);
  // Two benches: the working floor, and a higher one cut into the back of it.
  addConform(w, flat(qx, qy, 13, 8, true, level, 4, 12));
  addConform(w, flat(qx + 3, qy - 5, 8, 4, true, level + 4, 2, 12));
  block(w, qx, qy, 14, 10);
  const s = S.sculpt(36, 28);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 36; x++) {
    const q = Math.sqrt(((x - 17.5) * (x - 17.5)) / (15 * 15) + ((y - 11) * (y - 11)) / (10.5 * 10.5));
    if (q < 0.9 + (hash2(x >> 1, y >> 1, w.seed) & 255) / 1300) s.paint[y * 36 + x] = M.quarry;
  }
  // Spoil heaps along the lip.
  for (let k = 0; k < 4; k++) {
    const hsh = hash2(k, qx + qy, w.seed);
    const lx = 6 + k * 7 + (hsh & 3), ly = 22 + ((hsh >>> 2) & 1), r = 2.2 + ((hsh >>> 4) & 3) * 0.3;
    for (let y = Math.floor(ly - r); y <= Math.ceil(ly + r); y++) for (let x = Math.floor(lx - r); x <= Math.ceil(lx + r); x++) {
      const d2 = (x - lx) * (x - lx) + (y - ly) * (y - ly);
      if (d2 <= r * r) S.put(s, x, y, 0.6 + 2.2 * Math.sqrt(1 - d2 / (r * r)), M.screeSlate, 0);
    }
  }
  // Cut blocks on the floor.
  for (let k = 0; k < 7; k++) {
    const hsh = hash2(k, qx - qy, w.seed);
    const bx = 7 + (hsh % 22), by = 12 + ((hsh >>> 6) % 7);
    S.put(s, bx, by, 1 + ((hsh >>> 10) & 1), M.rockSlate, S.T_WALL);
    if ((hsh >>> 12) & 1) S.put(s, bx + 1, by, 1, M.rockSlate, S.T_WALL);
  }
  // A row of quarrymen's cottages below the tips.
  const rowX = qx - 14, rowY = qy + 22;
  if (dry(w, rowX, rowY) && dry(w, rowX + 20, rowY) && Math.abs(groundAt(w, rowX, rowY) - groundAt(w, rowX + 20, rowY)) < 3) {
    const base = (groundAt(w, rowX, rowY) + groundAt(w, rowX + 20, rowY)) / 2;
    addConform(w, flat(rowX + 10, rowY, 12, 4, false, base, 3, 2));
    const row = S.sculpt(20, 5);
    S.house(row, 0, 0, 20, 5, 3, 3, { gable: 0, wallMat: M.stoneDark, roofMat: M.roofSlate, openings: 0, chimney: false });
    for (let k = 0; k < 4; k++) {
      S.mark(row, 1 + k * 5, 4, 1, M.timber, 92);
      S.mark(row, 1 + k * 5, 4, 2, M.timber, 92);
      S.mark(row, 3 + k * 5, 4, 2, M.opening);
      S.put(row, 4 + k * 5, 1, row.top[1 * 20 + 4 + k * 5] + 2, M.stoneDark, S.T_WALL);
    }
    w.structures.push(S.standAt(row, rowX + 10, rowY, base));
  }
  w.structures.push(S.standAt(s, qx, qy + 3, level - 0.01));
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
  const net = roadNetwork({ n: cN, cellsPerNode: 8, h, isSea, lake, riverWidth }, ROAD_PARAMS, points);
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
  return roads;
}

/** Turns a path of cell positions (node centres, unwrapped) into road lines, with a bridge over every river of w ≥ 2 it crosses. */
function lanesOf(w: Work, path: number[], a: Stop, b: Stop, width: number, roads: RoadLine[]): void {
  const c = w.c, n = c.n;
  const m = path.length / 2;
  const px = new Float64Array(m), py = new Float64Array(m), fixed = new Uint8Array(m);
  for (let k = 0; k < m; k++) { px[k] = path[2 * k]; py[k] = path[2 * k + 1]; }
  // The ends meet the stops themselves.
  px[0] = a.x; py[0] = a.y;
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
  // Smooth the grid's stairs out of the rest.
  for (let pass = 0; pass < 4; pass++) {
    let lx = px[0], ly = py[0];
    for (let k = 1; k < m - 1; k++) {
      const nx = 0.25 * lx + 0.5 * px[k] + 0.25 * px[k + 1], ny = 0.25 * ly + 0.5 * py[k] + 0.25 * py[k + 1];
      lx = px[k]; ly = py[k];
      if (!fixed[k]) { px[k] = nx; py[k] = ny; }
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
        if (pts.length >= 4) roads.push(subdivide(pts, width));
        pts = [];
      }
      pts.push(px[k], py[k]);
    }
    if (pts.length >= 4) roads.push(subdivide(pts, width));
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
    blocked: new Uint8Array(c.gN * c.gN), laid: new Map(),
  };
  for (const site of placed.sites) standLandmark(w, site, !opts.occupied || opts.occupied.has(site.id) || site.type === "abbey");

  // Hamlets: one at the abbey's river crossing, the rest where the land is level and near water.
  const hamlets = pickHamlets(w, placed.sites);
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
  const roads = layLanes(w, stops);

  return {
    sites: placed.sites, shortfall: placed.shortfall, home: placed.home, hamlets: hamlets.filter((h) => h.houses > 0),
    built: { structures: w.structures, conforms: w.conforms, roads, mats: MATS }, ground: w.g,
  };
}
