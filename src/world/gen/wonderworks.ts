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
import { faceRow, house, mark, paint, put, sculpt, T_EAST, T_FLAT, T_NORTH, T_RIDGE, T_SOUTH, T_WALL, T_WEST, tower } from "./structures.ts";

/** Heights above the water of the things that stand in it. */
export const TRACK_DECK = 4.4;
export const HALT_DECK = 5;

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
 * The thermal baths (43 × 44; the dome's finial stands 21 over the court). Base: the sea. A domed rotunda between two
 * arcaded wings on the cliff top, three terraces of warm pools stepping down the cliff below it on arched
 * retaining walls, a stone quay at the water, and a funicular down the east side from the court to the quay.
 * `top` is the cliff top's height above the sea.
 */
export function thermalBaths(top: number, seed: number): Structure {
  const W = BATH_W, s = sculpt(W, BATH_H);
  const lv = bathLevels(top), L = lv.court;
  // Terraces span columns 1…34; the funicular runs down columns 37…39.
  const X0 = 1, X1 = 34;

  // The court: paving at the cliff top, a balustrade along its south edge.
  for (let y = 0; y < 17; y++) for (let x = X0; x <= X1; x++) put(s, x, y, L, M.cobble, T_FLAT);
  for (let x = X0; x <= X1; x++) put(s, x, 16, L + 1, M.stone, T_WALL);

  // The wings: long halls under tile, each with a row of tall round-headed windows.
  for (const wx of [X0 + 1, X1 - 11]) {
    house(s, wx, 4, 11, 8, L + 6, 3, { gable: 0, wallMat: M.plaster, roofMat: M.roofTile, openings: 0, chimney: false });
    for (let i = 1; i < 11; i += 2) {
      for (let z = 2; z <= 4; z++) mark(s, wx + i, 11, L + z, M.opening, z === 4 ? 118 : 100);
    }
    for (let i = 0; i < 11; i++) mark(s, wx + i, 11, L + 6, M.stoneDark, 110);
  }
  // The rotunda: a stone drum, a lead dome and a lantern.
  const cx = (X0 + X1) / 2, cy = 7.5, r = 6.4, drumTop = L + 9;
  for (let y = 0; y < 16; y++) for (let x = X0; x <= X1; x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    const d = Math.sqrt(d2);
    if (d > r - 1.1) {
      // The wall, lit round its girth.
      put(s, x, y, drumTop, M.stone, clampTone(128 - 30 * dx / r));
    } else {
      const k = Math.sqrt(1 - d2 / ((r - 1.1) * (r - 1.1)));
      put(s, x, y, drumTop + 1 + 7 * k, M.roofLead, clampTone(142 - 46 * dx / r - 22 * dy / r));
    }
  }
  const lx = Math.floor(cx), ly = Math.floor(cy);
  put(s, lx, ly, drumTop + 10, M.stone, T_WALL);
  put(s, lx + 1, ly, drumTop + 10, M.stone, T_WALL);
  mark(s, lx, ly, drumTop + 9, M.opening);
  mark(s, lx + 1, ly, drumTop + 9, M.opening);
  finial(s, lx, ly, drumTop + 10);
  // The drum's windows and its door, on the cells that face the camera.
  for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
    let row = -1;
    for (let y = 15; y >= 0; y--) if (s.top[y * W + x] >= drumTop && s.mat[y * W + x] === M.stone) { row = y; break; }
    if (row < 0) continue;
    mark(s, x, row, drumTop - 1, M.stoneDark, 108);
    const q = x - Math.floor(cx - r);
    if (q % 2 === 1) for (let z = 4; z <= 7; z++) mark(s, x, row, L + z, M.opening, z === 7 ? 118 : 100);
  }
  for (let z = 1; z <= 3; z++) { mark(s, lx, 13, L + z, M.timber, 92); mark(s, lx + 1, 13, L + z, M.timber, 92); }

  // The pool terraces: each narrower than the one above, so the baths come down the cliff as a cascade. Paving,
  // a pool of warm water in a pale kerb, a balustrade, and an arched retaining wall down to the next.
  const pools: [number, number][][] = [[[5, 30]], [[7, 15], [20, 28]], [[11, 24]]];
  const mid = Math.floor(cx);
  for (let k = 0; k < 3; k++) {
    const [y0, y1] = BATH_ROWS.pools[k];
    const level = lv.pools[k], below = k < 2 ? lv.pools[k + 1] : lv.quay;
    const t0 = X0 + 3 * k, t1 = X1 - 3 * k, drop = level - below;
    // The front bows out a cell in the middle: a bastion over the terrace below.
    const front = (x: number): number => (Math.abs(x - mid - 0.5) <= 5.5 ? y1 : y1 - 1);
    for (let x = t0; x <= t1; x++) {
      const f = front(x);
      for (let y = y0; y < f; y++) put(s, x, y, level, M.cobble, T_FLAT);
      put(s, x, f, level + 0.8, M.stone, 108);
      mark(s, x, f, level, M.stoneDark, 112);
      const q = (x - t0) % 4;
      if (drop >= 4.5 && q !== 0) for (let z = 1; z <= Math.min(drop - 2, 5) - (q === 2 ? 0 : 1); z++) mark(s, x, f, below + z, M.opening, 110);
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
    // Steps down through the wall at either end.
    for (const sx of [t0 + 1, t1 - 1]) {
      put(s, sx, y1 - 1, level - drop * 0.5, M.stone, 160);
      put(s, sx, y1 - 2, level - drop * 0.2, M.stone, 170);
    }
    // Bay trees in tubs at the terrace's corners.
    for (const x of [t0, t1]) put(s, x, y0 + 2, level + 2.2, M.yew, 0);
  }

  // The quay: stone at the water, bollards along its edge, a ferry stage of planks.
  const [qy0, qy1] = BATH_ROWS.quay;
  for (let y = qy0; y < qy1 - 1; y++) for (let x = 0; x < W; x++) put(s, x, y, lv.quay, y === qy1 - 2 ? M.stone : M.cobble, y === qy1 - 2 ? T_WALL : T_FLAT);
  for (let x = 3; x < W - 2; x += 6) put(s, x, qy1 - 2, lv.quay + 1, M.stoneDark, T_WALL);
  for (let x = 16; x <= 21; x++) put(s, x, qy1 - 1, 1.2, M.timber, x === 16 || x === 21 ? 90 : T_WALL);

  // The funicular: two rails on sleepers down an incline of stone, a station at each end and one car on the way.
  const fx = 37, fy0 = 14, fy1 = qy0;
  for (let y = fy0; y <= fy1; y++) {
    const t = (y - fy0) / (fy1 - fy0), z = L + (lv.quay + 0.4 - L) * t;
    put(s, fx, y, z, M.stoneDark, 84);
    put(s, fx + 1, y, z, y % 2 === 0 ? M.plaster : M.timber, y % 2 === 0 ? 150 : 110);
    put(s, fx + 2, y, z, M.stoneDark, 84);
  }
  // The car, part of the way down: a boxy body under a lead roof.
  const carY = fy0 + Math.floor((fy1 - fy0) * (0.3 + 0.2 * ((seed & 255) / 255)));
  for (let y = carY; y <= carY + 2; y++) for (let x = fx; x <= fx + 2; x++) {
    const t = (y - fy0) / (fy1 - fy0), z = L + (lv.quay + 0.4 - L) * t + 3;
    put(s, x, y, z, y === carY + 2 ? M.brick : M.roofLead, y === carY + 2 ? T_WALL : 160);
  }
  mark(s, fx + 1, carY + 2, Math.floor(L + (lv.quay + 0.4 - L) * ((carY + 2 - fy0) / (fy1 - fy0)) + 2), M.opening);
  // The top station: a small house over the head of the track, joined to the court.
  for (let y = 9; y < 17; y++) for (let x = X1 + 1; x <= 40; x++) if (s.top[y * W + x] === 0) put(s, x, y, L, M.cobble, T_FLAT);
  house(s, 36, 9, 5, 5, L + 4, 2.5, { gable: 1, wallMat: M.plaster, roofMat: M.roofTile, openings: 0, chimney: false });
  mark(s, 38, 13, L + 1, M.opening, 100);
  mark(s, 38, 13, L + 2, M.opening, 100);
  for (let x = X1 + 1; x <= 40; x++) if (x < fx || x > fx + 2) put(s, x, 16, L + 1, M.stone, T_WALL);
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
 * The track from (ax, ay) to (bx, by), in world cells: a single line on a low timber trestle, bowed `bow`
 * cells off the straight at its middle so it is not ruled. Base: the sea. It comes as pieces at most `piece`
 * cells long, each a small raster, so no bake window carries the whole line.
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
    const along = new Float32Array(s.w * s.h).fill(-1);
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const px = ox + i + 0.5 - ax, py = oy + j + 0.5 - ay;
      const a = px * ux + py * uy;
      if (a < a0 - 0.5 || a >= a1 + 0.5 || a < 0 || a > len) continue;
      const lat = -px * uy + py * ux - off(a);
      if (Math.abs(lat) > 1.5) continue;
      along[j * s.w + i] = a;
      // Rails outside, sleepers between: every other one lighter.
      if (Math.abs(lat) > 0.55) put(s, i, j, TRACK_DECK, M.stoneDark, 84);
      else if (Math.floor(a) % 2 === 0) put(s, i, j, TRACK_DECK, M.plaster, 150);
      else put(s, i, j, TRACK_DECK, M.timber, 104);
    }
    // The trestle, column by column on the face the camera sees: a bent every fourth cell, and between the
    // bents the water under the deck and the shade above it.
    for (let i = 0; i < s.w; i++) {
      const j = faceRow(s, i);
      if (j < 0) continue;
      const c = j * s.w + i;
      s.mat[c] = M.timber;
      s.tone[c] = 92;
      if (Math.floor(along[c]) % 4 === 0) continue;
      mark(s, i, j, 1, M.sea, 0);
      mark(s, i, j, 2, M.sea, 0);
      mark(s, i, j, 3, M.opening, 112);
    }
    out.push(s);
  }
  return out;
}

/**
 * The lone halt at the track's end (18 × 10, 13 tall): a plank platform on piles beside the line, an open
 * timber shelter with a bench in it, a lamp, a name board and the buffer stop. Base: the sea. The track
 * arrives along row `HALT_TRACK_ROW`; `east` is true when it comes in from the west and ends at the east.
 */
export const HALT_TRACK_ROW = 2;
export function tideHalt(east: boolean): Structure {
  const s = sculpt(18, 10), D = HALT_DECK;
  // The platform of bleached planks, south of the line, on piles.
  for (let y = 4; y <= 8; y++) for (let x = 1; x <= 15; x++) put(s, x, y, D, y === 8 ? M.timber : M.plaster, y === 8 ? 92 : (x + y) % 3 === 0 ? 140 : 152);
  for (let x = 1; x <= 15; x++) if ((x - 1) % 4 !== 0) { mark(s, x, 8, 1, M.sea, 0); mark(s, x, 8, 2, M.sea, 0); mark(s, x, 8, 3, M.opening, 112); }
  // The line's last cells.
  for (let x = 0; x <= 15; x++) {
    put(s, x, 1, TRACK_DECK, M.stoneDark, 84);
    if (x % 2 === 0) put(s, x, 2, TRACK_DECK, M.plaster, 150);
    else put(s, x, 2, TRACK_DECK, M.timber, 104);
    put(s, x, 3, TRACK_DECK, M.stoneDark, 84);
  }
  // The buffer stop: a baulk across the rails, its beam painted.
  for (let y = 1; y <= 3; y++) put(s, 16, y, TRACK_DECK + 2, M.timber, y === 3 ? 90 : 120);
  mark(s, 16, 3, Math.floor(TRACK_DECK + 2), M.brick, 150);
  mark(s, 16, 3, Math.floor(TRACK_DECK + 1), M.sailcloth, 150);
  // The shelter: limewashed boards under a slate roof, open to the south; the bench shows in its shade.
  house(s, 8, 4, 7, 4, D + 4, 2, { gable: 0, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let x = 9; x <= 13; x++) { mark(s, x, 7, D + 1, M.timber, 150); mark(s, x, 7, D + 2, M.opening, 104); mark(s, x, 7, D + 3, M.opening, 112); }
  // The name board on two posts, and the lamp at the platform's end.
  for (let x = 2; x <= 5; x++) { mark(s, x, 6, D + 3, M.dial, 150); mark(s, x, 6, D + 4, M.dial, 150); }
  for (let z = 1; z <= 2; z++) { mark(s, 2, 6, D + z, M.timber, 90); mark(s, 5, 6, D + z, M.timber, 90); }
  for (let z = 1; z <= 6; z++) mark(s, 7, 7, D + z, M.stoneDark, 90);
  mark(s, 6, 7, D + 6, M.stoneDark, 90);
  mark(s, 6, 7, D + 5, M.lantern, 190);
  mark(s, 7, 7, D + 7, M.gilt, 170);
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
 * bell tower stands whole, a weed line where the water meets it; east of it the nave lies under the lake, its
 * walls a paler line in the water, with a scrap of wall, the pier heads and a churchyard cross or two awash.
 */
export function drownedChurch(seed: number): Structure {
  const s = sculpt(CHURCH_W, CHURCH_H), W = CHURCH_W;
  const rnd = (k: number): number => (hash2(k, seed, 0xd20c) & 1023) / 1024;
  const shallow = (x: number, y: number): void => { if (s.top[y * W + x] === 0) put(s, x, y, 0.3, M.lake, T_FLAT); };
  // The church under the water, in the plan of a cross: nave, transepts and the rounded east end.
  // A wall that runs east–west is two rows thick: the camera folds five rows into four, and would lose one.
  for (let x = 8; x <= 29; x++) if (x < 21 || x > 26) for (const y of [3, 4, 11, 12]) shallow(x, y);
  for (const x of [21, 26]) for (let y = 0; y <= 15; y++) if (y <= 4 || y >= 11) shallow(x, y);
  for (let x = 21; x <= 26; x++) for (const y of [0, 1, 14, 15]) shallow(x, y);
  for (let y = 5; y <= 10; y++) shallow(y === 5 || y === 10 ? 31 : 32, y);
  for (const y of [3, 4, 11, 12]) shallow(30, y);
  // What still breaks the surface: a length of the nave's north wall with the heads of two windows, and the pier heads.
  const scrap = 9 + Math.floor(rnd(1) * 5);
  for (let i = 0; i < 7; i++) {
    const t = 4 + Math.floor(rnd(10 + i) * 2) - (i === 0 || i === 6 ? 2 : i === 3 ? 1 : 0);
    put(s, scrap + i, 3, t, M.stoneDark, T_FLAT);
    put(s, scrap + i, 4, t, M.stone, T_WALL);
  }
  for (const i of [1, 2, 4, 5]) mark(s, scrap + i, 4, 1, M.opening);
  mark(s, scrap + 1 + (seed & 1), 4, 2, M.opening);
  mark(s, scrap + 4 + ((seed >>> 1) & 1), 4, 2, M.opening);
  for (let k = 0; k < 5; k++) {
    if (rnd(30 + k) < 0.25) continue;
    const x = 9 + k * 3;
    put(s, x, 11, 0.8 + rnd(40 + k) * 1.2, M.stone, T_WALL);
  }
  // The chancel's east gable, down to a stump.
  for (let y = 6; y <= 9; y++) put(s, 32, y, 1.5 + (y === 7 || y === 8 ? 1.5 : 0) + Math.floor(rnd(70 + y) * 1.5), y === 9 ? M.stone : M.stoneDark, y === 9 ? T_WALL : T_FLAT);
  // Churchyard crosses south of the nave, their heads above the water.
  for (let k = 0; k < 3; k++) {
    const x = 9 + k * 4 + Math.floor(rnd(80 + k) * 2), y = 14 + Math.floor(rnd(90 + k) * 3);
    put(s, x, y, 1.2, M.stone, T_WALL);
    mark(s, x, y, 2, M.stone, 140);
    mark(s, x - 1, y, 1, M.stone, 140);
    mark(s, x + 1, y, 1, M.stone, 140);
  }
  // The tower: its belfry stage and spire, with a cross.
  const tx = CHURCH_TOWER[0] - 3, ty = CHURCH_TOWER[1] - 3;
  tower(s, tx, ty, 6, 7, 17, 10, M.stone, M.roofSlate, true);
  const south = ty + 6;
  for (let x = tx; x < tx + 6; x++) {
    mark(s, x, south, 1, M.yew, 104);
    mark(s, x, south, 2, M.stoneDark, 104);
    mark(s, x, south, 8, M.stoneDark, 108);
    mark(s, x, south, 16, M.stoneDark, 104);
  }
  for (const x of [tx + 1, tx + 2, tx + 4]) for (let z = 10; z <= 14; z++) mark(s, x, south, z, M.opening);
  mark(s, tx + 3, south, 5, M.opening);
  mark(s, tx + 3, south, 6, M.opening);
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
 * The hotel in the cove (42 × 36; its pavilions stand 31 over the sea). Base: the sea. An offshore rock built
 * out with sea walls; on it a white hotel of four floors under a lead roof, a square pavilion at either end,
 * a terrace with a balustrade to the south, and steps down to a landing stage and a seaplane pontoon.
 * `rock` and `cliff` are the materials of the rock's top and its faces.
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
  // Two stone pines on the rock's west end.
  for (const [px, py, pr] of [[5, 10, 2.1], [8, 7, 1.7]] as const) {
    for (let y = Math.floor(py - pr); y <= Math.ceil(py + pr); y++) for (let x = Math.floor(px - pr); x <= Math.ceil(px + pr); x++) {
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 <= pr * pr && x >= 0 && y >= 0) put(s, x, y, P + 4 + 2.5 * Math.sqrt(1 - d2 / (pr * pr)), M.yew, 0);
    }
  }

  // The terrace: paving in front of the hotel, a balustrade on a sea wall.
  for (let y = 4; y <= 17; y++) for (let x = 9; x <= 33; x++) put(s, x, y, P, M.cobble, T_FLAT);
  for (let x = 9; x <= 33; x++) put(s, x, 17, P + 1, M.stone, T_WALL);
  for (let x = 9; x <= 33; x++) mark(s, x, 17, P, M.stoneDark, 112);

  // The main block: four floors of whitewash under a hipped lead roof.
  const bx = 12, by = 5, bw = 19, bd = 8, wall = P + 13;
  for (let j = 0; j < bd - 1; j++) for (let i = 0; i < bw; i++) {
    const ex = Math.min(i, bw - 1 - i), ey = Math.min(j, bd - 2 - j), e = Math.min(ex, ey, 3);
    const tone = e >= 3 ? T_RIDGE : ex <= ey ? (i < bw / 2 ? T_WEST : T_EAST) : j > 3 ? T_SOUTH : T_NORTH;
    put(s, bx + i, by + j, wall + 1.2 * e, M.roofLead, tone);
  }
  const south = by + bd - 1;
  for (let i = 0; i < bw; i++) put(s, bx + i, south, wall, M.whitewash, T_WALL);
  for (let i = 0; i < bw; i++) {
    // The ground floor: tall glazed doors under a string course; three floors of windows above.
    if (i % 2 === 1) { mark(s, bx + i, south, P + 1, M.opening, 104); mark(s, bx + i, south, P + 2, M.opening, 112); }
    mark(s, bx + i, south, P + 4, M.stoneDark, 118);
    if (i % 2 === 1) for (const z of [6, 9, 12]) mark(s, bx + i, south, P + z, M.opening);
    mark(s, bx + i, south, wall, M.stoneDark, 110);
  }
  // The middle bay: the door, and a gable over the cornice with a round window.
  const mid = bx + (bw >> 1);
  for (let i = -1; i <= 1; i++) put(s, mid + i, south, wall + (i === 0 ? 3 : 1.5), M.whitewash, T_WALL);
  mark(s, mid, south, wall + 1, M.opening);
  for (let z = 1; z <= 3; z++) mark(s, mid, south, P + z, M.timber, 92);
  // Awnings over the terrace doors, striped.
  for (let i = 1; i < bw - 1; i++) if (Math.abs(bx + i - mid) > 1) mark(s, bx + i, south, P + 3, i % 2 === 0 ? M.brick : M.sailcloth, 150);

  // The pavilions: a square tower at either end, a floor higher, each under a steep lead roof with a finial.
  for (const px of [8, 29]) {
    const tip = tower(s, px, 6, 5, 8, wall + 3, 6, M.whitewash, M.roofLead, false);
    for (const x of [px + 1, px + 3]) for (const z of [2, 6, 9, 12, 15]) mark(s, x, 13, P + z, M.opening);
    for (let x = px; x < px + 5; x++) { mark(s, x, 13, P + 4, M.stoneDark, 118); mark(s, x, 13, wall + 3, M.stoneDark, 110); }
    finial(s, px + 2, 9, Math.floor(tip + 0.5));
  }

  // Steps from the terrace down the rock to the landing stage.
  for (let y = 18; y <= 23; y++) {
    const z = P - (P - 1.4) * ((y - 17) / 6);
    put(s, 20, y, z, M.stone, y % 2 === 0 ? 160 : 140);
    put(s, 21, y, z, M.stone, y % 2 === 0 ? 160 : 140);
  }
  // The landing stage and the pontoon: planks on piles, then a float lying across the stage's end.
  for (let y = 24; y <= 29; y++) for (let x = 20; x <= 21; x++) put(s, x, y, 1.4, M.timber, 140);
  for (let y = 25; y <= 29; y += 2) { put(s, 19, y, 2, M.timber, 90); put(s, 22, y, 2, M.timber, 90); }
  const [fx, fy] = HOTEL_PONTOON;
  for (let y = fy - 2; y <= fy + 1; y++) for (let x = fx - 8; x <= fx + 7; x++) {
    put(s, x, y, 0.9, y === fy + 1 ? M.timber : M.plaster, y === fy + 1 ? 96 : (x + y) % 2 === 0 ? 150 : 138);
  }
  // Mooring posts at its corners, and a windsock on a mast at its east end.
  for (const x of [fx - 8, fx + 7]) for (const y of [fy - 2, fy + 1]) put(s, x, y, 1.9, M.stoneDark, 96);
  for (let z = 1; z <= 6; z++) mark(s, fx + 6, fy - 1, z, M.timber, 90);
  mark(s, fx + 5, fy - 1, 6, M.brick, 160);
  mark(s, fx + 4, fy - 1, 6, M.sailcloth, 160);
  mark(s, fx + 3, fy - 1, 5, M.brick, 160);
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
 * The marsh house (34 × 24, 19 tall). Base: the rise. A tall, narrow house of weathered limewash under a steep
 * slate roof, every window shuttered but one; a cart shed against its east side, a broken garden wall round
 * the top of the rise, and three wind-bent alders. The causeway leaves along (ux, uy), due south unless
 * given; the wall is open where it leaves, and a path runs to the gate from the door.
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

  // The house: three floors and a garret, the gable to the camera.
  const hx = 12, hy = 6, hw = 9, hd = 8, wall = 10, south = hy + hd - 1;
  house(s, hx, hy, hw, hd, wall, 5.5, { gable: 1, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (const [cx, cy] of [[hx + 1, hy + 2], [hx + hw - 2, hy + 4]] as const) put(s, cx, cy, s.top[cy * W + cx] + 3.5, M.stoneDark, T_WALL);
  // Shutters: closed boards where the windows are. One on the top floor stands open.
  const open = marshLamp(seed);
  for (const z of [2, 5, 8]) for (const x of [hx + 2, hx + 6]) {
    const lit = z === 8 && x === open;
    mark(s, x, south, z, lit ? M.opening : M.timber, lit ? 100 : 104);
    mark(s, x, south, z + 1, lit ? M.opening : M.timber, 112);
    if (lit) mark(s, x + (x === hx + 2 ? -1 : 1), south, z, M.timber, 100);
  }
  mark(s, hx + 4, south, 12, M.timber, 104);
  for (let z = 1; z <= 3; z++) mark(s, hx + 4, south, z, M.timber, 88);
  mark(s, hx + 4, south, 4, M.stoneDark, 112);
  // Damp has stained the foot of the wall.
  for (let x = hx; x < hx + hw; x++) if (x !== hx + 4) mark(s, x, south, 1, M.stoneDark, 132);

  // The cart shed: boards under slate, open to the south.
  house(s, hx + hw, 9, 6, 6, 4, 2, { gable: 0, wallMat: M.timber, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let x = hx + hw + 1; x <= hx + hw + 4; x++) { mark(s, x, 14, 1, M.opening, 100); mark(s, x, 14, 2, M.opening, 108); }

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
 * The airship mast (42 × 18, 46 tall). Base: the pad. A tapering tower of riveted iron lattice on four stone
 * feet, a gallery a third of the way up and another under the head, a cabin for the mooring gear, and the
 * mooring cone on its spindle, banded so a pilot sees it; beside it the winch house, two gas holders, the
 * anchor blocks of the yaw lines and a windsock.
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

  const iron = M.stoneDark, p = picture(21, MAST_TALL), c = 10;
  const half = (z: number): number => (z >= 32 ? 1.5 : 5.6 - 4.1 * (z / 32));
  // The far face of the tower, seen through the near one: paler, and a little narrower.
  for (let z = 2; z <= 32; z++) { dot(p, c - half(z) + 1.2, z, iron, 124); dot(p, c + half(z) - 1.2, z, iron, 116); }
  // Bracing: a cross in every panel, each panel as tall as it is wide.
  const girders: number[] = [1];
  for (let z = 1; z < 31;) { z += Math.max(3, Math.floor(2 * half(z))); girders.push(Math.min(z, 32)); }
  for (let k = 0; k + 1 < girders.length; k++) {
    const z0 = girders[k], z1 = girders[k + 1];
    stroke(p, c - half(z0), z0, c + half(z1), z1, 1, iron, 104);
    stroke(p, c + half(z0), z0, c - half(z1), z1, 1, iron, 96);
    stroke(p, c - half(z1), z1, c + half(z1), z1, 1, iron, 84);
  }
  // The legs, and the gas and water mains up the middle.
  for (let z = 1; z <= 34; z++) {
    dot(p, c - half(z), z, iron, 100);
    dot(p, c + half(z), z, iron, 78);
    if (z < 32) dot(p, c, z, iron, z % 4 === 0 ? 84 : 112);
  }
  // The lower gallery, and the upper one with the cabin on it.
  for (let x = -5; x <= 5; x++) { dot(p, c + x, 13, iron, 80); if (x % 2 !== 0 || Math.abs(x) === 5) dot(p, c + x, 14, iron, 104); }
  for (let x = -5; x <= 5; x++) { dot(p, c + x, 32, iron, 76); if (Math.abs(x) >= 3) dot(p, c + x, 33, iron, x % 2 !== 0 ? 104 : 90); }
  for (let x = -2; x <= 2; x++) {
    for (let z = 33; z <= 35; z++) dot(p, c + x, z, M.roofLead, x < 0 ? 150 : 124);
    dot(p, c + x, 36, M.roofLead, 170);
  }
  dot(p, c - 1, 34, M.lantern, 180);
  dot(p, c + 1, 34, M.opening, 100);
  // The spindle and the mooring cone: banded red and white, a lamp at the tip.
  for (let z = 37; z <= 40; z++) dot(p, c, z, iron, 90);
  for (let z = 41; z <= 44; z++) {
    const band = z % 2 === 1 ? M.brick : M.sailcloth, hw = z >= 44 ? 0 : 1;
    for (let x = -hw; x <= hw; x++) dot(p, c + x, z, band, x < 0 ? 168 : x > 0 ? 130 : 150);
  }
  dot(p, c - 2, 41, iron, 90);
  dot(p, c + 2, 41, iron, 90);
  dot(p, c, 45, iron, 90);
  dot(p, c, 46, M.lantern, 190);
  hang(s, p, fx - c, fy);

  // The winch house: a stone shed under lead with wide doors, and a chimney for the donkey engine.
  house(s, 25, 5, 9, 6, 4.5, 2.5, { gable: 0, wallMat: M.stone, roofMat: M.roofLead, openings: 0, chimney: true });
  for (let x = 27; x <= 29; x++) for (let z = 1; z <= 3; z++) mark(s, x, 10, z, z === 3 ? M.stoneDark : M.timber, z === 3 ? 108 : x === 28 ? 84 : 100);
  mark(s, 32, 10, 2, M.opening);
  mark(s, 32, 10, 3, M.opening);
  // The cable from the winch to the foot of the mast, on the ground.
  for (let x = fx + 1; x <= 24; x++) put(s, x, fy + 1, 0.4, M.stoneDark, x % 2 === 0 ? 96 : 120);
  // Two gas holders west of the mast.
  for (const [gx, gy] of [[3.5, 7.5], [6, 11]] as const) {
    for (let y = Math.floor(gy - 1.6); y <= Math.ceil(gy + 1.6); y++) for (let x = Math.floor(gx - 1.6); x <= Math.ceil(gx + 1.6); x++) {
      const dx = x - gx, dy = y - gy;
      if (dx * dx + dy * dy <= 1.6 * 1.6 + 0.3) put(s, x, y, 3.2, M.roofLead, clampTone(140 - 30 * dx));
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
 * its middle: a gatehouse at the west bridgehead, a row of tall narrow houses and shops down each side of the
 * street, and in the middle, where the south row parts, a small square before the bridge chapel. Its ends are
 * bare deck between parapets, so its arches show; a wayside cross stands at the east end. `wet` is the river's width: the arches over it
 * stand in water, the others on the banks.
 */
export function bridgeTown(len: number, wet: number, deck: number, seed: number): Structure {
  const W = len + 2 * BRIDGE_END, s = sculpt(W, BRIDGE_H);
  const rnd = (k: number): number => (hash2(k, seed, 0xb41d) & 1023) / 1024;
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

  // The houses: the north row first, a floor taller, so its roofs stand over the south row's.
  const walls = [M.plaster, M.whitewash, M.plaster, M.stone], roofs = [M.roofTile, M.roofTile, M.roofSlate];
  const square: readonly [number, number] = [mid - 4, mid + 4];
  const from = x0 + 5 + BRIDGE_BARE_WEST, to = x1 - BRIDGE_BARE;
  const row = (y: number, d: number, tall: number, salt: number, gap: boolean): void => {
    let x = from, k = 0;
    while (x <= to - 2) {
      k++;
      let w = 4 + Math.floor(rnd(salt + k) * 3);
      if (x + w > to || to - (x + w) < 3) w = to - x;
      if (gap && x + w > square[0] && x <= square[1]) {
        if (x < square[0] - 2) w = square[0] - x;
        else { x = square[1] + 1; continue; }
      }
      const wall = deck + tall + Math.floor(rnd(salt + 40 + k) * 3), gable = rnd(salt + 80 + k) < 0.45 ? 1 : 0;
      const wallMat = walls[Math.floor(rnd(salt + 120 + k) * walls.length)], roofMat = roofs[Math.floor(rnd(salt + 160 + k) * roofs.length)];
      house(s, x, y, w, d, wall, gable === 1 ? 1.2 + w * 0.45 : 2.2, { gable, wallMat, roofMat, openings: 0, chimney: false });
      const face = y + d - 1;
      if (rnd(salt + 200 + k) < 0.6) put(s, x + w - 1, y, s.top[y * W + x + w - 1] + 2, M.stoneDark, T_WALL);
      // Shop below, a floor or two of windows over it; a party wall's shade down the east edge.
      for (let i = 0; i < w - 1; i++) {
        const shop = i % 2 === 0;
        mark(s, x + i, face, deck + 1, shop ? M.opening : M.timber, shop ? 100 : 96);
        mark(s, x + i, face, deck + 2, shop ? M.opening : wallMat, shop ? 110 : T_WALL);
        mark(s, x + i, face, deck + 3, k % 3 === 0 ? (i % 2 === 0 ? M.brick : M.sailcloth) : M.timber, k % 3 === 0 ? 150 : 100);
        if (i % 2 === (w > 4 ? 1 : 0)) for (let z = deck + 5; z <= wall - 1; z += 3) mark(s, x + i, face, z, M.opening);
      }
      for (let z = deck + 1; z <= wall; z++) mark(s, x + w - 1, face, z, M.stoneDark, 120);
      if (gable === 1) mark(s, x + ((w - 1) >> 1), face, wall + 1, M.opening);
      x += w;
    }
  };
  row(y0, 3, 6, 0, false);
  row(south - 2, 3, 4, 400, true);

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
 * The great oak (43 × 13, 47 tall). Base: the ground at its foot. One tree: a buttressed trunk, five great
 * boughs, and a crown in separate masses of leaf with the sky between them; a treehouse on the lowest bough
 * to the west with a ladder to it, and a swing from the bough to the east.
 */
export function greatOak(seed: number): Structure {
  const W = OAK_W, s = sculpt(W, OAK_H);
  const [cx, row] = OAK_TRUNK;
  const p = picture(W, OAK_TALL);
  // The boughs first: the leaves go over them and leave lengths of them bare.
  const bark = M.timber;
  stroke(p, cx - 2, 15, 9, 20, 2, bark, 84, 26);
  stroke(p, 9, 20, 3, 24, 1, bark, 90);
  stroke(p, cx + 2, 15, 35, 20, 2, bark, 78, 22);
  stroke(p, 35, 20, 39, 24, 1, bark, 84);
  stroke(p, cx - 1, 16, 13, 31, 2, bark, 88, 20);
  stroke(p, cx + 1, 16, 29, 32, 2, bark, 76, 20);
  stroke(p, cx - 0.5, 16, cx - 0.5, 36, 1, bark, 96);
  stroke(p, cx + 0.5, 16, cx + 0.5, 36, 1, bark, 76);
  stroke(p, 15, 27, 9, 30, 1, bark, 84);
  stroke(p, 27, 28, 33, 30, 1, bark, 78);
  // The crown: masses of leaf, the far ones first. Each is lit from the north-west and dark along its
  // underside, which is what parts one from the next.
  const masses: readonly (readonly [number, number, number])[] = [
    [21, 39, 7.6], [12.5, 36, 6.2], [29.5, 37, 6.2], [7.5, 29.5, 5.8], [34.5, 30.5, 5.8],
    [21, 30.5, 6], [3.8, 24.5, 3.4], [38.6, 25.5, 3.4], [14.5, 25.5, 4], [28, 26.5, 4],
  ];
  masses.forEach(([mx, mz, r], k) => {
    for (let z = Math.floor(mz - r - 1); z <= Math.ceil(mz + r + 1); z++) for (let x = Math.floor(mx - r - 1); x <= Math.ceil(mx + r + 1); x++) {
      const dx = x - mx, dz = (z - mz) * 1.12, d = Math.sqrt(dx * dx + dz * dz);
      const ragged = r + ((hash2(Math.floor(turn(dx, dz) * 4), k, seed) & 3) - 1.5) * 0.42;
      if (d > ragged) continue;
      const l = (-0.55 * dx + 0.83 * dz) / r;
      const grain = ((hash2(x, z, seed ^ 0x0a6) & 7) - 3.5) * 3.2;
      const under = d > ragged - 1.2 && l < -0.3;
      dot(p, x, z, l > 0.38 ? M.broadleafWarm : l < -0.28 ? M.broadleafCool : M.broadleafMid, 130 + 46 * l + grain - (under ? 26 : 0));
    }
  });
  // The trunk: wide at the root, lit from the west, its bark in long streaks. Its flare falls off by the same
  // share at every step up (e to the −1/2.4).
  let flare = 3.2;
  for (let z = 1; z <= 17; z++, flare *= 0.6592) {
    const hw = 2.3 + flare + (z > 13 ? (z - 13) * 0.45 : 0);
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
      dot(p, x, z, bark, 122 - 40 * ((x - cx) / hw) + ((hash2(x, z >> 2, seed ^ 0x7b) & 3) - 1.5) * 7);
    }
  }
  dot(p, cx + 1, 9, M.opening, 96);
  dot(p, cx + 1, 10, M.opening, 104);

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
    return m === M.broadleafCool || m === M.broadleafMid || m === M.broadleafWarm;
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
  for (let x = cx - 2; x <= cx + 2; x++) put(s, x, row, 10, bark, T_WALL);
  for (const [rx, ry, rt] of [[cx - 5, row, 1], [cx - 4, row, 1.6], [cx - 3, row, 2.4], [cx + 3, row, 2.4], [cx + 4, row, 1.6], [cx + 5, row, 1], [cx - 2, row + 1, 1.2], [cx + 1, row + 1, 1.6], [cx + 3, row + 1, 1]] as const) {
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

/** A round house under a dome with a shutter slit open to the south: the drum's wall is `drum` high, the dome `rise` more. */
function domeHouse(s: Structure, cx: number, cy: number, r: number, drum: number, rise: number, slit: number): void {
  const inner = r - 1.1;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (d2 > inner * inner) { put(s, x, y, drum, M.whitewash, clampTone(132 - 34 * dx / r)); continue; }
    const k = Math.sqrt(1 - d2 / (inner * inner));
    const open = x >= Math.floor(cx) + 1 && x < Math.floor(cx) + 1 + slit && dy > -1.5;
    put(s, x, y, drum + 1 + rise * k - (open ? 0.4 : 0), open ? M.opening : M.roofLead, open ? 92 : clampTone(144 - 48 * dx / r - 24 * dy / r));
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
 * The observatory (46 × 25, 24 tall). Base: its terrace on the summit. A great dome on a white drum, its
 * shutter open and the telescope's mouth in the slit; a slated hall for the astronomers east of it, a
 * small dome for the transit instrument beyond, and a walled terrace with a meridian pillar, a wind gauge
 * and steps down to the path.
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
  const drum = 9.4;
  domeHouse(s, cx, cy, 7.4, drum, 6.2, 2);
  const south = Math.floor(cy + 7.4);
  for (let z = 2; z <= 4; z++) mark(s, cx, south, z, M.timber, 90);
  for (const x of [cx - 4, cx - 2, cx + 3, cx + 5]) { mark(s, x, south - (Math.abs(x - cx) > 3 ? 1 : 0), 7, M.opening); mark(s, x, south - (Math.abs(x - cx) > 3 ? 1 : 0), 3, M.opening); }
  // The telescope, looking out of the slit a little east of south.
  const tz = Math.floor(drum + 7);
  mark(s, cx + 1, cy + 2, tz, M.stoneDark, 84);
  mark(s, cx + 2, cy + 2, tz + 1, M.stoneDark, 96);
  mark(s, cx + 2, cy + 2, tz + 2, M.gilt, 170);
  mark(s, cx + 3, cy + 2, tz + 2, M.gilt, 150);

  // The astronomers' hall.
  house(s, 23, 7, 12, 7, 6.4, 3, { gable: 0, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: true });
  for (let i = 1; i < 12; i += 2) { mark(s, 23 + i, 13, 3, M.opening); mark(s, 23 + i, 13, 4, M.opening, 112); }
  for (let z = 2; z <= 3; z++) mark(s, 30, 13, z, M.timber, 92);
  for (let i = 0; i < 12; i++) mark(s, 23 + i, 13, 6, M.stoneDark, 110);
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
