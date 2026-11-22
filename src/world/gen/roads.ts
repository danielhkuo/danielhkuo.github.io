// S10 roads: least-cost paths on G with 16 step directions, a grade limit that
// makes switchbacks, cheaper south-facing flanks (so switchbacks face the
// camera), bridges and fords, joined into a network per island.

import { MinHeap, sortIndicesBy } from "../core/heap.ts";
import { PI } from "../core/psin.ts";
import { NB8_DX, NB8_DY, torusDelta, torusDist2, wrapIndex } from "../core/torus.ts";

export interface RoadInput {
  /** G grid size (nodes a side). */
  n: number;
  /** Cells per node (4 on G); grades are in height units per cell. */
  cellsPerNode: number;
  h: Float64Array;
  isSea: Uint8Array;
  /** 1 on lake nodes. */
  lake: Uint8Array;
  /** River width class per node: 0 none, 1–6. */
  riverWidth: Uint8Array;
  /**
   * Multiplier on the cost of stepping onto each node (1 leaves it as it is): under 1 on valley floors and
   * in saddles, over 1 along crests and through woods. Absent, every node costs the same.
   */
  bias?: Float32Array;
}

export interface RoadParams {
  /** Steepest allowed grade, height per cell (0.12). */
  gradeMax: number;
  /** cost = length · (1 + slopeCost · grade²) … (40). */
  slopeCost: number;
  /** Fractional discount on south-facing flanks (0.15). */
  southBonus: number;
  /** Extra cost of a bridge crossing (50). */
  bridgeCost: number;
  /** Widest river a road may bridge (4); wider ones block. */
  maxBridgeWidth: number;
  /** Cost per radian of turn between consecutive steps. */
  turnCost: number;
  /** Extra edges beyond the minimum spanning tree, as a share of its edge count (0.2). */
  extraEdges: number;
}

export interface Road {
  /** Indices into the `points` list given to roadNetwork. */
  a: number;
  b: number;
  /** Node indices along the road, endpoints included. */
  path: Uint32Array;
  /** Nodes where the road crosses a river of width ≥ 2. */
  bridges: number[];
  /** Nodes where it crosses a width-1 stream. */
  fords: number[];
}

/** 8 neighbours (E, SE, S, SW, W, NW, N, NE) then the 8 knight moves. */
const DIR_N = 16;
const DX = new Int8Array(DIR_N);
const DY = new Int8Array(DIR_N);
const DLEN = new Float64Array(DIR_N);
/** Angle in radians between direction i and direction j. */
const TURN = new Float64Array(DIR_N * DIR_N);

const SENTINEL = 0xffffffff;
/** No node's bias counts for less than this. */
const BIAS_MIN = 0.7;
/** Above this many sites on one island, pathfind a k-nearest subset plus a distance spanning tree. */
const ALL_PAIRS_LIMIT = 12;
const K_NEAREST = 8;

function cosSeries(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  let sign = -1;
  for (let k = 1; k <= 16; k++) {
    term *= x2 / ((2 * k - 1) * (2 * k));
    sum += sign * term;
    sign = -sign;
  }
  return sum;
}

function sinSeries(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  let sign = -1;
  for (let k = 1; k <= 16; k++) {
    term *= x2 / ((2 * k) * (2 * k + 1));
    sum += sign * term;
    sign = -sign;
  }
  return sum;
}

/** Arccos on [−1, 1], in [0, π]. Series + Newton, so the turn table is deterministic. */
function acosUnit(c: number): number {
  if (c >= 1) return 0;
  if (c <= -1) return PI;
  let lo = 0;
  let hi = PI;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) * 0.5;
    if (cosSeries(mid) > c) lo = mid;
    else hi = mid;
  }
  let t = (lo + hi) * 0.5;
  for (let i = 0; i < 4; i++) {
    const ct = cosSeries(t);
    const st = sinSeries(t);
    t = t + (ct - c) / st;
  }
  if (t < 0) return 0;
  if (t > PI) return PI;
  return t;
}

function initDirections(): void {
  for (let k = 0; k < 8; k++) {
    DX[k] = NB8_DX[k];
    DY[k] = NB8_DY[k];
  }
  const kdx = new Int8Array([2, 1, -1, -2, -2, -1, 1, 2]);
  const kdy = new Int8Array([1, 2, 2, 1, -1, -2, -2, -1]);
  for (let k = 0; k < 8; k++) {
    DX[8 + k] = kdx[k];
    DY[8 + k] = kdy[k];
  }
  for (let d = 0; d < DIR_N; d++) DLEN[d] = Math.sqrt(DX[d] * DX[d] + DY[d] * DY[d]);
  for (let i = 0; i < DIR_N; i++) {
    for (let j = 0; j < DIR_N; j++) {
      const at = i * DIR_N + j;
      if (i === j) {
        TURN[at] = 0;
        continue;
      }
      const x1 = DX[i];
      const y1 = DY[i];
      const x2 = DX[j];
      const y2 = DY[j];
      if (x1 === -x2 && y1 === -y2) {
        TURN[at] = PI;
        continue;
      }
      const dot = x1 * x2 + y1 * y2;
      let c = dot / (DLEN[i] * DLEN[j]);
      if (c > 1) c = 1;
      else if (c < -1) c = -1;
      TURN[at] = acosUnit(c);
    }
  }
}

initDirections();

/**
 * The two nodes a knight step passes beside, nearer one first.
 * For (Δx, Δy) = (±2, ±1) they are the cells flanking the midpoint; likewise swapped for (±1, ±2).
 */
function knightBeside(x: number, y: number, dx: number, dy: number, n: number, out: Int32Array): void {
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  if (dx >= 2 || dx <= -2) {
    out[0] = wrapIndex(x + sx, y, n);
    out[1] = wrapIndex(x + sx, y + sy, n);
  } else {
    out[0] = wrapIndex(x, y + sy, n);
    out[1] = wrapIndex(x + sx, y + sy, n);
  }
}

/** Connected land components (8-connected, wrapped); −1 on sea and lake. */
export function islandIds(isSea: Uint8Array, lake: Uint8Array, n: number): Int32Array {
  const nn = n * n;
  const ids = new Int32Array(nn);
  ids.fill(-1);
  const queue = new Int32Array(nn);
  let comp = 0;
  for (let start = 0; start < nn; start++) {
    if (ids[start] !== -1 || isSea[start] !== 0 || lake[start] !== 0) continue;
    ids[start] = comp;
    queue[0] = start;
    let qh = 0;
    let qt = 1;
    while (qh < qt) {
      const i = queue[qh];
      qh++;
      const x = i % n;
      const y = (i - x) / n;
      for (let k = 0; k < 8; k++) {
        const j = wrapIndex(x + NB8_DX[k], y + NB8_DY[k], n);
        if (ids[j] !== -1 || isSea[j] !== 0 || lake[j] !== 0) continue;
        ids[j] = comp;
        queue[qt] = j;
        qt++;
      }
    }
    comp++;
  }
  return ids;
}

// Scratch for A*, reused across searches of the same grid size. Epoch stamps
// stand in for clearing the g / closed arrays.
let bufN = -1;
let epoch = 0;
let gScore = new Float64Array(0);
let came = new Uint32Array(0);
let seen = new Uint32Array(0);
let closed = new Uint32Array(0);
let heap = new MinHeap(1);

function prepare(n: number): void {
  const states = n * n * DIR_N;
  if (bufN !== n) {
    gScore = new Float64Array(states);
    came = new Uint32Array(states);
    seen = new Uint32Array(states);
    closed = new Uint32Array(states);
    // Several improvements per state before it is settled; small grids can afford the slack.
    const cap = states <= 1 << 20 ? states * 8 : 1 << 22;
    heap = new MinHeap(cap);
    bufN = n;
    epoch = 0;
  }
  if (epoch === 0xffffffff) {
    seen.fill(0);
    closed.fill(0);
    epoch = 0;
  }
  epoch++;
  heap.clear();
}

interface Found {
  path: Uint32Array;
  cost: number;
}

function rebuild(goalState: number, from: number): Found {
  let count = 0;
  let s = goalState;
  while (s !== SENTINEL) {
    count++;
    s = came[s];
  }
  const path = new Uint32Array(count + 1);
  path[0] = from;
  s = goalState;
  let i = count;
  while (s !== SENTINEL) {
    path[i] = Math.floor(s / DIR_N);
    i--;
    s = came[s];
  }
  return { path, cost: gScore[goalState] };
}

/**
 * A* over (node, incoming direction). The heuristic is torus distance times the
 * cheapest per-node multiplier (the south-facing discount); turn and bridge
 * costs are nonnegative, so it stays admissible.
 */
function search(inp: RoadInput, p: RoadParams, from: number, to: number): Found | null {
  if (from === to) return { path: new Uint32Array([from]), cost: 0 };

  const n = inp.n;
  const h = inp.h;
  const isSea = inp.isSea;
  const lake = inp.lake;
  const river = inp.riverWidth;
  const cells = inp.cellsPerNode;
  const gradeMax = p.gradeMax;
  const slopeCost = p.slopeCost;
  const southMul = 1 - p.southBonus;
  const bridgeCost = p.bridgeCost;
  const maxBridge = p.maxBridgeWidth;
  const turnCost = p.turnCost;
  const bias = inp.bias;
  let hScale = southMul < 1 ? southMul : 1;
  if (hScale < 0) hScale = 0;
  // The heuristic stays admissible under the cheapest bias a node may carry.
  if (bias) hScale *= BIAS_MIN;

  prepare(n);
  const gx = to % n;
  const gy = (to - gx) / n;
  const beside = new Int32Array(2);
  let best = Infinity;

  const heuristic = (x: number, y: number): number => {
    const dx = torusDelta(x, gx, n);
    const dy = torusDelta(y, gy, n);
    return hScale * Math.sqrt(dx * dx + dy * dy);
  };

  // prevDir < 0: the first step off `from`, which pays no turn.
  const relax = (sx: number, sy: number, prevDir: number, prevState: number, gBase: number): void => {
    for (let d = 0; d < DIR_N; d++) {
      const dx = DX[d];
      const dy = DY[d];
      const dest = wrapIndex(sx + dx, sy + dy, n);
      if (isSea[dest] !== 0 || lake[dest] !== 0) continue;

      let cross = river[dest];
      const adx = dx < 0 ? -dx : dx;
      const ady = dy < 0 ? -dy : dy;
      if (adx + ady === 3) {
        knightBeside(sx, sy, dx, dy, n, beside);
        const b0 = beside[0];
        const b1 = beside[1];
        if (isSea[b0] !== 0 || lake[b0] !== 0 || isSea[b1] !== 0 || lake[b1] !== 0) continue;
        if (river[b0] > cross) cross = river[b0];
        if (river[b1] > cross) cross = river[b1];
      }
      if (cross > maxBridge) continue;

      const dh = h[dest] - h[wrapIndex(sx, sy, n)];
      const adh = dh < 0 ? -dh : dh;
      const run = DLEN[d] * cells;
      const grade = adh / run;
      if (grade > gradeMax) continue;

      const destX = dest % n;
      const destY = (dest - destX) / n;
      const facing = h[wrapIndex(destX, destY + 1, n)] - h[wrapIndex(destX, destY - 1, n)] < 0;
      const mul = facing ? southMul : 1;
      let cost = DLEN[d] * (1 + slopeCost * grade * grade) * mul;
      if (bias) cost *= bias[dest] < BIAS_MIN ? BIAS_MIN : bias[dest];
      if (cross >= 2) cost += bridgeCost;
      // Square of the turning angle: a hairpin costs more than a fan of equal total
      // angle, which is what pushes a grade-limited climb into long switchbacks.
      if (prevDir >= 0) {
        const ang = TURN[prevDir * DIR_N + d];
        cost += turnCost * ang * ang;
      }
      const ng = gBase + cost;

      const st = dest * DIR_N + d;
      if (closed[st] === epoch) continue;
      if (seen[st] === epoch && ng >= gScore[st]) continue;
      const f = ng + heuristic(destX, destY);
      if (f >= best) continue;
      seen[st] = epoch;
      gScore[st] = ng;
      came[st] = prevState;
      heap.push(f, st);
      if (dest === to) best = ng;
    }
  };

  const fx = from % n;
  const fy = (from - fx) / n;
  relax(fx, fy, -1, SENTINEL, 0);

  while (heap.size > 0) {
    const key = heap.peekKey();
    if (key > best) break;
    const st = heap.pop();
    if (closed[st] === epoch) continue;
    closed[st] = epoch;
    const node = Math.floor(st / DIR_N);
    if (node === to) return rebuild(st, from);
    if (!(key < best)) continue;
    const dir = st - node * DIR_N;
    const x = node % n;
    const y = (node - x) / n;
    relax(x, y, dir, st, gScore[st]);
  }
  return null;
}

/** Least-cost path from node `from` to node `to`, or null if none. */
export function leastCostPath(inp: RoadInput, p: RoadParams, from: number, to: number): Uint32Array | null {
  const found = search(inp, p, from, to);
  return found === null ? null : found.path;
}

/**
 * Bridge and ford nodes along a path. Knight steps that only pass beside a
 * river still record it. A run of consecutive river nodes is one crossing,
 * kept as its first node; a ford run and a bridge run are separate.
 */
function crossings(inp: RoadInput, path: Uint32Array): { bridges: number[]; fords: number[] } {
  const bridges: number[] = [];
  const fords: number[] = [];
  const n = inp.n;
  const river = inp.riverWidth;
  const beside = new Int32Array(2);
  // 0 none, 1 ford, 2 bridge. Same class in a row collapses to the first node.
  let prev = 0;
  const consider = (node: number): void => {
    const width = river[node];
    const cls = width >= 2 ? 2 : width > 0 ? 1 : 0;
    if (cls !== 0 && cls !== prev) {
      if (cls === 2) bridges.push(node);
      else fords.push(node);
    }
    prev = cls;
  };
  consider(path[0]);
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const ax = a % n;
    const ay = (a - ax) / n;
    const bx = b % n;
    const by = (b - bx) / n;
    const dx = torusDelta(ax, bx, n);
    const dy = torusDelta(ay, by, n);
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    if (adx + ady === 3) {
      knightBeside(ax, ay, dx, dy, n, beside);
      consider(beside[0]);
      consider(beside[1]);
    }
    consider(b);
  }
  return { bridges, fords };
}

function makeUf(count: number): { unite: (a: number, b: number) => boolean } {
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const unite = (a: number, b: number): boolean => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return false;
    if (ra > rb) {
      const swap = ra;
      ra = rb;
      rb = swap;
    }
    parent[rb] = ra;
    return true;
  };
  return { unite };
}

function buildMask(inp: RoadInput, points: readonly number[], group: ArrayLike<number>, full: boolean): Uint8Array {
  const count = group.length;
  const mask = new Uint8Array(count * count);
  const n = inp.n;
  if (full || count <= ALL_PAIRS_LIMIT) {
    for (let i = 0; i < count; i++) {
      const row = i * count;
      for (let j = i + 1; j < count; j++) mask[row + j] = 1;
    }
    return mask;
  }

  const keys = new Float64Array(count);
  const far = n * n * 2;
  const k = K_NEAREST < count - 1 ? K_NEAREST : count - 1;
  for (let i = 0; i < count; i++) {
    const ai = points[group[i]];
    const ax = ai % n;
    const ay = (ai - ax) / n;
    for (let j = 0; j < count; j++) {
      if (j === i) {
        keys[j] = far;
        continue;
      }
      const bj = points[group[j]];
      const bx = bj % n;
      const by = (bj - bx) / n;
      keys[j] = torusDist2(ax, ay, bx, by, n);
    }
    const order = sortIndicesBy(keys);
    for (let t = 0; t < k; t++) {
      const j = order[t];
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      mask[lo * count + hi] = 1;
    }
  }

  // Distance spanning tree, so a clustered k-nearest graph still has a connecting set.
  const pairs = (count * (count - 1)) / 2;
  const dist = new Float64Array(pairs);
  const pi = new Int32Array(pairs);
  const pj = new Int32Array(pairs);
  let e = 0;
  for (let i = 0; i < count; i++) {
    const ai = points[group[i]];
    const ax = ai % n;
    const ay = (ai - ax) / n;
    for (let j = i + 1; j < count; j++) {
      const bj = points[group[j]];
      const bx = bj % n;
      const by = (bj - bx) / n;
      pi[e] = i;
      pj[e] = j;
      dist[e] = torusDist2(ax, ay, bx, by, n);
      e++;
    }
  }
  const ord = sortIndicesBy(dist);
  const uf = makeUf(count);
  let merged = 0;
  for (let t = 0; t < pairs && merged < count - 1; t++) {
    const eidx = ord[t];
    const i = pi[eidx];
    const j = pj[eidx];
    if (!uf.unite(i, j)) continue;
    mask[i * count + j] = 1;
    merged++;
  }
  return mask;
}

function span(
  inp: RoadInput,
  p: RoadParams,
  points: readonly number[],
  group: ArrayLike<number>,
  mask: Uint8Array,
): { roads: Road[]; treeEdges: number } {
  const count = group.length;
  const aOf: number[] = [];
  const bOf: number[] = [];
  const iOf: number[] = [];
  const jOf: number[] = [];
  const costList: number[] = [];
  const paths: Uint32Array[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (mask[i * count + j] === 0) continue;
      const a = group[i];
      const b = group[j];
      const found = search(inp, p, points[a], points[b]);
      if (found === null) continue;
      aOf.push(a);
      bOf.push(b);
      iOf.push(i);
      jOf.push(j);
      costList.push(found.cost);
      paths.push(found.path);
    }
  }
  const eCount = costList.length;
  const costs = new Float64Array(eCount);
  for (let e = 0; e < eCount; e++) costs[e] = costList[e];
  // Edges were appended in (a, b) order, so the index tie-break is (cost, a, b).
  const order = sortIndicesBy(costs);
  const inTree = new Uint8Array(eCount);
  const uf = makeUf(count);
  const chosen: number[] = [];
  let treeEdges = 0;
  for (let t = 0; t < eCount; t++) {
    const e = order[t];
    if (!uf.unite(iOf[e], jOf[e])) continue;
    inTree[e] = 1;
    chosen.push(e);
    treeEdges++;
    if (treeEdges === count - 1) break;
  }
  const extras = Math.round(p.extraEdges * treeEdges);
  let got = 0;
  for (let t = 0; t < eCount && got < extras; t++) {
    const e = order[t];
    if (inTree[e] !== 0) continue;
    chosen.push(e);
    got++;
  }
  const roads: Road[] = [];
  for (let c = 0; c < chosen.length; c++) {
    const e = chosen[c];
    const path = paths[e];
    const cross = crossings(inp, path);
    roads.push({ a: aOf[e], b: bOf[e], path, bridges: cross.bridges, fords: cross.fords });
  }
  return { roads, treeEdges };
}

function connectGroup(
  inp: RoadInput,
  p: RoadParams,
  points: readonly number[],
  group: ArrayLike<number>,
  full: boolean,
): Road[] {
  const mask = buildMask(inp, points, group, full);
  const built = span(inp, p, points, group, mask);
  if (!full && group.length > ALL_PAIRS_LIMIT && built.treeEdges < group.length - 1) {
    return connectGroup(inp, p, points, group, true);
  }
  return built.roads;
}

/** A road network joining `points` (node indices) island by island: minimum spanning tree plus extra edges. */
export function roadNetwork(inp: RoadInput, p: RoadParams, points: readonly number[]): Road[] {
  const n = inp.n;
  const ids = islandIds(inp.isSea, inp.lake, n);
  const m = points.length;
  const island = new Int32Array(m);
  let maxId = -1;
  for (let i = 0; i < m; i++) {
    const id = ids[points[i]];
    island[i] = id;
    if (id > maxId) maxId = id;
  }
  if (maxId < 0) return [];

  const counts = new Int32Array(maxId + 1);
  for (let i = 0; i < m; i++) if (island[i] >= 0) counts[island[i]]++;
  const start = new Int32Array(maxId + 1);
  let total = 0;
  for (let id = 0; id <= maxId; id++) {
    start[id] = total;
    total += counts[id];
  }
  const members = new Int32Array(total);
  const cursor = new Int32Array(start);
  for (let i = 0; i < m; i++) {
    const id = island[i];
    if (id < 0) continue;
    members[cursor[id]] = i;
    cursor[id]++;
  }

  const roads: Road[] = [];
  for (let id = 0; id <= maxId; id++) {
    const count = counts[id];
    if (count < 2) continue;
    const group = members.subarray(start[id], start[id] + count);
    const part = connectGroup(inp, p, points, group, false);
    for (let i = 0; i < part.length; i++) roads.push(part[i]);
  }
  return roads;
}
