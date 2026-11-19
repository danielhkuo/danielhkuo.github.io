// The ear: what is in the land around the dragon, as a Hearing (design §2). It runs only while sound is on, a pass
// every 100 ms of page time whatever the frame rate: each frame does the share of rows and grid nodes that the time
// since the last frame calls for. Two scans feed one Hearing:
//
//   the bake scan   the frame's bake pixels on a lattice fixed to the land (even bx, even by): shore crossings by kind
//                   (beach, shingle, rock, calm), open sea, and the heaviest shore cells in each of eight sectors.
//                   A crossing is read off each square of four neighbouring samples (a straight side, or a corner cut
//                   off), so a shore weighs the same whichever way it runs;
//   the coast scan  the land grid (8 cells a node) in a disc of 56 nodes: the coast the bake does not speak for.
//
// Rivers and falls (river, stream, white, falls) join the bake scan with their phase. No allocation per frame.

import { hash2 } from "../core/hash.ts";
import { torusDelta, wrap } from "../core/torus.ts";
import { isBuilt, MATERIAL as M } from "../look/materials.ts";
import { emptyHearing, type Area, type Hearing, type Pose, type ShorePoint } from "./types.ts";

/** What the ear layer kept from the frame the live layers saw. */
export interface Seen {
  bake: Uint32Array | null;
  rect: { x: number; y: number; w: number; h: number } | null;
  t: number;
  /**
   * True when `bake` holds only the lattice's samples (even bx, even by), row by row, `latticeCols(rect)` to a row:
   * what the page gathers a few rows a frame and hands to the ear's worker.
   */
  packed?: boolean;
}

/** The lattice over a frame: its first sample's pixel, and how many samples across and down. */
export function latticeOf(rect: { x: number; y: number; w: number; h: number }): { px0: number; py0: number; cols: number; rows: number } {
  const px0 = Math.floor(rect.x) & 1, py0 = Math.floor(rect.y) & 1;
  return { px0, py0, cols: (rect.w - px0 + 1) >> 1, rows: (rect.h - py0 + 1) >> 1 };
}

/** The land the ear listens to. */
export interface EarWorld {
  /** World size, cells. */
  n: number;
  /** The ground grid, gN = n / 8 a side, under 0 where sea; null when there is none (then nothing is heard beyond the frame). */
  land: { gN: number; ground: ArrayLike<number> } | null;
}

/** Seconds a pass takes. */
export const PASS = 0.1;
/** The lattice's stride, bake pixels, and what a crossing between two samples stands for, cells. */
const STRIDE = 2;
/** A left–right pair straddles a shore running north–south: rows are 2 px, 2.5 cells, apart. An upper–lower pair, 2 cells. */
export const LEN_LR = 2.5;
export const LEN_UD = 2;
/** A shore that cuts one corner off a square of four samples: half the square's diagonal. */
const LEN_CORNER = Math.sqrt(LEN_LR * LEN_LR + LEN_UD * LEN_UD) / 2;
/** Land and water meet at a shore when their depths agree within this many eighths of a row (water.ts's `near`, doubled for the stride). */
const NEAR = 96;
/** Pixels over which a sample fades toward the frame's edge. */
const EDGE = 24;
/** The coast scan's reach, grid nodes. */
export const REACH = 56;
const GRID = 2 * REACH + 1;
/** Shore cells are this many bake pixels a side (a power of two), and the frame holds fewer than 16 of them either way. */
const CELL_SHIFT = 5;
/** Entries in the shore-cell table: 16 × 16 cells, each in up to eight sectors. */
const CELLS = 256 * 8;
/** Sea counts as open when no shore crossing lies within this many pixels (a coarse grid of this size, and its neighbours). */
const OPEN_SHIFT = 4;

const C_HAZE = 0, C_SEA = 1, C_LAKE = 2, C_RIVER = 3, C_LAND = 4;
const CLASS = new Uint8Array(256).fill(C_LAND);
CLASS[M.none] = C_HAZE;
CLASS[M.sea] = C_SEA;
CLASS[M.seaClear] = C_SEA;
CLASS[M.lake] = C_LAKE;
CLASS[M.river] = C_RIVER;

/** Shore kind of each land material: 0 calm, 1 beach, 2 shingle, 3 rock. Shingle is its own kind. */
const KIND = new Uint8Array(256);
for (const m of [M.sand, M.sandPale, M.duneGrass]) KIND[m] = 1;
KIND[M.shingle] = 2;
for (const m of [M.boulder, M.rockHard, M.rockSed, M.rockLime, M.rockSlate, M.cliffHard, M.cliffSed, M.cliffLime, M.cliffSlate, M.scree, M.screeSlate, M.screeStone]) KIND[m] = 3;
for (let m = 0; m < 256; m++) if (isBuilt[m] === 1) KIND[m] = 0;

function smooth(a: number, b: number, x: number): number {
  const u = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return u * u * (3 - 2 * u);
}

/** Which of eight 45° sectors round the dragon (0 centred on east, then clockwise on screen: south-east, south …). */
export function sectorOf(dx: number, dy: number): number {
  const a = Math.atan2(dy, dx);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** How loud a source d cells off counts in the surf's sums: full inside 30 cells, then 1/d. */
function reach(d: number): number {
  return 30 / (d > 30 ? d : 30);
}

interface Sums {
  /** Beach, shingle, rock, far: e, Σw·ux, Σw·uy, Σw·d. */
  area: Float64Array;
  samples: number;
  haze: number;
  open: number;
  /** Per shore cell and sector (16 × 16 × 8 table): weight; best crossing's distance² to the cell's centre, kind, sector, bend; its place. */
  cellW: Float64Array;
  cellBest: Float64Array;
  cellKind: Uint8Array;
  cellSector: Uint8Array;
  cellBend: Uint8Array;
  cellX: Float64Array;
  cellY: Float64Array;
  cellId: Int32Array;
  /** The coarse grid of where crossings were, this pass. */
  crossed: Uint8Array;
}

function newSums(): Sums {
  return {
    area: new Float64Array(16), samples: 0, haze: 0, open: 0,
    cellW: new Float64Array(CELLS), cellBest: new Float64Array(CELLS), cellKind: new Uint8Array(CELLS), cellSector: new Uint8Array(CELLS), cellBend: new Uint8Array(CELLS),
    cellX: new Float64Array(CELLS), cellY: new Float64Array(CELLS), cellId: new Int32Array(CELLS), crossed: new Uint8Array(64 * 64),
  };
}

function clearSums(s: Sums): void {
  s.area.fill(0);
  s.samples = s.haze = s.open = 0;
  s.cellW.fill(0);
  s.cellBest.fill(Infinity);
  s.crossed.fill(0);
}

export interface Ear {
  /** The land, once the world has loaded. */
  setWorld(world: EarWorld): void;
  /** water.ts's warp tile (the kit makes it off the main thread): without it no shore point can be timed, so none is reported. */
  setWarp(warp: Uint8Array): void;
  /** One frame's share of a pass. `lanes` is the engine's lane mask. Returns the Hearing in force (the same object until the next pass publishes). */
  step(pose: Pose, seen: Seen, lanes: number): Hearing;
  /** A whole pass at once, published: for the bench and the tests. */
  pass(pose: Pose, seen: Seen, lanes: number): Hearing;
  hearing(): Hearing;
}

export function createEar(): Ear {
  let world: EarWorld = { n: 10240, land: null };
  let warp: Uint8Array | null = null;
  let front = emptyHearing(), back = emptyHearing();
  const pool: [ShorePoint[], ShorePoint[]] = [[], []];
  for (const p of pool) for (let i = 0; i < 16; i++) p.push({ sector: 0, cell: 0, kind: 0, bend: 0, x: 0, y: 0, w: 0 });
  let which = 0;
  const sums = newSums();
  clearSums(sums);
  /** Where last pass's crossings were: this pass's sea samples are judged open against it. */
  const crossedBefore = new Uint8Array(64 * 64);
  /** How far through the pass: 0 … 1. */
  let progress = 0;
  let lastT = NaN;
  let passLanes = 0;
  /** The two heaviest cells of each sector, as table indices (−1 none), while publishing. */
  const top = new Int16Array(16);

  /** Sample rows [r0, r1) of the frame's lattice. */
  const bakeRows = (pose: Pose, bake: Uint32Array, rect: { x: number; y: number; w: number; h: number }, r0: number, r1: number, lanes: number, packed: boolean): void => {
    const n = world.n, w = rect.w, h = rect.h;
    const rx = Math.floor(rect.x), ry = Math.floor(rect.y);
    const px0 = rx & 1, py0 = ry & 1;
    // Steps through `bake` from one sample to the next, and to the sample above: whole pixels, or lattice samples.
    const cols = (w - px0 + 1) >> 1;
    const stepX = packed ? 1 : STRIDE, stepUp = packed ? cols : STRIDE * w;
    const area = sums.area;
    const ox = pose.x, oy = pose.y, alt2 = pose.alt * pose.alt;
    const tile = warp;
    for (let r = r0; r < r1; r++) {
      const py = py0 + STRIDE * r;
      if (py >= h) break;
      const by = ry + py;
      const base = Math.floor(by / 256) * 2560, baseUp = Math.floor((by - STRIDE) / 256) * 2560;
      const edgeY = py < h - 1 - py ? py : h - 1 - py;
      let i = packed ? r * cols : py * w + px0;
      // The sample to the left and the one above it are carried along the row, so each step reads two pixels.
      let l = 0, q = 0, haveLeft = false;
      const up = py >= STRIDE;
      for (let px = px0; px < w; px += STRIDE, i += stepX) {
        const v = bake[i];
        const u = up ? bake[i - stepUp] : 0;
        const cls = CLASS[v & 255];
        sums.samples++;
        if (cls === C_HAZE) sums.haze++;
        let len = 0, landMat = 0, lake = false;
        const water = cls !== C_LAND;
        const row = base + (v >>> 16);
        // The square this sample closes with the samples to its left, above, and above-left: where land and water share
        // it (side by side on the ground), the shore runs through it, and its length there is read off the pattern.
        if (haveLeft && up && cls !== C_HAZE && cls !== C_RIVER) {
          const cl = CLASS[l & 255], cu = CLASS[u & 255], cq = CLASS[q & 255];
          const wl = cl !== C_LAND, wu = cu !== C_LAND, wq = cq !== C_LAND;
          if ((wl !== water || wu !== water || wq !== water) && cl !== C_HAZE && cl !== C_RIVER && cu !== C_HAZE && cu !== C_RIVER && cq !== C_HAZE && cq !== C_RIVER) {
            const count = (water ? 1 : 0) + (wl ? 1 : 0) + (wu ? 1 : 0) + (wq ? 1 : 0);
            const rl = base + (l >>> 16), ru = baseUp + (u >>> 16), rq = baseUp + (q >>> 16);
            // Every side of the square that the shore crosses must join ground that lies together.
            const ok =
              (wl === water || (row - rl <= NEAR && rl - row <= NEAR)) && (wu === water || (row - ru <= NEAR && ru - row <= NEAR)) &&
              (wq === wl || (rl - rq <= NEAR && rq - rl <= NEAR)) && (wq === wu || (ru - rq <= NEAR && rq - ru <= NEAR));
            if (ok) {
              if (count === 2) len = water === wl ? LEN_UD : water === wu ? LEN_LR : 2 * LEN_CORNER;
              else len = LEN_CORNER;
              landMat = !water ? v & 255 : !wl ? l & 255 : !wu ? u & 255 : q & 255;
              lake = cls === C_LAKE || cl === C_LAKE || cu === C_LAKE || cq === C_LAKE;
            }
          }
        }
        l = v;
        q = u;
        haveLeft = true;
        if (cls === C_HAZE || cls === C_RIVER) continue;
        if (len === 0) {
          // Open sea: no crossing near it last pass.
          if (cls === C_SEA) {
            const gx = px >> OPEN_SHIFT, gy = py >> OPEN_SHIFT, at = (gy + 1) * 64 + gx + 1;
            if (crossedBefore[at] === 0) sums.open++;
          }
          continue;
        }
        sums.crossed[((py >> OPEN_SHIFT) + 1) * 64 + (px >> OPEN_SHIFT) + 1] = 1;
        const kind = lake ? 0 : KIND[landMat];
        const bx = rx + px;
        const wx = wrap(bx, n), wy = wrap(row / 8, n);
        const dx = torusDelta(ox, wx, n), dy = torusDelta(oy, wy, n);
        const flat2 = dx * dx + dy * dy;
        const d = Math.sqrt(flat2 + alt2);
        const edgeX = px < w - 1 - px ? px : w - 1 - px;
        const edge = smooth(0, EDGE, edgeX < edgeY ? edgeX : edgeY);
        const g = reach(d);
        const raw = len * g * g * edge;
        if (raw <= 0) continue;
        const sector = sectorOf(dx, dy);
        if (kind !== 0) {
          const wgt = (lanes >> sector) & 1 ? raw * smooth(50, 130, d) : raw;
          const flat = Math.sqrt(flat2);
          const a = (kind - 1) * 4;
          area[a] += wgt;
          if (flat > 1e-9) {
            area[a + 1] += (wgt * dx) / flat;
            area[a + 2] += (wgt * dy) / flat;
          }
          area[a + 3] += wgt * d;
        }
        // Its shore cell, fixed in bake space.
        const cx = bx >> CELL_SHIFT, cy = by >> CELL_SHIFT;
        // A cell that straddles sectors is heard in each: the part of it that lies there, with a point of its own.
        const ci = ((((cy & 15) << 4) | (cx & 15)) << 3) | sector;
        sums.cellW[ci] += raw;
        const ex = (bx & 31) - 16, ey = (by & 31) - 16, off = ex * ex + ey * ey;
        if (off < sums.cellBest[ci]) {
          sums.cellBest[ci] = off;
          sums.cellKind[ci] = kind;
          sums.cellSector[ci] = sector;
          sums.cellBend[ci] = tile ? tile[(((by >> 1) & 255) << 8) | ((bx >> 1) & 255)] : 0;
          sums.cellX[ci] = wx;
          sums.cellY[ci] = wy;
          sums.cellId[ci] = hash2(cx, cy, 0x5ea + sector) | 0;
        }
      }
    }
  };

  /** Rows [r0, r1) of the coast scan's square of grid nodes round the dragon. */
  const gridRows = (pose: Pose, seen: Seen, r0: number, r1: number): void => {
    const land = world.land;
    if (!land) return;
    const n = world.n, gN = land.gN, ground = land.ground;
    const cell = n / gN;
    const gx0 = Math.floor(pose.x / cell) - REACH, gy0 = Math.floor(pose.y / cell) - REACH;
    const bake = seen.bake, rect = seen.rect;
    const w = rect ? rect.w : 0, h = rect ? rect.h : 0;
    const rx = rect ? Math.floor(rect.x) : 0, ry = rect ? Math.floor(rect.y) : 0;
    const rows = 0.8 * n;
    const area = sums.area;
    const alt2 = pose.alt * pose.alt;
    // A packed frame holds lattice samples only: the sample nearest a pixel stands for it.
    const lat = rect && seen.packed ? latticeOf(rect) : null;
    const packedAt = lat ? lat.py0 : -1, packPx0 = lat ? lat.px0 : 0, packCols = lat ? lat.cols : 0, packRows = lat ? lat.rows : 0;
    for (let r = r0; r < r1; r++) {
      const gy = wrap(gy0 + r, gN), gyS = gy + 1 === gN ? 0 : gy + 1;
      const ry2 = (r - REACH) * (r - REACH);
      for (let c = 0; c < GRID; c++) {
        if ((c - REACH) * (c - REACH) + ry2 > REACH * REACH) continue;
        const gx = wrap(gx0 + c, gN), gxE = gx + 1 === gN ? 0 : gx + 1;
        // The square of four nodes this one heads (with its east, south and south-east neighbours): where sea and land
        // share it the coast runs through it, a straight side (8 cells) or a corner cut off, placed at its middle.
        // Symmetric: land to the west or north of the water counts the same as land to the east or south.
        const a = ground[gy * gN + gx] < 0, e = ground[gy * gN + gxE] < 0, so = ground[gyS * gN + gx] < 0, se = ground[gyS * gN + gxE] < 0;
        const count = (a ? 1 : 0) + (e ? 1 : 0) + (so ? 1 : 0) + (se ? 1 : 0);
        if (count === 0 || count === 4) continue;
        {
          const len = count === 2 ? (a === e || a === so ? cell : cell * Math.SQRT2) : cell * Math.SQRT1_2;
          const wx = (gx + 1) * cell, wy = (gy + 1) * cell;
          const dx = torusDelta(pose.x, wx, n), dy = torusDelta(pose.y, wy, n);
          const flat2 = dx * dx + dy * dy;
          const d = Math.sqrt(flat2 + alt2);
          const g = reach(d);
          let wgt = len * g * g;
          // Hand-over, per node: where the frame has baked land at its place the bake speaks, fading out toward the edge.
          if (bake && rect) {
            const px = Math.floor(torusDelta(rx, wx, n)), py = Math.floor(torusDelta(ry, 0.8 * wy, rows));
            if (px >= 0 && px < w && py >= 0 && py < h && (bake[packedAt >= 0 ? Math.min(packRows - 1, Math.max(0, (py - packedAt) >> 1)) * packCols + Math.min(packCols - 1, Math.max(0, (px - packPx0) >> 1)) : py * w + px] & 255) !== 0) {
              const ex = px < w - 1 - px ? px : w - 1 - px, ey = py < h - 1 - py ? py : h - 1 - py;
              wgt *= 1 - smooth(0, EDGE, ex < ey ? ex : ey);
            }
          }
          if (wgt <= 0) continue;
          const flat = Math.sqrt(flat2);
          area[12] += wgt;
          if (flat > 1e-9) {
            area[13] += (wgt * dx) / flat;
            area[14] += (wgt * dy) / flat;
          }
          area[15] += wgt * d;
        }
      }
    }
  };

  const setArea = (a: Area, at: number): void => {
    const e = sums.area[at];
    a.e = e;
    a.dx = sums.area[at + 1];
    a.dy = sums.area[at + 2];
    a.d = e > 0 ? sums.area[at + 3] / e : 0;
  };

  const publish = (t: number): Hearing => {
    const h = back;
    h.t = t;
    h.lanes = passLanes;
    h.ready = sums.samples > 0 ? 1 - sums.haze / sums.samples : 0;
    h.sea = sums.samples > 0 ? sums.open / sums.samples : 0;
    setArea(h.surf[0], 0);
    setArea(h.surf[1], 4);
    setArea(h.surf[2], 8);
    setArea(h.far, 12);
    // The two heaviest shore cells of each sector.
    top.fill(-1);
    if (warp) {
      for (let ci = 0; ci < CELLS; ci++) {
        const wgt = sums.cellW[ci];
        if (wgt <= 0) continue;
        const s = sums.cellSector[ci] * 2;
        if (top[s] < 0 || wgt > sums.cellW[top[s]]) {
          top[s + 1] = top[s];
          top[s] = ci;
        } else if (top[s + 1] < 0 || wgt > sums.cellW[top[s + 1]]) top[s + 1] = ci;
      }
    }
    const spare = pool[which ^ 1];
    h.shores.length = 0;
    for (let k = 0; k < 16; k++) {
      const ci = top[k];
      if (ci < 0) continue;
      const p = spare[h.shores.length];
      p.sector = k >> 1;
      p.cell = sums.cellId[ci];
      p.kind = sums.cellKind[ci] as 0 | 1 | 2 | 3;
      p.bend = sums.cellBend[ci];
      p.x = sums.cellX[ci];
      p.y = sums.cellY[ci];
      p.w = sums.cellW[ci];
      h.shores.push(p);
    }
    // Spread by one square each way, so "no crossing near" is one read next pass.
    const cr = sums.crossed;
    for (let at = 65; at < 64 * 63 - 1; at++) {
      crossedBefore[at] = cr[at] | cr[at - 1] | cr[at + 1] | cr[at - 64] | cr[at + 64] | cr[at - 65] | cr[at - 63] | cr[at + 63] | cr[at + 65];
    }
    clearSums(sums);
    back = front;
    front = h;
    which ^= 1;
    progress = 0;
    return h;
  };

  /** The share [from, to) of a pass, on this frame. */
  const work = (pose: Pose, seen: Seen, from: number, to: number, lanes: number): void => {
    const rect = seen.rect, bake = seen.bake;
    if (bake && rect) {
      const lat = latticeOf(rect);
      const packed = seen.packed === true;
      if (bake.length >= (packed ? lat.cols * lat.rows : rect.w * rect.h)) {
        bakeRows(pose, bake, rect, Math.floor(from * lat.rows), Math.floor(to * lat.rows), lanes, packed);
      }
    }
    gridRows(pose, seen, Math.floor(from * GRID), Math.floor(to * GRID));
  };

  return {
    setWorld(w) {
      world = w;
    },
    setWarp(tile) {
      warp = tile;
    },
    step(pose, seen, lanes) {
      const dt = lastT === lastT ? pose.t - lastT : 0;
      lastT = pose.t;
      if (!(dt > 0)) return front;
      if (progress === 0) passLanes = lanes;
      // A long frame finishes the pass it is in; it does not start another.
      const to = Math.min(1, progress + dt / PASS);
      work(pose, seen, progress, to, passLanes);
      progress = to;
      return to >= 1 ? publish(pose.t) : front;
    },
    pass(pose, seen, lanes) {
      clearSums(sums);
      passLanes = lanes;
      work(pose, seen, 0, 1, lanes);
      lastT = pose.t;
      return publish(pose.t);
    },
    hearing: () => front,
  };
}

/**
 * Gathers lattice rows [r0, r1) of the frame `home` (the rect a pass began with) into `into`, reading them from the
 * frame as it is now (`bake`, `rect`): the lattice is fixed to the land, so a camera that has moved since reads the
 * same land from other pixels, and what has slid out of view is left as haze (0).
 */
export function gatherRows(
  into: Uint32Array, home: { x: number; y: number; w: number; h: number }, bake: Uint32Array, rect: { x: number; y: number; w: number; h: number }, r0: number, r1: number,
): void {
  const lat = latticeOf(home);
  const hx = Math.floor(home.x) + lat.px0, hy = Math.floor(home.y) + lat.py0;
  const cx = Math.floor(rect.x), cy = Math.floor(rect.y), w = rect.w, h = rect.h;
  // Columns of the lattice that lie inside the frame as it is now.
  const cFrom = Math.max(0, Math.ceil((cx - hx) / 2)), cTo = Math.min(lat.cols, Math.floor((cx + w - 1 - hx) / 2) + 1);
  for (let r = r0; r < r1 && r < lat.rows; r++) {
    const py = hy + 2 * r - cy;
    const row = r * lat.cols;
    if (py < 0 || py >= h || cTo <= cFrom) {
      into.fill(0, row, row + lat.cols);
      continue;
    }
    if (cFrom > 0) into.fill(0, row, row + cFrom);
    if (cTo < lat.cols) into.fill(0, row + cTo, row + lat.cols);
    let i = py * w + (hx + 2 * cFrom - cx);
    for (let c = cFrom; c < cTo; c++, i += 2) into[row + c] = bake[i];
  }
}
