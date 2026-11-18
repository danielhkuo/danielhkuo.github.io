// The wonders, as rasters of heights and materials (gen/built.ts Structure),
// built the way gen/structures.ts builds the landmarks: the camera looks from
// the south, so every volume keeps a wall row along its south edge and carries
// its windows, arches and fittings as marks on that row.
//
// Local coordinates: x east, y south; row h − 1 is the southmost. Each builder
// says what its base is: the sea, a lake's surface or a pad.

import { hash2 } from "../core/hash.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Structure } from "./built.ts";
import { faceRow, house, mark, paint, put, sculpt, T_EAST, T_FLAT, T_RIDGE, T_SOUTH, T_WALL, T_WEST, tower } from "./structures.ts";

/** Heights above the water. The rails sit just on the surface; the halt's planks are a step above them. */
export const TRACK_DECK = 1.25;
export const HALT_DECK = 1.85;

function clampTone(t: number): number {
  return t < 60 ? 60 : t > 200 ? 200 : Math.floor(t);
}

/**
 * Which way (x, y) points, as a number in [0, 4) that grows with the angle from east towards south: a quarter
 * turn for each unit. Not the angle itself, but exact arithmetic, so every engine agrees on it.
 */
function turn(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  if (y >= 0) return x >= 0 ? y / (x + y) : 1 + -x / (-x + y);
  return x < 0 ? 2 + -y / (-x - y) : 3 + x / (x - y);
}

/** A gilt ball on a short rod: the finial of a dome or a pavilion roof. Never a cross: these are not churches. */
function finial(s: Structure, x: number, y: number, z: number): void {
  mark(s, x, y, z + 1, M.stoneDark, 110);
  mark(s, x, y, z + 2, M.gilt, 160);
}

/**
 * Warm windows and red rails on the south wall `row`. Each storey is `step` high, the top pixel of it a rail;
 * every fourth column is a red pier instead of a window. `glow` lights the upper pixel of a window.
 */
function lacquerFront(s: Structure, x0: number, x1: number, row: number, base: number, stories: number, step: number): void {
  for (let x = x0; x <= x1; x++) {
    const pier = (x - x0) % 4 === 0;
    for (let k = 0; k < stories; k++) {
      const z = Math.floor(base + k * step);
      if (pier) {
        for (let t = 1; t < step; t++) mark(s, x, row, z + t, M.brick, 124);
      } else if ((x - x0) % 2 === 1) {
        mark(s, x, row, z + 1, M.lantern, 230);
        if (step > 3) mark(s, x, row, z + 2, M.opening, 108);
      } else {
        mark(s, x, row, z + 1, M.opening, 100);
        if (step > 3) mark(s, x, row, z + 2, M.lantern, 210);
      }
      mark(s, x, row, z + step, M.brick, pier ? 156 : 132);
    }
  }
}

/** A copper-roofed hall. Returns its south wall's row. The eave under the copper is red. */
function hall(s: Structure, x: number, y: number, w: number, d: number, wall: number, roof: number, wallMat: number): number {
  house(s, x, y, w, d, wall, roof, { gable: 0, wallMat, roofMat: M.copper, openings: 0, chimney: false });
  const south = y + d - 1;
  for (let i = 0; i < w; i++) mark(s, x + i, south, Math.floor(wall), M.brick, 146);
  return south;
}

// ---------------------------------------------------------------------------
// The thermal baths.

/** How the baths step down a cliff of height `top`: the three pool terraces and the quay, above the sea. */
export function bathLevels(top: number): { court: number; pools: readonly [number, number, number]; quay: number } {
  const quay = 2.2;
  const span = top - quay;
  return { court: top, pools: [quay + span * 0.72, quay + span * 0.46, quay + span * 0.2], quay };
}

/** Rows of the baths' raster: the court, each pool terrace and the quay, as [first row, row past the last]. */
export const BATH_ROWS = { court: [0, 17], pools: [[17, 24], [24, 31], [31, 38]], quay: [38, 44] } as const;
export const BATH_W = 43;
export const BATH_H = 44;

/**
 * The thermal baths (43 × 44; nothing stands more than 22 over the court). Base: the sea. On the cliff top a
 * bathhouse in three stacked copper roofs, cream walls banded with red rails and warm windows; below it three
 * terraces of warm pools on arched walls; at the water a quay and a long red bridge that climbs the east side
 * to a gate. `top` is the cliff top's height above the sea.
 */
export function thermalBaths(top: number, seed: number): Structure {
  const W = BATH_W, s = sculpt(W, BATH_H);
  const lv = bathLevels(top), L = lv.court;
  // The house fills columns 2…32. The bridge climbs columns 34…40, where the way up meets the court.
  const X0 = 1, X1 = 34;

  // The court: paving at the cliff top. The buildings stand on it.
  for (let y = 0; y < 17; y++) for (let x = X0; x <= 40; x++) put(s, x, y, L, M.cobble, T_FLAT);

  // Three roofs, each taller and narrower than the one in front of it, so the south wall of each shows
  // above the copper in front. The crown's ridge is the highest cell: 22 over the court.
  const front = hall(s, 2, 10, 31, 6, L + 8, 2.2, M.plaster);
  lacquerFront(s, 2, 32, front, L, 2, 4);
  const middle = hall(s, 7, 5, 20, 5, L + 15, 1.4, M.plaster);
  lacquerFront(s, 7, 26, middle, L + 10, 1, 4);
  const crown = hall(s, 12, 1, 10, 4, L + 19, 3, M.whitewash);
  lacquerFront(s, 12, 21, crown, L + 16, 1, 3);
  // The door, under a short copper hood, and a gilt ball on the crown's ridge.
  const door = 17;
  for (let z = 1; z <= 4; z++) {
    mark(s, door - 1, front, L + z, M.timber, 96);
    mark(s, door, front, L + z, M.opening, z === 4 ? 150 : 100);
    mark(s, door + 1, front, L + z, M.timber, 96);
  }
  for (let x = door - 2; x <= door + 2; x++) mark(s, x, front, Math.floor(L + 5), M.copper, 160);
  let bx = 17, by = 2, bt = 0;
  for (let y = 1; y <= 4; y++) for (let x = 12; x <= 21; x++) {
    const t = s.top[y * W + x];
    if (t > bt) { bt = t; bx = x; by = y; }
  }
  mark(s, bx, by, Math.floor(bt), M.gilt, 210);
  mark(s, bx, by, Math.floor(bt) - 1, M.lantern, 200);
  // Chimneys on the lower roofs, clear of the block behind them, some of them smoking.
  const stack = (x: number, y: number): void => {
    const t = s.top[y * W + x];
    if (t <= 0 || t + 2.6 > L + 22) return;
    put(s, x, y, t + 2.3, M.brick, T_WALL);
    if ((hash2(x, y, seed) & 3) === 0 || t + 4 > L + 22) return;
    mark(s, x, y, Math.floor(t + 3), M.sailcloth, 220);
    if (t + 4.2 <= L + 22) mark(s, x, y, Math.floor(t + 4), M.sailcloth, 236);
  };
  stack(4, 12);
  stack(30, 12);
  stack(9, 7);
  stack(24, 7);

  // A red rail along the court's south edge, open at the door.
  for (let x = X0; x <= X1; x++) if (Math.abs(x - door) > 2) put(s, x, 16, L + 1.3, x % 5 === 0 ? M.stone : M.brick, x % 5 === 0 ? 150 : 118);

  // The pool terraces: each narrower than the one above. Paving, a warm pool in a pale kerb, a red rail on
  // stone posts, and an arched wall down to the next. Steam lifts off the near edge.
  const pools: [number, number][][] = [[[5, 30]], [[7, 15], [20, 28]], [[11, 24]]];
  const mid = 17;
  for (let k = 0; k < 3; k++) {
    const [y0, y1] = BATH_ROWS.pools[k];
    const level = lv.pools[k], below = k < 2 ? lv.pools[k + 1] : lv.quay;
    const t0 = X0 + 3 * k, t1 = X1 - 3 * k, drop = level - below;
    const frontOf = (x: number): number => (Math.abs(x - mid - 0.5) <= 5.5 ? y1 : y1 - 1);
    for (let x = t0; x <= t1; x++) {
      const f = frontOf(x);
      for (let y = y0; y < f; y++) put(s, x, y, level, M.cobble, T_FLAT);
      const post = (x - t0) % 4 === 0;
      put(s, x, f, level + 1.15, post ? M.stone : M.brick, post ? 150 : 116);
      const q = (x - t0) % 4;
      if (drop >= 4.5 && q !== 0) for (let z = 1; z <= Math.min(drop - 2, 5) - (q === 2 ? 0 : 1); z++) mark(s, x, f, below + z, M.opening, 110);
      if ((x + k * 2) % 3 === (seed & 1) && x > t0 + 1 && x < t1 - 1) {
        mark(s, x, f, Math.floor(level + 2), M.sailcloth, 220);
        mark(s, x, f, Math.floor(level + 3), M.sailcloth, 236);
      }
    }
    for (const [px0, px1] of pools[k]) {
      for (let y = y0 + 1; y <= y1 - 2; y++) for (let x = px0 - 1; x <= px1 + 1; x++) {
        const rim = x < px0 || x > px1 || y === y0 + 1 || y === y1 - 2;
        const corner = (x === px0 - 1 || x === px1 + 1) && (y === y0 + 1 || y === y1 - 2);
        if (corner) continue;
        if (rim) put(s, x, y, level, M.whitewash, 150);
        else put(s, x, y, level - 0.3, M.seaClear, T_FLAT);
      }
    }
    for (const sx of [t0 + 1, t1 - 1]) {
      put(s, sx, y1 - 1, level - drop * 0.5, M.stone, 160);
      put(s, sx, y1 - 2, level - drop * 0.2, M.stone, 170);
    }
    for (const x of [t0, t1]) put(s, x, y0 + 2, level + 2.2, M.yew, 0);
  }
  // A small open bath hall on the upper terrace, west of the pools.
  const bath = hall(s, 3, 18, 7, 4, lv.pools[0] + 4, 1.6, M.plaster);
  for (let x = 4; x <= 8; x++) if (x % 2 === 0) {
    mark(s, x, bath, Math.floor(lv.pools[0] + 1), M.opening, 110);
    mark(s, x, bath, Math.floor(lv.pools[0] + 2), M.lantern, 200);
  }

  // The quay, and along its outer edge a red bridge lying on the water: the near end of the way up.
  const [qy0, qy1] = BATH_ROWS.quay;
  for (let y = qy0; y < qy1 - 2; y++) for (let x = 0; x < W; x++) put(s, x, y, lv.quay, M.cobble, T_FLAT);
  for (let x = 2; x <= 40; x++) put(s, x, qy1 - 2, lv.quay + 1.1, x % 5 === 0 ? M.stone : M.brick, x % 5 === 0 ? 148 : 116);
  for (let x = 4; x <= 40; x++) put(s, x, qy1 - 1, 1.35, x === 4 || x === 40 ? M.brick : M.roofTile, x === 4 || x === 40 ? 100 : 150);

  // The bridge climbs the east side from that landing to a copper-roofed gate on the court.
  const bx0 = 34, bx1 = 40, yTop = 15, yBot = qy1 - 2;
  for (let y = yTop; y <= yBot; y++) {
    const t = (y - yTop) / (yBot - yTop);
    const z = L + (lv.quay + 0.3 - L) * t;
    for (let x = bx0 + 1; x < bx1; x++) put(s, x, y, z, M.roofTile, 148);
    put(s, bx0, y, z + 1.15, M.brick, 112);
    put(s, bx1, y, z + 1.15, M.brick, 112);
    if ((y - yTop) % 4 === 0) {
      put(s, bx0, y, z + 2.5, M.brick, 140);
      put(s, bx1, y, z + 2.5, M.brick, 140);
    }
  }
  const gate = hall(s, 34, 11, 7, 5, L + 5, 2, M.plaster);
  lacquerFront(s, 35, 39, gate, L, 1, 4);
  for (let z = 1; z <= 3; z++) mark(s, 37, gate, L + z, M.opening, 120);
  return s;
}

// ---------------------------------------------------------------------------
// The tide railway.

/** How far the track stands off the straight at share t of its length: nothing at either end, `bow` in the middle. */
export function trackBow(bow: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return bow * 4 * c * (1 - c);
}

/**
 * The track from (ax, ay) to (bx, by), in world cells: two rails and a sleeper every fifth cell, sitting just
 * on the water, bowed `bow` cells off the straight at its middle so it is not ruled. Base: the sea. It comes
 * as pieces at most `piece` cells long, each a small raster, so no bake window carries the whole line.
 */
export function tideTrack(ax: number, ay: number, bx: number, by: number, bow: number, piece = 40): Structure[] {
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
  const out: Structure[] = [];
  if (len < 4) return out;
  const ux = dx / len, uy = dy / len;
  const off = (a: number): number => trackBow(bow, a / len);
  const count = Math.ceil(len / piece);
  for (let k = 0; k < count; k++) {
    const a0 = (len * k) / count, a1 = (len * (k + 1)) / count;
    // The piece's box: its two ends and its middle, with room for the deck's width.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of [a0, (a0 + a1) / 2, a1]) {
      const px = ax + ux * a - uy * off(a), py = ay + uy * a + ux * off(a);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    const ox = Math.floor(x0) - 3, oy = Math.floor(y0) - 3;
    const s = sculpt(Math.ceil(x1) + 4 - ox, Math.ceil(y1) + 4 - oy);
    s.x = ox;
    s.y = oy;
    s.base = 0;
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const px = ox + i + 0.5 - ax, py = oy + j + 0.5 - ay;
      const a = px * ux + py * uy;
      if (a < a0 - 0.5 || a >= a1 + 0.5 || a < 0 || a > len) continue;
      const lat = -px * uy + py * ux - off(a);
      const alat = lat < 0 ? -lat : lat;
      if (alat > 1.15) continue;
      // One dark rail on the water, with a sleeper sticking out to either side every fifth cell.
      if (alat <= 0.5) put(s, i, j, TRACK_DECK, M.stoneDark, 64);
      else if (Math.floor(a) % 5 === 0) put(s, i, j, TRACK_DECK - 0.28, M.timber, 120);
    }
    out.push(s);
  }
  return out;
}

/**
 * The lone halt at the track's end (18 × 10, 13 tall): a low plank platform beside the line, a small open
 * shelter with a bench in it, one lamp and a baulk where the rails stop. Base: the sea. The track arrives
 * along row `HALT_TRACK_ROW`; `east` is true when it comes in from the west and ends at the east.
 */
export const HALT_TRACK_ROW = 2;
export function tideHalt(east: boolean): Structure {
  const s = sculpt(18, 10), D = HALT_DECK;
  // Bleached planks, a step above the rails. No piles: the platform barely clears the water.
  for (let y = 4; y <= 7; y++) for (let x = 2; x <= 14; x++) put(s, x, y, D, M.plaster, (x + y) % 3 === 0 ? 150 : 168);
  for (let x = 2; x <= 14; x++) put(s, x, 8, D, M.timber, 96);
  // The last of the line: a far rail, sleepers, a near rail.
  for (let x = 0; x <= 15; x++) {
    put(s, x, 1, TRACK_DECK, M.stoneDark, 68);
    if (x % 5 === 0) put(s, x, 2, TRACK_DECK - 0.3, M.timber, 124);
    put(s, x, 3, TRACK_DECK, M.stoneDark, 68);
  }
  // A plain baulk across the rails.
  for (let y = 1; y <= 3; y++) put(s, 16, y, TRACK_DECK + 0.9, M.timber, y === 3 ? 88 : 116);
  // The shelter: a short roof on pale posts, open to the platform. The bench is the dark band inside.
  house(s, 8, 4, 5, 3, D + 2.6, 1.15, { gable: 0, wallMat: M.whitewash, roofMat: M.timber, openings: 0, chimney: false });
  for (let x = 8; x <= 12; x++) {
    mark(s, x, 6, Math.floor(D + 1), M.opening, 108);
    mark(s, x, 6, Math.floor(D + 2), M.opening, 120);
  }
  for (let x = 9; x <= 11; x++) mark(s, x, 6, Math.floor(D + 1), M.timber, 100);
  // The lamp at the platform's far end: a post, a short arm and one light.
  for (let z = 1; z <= 6; z++) mark(s, 4, 7, Math.floor(D + z), M.timber, 90);
  mark(s, 3, 7, Math.floor(D + 6), M.timber, 100);
  mark(s, 3, 7, Math.floor(D + 5), M.lantern, 236);
  if (east) return s;
  // The mirror image, for a line that ends at its west.
  const o = sculpt(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const a = y * s.w + x, b = y * s.w + (s.w - 1 - x), t = s.tone[a];
    o.top[b] = s.top[a];
    o.mat[b] = s.mat[a];
    o.tone[b] = t === T_WEST ? T_EAST : t === T_EAST ? T_WEST : t;
  }
  for (let k = 0; k < s.marks.length; k += 5) o.marks.push(s.w - 1 - s.marks[k], s.marks[k + 1], s.marks[k + 2], s.marks[k + 3], s.marks[k + 4]);
  return o;
}

// ---------------------------------------------------------------------------
// The drowned church.

export const CHURCH_W = 36;
export const CHURCH_H = 18;
/** The tower's middle in the church's raster. */
export const CHURCH_TOWER = [5, 7] as const;

/**
 * The drowned church (36 × 18; the spire's cross stands 31 over the water). Base: the lake's surface. The
 * bell tower stands in the water, thick with ivy, moss at the line where the lake meets it; east of it the
 * nave lies drowned, its walls a pale broken course in the water, higher where a scrap still breaks the
 * surface, with the pier heads and a churchyard cross or two awash.
 */
export function drownedChurch(seed: number): Structure {
  const s = sculpt(CHURCH_W, CHURCH_H), W = CHURCH_W;
  const rnd = (k: number): number => (hash2(k, seed, 0xd20c) & 1023) / 1024;
  // A drowned course. The row nearest the camera stands clear of the water, pale stone with a mossy
  // coping, so the plan reads; the row behind it is lower, still light enough to show through the lake.
  const course = (x: number, y: number, k: number, face: boolean): void => {
    if (s.top[y * W + x] > 2) return;
    const n = hash2(x + k, y, seed);
    if ((n & 15) === 0) return;
    const h = face ? 2.6 + ((n & 3) === 0 ? 1.5 : (n & 1) * 0.6) : 1.35 + (n & 3) * 0.28;
    put(s, x, y, h, (n & 2) === 0 ? M.whitewash : M.stone, face ? 186 : 168);
    mark(s, x, y, 1, M.moss, face ? 168 : 150);
    if (face && h > 3) mark(s, x, y, 2, M.ivy, 156);
  };
  // The church under the water, in the plan of a cross: nave, transepts and the rounded east end.
  // A wall that runs east–west is two rows thick: the camera folds five rows into four, and would lose one.
  for (let x = 8; x <= 29; x++) if (x < 21 || x > 26) for (const y of [3, 4, 11, 12]) course(x, y, 1, y === 4 || y === 12);
  for (const x of [21, 26]) for (let y = 0; y <= 15; y++) if (y <= 4 || y >= 11) course(x, y, 2, y === 4 || y === 15);
  for (let x = 21; x <= 26; x++) for (const y of [0, 1, 14, 15]) course(x, y, 3, y === 1 || y === 15);
  for (let y = 5; y <= 10; y++) course(y === 5 || y === 10 ? 31 : 32, y, 4, y === 10);
  for (const y of [3, 4, 11, 12]) course(30, y, 5, y === 4 || y === 12);
  for (let x = 10; x <= 19; x += 3) if (s.top[12 * W + x] > 2.4) mark(s, x, 12, 2, M.opening, 88);
  // What still breaks the surface: a length of the nave wall, window-heads in it, ivy in the joints.
  const scrap = 9 + Math.floor(rnd(1) * 5);
  for (let i = 0; i < 7; i++) {
    const t = 3 + Math.floor(rnd(10 + i) * 2) - (i === 0 || i === 6 ? 1 : 0);
    put(s, scrap + i, 3, t, M.stone, 170);
    put(s, scrap + i, 4, t, M.whitewash, 184);
    mark(s, scrap + i, 4, 1, M.moss, 164);
    if (t > 2) mark(s, scrap + i, 4, 2, M.ivy, 150);
    if (t > 3) mark(s, scrap + i, 4, 3, M.ivy, 142);
  }
  for (const i of [1, 2, 4, 5]) mark(s, scrap + i, 4, 1, M.opening);
  mark(s, scrap + 1 + (seed & 1), 4, 2, M.opening);
  mark(s, scrap + 4 + ((seed >>> 1) & 1), 4, 2, M.opening);
  for (let k = 0; k < 5; k++) {
    if (rnd(30 + k) < 0.2) continue;
    const x = 9 + k * 3;
    put(s, x, 11, 0.9 + rnd(40 + k) * 1.4, M.stone, T_WALL);
    mark(s, x, 11, 1, M.moss, 136);
  }
  // The chancel's east gable, down to a mossy stump.
  for (let y = 6; y <= 9; y++) {
    const t = 1.6 + (y === 7 || y === 8 ? 1.6 : 0) + Math.floor(rnd(70 + y) * 1.6);
    put(s, 32, y, t, y === 9 ? M.stone : M.stoneDark, y === 9 ? T_WALL : T_FLAT);
    if (t > 1.4) mark(s, 32, y, 1, M.moss, 128);
    if (t > 2.4) mark(s, 32, y, 2, M.ivy, 104);
  }
  // Rubble and a clump of reeds beside the nave, and the churchyard crosses, their heads above the water.
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 4 + Math.floor(rnd(50 + k) * 2), y = 13 + (k & 1);
    put(s, x, y, 0.7 + rnd(60 + k), M.stoneDark, T_WALL);
    mark(s, x, y, 1, M.moss, 120);
  }
  put(s, 28, 13, 1.8, M.reeds, 140);
  put(s, 29, 14, 1.5, M.reeds, 150);
  for (let k = 0; k < 3; k++) {
    const x = 9 + k * 4 + Math.floor(rnd(80 + k) * 2), y = 14 + Math.floor(rnd(90 + k) * 3);
    put(s, x, y, 1.2, M.stone, T_WALL);
    mark(s, x, y, 2, M.stone, 140);
    mark(s, x - 1, y, 1, M.stone, 140);
    mark(s, x + 1, y, 1, M.stone, 140);
    mark(s, x, y, 1, M.moss, 124);
  }
  // The tower: belfry and spire, the shaft broken at the corners and hung with ivy. A bell shows in the opening.
  const tx = CHURCH_TOWER[0] - 3, ty = CHURCH_TOWER[1] - 3;
  tower(s, tx, ty, 6, 7, 17, 10, M.stone, M.roofSlate, true);
  const south = ty + 6;
  put(s, tx, south, 13, M.ivy, 150);
  put(s, tx + 5, south, 12, M.ivy, 140);
  // The shaft's face is ivy, with a pale stone course left every fifth level and moss at the water.
  // The belfry is cut back out afterwards so the openings and the bell stay clear of the leaves.
  for (let x = tx; x < tx + 6; x++) {
    const top = Math.floor(s.top[south * W + x]);
    s.mat[south * W + x] = M.ivy;
    s.tone[south * W + x] = 156;
    mark(s, x, south, 1, M.moss, 176);
    mark(s, x, south, 2, M.moss, 164);
    for (let z = 5; z <= top && z <= 16; z += 5) mark(s, x, south, z, M.stone, 180);
  }
  for (const x of [tx + 1, tx + 2, tx + 4]) for (let z = 10; z <= 14; z++) mark(s, x, south, z, M.opening, 96);
  mark(s, tx + 2, south, 12, M.gilt, 170);
  mark(s, tx + 3, south, 5, M.opening, 100);
  mark(s, tx + 3, south, 6, M.opening, 112);
  return s;
}

// ---------------------------------------------------------------------------
// The hotel in the cove.

export const HOTEL_W = 42;
export const HOTEL_H = 36;
/** The middle of the hotel's rock in its raster: where the offshore rock it is built on stands. */
export const HOTEL_ROCK = [21, 11] as const;
/** The pontoon's middle in the raster. */
export const HOTEL_PONTOON = [21, 32] as const;

/**
 * The hotel in the cove (42 × 36; its tower stands under 31 over the sea). Base: the sea. An offshore rock;
 * on it a white hotel under a terracotta roof, an arcaded terrace in front, a garden to the west, one stair
 * tower, and steps down to a jetty. `rock` and `cliff` are the materials of the rock's top and its faces.
 */
export function coveHotel(seed: number, rock: number, cliff: number): Structure {
  const W = HOTEL_W, s = sculpt(W, HOTEL_H);
  const [rx0, ry0] = HOTEL_ROCK;
  const P = 6;
  // The rock: a lumpy oval, flat where the hotel stands, its rim falling to the sea in a broken face.
  for (let y = 0; y < 24; y++) for (let x = 0; x < W; x++) {
    const dx = (x - rx0) / 19.5, dy = (y - ry0) / 11;
    const lump = ((hash2(x >> 1, y >> 1, seed) & 7) - 3.5) * 0.02;
    const q = Math.sqrt(dx * dx + dy * dy) + lump;
    if (q > 1) continue;
    const edge = (1 - q) / 0.22;
    const t = edge >= 1 ? P : 1.2 + (P - 1.2) * edge + ((hash2(x, y, seed ^ 0x51) & 3) - 1.5) * 0.3;
    // Its faces are lit from the north-west, as the land's cliffs are.
    put(s, x, y, t, edge >= 1 ? rock : cliff, edge >= 1 ? 0 : clampTone(126 - 34 * dx - 16 * dy + ((hash2(x, y, seed ^ 0x77) & 15) - 8)));
  }
  // The garden, on the flat of the rock west of the hotel, and two stone pines in it.
  for (let y = 5; y <= 15; y++) for (let x = 3; x <= 13; x++) {
    if (s.top[y * W + x] >= P - 0.4) put(s, x, y, P, M.pastureMid, T_FLAT);
  }
  for (const [fx, fy, mat] of [[6, 9, M.flowerPale], [7, 12, M.flowerMauve], [10, 8, M.flowerPale], [9, 13, M.flowerMauve], [5, 12, M.flowerPale]] as const) {
    put(s, fx, fy, P + 1.1, mat, 170);
  }
  for (const [px, py, pr] of [[5, 10, 2.1], [8, 6, 1.6]] as const) {
    for (let y = Math.floor(py - pr); y <= Math.ceil(py + pr); y++) for (let x = Math.floor(px - pr); x <= Math.ceil(px + pr); x++) {
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 <= pr * pr && x >= 0 && y >= 0) put(s, x, y, P + 4 + 2.5 * Math.sqrt(1 - d2 / (pr * pr)), M.yew, 0);
    }
  }

  // The terrace in front of the hotel, a pale balustrade along its south edge.
  for (let y = 4; y <= 17; y++) for (let x = 14; x <= 33; x++) put(s, x, y, P, M.cobble, T_FLAT);
  for (let x = 14; x <= 33; x++) {
    put(s, x, 17, P + 1.1, x % 4 === 0 ? M.stoneDark : M.stone, x % 4 === 0 ? 100 : T_WALL);
    mark(s, x, 17, P, M.stoneDark, 112);
  }

  // The hotel: four floors of whitewash under a hipped tile roof, the long side to the sea.
  const bx = 14, by = 3, bw = 16, wall = P + 11;
  house(s, bx, by, bw, 8, wall, 3.4, { gable: 0, wallMat: M.whitewash, roofMat: M.roofTile, openings: 0, chimney: false });
  const upper = by + 7;
  for (let i = 1; i < bw - 1; i += 2) for (const z of [8, 10]) mark(s, bx + i, upper, P + z, M.opening, z === 10 ? 130 : 108);
  for (let i = 0; i < bw; i++) mark(s, bx + i, upper, Math.floor(wall), M.roofTile, 150);
  // One stair tower at the east end, under its own tile roof.
  const tip = tower(s, 30, 4, 5, 7, P + 12, 6, M.whitewash, M.roofTile, false);
  for (const x of [31, 33]) for (const z of [3, 6, 9, 12]) mark(s, x, 10, P + z, M.opening);
  for (let z = 1; z <= 4; z++) mark(s, 32, 10, P + z, (hash2(z, 3, seed) & 1) === 0 ? M.ivy : M.opening, 110);
  finial(s, 32, 6, Math.floor(tip));

  // The arcade in front: one storey, round-headed openings, striped awnings, tile above.
  const lx = 14, ly = 11;
  house(s, lx, ly, bw, 5, P + 4.6, 1.5, { gable: 0, wallMat: M.whitewash, roofMat: M.roofTile, openings: 0, chimney: false });
  const loggia = ly + 4;
  for (let i = 0; i < bw; i++) {
    if (i % 2 === 1) {
      mark(s, lx + i, loggia, P + 1, M.opening, 104);
      mark(s, lx + i, loggia, P + 2, M.opening, 116);
      mark(s, lx + i, loggia, P + 3, M.opening, 140);
      mark(s, lx + i, loggia, P + 4, i % 4 === 1 ? M.brick : M.sailcloth, 156);
    } else mark(s, lx + i, loggia, P + 4, M.stoneDark, 120);
  }
  // The door, in the middle bay of the arcade.
  for (let z = 1; z <= 3; z++) mark(s, lx + 8, loggia, P + z, M.timber, 92);

  // Steps down the rock to the jetty.
  for (let y = 18; y <= 23; y++) {
    const z = P - (P - 1.4) * ((y - 17) / 6);
    for (let x = 19; x <= 22; x++) put(s, x, y, z, M.stone, y % 2 === 0 ? 160 : 140);
  }
  // The jetty: a timber walk, then the pontoon across its end, a small tiled hut and a windsock.
  for (let y = 24; y <= 29; y++) for (let x = 19; x <= 22; x++) put(s, x, y, 1.4, M.timber, x === 19 || x === 22 ? 96 : 146);
  for (let y = 25; y <= 29; y += 2) { put(s, 18, y, 2.1, M.timber, 90); put(s, 23, y, 2.1, M.timber, 90); }
  const [fx, fy] = HOTEL_PONTOON;
  for (let y = fy - 2; y <= fy + 1; y++) for (let x = fx - 8; x <= fx + 7; x++) {
    put(s, x, y, 0.95, y === fy + 1 ? M.timber : M.plaster, y === fy + 1 ? 96 : (x + y) % 2 === 0 ? 158 : 140);
  }
  for (const x of [fx - 8, fx + 7]) for (const y of [fy - 2, fy + 1]) put(s, x, y, 2, M.stoneDark, 96);
  house(s, fx - 7, fy - 2, 4, 3, 3.2, 1.3, { gable: 0, wallMat: M.whitewash, roofMat: M.roofTile, openings: 0, chimney: false });
  mark(s, fx - 6, fy, 1, M.opening, 110);
  mark(s, fx - 5, fy, 2, M.opening, 120);
  for (let z = 1; z <= 6; z++) mark(s, fx + 6, fy - 1, z, M.timber, 90);
  mark(s, fx + 5, fy - 1, 6, M.brick, 160);
  mark(s, fx + 4, fy - 1, 6, M.sailcloth, 170);
  mark(s, fx + 3, fy - 1, 5, M.brick, 150);
  return s;
}

// ---------------------------------------------------------------------------
// Things drawn as pictures. A raster of heights is solid from its top to the ground, so whatever must show the
// land through or under it (a crown over a trunk, a lattice of iron) is drawn as marks on one row instead: a
// picture x cells wide and z tall that stands on that row like a flat cut-out facing the camera.

interface Picture {
  w: number;
  tall: number;
  mat: Uint8Array;
  tone: Uint8Array;
}

function picture(w: number, tall: number): Picture {
  return { w, tall, mat: new Uint8Array(w * (tall + 1)), tone: new Uint8Array(w * (tall + 1)) };
}

function dot(p: Picture, x: number, z: number, mat: number, tone: number): void {
  const px = Math.floor(x + 0.5), pz = Math.floor(z + 0.5);
  if (px < 0 || px >= p.w || pz < 1 || pz > p.tall) return;
  p.mat[pz * p.w + px] = mat;
  p.tone[pz * p.w + px] = clampTone(tone);
}

/** A straight stroke from (x0, z0) to (x1, z1), `thick` pixels deep, its upper edge lighter by `lift`. */
function stroke(p: Picture, x0: number, z0: number, x1: number, z1: number, thick: number, mat: number, tone: number, lift = 0): void {
  const steps = Math.max(1, Math.ceil(2 * Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    for (let q = 0; q < thick; q++) dot(p, x, z + q, mat, tone + (q === thick - 1 ? lift : 0));
  }
}

/** Stands the picture on row `row` of the structure, its column 0 on column `x0`. */
function hang(s: Structure, p: Picture, x0: number, row: number): void {
  for (let z = 1; z <= p.tall; z++) for (let x = 0; x < p.w; x++) {
    const m = p.mat[z * p.w + x];
    if (m !== 0) mark(s, x0 + x, row, z, m, p.tone[z * p.w + x]);
  }
}

// ---------------------------------------------------------------------------
// The marsh house.

export const MARSH_W = 34;
export const MARSH_H = 24;
/** The house's middle in its raster. */
export const MARSH_HOUSE = [16, 11] as const;
/** The height of the rise the house stands on, above the sea. */
export const MARSH_RISE = 3.6;

/** The yard's wall, as seen from the yard's middle: the way (ux, uy) scaled to the oval and made unit. */
function onWall(ux: number, uy: number): [number, number] {
  const ex = ux / 15.6, ey = uy / 10.6, l = Math.sqrt(ex * ex + ey * ey);
  return l > 0 ? [ex / l, ey / l] : [0, 1];
}

/** Where a causeway leaving the marsh house along (ux, uy) meets its wall, in the house's raster. */
export function marshGate(ux: number, uy: number): [number, number] {
  const [cx, cy] = onWall(ux, uy);
  return [16.5 + 15.6 * cx, 11.5 + 10.6 * cy];
}

/** The column of the one window whose shutters stand open, where the lamp is lit. */
export function marshLamp(seed: number): number {
  return (hash2(1, seed, 0x3a51) & 1023) / 1024 < 0.5 ? 14 : 18;
}

/**
 * The marsh house (34 × 24, 19 tall). Base: the rise. A large old house of weathered limewash under a steep
 * blue-grey roof, a window in almost every bay and one of them lit; a lower wing on its east side, a broken
 * garden wall round the top of the rise, and three wind-bent alders. The causeway leaves along (ux, uy), due
 * south unless given; the wall is open where it leaves, and a path runs to the gate from the door.
 */
export function marshHouse(seed: number, ux = 0, uy = 1): Structure {
  const W = MARSH_W, s = sculpt(W, MARSH_H);
  // The yard: rough grass inside the wall, a beaten path from the door to the gate.
  for (let y = 2; y <= 21; y++) for (let x = 2; x <= 31; x++) {
    const dx = (x - 16.5) / 15.5, dy = (y - 11.5) / 10.5;
    if (dx * dx + dy * dy <= 1) s.paint[y * W + x] = M.pastureCool;
  }
  const [gx, gy] = marshGate(ux, uy), [gc, gs] = onWall(ux, uy);
  for (let k = 0; k <= 24; k++) {
    const t = k / 24, x = Math.floor(16.5 + (gx - 16.5) * t), y = Math.floor(14.5 + (gy - 14.5) * t);
    if (x >= 0 && y >= 0 && x < W && y < MARSH_H) s.paint[y * W + x] = M.path;
  }
  // The garden wall: an oval of rubble in runs, a third of them fallen, open at the gate. `near` is the cosine of
  // the turn between a wall cell and the gate: the gap is 0.17 of a radian either side, and no run near it falls.
  for (let y = 1; y <= 22; y++) for (let x = 1; x <= 32; x++) {
    const dx = (x - 16.5) / 15, dy = (y - 11.5) / 10;
    const q = Math.sqrt(dx * dx + dy * dy);
    if (q < 0.93 || q > 1.04) continue;
    const near = (dx * gc + dy * gs) / q;
    if (near > 0.98558) continue;
    const run = hash2(Math.floor(turn(dx, dy) * 8), 7, seed);
    if ((run & 7) < 2 && near < 0.92106) continue;
    put(s, x, y, (run & 8) !== 0 ? 1 : 1.6, M.stoneDark, T_WALL);
  }
  // Gate posts, 0.22 of a radian either side of the gate.
  for (const k of [-1, 1]) {
    const c = gc * 0.9759 - k * gs * 0.21823, sn = gs * 0.9759 + k * gc * 0.21823;
    put(s, Math.floor(16.5 + 15 * c), Math.floor(11.5 + 10 * sn), 2.4, M.stone, T_WALL);
  }

  // The house: a long front under a steep slate roof, a cross-gable in the middle, dormers on the slope.
  const hx = 6, hy = 5, hw = 16, hd = 9, wall = 9, south = hy + hd - 1;
  house(s, hx, hy, hw, hd, wall, 6, { gable: 0, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 0, chimney: false });
  house(s, hx + 5, hy + 3, 6, 6, wall, 4.5, { gable: 1, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 0, chimney: false });
  // Chimneys at the two ends of the ridge. The ridge sits near the middle of the roof rows.
  for (const cx of [hx + 2, hx + 13]) {
    const cy = hy + 3;
    const t = s.top[cy * W + cx];
    if (t > 0 && t + 2.8 <= 19) put(s, cx, cy, t + 2.6, M.stoneDark, T_WALL);
  }
  // Dormers on the south slope, each a small window under a slate cap.
  for (const dx of [2, 13]) {
    const x = hx + dx, y = hy + 6;
    const roofZ = s.top[y * W + x];
    if (roofZ <= 0 || roofZ + 2.8 > 19) continue;
    put(s, x, y, roofZ + 2.2, M.whitewash, T_WALL);
    mark(s, x, y, Math.floor(roofZ + 1), M.opening, 124);
    put(s, x, y - 1, roofZ + 2.8, M.roofSlate, T_RIDGE);
  }
  // Windows in a grid. One, high up, is lit; the rest are dark glass. The foot of the wall is damp.
  const open = marshLamp(seed);
  for (const z of [2, 5, 8]) for (const x of [7, 9, 11, 13, 15, 17, 19, open]) {
    const lit = z === 8 && x === open;
    mark(s, x, south, z, lit ? M.lantern : M.opening, lit ? 220 : 104);
    mark(s, x, south, z + 1, lit ? M.lantern : M.opening, lit ? 200 : 124);
  }
  // A porch only over the door, so the ground-floor windows to either side stay in view.
  for (let x = hx + 6; x <= hx + 10; x++) put(s, x, south + 1, 4.2, M.roofSlate, T_SOUTH);
  put(s, hx + 6, south + 2, 3.6, M.timber, T_WALL);
  put(s, hx + 10, south + 2, 3.6, M.timber, T_WALL);
  for (let z = 1; z <= 3; z++) mark(s, hx + 8, south, z, M.timber, 88);
  for (let x = hx; x < hx + hw; x++) if (x !== hx + 8) mark(s, x, south, 1, M.stoneDark, 128);

  // The east wing: a lower slate roof against the house, its front open.
  house(s, hx + hw - 1, 8, 7, 6, 5, 2.2, { gable: 0, wallMat: M.plaster, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let x = hx + hw; x <= hx + hw + 4; x++) {
    mark(s, x, 13, 1, M.opening, 100);
    mark(s, x, 13, 2, M.opening, 112);
    mark(s, x, 13, 4, M.opening, 120);
  }

  // Alders, leaning from the sea wind: each crown stands east of its foot.
  for (const [ax, ay, ar] of [[5, 8, 2.3], [8, 5, 1.8], [27, 7, 2.1]] as const) {
    for (let y = Math.floor(ay - ar); y <= Math.ceil(ay + ar); y++) for (let x = Math.floor(ax - ar); x <= Math.ceil(ax + ar + 1); x++) {
      const dx = (x - ax - 0.5) / 1.25, dy = y - ay, d2 = dx * dx + dy * dy;
      if (d2 <= ar * ar) put(s, x, y, 3.5 + 2.6 * Math.sqrt(1 - d2 / (ar * ar)), M.alder, 0);
    }
  }
  // A water butt by the door, and a mounting block at the gate.
  put(s, hx - 1, south, 1.6, M.timber, 100);
  put(s, 20, 20, 1, M.stone, T_WALL);
  return s;
}

/** The height of the causeway's crown above the sea. */
export const CAUSEWAY_TOP = 2.3;

/**
 * The causeway from (ax, ay) to (bx, by), in world cells: a bank of rubble three cells wide with a beaten
 * track along its crown and a stake every eight cells to mark it at a high tide. Base: the sea. It comes in
 * pieces like the tide railway's track, bowed `bow` cells off the straight.
 */
export function marshCauseway(ax: number, ay: number, bx: number, by: number, bow: number, piece = 40): Structure[] {
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
  const out: Structure[] = [];
  if (len < 4) return out;
  const ux = dx / len, uy = dy / len;
  const off = (a: number): number => trackBow(bow, a / len);
  const count = Math.ceil(len / piece);
  for (let k = 0; k < count; k++) {
    const a0 = (len * k) / count, a1 = (len * (k + 1)) / count;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of [a0, (a0 + a1) / 2, a1]) {
      const px = ax + ux * a - uy * off(a), py = ay + uy * a + ux * off(a);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    const ox = Math.floor(x0) - 3, oy = Math.floor(y0) - 3;
    const s = sculpt(Math.ceil(x1) + 4 - ox, Math.ceil(y1) + 4 - oy);
    s.x = ox;
    s.y = oy;
    s.base = 0;
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const px = ox + i + 0.5 - ax, py = oy + j + 0.5 - ay;
      const a = px * ux + py * uy;
      if (a < a0 - 0.5 || a >= a1 + 0.5 || a < 0 || a > len) continue;
      const lat = -px * uy + py * ux - off(a);
      if (Math.abs(lat) > 1.5) continue;
      if (Math.abs(lat) > 0.55) put(s, i, j, CAUSEWAY_TOP - 0.5, M.stoneDark, 112);
      else put(s, i, j, CAUSEWAY_TOP, M.path, 150);
      if (lat > 0.55 && Math.floor(a) % 8 === 0) { mark(s, i, j, 3, M.timber, 84); mark(s, i, j, 4, M.timber, 84); }
    }
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The airship mast.

export const MAST_W = 42;
export const MAST_H = 18;
/** The mast's foot in its raster, and its height to the lamp. */
export const MAST_FOOT = [14, 10] as const;
export const MAST_TALL = 46;

/**
 * The airship mast (42 × 18, 46 tall). Base: the pad. A tapering tower of iron lattice on four stone feet,
 * guyed, with two galleries, a mooring yard and a banded cone a pilot can see; beside it a small winch house,
 * two low gas holders, the anchor blocks of the yaw lines and a windsock.
 */
export function airshipMast(seed: number): Structure {
  const W = MAST_W, s = sculpt(W, MAST_H);
  const [fx, fy] = MAST_FOOT;
  // The pad: a round of setts.
  for (let y = 0; y < MAST_H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - 19) / 20, dy = (y - 9) / 8.6;
    if (dx * dx + dy * dy <= 1) s.paint[y * W + x] = M.cobble;
  }
  // The feet: two in front, two behind.
  for (const x of [fx - 6, fx - 5, fx + 5, fx + 6]) { put(s, x, fy, 1.6, M.stone, T_WALL); put(s, x, fy - 4, 1.6, M.stone, T_WALL); }

  // Iron reads as dark blue-grey, not stone. The picture is wide enough for the yard and the guys.
  const iron = M.roofSlate, p = picture(29, MAST_TALL), c = 14;
  const half = (z: number): number => (z >= 34 ? 1.3 : 7.4 - 5.6 * (z / 34));
  // Guys, drawn first so the tower stands in front of them.
  stroke(p, c - 1, 30, 1, 6, 1, iron, 78);
  stroke(p, c + 1, 30, 27, 6, 1, iron, 70);
  stroke(p, c - 1, 18, 2, 4, 1, iron, 86);
  stroke(p, c + 1, 18, 26, 4, 1, iron, 74);
  // The far legs, paler, seen through the bracing.
  for (let z = 2; z <= 34; z++) { dot(p, c - half(z) + 1.4, z, iron, 128); dot(p, c + half(z) - 1.4, z, iron, 112); }
  // A cross in every panel, each panel about as tall as the tower is wide there.
  const girders: number[] = [1];
  for (let z = 1; z < 33;) { z += Math.max(3, Math.floor(2 * half(z))); girders.push(Math.min(z, 34)); }
  for (let k = 0; k + 1 < girders.length; k++) {
    const z0 = girders[k], z1 = girders[k + 1];
    stroke(p, c - half(z0), z0, c + half(z1), z1, 1, iron, 96);
    stroke(p, c + half(z0), z0, c - half(z1), z1, 1, iron, 78);
    stroke(p, c - half(z1), z1, c + half(z1), z1, 1, iron, 70);
  }
  // The near legs, and the main up the middle.
  for (let z = 1; z <= 36; z++) {
    dot(p, c - half(Math.min(z, 34)), z, iron, 88);
    dot(p, c + half(Math.min(z, 34)), z, iron, 64);
    if (z < 34 && z % 2 === 0) dot(p, c, z, iron, 100);
  }
  // Two galleries. The upper one carries the mooring cabin.
  for (let x = -6; x <= 6; x++) { dot(p, c + x, 12, iron, 72); if (Math.abs(x) % 2 === 1 || Math.abs(x) === 6) dot(p, c + x, 13, iron, 96); }
  for (let x = -7; x <= 7; x++) { dot(p, c + x, 33, iron, 68); if (Math.abs(x) >= 4) dot(p, c + x, 34, iron, Math.abs(x) % 2 === 1 ? 100 : 80); }
  for (let x = -2; x <= 2; x++) {
    for (let z = 34; z <= 36; z++) dot(p, c + x, z, M.roofLead, x < 0 ? 150 : 120);
    dot(p, c + x, 37, M.copper, 160);
  }
  dot(p, c - 1, 35, M.lantern, 210);
  dot(p, c + 1, 35, M.opening, 100);
  // The yard: a long arm, then the spindle and the banded mooring cone, a lamp at the tip.
  for (let x = -11; x <= 11; x++) dot(p, c + x, 38, iron, Math.abs(x) > 8 ? 80 : 64);
  for (let x = -11; x <= 11; x += 2) dot(p, c + x, 39, iron, 90);
  stroke(p, c + 2, 40, c + 10, 36, 1, iron, 76);
  for (let z = 39; z <= 41; z++) dot(p, c, z, iron, 84);
  for (let z = 42; z <= 44; z++) {
    const band = z % 2 === 0 ? M.brick : M.sailcloth, hw = z >= 44 ? 0 : 1;
    for (let x = -hw; x <= hw; x++) dot(p, c + x, z, band, x < 0 ? 168 : x > 0 ? 128 : 150);
  }
  dot(p, c - 3, 42, iron, 80);
  dot(p, c + 3, 42, iron, 72);
  dot(p, c, 45, iron, 80);
  dot(p, c, 46, M.lantern, 230);
  hang(s, p, fx - c, fy);

  // The winch house: a small plastered shed under tile, wide doors, a chimney for the donkey engine.
  house(s, 26, 6, 8, 5, 4.2, 2.2, { gable: 0, wallMat: M.plaster, roofMat: M.roofTile, openings: 0, chimney: true });
  for (let x = 28; x <= 30; x++) for (let z = 1; z <= 3; z++) mark(s, x, 10, z, z === 3 ? M.timber : M.opening, z === 3 ? 100 : 112);
  mark(s, 32, 10, 2, M.opening);
  mark(s, 32, 10, 3, M.opening);
  // The cable from the winch to the foot of the mast, on the ground.
  for (let x = fx + 1; x <= 24; x++) put(s, x, fy + 1, 0.4, M.stoneDark, x % 2 === 0 ? 96 : 120);
  // Two gas holders west of the mast.
  for (const [gx, gy] of [[3.5, 7.5], [6, 11]] as const) {
    for (let y = Math.floor(gy - 1.6); y <= Math.ceil(gy + 1.6); y++) for (let x = Math.floor(gx - 1.6); x <= Math.ceil(gx + 1.6); x++) {
      const dx = x - gx, dy = y - gy;
      if (dx * dx + dy * dy <= 1.35 * 1.35) put(s, x, y, 2.4, M.roofSlate, clampTone(130 - 28 * dx));
    }
  }
  // Anchor blocks for the yaw lines, each with its ring.
  const blocks = [[1, 13], [20, 16], [37, 13 + (seed & 1)], [11, 2]] as const;
  for (const [bx, by] of blocks) { put(s, bx, by, 1.2, M.stone, T_WALL); put(s, bx + 1, by, 1.2, M.stone, T_WALL); mark(s, bx, by, 2, iron, 84); }
  // The windsock.
  for (let z = 1; z <= 8; z++) mark(s, 38, 8, z, M.timber, 90);
  mark(s, 39, 8, 8, M.brick, 160);
  mark(s, 40, 8, 8, M.sailcloth, 160);
  mark(s, 41, 8, 7, M.brick, 160);
  put(s, 38, 8, 0.8, M.stone, T_WALL);
  return s;
}

// ---------------------------------------------------------------------------
// The bridge town.

/** The raster's rows: the bridge is BRIDGE_DEPTH deep from row BRIDGE_ROW, and BRIDGE_END cells of road lie at each end. */
export const BRIDGE_ROW = 2;
export const BRIDGE_DEPTH = 8;
export const BRIDGE_END = 6;
export const BRIDGE_H = 13;
/** How far the tallest roof stands over the deck, the chapel's cross included. */
export const BRIDGE_TALL = 17;
/** Cells of bare deck at the bridge's east end past the last house, and at its west end past the gatehouse. */
const BRIDGE_BARE = 8;
const BRIDGE_BARE_WEST = 4;

/**
 * The bridge town (len + 12 wide, 13 deep; its roofs stand up to 17 over the deck). Base: the river. An old
 * stone bridge of round arches on cutwater piers, `len` cells long and `deck` above the water, built over for
 * its middle: a gatehouse at the west bridgehead, then tall narrow houses crowded along both sides of the
 * street, plastered in several colours under steep roofs and chimneys. Where the south row parts, a small
 * square in front of the bridge chapel. The ends are bare deck between parapets, so the arches show; a
 * wayside cross stands at the east end. `wet` is the river's width: the arches over it stand in water, the
 * others on the banks.
 */
export function bridgeTown(len: number, wet: number, deck: number, seed: number): Structure {
  const W = len + 2 * BRIDGE_END, s = sculpt(W, BRIDGE_H);
  const x0 = BRIDGE_END, x1 = x0 + len - 1, y0 = BRIDGE_ROW, south = y0 + BRIDGE_DEPTH - 1, mid = x0 + (len >> 1);
  // The road on to it.
  paint(s, 0, y0 + 3, x0, 2, M.road);
  paint(s, x1 + 1, y0 + 3, BRIDGE_END, 2, M.road);
  // The deck and its parapets.
  for (let y = y0; y <= south; y++) for (let x = x0; x <= x1; x++) put(s, x, y, deck, M.cobble, T_FLAT);
  for (let x = x0; x <= x1; x++) { put(s, x, y0, deck + 1, M.stone, T_FLAT); put(s, x, south, deck + 1, M.stone, T_WALL); }

  // The gatehouse over the road at the west end.
  tower(s, x0, y0 + 1, 5, BRIDGE_DEPTH - 1, deck + 10, 4, M.stone, M.roofSlate, false);
  for (let x = x0; x < x0 + 5; x++) mark(s, x, south, deck + 9, M.stoneDark, 108);
  mark(s, x0 + 2, south, deck + 6, M.opening);
  mark(s, x0 + 2, south, deck + 7, M.opening);
  mark(s, x0 + 2, south, deck + 1, M.timber, 92);
  mark(s, x0 + 2, south, deck + 2, M.timber, 92);
  // The wayside cross on the parapet at the east end.
  const wx = x1 - 3;
  for (let z = 2; z <= 4; z++) mark(s, wx, south, deck + z, M.stone, 150);
  mark(s, wx - 1, south, deck + 3, M.stone, 150);
  mark(s, wx + 1, south, deck + 3, M.stone, 150);

  // Two ranks. The south rank is low, a shop front and a tile roof; the north rank stands well above it,
  // so a second row of plaster and steep roofs shows. Colours alternate by house. Nothing passes the cap.
  const walls = [M.plasterRose, M.plasterSea, M.plasterSage, M.brick, M.plasterButter, M.plasterRose, M.plasterSea];
  const roofs = [M.roofTile, M.roofSlate, M.copper, M.roofTile, M.roofLead];
  const square: readonly [number, number] = [mid - 4, mid + 4];
  const from = x0 + 5 + BRIDGE_BARE_WEST, to = x1 - BRIDGE_BARE;
  const limit = deck + BRIDGE_TALL;
  const row = (y: number, d: number, wall0: number, roof0: number, salt: number, gap: boolean, far: boolean): void => {
    let x = from, k = 0;
    while (x <= to - 2) {
      k++;
      let w = 4 + ((k + salt) % 3);
      if (x + w > to || to - (x + w) < 3) w = to - x;
      if (w < 3) break;
      if (gap && x + w > square[0] && x <= square[1]) {
        if (x < square[0] - 2) w = square[0] - x;
        else { x = square[1] + 1; continue; }
      }
      const n = hash2(k, salt, seed);
      const gable = (n & 3) === 0 ? 1 : 0;
      let wall = wall0 + (n & 3) * 0.4;
      let roof = roof0 + (gable === 1 ? 0.6 : 0);
      if (wall + roof > limit - 2.6) roof = Math.max(1.4, limit - 2.6 - wall);
      if (wall + roof > limit) wall = limit - roof;
      const wallMat = walls[(k + salt) % walls.length];
      const roofMat = roofs[(k + salt) % roofs.length];
      house(s, x, y, w, d, wall, roof, { gable, wallMat, roofMat, openings: 0, chimney: false });
      const face = y + d - 1;
      // A light face, so the plaster colour survives the shade on the south wall.
      for (let i = 0; i < w; i++) s.tone[face * W + x + i] = 176;
      // A dark party pier up the east edge of the roof, so one house does not melt into the next.
      for (let j = 0; j < d - 1; j++) {
        const ry = y + j, t = s.top[ry * W + x + w - 1];
        if (t > deck && t + 0.5 <= limit) put(s, x + w - 1, ry, t + 0.45, M.stoneDark, 108);
      }
      // The near rank: a shop, an awning, one window. The far rank: the floors that clear the roofs in front.
      const floors = far ? [deck + 7, deck + 9] : [deck + 1, deck + 2];
      for (let i = 0; i < w; i++) {
        const bay = i % 2 === 1;
        for (const z of floors) {
          if (z >= wall) continue;
          const lit = bay && z === floors[floors.length - 1] && (k + i) % 3 === 0;
          mark(s, x + i, face, z, bay ? (lit ? M.lantern : M.opening) : M.timber, bay ? (lit ? 214 : 108) : 100);
          if (bay && z + 1 < wall) mark(s, x + i, face, z + 1, lit ? M.lantern : M.opening, lit ? 196 : 124);
        }
        if (!far && i < w - 1 && deck + 3 < wall) mark(s, x + i, face, deck + 3, i % 2 === 0 ? M.brick : M.sailcloth, 160);
      }
      for (let z = Math.floor(deck + 1); z <= wall; z++) mark(s, x + w - 1, face, z, M.stoneDark, 120);
      if (gable === 1 && wall + 1 < wall + roof) mark(s, x + ((w - 1) >> 1), face, Math.floor(wall + 1), M.opening, 116);
      // The chimney stands on a roof row behind the face, so it does not repaint the wall.
      const cx = x + Math.max(1, w - 2), cy = y + 1, peak = s.top[cy * W + cx];
      if (peak > deck + 1 && peak + 2.3 <= limit) {
        put(s, cx, cy, peak + 2.1, M.brick, T_WALL);
        mark(s, cx, cy, Math.floor(peak + 1.4), M.stoneDark, 100);
      }
      x += w;
    }
  };
  row(y0, 4, deck + 9.2, 3.6, 0, false, true);
  row(south - 3, 4, deck + 3.2, 2.2, 3, true, false);

  // The chapel on the north side of the square: its gable, a lancet and a bellcote with a cross.
  const cx = mid - 2;
  house(s, cx, y0, 5, 4, deck + 8, 4, { gable: 1, wallMat: M.stone, roofMat: M.roofLead, openings: 0, chimney: false });
  for (let z = 3; z <= 6; z++) mark(s, cx + 2, y0 + 3, deck + z, M.opening, z === 6 ? 118 : 100);
  for (const x of [cx + 1, cx + 3]) for (let z = 1; z <= 2; z++) mark(s, x, y0 + 3, deck + z, M.timber, 92);
  for (let k = 1; k <= 4; k++) mark(s, cx + 2, y0 + 3, deck + 12 + k, k === 1 ? M.stone : M.gilt, 150);
  mark(s, cx + 1, y0 + 3, deck + 15, M.gilt, 150);
  mark(s, cx + 3, y0 + 3, deck + 15, M.gilt, 150);
  // The square: a well.
  put(s, mid + 3, south - 2, deck + 1.2, M.stone, T_WALL);
  mark(s, mid + 3, south - 2, deck + 2, M.timber, 90);

  // The bridge's south face, painted over whatever stands on it: stone, a string course under the deck, and the
  // arches, each under a ring of darker voussoirs, a pier with its cutwater between each pair.
  const bays = Math.max(3, Math.round(len / 10)), bay = len / bays, a = bay / 2 - 1.2;
  const top = Math.floor(deck);
  for (let x = x0; x <= x1; x++) {
    const along = x + 0.5 - x0, v = along - (Math.floor(along / bay) + 0.5) * bay;
    for (let z = 1; z < top; z++) mark(s, x, south, z, M.stone, T_WALL);
    mark(s, x, south, top, M.stoneDark, 112);
    if (Math.abs(v) >= a) {
      // A pier: its cutwater stands out a cell, lit on the west.
      if (Math.abs(v) > bay / 2 - 0.6 && x > x0 + 1 && x < x1 - 1) put(s, x, south + 1, deck - 2.5, M.stone, v > 0 ? 150 : 104);
      continue;
    }
    const rise = Math.min(deck - 2, 1 + a * Math.sqrt(1 - (v * v) / (a * a)));
    const water = Math.abs(x - mid) <= wet / 2 + 1.5;
    for (let z = 1; z <= rise; z++) mark(s, x, south, z, z === 1 && water ? M.river : M.opening, z >= rise - 1 ? 92 : 104);
    if (rise + 1 < top) mark(s, x, south, Math.floor(rise) + 1, M.stoneDark, 132);
  }
  return s;
}

/**
 * The water meadows south of the bridge town (w × h): grass painted over the banks, its edge ragged, so no wood
 * stands between the camera and the arches. Nothing stands on it.
 */
export function waterMeadow(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  const cx = (w - 1) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / (w / 2), dy = y / h;
    const ragged = ((hash2(x >> 2, y >> 2, seed ^ 0x3ead) & 7) - 3.5) * 0.04;
    if (dx * dx + dy * dy <= 1 + ragged) s.paint[y * w + x] = M.pastureMid;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The great oak.

export const OAK_W = 43;
export const OAK_H = 13;
/** The trunk's foot in the oak's raster, and the oak's height. */
export const OAK_TRUNK = [21, 7] as const;
export const OAK_TALL = 47;
/** In the raster: where the swing's seat hangs, and the treehouse's door. */
export const OAK_SWING = [32, 7] as const;
export const OAK_HOUSE = [10, 7] as const;

/**
 * The great oak (43 × 13, 47 tall). Base: the ground at its foot. One tree: a thick trunk and a single
 * billowing dome of dark evergreen, far above the ground; a treehouse on the west with a ladder to it, and
 * a swing to the east.
 */
export function greatOak(seed: number): Structure {
  const W = OAK_W, s = sculpt(W, OAK_H);
  const [cx, row] = OAK_TRUNK;
  const p = picture(W, OAK_TALL);
  const bark = M.timber;
  // One dome: overlapping lobes of evergreen, solid inside, lumpy only at the edge. Lit from the north-west,
  // dark underneath, so the mass billows instead of reading as a flat disc.
  const lobes: readonly (readonly [number, number, number, number])[] = [
    [21, 33, 16.5, 13], [9, 30, 7.5, 6], [33, 31, 7.5, 6.2], [15, 40, 7.2, 4.2], [27, 40, 7.2, 4.2],
    [21, 24, 11, 5.5], [5, 26, 4.2, 3.6], [37, 27, 4.4, 3.6], [21, 37, 9, 7],
  ];
  for (let z = 18; z <= 46; z++) for (let x = 0; x < W; x++) {
    let inCrown = false;
    for (const [mx, mz, rx, rz] of lobes) {
      const nx = (x - mx) / rx, nz = (z - mz) / rz;
      const edge = 1 + ((hash2(x, z, seed ^ 0x51) & 3) - 1.5) * 0.04;
      if (nx * nx + nz * nz <= edge) { inCrown = true; break; }
    }
    if (!inCrown) continue;
    const dx = x - 21, dz = z - 33;
    const light = (-0.5 * dx + 0.85 * dz) / 16;
    const grain = ((hash2(x, z, seed ^ 0x0a6) & 7) - 3.5) * 3;
    const under = dz < -8;
    const mat = light > 0.28 ? M.coniferMid : light < -0.2 || under ? M.yew : M.coniferCool;
    dot(p, x, z, mat, 112 + 40 * light + grain - (under ? 16 : 0));
  }
  // The trunk, thick at the root and lit from the west, drawn over the leaves it rises into.
  for (let z = 1; z <= 20; z++) {
    const t = (z - 1) / 19;
    const hw = 6.2 - t * 3.1;
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
      dot(p, x, z, bark, 118 - 36 * ((x - cx) / hw) + ((hash2(x, z >> 2, seed ^ 0x7b) & 3) - 1.5) * 6);
    }
  }
  dot(p, cx + 2, 8, M.opening, 90);
  dot(p, cx + 2, 9, M.opening, 100);

  // The treehouse: a deck across the west bough, a boarded hut under a tiled roof, a strut to the trunk and a ladder.
  const [hx] = OAK_HOUSE;
  for (let x = hx - 5; x <= hx + 4; x++) dot(p, x, 17, bark, 80);
  for (let x = hx - 4; x <= hx + 3; x++) for (let z = 18; z <= 21; z++) dot(p, x, z, M.plaster, x === hx + 3 ? 120 : 150);
  for (let z = 18; z <= 20; z++) dot(p, hx, z, bark, 88);
  dot(p, hx - 3, 20, M.opening, 100);
  dot(p, hx - 2, 20, M.opening, 100);
  dot(p, hx + 2, 20, M.lantern, 170);
  for (let x = hx - 5; x <= hx + 4; x++) dot(p, x, 22, M.roofTile, 118);
  for (let x = hx - 4; x <= hx + 3; x++) dot(p, x, 23, M.roofTile, 140);
  for (let x = hx - 2; x <= hx + 1; x++) dot(p, x, 24, M.roofTile, 160);
  stroke(p, hx + 5, 16, cx - 4, 11, 1, bark, 80);
  for (let z = 1; z <= 16; z++) { dot(p, hx - 1, z, bark, z % 2 === 0 ? 170 : 96); if (z % 2 === 0) dot(p, hx, z, bark, 170); }
  // The swing: two ropes from the east bough and a painted seat.
  const [sx] = OAK_SWING;
  for (let z = 5; z <= 18; z++) { dot(p, sx - 1, z, M.timber, 168); dot(p, sx + 2, z, M.timber, 168); }
  for (let x = sx - 1; x <= sx + 2; x++) dot(p, x, 4, M.brick, 160);
  // The crown's silhouette is inked, as the wood's crowns are against open ground: its outermost leaves are the
  // darkest, so the tree stands out from whatever lies behind it.
  const leaf = (x: number, z: number): boolean => {
    const m = x < 0 || x >= p.w || z < 1 || z > p.tall ? 0 : p.mat[z * p.w + x];
    return m === M.coniferCool || m === M.coniferMid || m === M.coniferWarm || m === M.yew;
  };
  const empty = (x: number, z: number): boolean => x < 0 || x >= p.w || z < 1 || z > p.tall || p.mat[z * p.w + x] === 0;
  const rim: number[] = [];
  for (let z = 1; z <= p.tall; z++) for (let x = 0; x < p.w; x++) {
    if (leaf(x, z) && (empty(x - 1, z) || empty(x + 1, z) || empty(x, z - 1) || empty(x, z + 1))) rim.push(z * p.w + x);
  }
  for (const k of rim) { p.mat[k] = M.yew; p.tone[k] = 70; }
  hang(s, p, 0, row);

  // What stands on the ground: the trunk's foot and its roots, and the shade and leaf litter under the crown.
  for (let y = 0; y < OAK_H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) / 19, dy = (y - row - 0.5) / 5.6;
    if (dx * dx + dy * dy <= 1) s.paint[y * W + x] = M.floorBroadleaf;
  }
  for (let x = cx - 4; x <= cx + 4; x++) put(s, x, row, 8, bark, T_WALL);
  for (const [rx, ry, rt] of [[cx - 7, row, 1], [cx - 6, row, 1.5], [cx - 5, row, 2.2], [cx + 5, row, 2.2], [cx + 6, row, 1.5], [cx + 7, row, 1], [cx - 3, row + 1, 1.4], [cx + 2, row + 1, 1.6], [cx + 4, row + 1, 1.1]] as const) {
    put(s, rx, ry, rt, bark, clampTone(118 - 8 * (rx - cx)));
  }
  return s;
}

// ---------------------------------------------------------------------------
// The observatory.

export const OBS_W = 46;
export const OBS_H = 25;
/** The great dome's middle in the raster, and the observatory's height over its terrace. */
export const OBS_DOME = [15, 10] as const;
export const OBS_TALL = 24;

/** A round house under a verdigris dome with a shutter slit open to the south: the drum's wall is `drum` high, the dome `rise` more. */
function domeHouse(s: Structure, cx: number, cy: number, r: number, drum: number, rise: number, slit: number): void {
  const inner = r - 1.1;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (d2 > inner * inner) { put(s, x, y, drum, M.whitewash, clampTone(132 - 34 * dx / r)); continue; }
    const k = Math.sqrt(1 - d2 / (inner * inner));
    const open = x >= Math.floor(cx) + 1 && x < Math.floor(cx) + 1 + slit && dy > -1.5;
    const rib = Math.abs(Math.floor(x - cx)) % 4 === 0 ? -16 : 0;
    put(s, x, y, drum + 1 + rise * k - (open ? 0.4 : 0), open ? M.opening : M.copper, open ? 92 : clampTone(150 - 46 * dx / r - 22 * dy / r + rib));
  }
  // On the cells that face the camera: a rail round the dome's foot and a string course below it.
  for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    let face = -1;
    for (let y = Math.ceil(cy + r); y >= Math.floor(cy - r); y--) if (y >= 0 && y < s.h && x >= 0 && x < s.w && s.mat[y * s.w + x] === M.whitewash && s.top[y * s.w + x] === Math.fround(drum)) { face = y; break; }
    if (face < 0) continue;
    mark(s, x, face, Math.floor(drum), M.stoneDark, 104);
    if (drum >= 7) mark(s, x, face, Math.floor(drum) - 4, M.stoneDark, 124);
  }
}

/**
 * The observatory (46 × 25, 24 tall). Base: its terrace on the summit. A great verdigris dome on a white
 * drum, its shutter open and the telescope's mouth in the slit; a copper-roofed hall for the astronomers
 * east of it, a small dome for the transit instrument beyond, and a walled terrace with a meridian pillar,
 * a wind gauge and steps down to the path.
 */
export function observatory(seed: number): Structure {
  const W = OBS_W, s = sculpt(W, OBS_H);
  const [cx, cy] = OBS_DOME;
  // The terrace: flags behind a parapet on a retaining wall of the summit's own rubble.
  for (let y = 1; y <= 21; y++) for (let x = 1; x <= 44; x++) {
    const ex = Math.min(x - 1, 44 - x), ey = Math.min(y - 1, 21 - y);
    if (ex + ey < 3) continue;
    put(s, x, y, 1.4, M.cobble, T_FLAT);
  }
  for (let x = 1; x <= 44; x++) {
    const j = faceRow(s, x);
    if (j < 0) continue;
    put(s, x, j, 2.4, M.stoneDark, T_WALL);
    mark(s, x, j, 2, M.stone, 150);
  }
  // Steps through the parapet.
  for (const x of [26, 27]) { put(s, x, 21, 1.4, M.stone, 160); put(s, x, 22, 1, M.stone, 150); put(s, x, 23, 0.5, M.stone, 160); }

  // The great dome.
  const drum = 10.2;
  domeHouse(s, cx, cy, 8, drum, 7.2, 2);
  // Windows, a door and a little ivy, on the drum's cells that face the camera.
  for (let x = cx - 6; x <= cx + 6; x++) {
    let face = -1;
    for (let y = s.h - 1; y >= 0; y--) if (s.mat[y * s.w + x] === M.whitewash) { face = y; break; }
    if (face < 0) continue;
    const q = x - cx;
    if (q === 0) { mark(s, x, face, 2, M.timber, 92); mark(s, x, face, 3, M.opening, 110); mark(s, x, face, 4, M.opening, 124); }
    else if (Math.abs(q) % 2 === 1) { mark(s, x, face, 3, M.opening, 108); mark(s, x, face, 7, M.lantern, 200); }
    if (Math.abs(q) >= 3 && (hash2(x, face, seed) & 3) === 0) mark(s, x, face, 2, M.ivy, 108);
    mark(s, x, face, 1, M.stone, 146);
  }
  // The telescope, looking out of the slit a little east of south.
  const tz = Math.floor(drum + 7);
  mark(s, cx + 1, cy + 2, tz, M.stoneDark, 84);
  mark(s, cx + 2, cy + 2, tz + 1, M.stoneDark, 96);
  mark(s, cx + 2, cy + 2, tz + 2, M.gilt, 170);
  mark(s, cx + 3, cy + 2, tz + 2, M.gilt, 150);

  // The astronomers' hall, plaster and copper, with a chimney.
  house(s, 23, 7, 12, 7, 6.6, 2.8, { gable: 0, wallMat: M.plaster, roofMat: M.copper, openings: 0, chimney: true });
  for (let i = 1; i < 12; i += 2) { mark(s, 23 + i, 13, 3, M.opening, 108); mark(s, 23 + i, 13, 4, M.lantern, 190); }
  for (let z = 2; z <= 3; z++) mark(s, 30, 13, z, M.timber, 92);
  for (let i = 0; i < 12; i++) mark(s, 23 + i, 13, 6, M.copper, 140);
  // The transit house.
  domeHouse(s, 40, 10.5, 3.6, 5.4, 3.4, 1);
  mark(s, 40, 14, 2, M.timber, 92);
  mark(s, 40, 14, 3, M.timber, 92);

  // On the terrace: the meridian pillar with its gilt ball, and a wind gauge on a mast.
  put(s, 6, 18, 4.4, M.stone, T_WALL);
  mark(s, 6, 18, 5, M.gilt, 170);
  const gx = 34 + (seed & 1);
  put(s, gx, 18, 2, M.stoneDark, T_WALL);
  for (let z = 3; z <= 9; z++) mark(s, gx, 18, z, M.timber, 88);
  for (const dx of [-2, -1, 1, 2]) mark(s, gx + dx, 18, 9, M.stoneDark, Math.abs(dx) === 2 ? 150 : 90);
  mark(s, gx, 18, 10, M.brick, 160);
  return s;
}
