// Sea routes for a town's boats, planned once on the flight data's ground grid: from the harbour's water out to the
// roads (the nearest open water off it), and from there to a spread of places far out at sea, round whatever land
// lies between. A route never touches a cell of land, nor a cell beside one.
//
// The ground grid knows the shore but not the harbour's mole, which is a building, and the shipped harbour's mole
// has no gap in it. So the boats lie in the roads, outside the mole, and every route begins and ends there.

/** The ground on its grid, as the flight data has it: under 0 is sea. */
export interface Land {
  gN: number;
  ground: Float32Array;
}

/** Cells between a route's points. */
export const ROUTE_STEP = 2;
/** How far round a town the sea is searched, in cells. */
const REACH = 400;
/** The harbour's water is looked for this near the town. */
const HARBOUR_REACH = 160;
/** The roads lie at least this far from the harbour by water, with this many grid cells of clear sea all round. */
const ROADS_OUT = 40;
const OPEN = 5;

export interface Harbour {
  /** Sea in the harbour: the water nearest the town. */
  x: number;
  y: number;
  /** The roads: open water off the harbour, where every route begins. */
  roadsX: number;
  roadsY: number;
  /** One route to each length asked for, null where the sea does not reach so far: x, y pairs every ROUTE_STEP cells. */
  routes: (Float32Array | null)[];
}

/** A binary heap of (cost, cell). */
function heap(): { push(cost: number, cell: number): void; pop(): number; size(): number } {
  const costs: number[] = [], cells: number[] = [];
  return {
    size: () => cells.length,
    push(cost, cell) {
      let i = cells.length;
      costs.push(cost);
      cells.push(cell);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (costs[p] <= cost) break;
        costs[i] = costs[p];
        cells[i] = cells[p];
        i = p;
      }
      costs[i] = cost;
      cells[i] = cell;
    },
    pop() {
      const top = cells[0];
      const cost = costs.pop() as number, cell = cells.pop() as number;
      const len = cells.length;
      if (len > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= len) break;
          if (c + 1 < len && costs[c + 1] < costs[c]) c++;
          if (costs[c] >= cost) break;
          costs[i] = costs[c];
          cells[i] = cells[c];
          i = c;
        }
        costs[i] = cost;
        cells[i] = cell;
      }
      return top;
    },
  };
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** `pts` (x, y pairs) with its points set `step` apart along it and then its corners rounded; the ends stay where they are. */
export function evenly(pts: readonly number[], step: number, rounds: number): Float32Array {
  const out: number[] = [pts[0], pts[1]];
  let need = step;
  for (let i = 2; i < pts.length; i += 2) {
    let ax = pts[i - 2], ay = pts[i - 1];
    let left = Math.hypot(pts[i] - ax, pts[i + 1] - ay);
    while (left >= need) {
      const k = need / left;
      ax += (pts[i] - ax) * k;
      ay += (pts[i + 1] - ay) * k;
      out.push(ax, ay);
      left -= need;
      need = step;
    }
    need -= left;
  }
  let p = Float32Array.from(out);
  for (let r = 0; r < rounds; r++) {
    const q = p.slice();
    for (let i = 2; i < p.length - 2; i += 2) {
      q[i] = (p[i - 2] + 2 * p[i] + p[i + 2]) / 4;
      q[i + 1] = (p[i - 1] + 2 * p[i + 1] + p[i + 3]) / 4;
    }
    p = q;
  }
  return p;
}

/**
 * The harbour of the town at (tx, ty) and a route for each of `fars` (a length in cells, by water, from the roads).
 * Without `land` everything is taken for sea. Null when there is no sea by the town, or no open water off it.
 */
export function planHarbour(land: Land | undefined, n: number, tx: number, ty: number, fars: readonly number[]): Harbour | null {
  const step = land ? n / land.gN : 4;
  const half = Math.floor(REACH / step), G = 2 * half + 1;
  const gx0 = Math.floor(tx / step) - half, gy0 = Math.floor(ty / step) - half;
  const worldX = (i: number): number => (gx0 + i + 0.5) * step;
  const worldY = (j: number): number => (gy0 + j + 0.5) * step;

  // How many cells of sea lie between each cell and the land, to OPEN: 0 on land and along the window's edge.
  const clear = new Uint8Array(G * G);
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    if (!land) { clear[j * G + i] = 1; continue; }
    const gN = land.gN;
    const gx = (((gx0 + i) % gN) + gN) % gN, gy = (((gy0 + j) % gN) + gN) % gN;
    if (land.ground[gy * gN + gx] < 0) clear[j * G + i] = 1;
  }
  const raise: number[] = [];
  for (let d = 2; d <= OPEN; d++) {
    raise.length = 0;
    for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
      const c = j * G + i;
      if (clear[c] !== d - 1) continue;
      let open = true;
      for (let k = 0; k < 8 && open; k++) if (clear[c + DY[k] * G + DX[k]] < d - 1) open = false;
      if (open) raise.push(c);
    }
    for (const c of raise) clear[c] = d;
  }

  // The harbour: the sea nearest the town that is not a creek's width.
  let at = -1, best = HARBOUR_REACH * HARBOUR_REACH;
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    if (clear[j * G + i] < 2) continue;
    const dx = worldX(i) - tx, dy = worldY(j) - ty;
    if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; at = j * G + i; }
  }
  if (at < 0) return null;

  const dist = new Float32Array(G * G);
  const from = new Int32Array(G * G);
  /** Shortest ways by water from `start` over cells at least `least` clear, dearer close under the land. */
  const flood = (start: number, least: number, until: (cell: number) => boolean): number => {
    dist.fill(Infinity);
    from.fill(-1);
    const open = heap();
    dist[start] = 0;
    open.push(0, start);
    while (open.size() > 0) {
      const c = open.pop();
      if (until(c)) return c;
      const base = dist[c];
      for (let k = 0; k < 8; k++) {
        const c2 = c + DY[k] * G + DX[k];
        const room = clear[c2];
        if (room < least) continue;
        const cost = base + step * ((k & 1) === 1 ? Math.SQRT2 : 1) * (room <= 2 ? 2.5 : room === 3 ? 1.5 : 1);
        if (cost < dist[c2]) {
          dist[c2] = cost;
          from[c2] = c;
          open.push(cost, c2);
        }
      }
    }
    return -1;
  };
  const roads = flood(at, 1, (c) => clear[c] >= OPEN && dist[c] >= ROADS_OUT);
  if (roads < 0) return null;
  flood(roads, 2, () => false);

  /** Whether the straight line between two cells keeps to water clear of the land. */
  const inSight = (c1: number, c2: number): boolean => {
    const x1 = c1 % G, y1 = (c1 - x1) / G, x2 = c2 % G, y2 = (c2 - x2) / G;
    const steps = 2 * Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let k = 1; k < steps; k++) {
      const x = x1 + ((x2 - x1) * k) / steps, y = y1 + ((y2 - y1) * k) / steps;
      if (clear[Math.round(y) * G + Math.round(x)] < 3) return false;
    }
    return true;
  };

  // Where the routes end: for each length, the open cells about that far off by water, taken in order of bearing
  // from the roads, so the boats fan over all the sea there is.
  const ri = roads % G, rj = (roads - ri) / G;
  const routes: (Float32Array | null)[] = [];
  for (let b = 0; b < fars.length; b++) {
    const far = fars[b];
    const ends: number[] = [], bearings: number[] = [];
    for (let c = 0; c < dist.length; c++) {
      if (clear[c] < OPEN || dist[c] < 0.94 * far || dist[c] > 1.06 * far) continue;
      ends.push(c);
      bearings.push(Math.atan2((c - (c % G)) / G - rj, (c % G) - ri));
    }
    if (ends.length === 0) { routes.push(null); continue; }
    const order = ends.map((_, k) => k).sort((p, q) => bearings[p] - bearings[q] || ends[p] - ends[q]);
    // Begin the count after the widest gap in the bearings (the land), so the fan is not split across it.
    let gapAfter = order.length - 1, gap = bearings[order[0]] + 2 * Math.PI - bearings[order[order.length - 1]];
    for (let k = 0; k + 1 < order.length; k++) {
      const g = bearings[order[k + 1]] - bearings[order[k]];
      if (g > gap) { gap = g; gapAfter = k; }
    }
    const pick = order[(gapAfter + 1 + Math.floor(((b + 0.5) / fars.length) * order.length)) % order.length];
    // Back from the end to the roads; then, from the roads out, each stretch drawn straight for as far as the
    // water lets it run, so a boat holds a course and does not tack along the grid.
    const cells: number[] = [];
    for (let c = ends[pick]; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const pts: number[] = [worldX(ri), worldY(rj)];
    for (let a = 0, k = 1; k < cells.length; k++) {
      if (k + 1 < cells.length && inSight(cells[a], cells[k + 1])) continue;
      pts.push(worldX(cells[k] % G), worldY((cells[k] - (cells[k] % G)) / G));
      a = k;
    }
    routes.push(evenly(pts, ROUTE_STEP, 3));
  }
  return { x: worldX(at % G), y: worldY((at - (at % G)) / G), roadsX: worldX(ri), roadsY: worldY(rj), routes };
}
