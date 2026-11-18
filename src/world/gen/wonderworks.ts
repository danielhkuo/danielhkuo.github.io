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
import { faceRow, house, mark, put, sculpt, T_EAST, T_FLAT, T_NORTH, T_RIDGE, T_SOUTH, T_WALL, T_WEST, tower } from "./structures.ts";

/** Heights above the water of the things that stand in it. */
export const TRACK_DECK = 4.4;
export const HALT_DECK = 5;

function clampTone(t: number): number {
  return t < 60 ? 60 : t > 200 ? 200 : Math.floor(t);
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
