// The buildings, as small rasters of heights and materials (gen/built.ts
// Structure). The camera looks from the south, so a building shows its south
// wall and its roof. Each builder therefore keeps a wall row along the south
// edge of every volume (its cells carry the wall material, so the pixels drawn
// below them are wall), sets roof planes north of it, and adds windows, doors
// and arches as marks on the wall row.
//
// Local coordinates: x east, y south; row h − 1 is the southmost.

import { hash2 } from "../core/hash.ts";
import { MATERIAL as M } from "../look/materials.ts";
import type { Structure } from "./built.ts";

// Light bytes (128 is flat open ground). The sun stands in the north-west.
/** A south wall: in soft shade. */
export const T_WALL = 122;
/** Roof planes by the way they face. */
export const T_SOUTH = 116;
export const T_NORTH = 168;
export const T_WEST = 178;
export const T_EAST = 98;
export const T_RIDGE = 150;
export const T_FLAT = 144;

export function sculpt(w: number, h: number): Structure {
  const c = w * h;
  return { x: 0, y: 0, w, h, base: 0, top: new Float32Array(c), mat: new Uint8Array(c), tone: new Uint8Array(c), paint: new Uint8Array(c), marks: [] };
}

/** Stands the structure with its raster's centre on (cx, cy) and its base at `base`. */
export function standAt(s: Structure, cx: number, cy: number, base: number): Structure {
  s.x = Math.floor(cx - s.w / 2 + 0.5);
  s.y = Math.floor(cy - s.h / 2 + 0.5);
  s.base = base;
  return s;
}

export function put(s: Structure, x: number, y: number, top: number, mat: number, tone: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = y * s.w + x;
  s.top[i] = top;
  s.mat[i] = mat;
  s.tone[i] = tone;
}

export function paint(s: Structure, x0: number, y0: number, w: number, h: number, mat: number): void {
  for (let y = Math.max(0, y0); y < Math.min(s.h, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(s.w, x0 + w); x++) s.paint[y * s.w + x] = mat;
}

export function mark(s: Structure, x: number, y: number, z: number, mat: number, tone = 128): void {
  s.marks.push(x, y, z, mat, tone);
}

/** A flat-topped block; its south row is wall. */
export function block(s: Structure, x: number, y: number, w: number, d: number, top: number, wall: number, roof: number, tone = T_FLAT): void {
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) put(s, x + i, y + j, top, j === d - 1 ? wall : roof, j === d - 1 ? T_WALL : tone);
}

/** The southmost standing cell of a column, or −1. */
export function faceRow(s: Structure, x: number): number {
  for (let y = s.h - 1; y >= 0; y--) if (s.top[y * s.w + x] > 0) return y;
  return -1;
}

/** The structure with east and west changed over: the same building, its ends the other way round. */
export function mirrored(s: Structure): Structure {
  const o = sculpt(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const a = y * s.w + x, b = y * s.w + (s.w - 1 - x);
    const t = s.tone[a];
    o.top[b] = s.top[a];
    o.mat[b] = s.mat[a];
    o.tone[b] = t === T_WEST ? T_EAST : t === T_EAST ? T_WEST : t;
    o.paint[b] = s.paint[a];
  }
  for (let k = 0; k < s.marks.length; k += 5) o.marks.push(s.w - 1 - s.marks[k], s.marks[k + 1], s.marks[k + 2], s.marks[k + 3], s.marks[k + 4]);
  o.x = s.x; o.y = s.y; o.base = s.base;
  if (s.onGround) o.onGround = true;
  return o;
}

export interface HouseOptions {
  /** 0 the ridge runs east–west (the roof slopes to the camera); 1 north–south (a gable faces the camera). */
  gable: number;
  wallMat: number;
  roofMat: number;
  /** 0 none, 1 a door and small windows, 2 tall lancets (a church). */
  openings: number;
  chimney: boolean;
}

/**
 * A house w wide and d deep with walls `wall` high and a pitched roof `roof` higher at the ridge.
 * Heights are above the structure's base.
 */
export function house(s: Structure, x: number, y: number, w: number, d: number, wall: number, roof: number, o: HouseOptions): void {
  const south = y + d - 1;
  if (o.gable === 0) {
    const rows = d - 1, mid = (rows - 1) / 2;
    for (let i = 0; i < w; i++) put(s, x + i, south, wall, o.wallMat, T_WALL);
    for (let q = 0; q < rows; q++) {
      const lift = roof * (1 - Math.abs(q - mid) / (mid + 1));
      const tone = q < mid - 0.25 ? T_SOUTH : q > mid + 0.25 ? T_NORTH : T_RIDGE;
      for (let i = 0; i < w; i++) put(s, x + i, south - 1 - q, wall + lift, o.roofMat, tone);
    }
  } else {
    const mid = (w - 1) / 2;
    for (let i = 0; i < w; i++) {
      const lift = roof * (1 - Math.abs(i - mid) / (mid + 1));
      const tone = i < mid - 0.25 ? T_WEST : i > mid + 0.25 ? T_EAST : T_RIDGE;
      put(s, x + i, south, wall + lift, o.wallMat, T_WALL);
      for (let j = 0; j < d - 1; j++) put(s, x + i, y + j, wall + lift, o.roofMat, tone);
    }
  }
  if (o.chimney && w >= 5 && d >= 4) {
    const cx = x + w - 2, cy = y + Math.floor((d - 1) / 2);
    put(s, cx, cy, s.top[cy * s.w + cx] + 2, M.stoneDark, T_WALL);
  }
  if (o.openings === 1) {
    const door = x + (w >> 1);
    mark(s, door, south, 1, M.timber, 96);
    if (wall >= 4) mark(s, door, south, 2, M.timber, 96);
    for (const wx of w >= 7 ? [x + 1, x + w - 2] : w >= 5 ? [x + 1, x + w - 2] : [x + w - 1 - (w >> 1) + 1]) {
      if (wx === door) continue;
      mark(s, wx, south, 2, M.opening);
      if (wall >= 6) mark(s, wx, south, wall - 2, M.opening);
    }
    if (wall >= 7 && w >= 5) mark(s, door, south, wall - 2, M.opening);
    if (o.gable === 1 && roof >= 3) mark(s, x + (w >> 1), south, wall + 1, M.opening);
  } else if (o.openings === 2) {
    for (let i = 2; i < w - 1; i += 3) for (let z = 3; z <= wall - 3; z++) mark(s, x + i, south, z, M.opening);
  }
}

/** A square tower with a pyramid roof behind a parapet row, and a cross on its tip. Returns the tip's height. */
export function tower(s: Structure, x: number, y: number, w: number, d: number, shaft: number, spire: number, wallMat: number, roofMat: number, cross: boolean): number {
  const south = y + d - 1;
  for (let i = 0; i < w; i++) put(s, x + i, south, shaft, wallMat, T_WALL);
  const rows = d - 1, cx = (w - 1) / 2, cy = (rows - 1) / 2, half = Math.max(cx, cy) + 0.5;
  let tipX = x, tipY = y, tip = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < w; i++) {
    const ax = Math.abs(i - cx), ay = Math.abs(j - cy);
    const lift = spire * (1 - Math.max(ax, ay) / half);
    // The face a cell lies on: the one whose edge it is nearest.
    const tone = ax >= ay ? (i < cx ? T_WEST : T_EAST) : j > cy ? T_SOUTH : T_NORTH;
    put(s, x + i, y + j, shaft + lift, roofMat, ax < 0.6 && ay < 0.6 ? T_RIDGE : tone);
    if (shaft + lift > tip) { tip = shaft + lift; tipX = x + i; tipY = y + j; }
  }
  if (cross) {
    const z = Math.floor(tip + 0.5);
    for (let k = 1; k <= 4; k++) mark(s, tipX, tipY, z + k, M.gilt, 150);
    mark(s, tipX - 1, tipY, z + 3, M.gilt, 150);
    mark(s, tipX + 1, tipY, z + 3, M.gilt, 150);
  }
  return tip;
}

/** A round tower: cells within r of (cx, cy), shaded round its girth. */
export function drum(s: Structure, cx: number, cy: number, r: number, top: number, mat: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy > r * r) continue;
    const t = 128 - Math.floor(34 * dx / (r + 0.5));
    put(s, x, y, top, mat, t < 60 ? 60 : t > 200 ? 200 : t);
  }
}

// ---------------------------------------------------------------------------
// The landmarks.

/** The abbey (30 × 24, 35 tall): church with a west tower and a cross, cloister round a garth, guest hall, precinct wall. */
export function abbey(): Structure {
  const s = sculpt(30, 24);
  paint(s, 0, 0, 30, 24, M.road);
  // Precinct wall round the yard, with a gate in the south side.
  for (let x = 0; x < 30; x++) { put(s, x, 0, 2, M.stoneDark, T_WALL); if (x < 13 || x > 16) put(s, x, 23, 2, M.stoneDark, T_WALL); }
  for (let y = 0; y < 24; y++) { put(s, 0, y, 2, M.stoneDark, T_WALL); put(s, 29, y, 2, M.stoneDark, T_WALL); }
  // The church: nave and chancel on one ridge, a lower apse at the east end.
  house(s, 8, 1, 17, 8, 11, 5, { gable: 0, wallMat: M.stone, roofMat: M.roofLead, openings: 2, chimney: false });
  house(s, 25, 2, 3, 6, 7, 3, { gable: 0, wallMat: M.stone, roofMat: M.roofLead, openings: 0, chimney: false });
  // The west tower.
  tower(s, 2, 2, 6, 7, 24, 8, M.stone, M.roofLead, true);
  for (const x of [3, 4, 6]) for (let z = 18; z <= 21; z++) mark(s, x, 8, z, M.opening);
  for (let x = 2; x <= 7; x++) mark(s, x, 8, 16, M.stoneDark, 104);
  mark(s, 5, 8, 11, M.opening);
  mark(s, 5, 8, 12, M.opening);
  for (let z = 1; z <= 3; z++) { mark(s, 4, 8, z, M.timber, 92); mark(s, 5, 8, z, M.timber, 92); }
  // The cloister south of the nave: three ranges round a lawn.
  house(s, 9, 9, 3, 11, 5, 2.5, { gable: 1, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  house(s, 20, 9, 3, 11, 5, 2.5, { gable: 1, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  house(s, 9, 17, 14, 4, 5, 2.5, { gable: 0, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let i = 10; i <= 21; i += 2) for (let z = 1; z <= 3; z++) mark(s, i, 20, z, M.opening);
  paint(s, 12, 9, 8, 8, M.ley);
  // The guest hall by the east wall.
  house(s, 24, 11, 5, 8, 5, 3, { gable: 1, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 1, chimney: true });
  // A barn in the west yard.
  house(s, 2, 14, 6, 5, 4, 3, { gable: 0, wallMat: M.stoneDark, roofMat: M.roofSlate, openings: 1, chimney: false });
  return s;
}

/** The town's bell tower (7 × 7, 38 tall): a square shaft with an open belfry, a clock face and a tiled spire. */
export function bellTower(): Structure {
  const s = sculpt(7, 7);
  tower(s, 1, 0, 5, 6, 27, 7, M.stone, M.roofTile, true);
  // A plinth one cell wider.
  for (let x = 0; x < 7; x++) put(s, x, 6, 3, M.stone, T_WALL);
  // Belfry: two round-headed openings under the cornice.
  for (const x of [2, 4]) for (let z = 21; z <= 24; z++) mark(s, x, 5, z, M.opening);
  for (let x = 1; x <= 5; x++) mark(s, x, 5, 26, M.stoneDark, 100);
  for (let x = 1; x <= 5; x++) mark(s, x, 5, 19, M.stoneDark, 110);
  // The clock.
  for (let z = 13; z <= 15; z++) for (let x = 2; x <= 4; x++) mark(s, x, 5, z, M.dial, 150);
  mark(s, 3, 5, 14, M.opening);
  mark(s, 3, 5, 15, M.opening);
  // Door and slit windows.
  mark(s, 3, 6, 1, M.timber, 92);
  mark(s, 3, 6, 2, M.timber, 92);
  mark(s, 3, 5, 7, M.opening);
  mark(s, 3, 5, 10, M.opening);
  return s;
}

/** A lighthouse (7 × 7, 36 tall): a white tower on a stone plinth with a muted brick band, a lamp room and a dark cap. */
export function lighthouse(): Structure {
  const s = sculpt(7, 7);
  drum(s, 3, 3, 3.2, 2.5, M.stone);
  drum(s, 3, 3, 2.3, 27, M.whitewash);
  drum(s, 3, 3, 1.5, 31, M.lantern);
  put(s, 3, 3, 34, M.roofSlate, T_RIDGE);
  put(s, 3, 2, 33, M.roofSlate, T_NORTH);
  for (let x = 1; x <= 5; x++) {
    // The south face of the shaft in this column.
    let row = -1;
    for (let y = 6; y >= 0; y--) if (s.top[y * 7 + x] >= 27) { row = y; break; }
    if (row < 0) continue;
    const t = 128 - 15 * (x - 3);
    for (let z = 11; z <= 15; z++) mark(s, x, row, z, M.brick, t);
    mark(s, x, row, 26, M.stoneDark, 100);
  }
  // The lamp room's glazing bars and the door.
  mark(s, 3, 4, 29, M.gilt, 170);
  mark(s, 2, 4, 28, M.opening);
  mark(s, 4, 4, 28, M.opening);
  mark(s, 3, 5, 4, M.timber, 92);
  mark(s, 3, 5, 5, M.timber, 92);
  mark(s, 3, 5, 20, M.opening);
  return s;
}

/** The keeper's cottage. */
export function cottage(seed: number): Structure {
  const s = sculpt(6, 5);
  house(s, 0, 0, 6, 5, 4, 3, { gable: 0, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 1, chimney: (seed & 1) === 0 });
  return s;
}

/**
 * A post mill (9 × 9, 21 tall): a dark weatherboarded body with a gabled cap on a pale stone roundhouse, and
 * four white sails set as a pinwheel on its south face, wider than the mill itself.
 */
export function windmill(): Structure {
  const s = sculpt(9, 9);
  drum(s, 4, 3, 3.7, 6, M.stone);
  house(s, 2, 1, 5, 5, 17, 3.5, { gable: 1, wallMat: M.timber, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let x = 2; x <= 6; x++) s.tone[5 * 9 + x] = 100 - 8 * (x - 4);
  for (let z = 1; z <= 3; z++) mark(s, 4, 6, z, M.timber, 80);
  mark(s, 3, 5, 9, M.opening);
  mark(s, 5, 5, 9, M.opening);
  // Sails on the south face: stocks from the hub, a ladder of cloth on the trailing side of each.
  const hub = 15, row = 7;
  const stock: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4]], cloth: [number, number][] = [[1, 2], [1, 3], [1, 4], [2, 2], [2, 3], [2, 4]];
  for (let q = 0; q < 4; q++) {
    // Each sail is the first turned a quarter: (x, z) → (z, −x).
    const turn = (p: [number, number]): [number, number] => { let [x, z] = p; for (let k = 0; k < q; k++) [x, z] = [z, -x]; return [x, z]; };
    for (const p of cloth) { const [x, z] = turn(p); mark(s, 4 + x, row, hub + z, M.sailcloth, (x + z) & 1 ? 190 : 165); }
    for (const p of stock) { const [x, z] = turn(p); mark(s, 4 + x, row, hub + z, M.stoneDark, 150); }
  }
  mark(s, 4, row, hub, M.opening, 100);
  return s;
}

/**
 * A ruined cathedral (34 × 16, 25 tall). No two fell the same way: `kind` picks which parts still stand,
 * the seed which bays, how high, and which end is which.
 *
 * Kind 0: the roofless nave's north wall with its tall empty windows, the south wall down to stubs, a row
 * of piers, and the south transept's gable still standing to its point on one side and broken on the
 * other, its great window and the rose above it open to the sky. The tower is a stump; it lies where it fell.
 *
 * Kind 1: the tower stands almost to its belfry, one corner gone; the transept is down, and the nave's
 * south arcade still carries a run of arches and a scrap of clerestory in front of a gapped north wall.
 */
export function ruinedCathedral(seed: number, kind: number = (seed >>> 3) & 1): Structure {
  const s = sculpt(34, 16);
  const rnd = (k: number): number => (hash2(k, seed, 0x7a1e) & 1023) / 1024;
  if ((kind & 1) === 0) ruinWithTransept(s, rnd);
  else ruinWithTower(s, rnd);
  return rnd(999) < 0.5 ? mirrored(s) : s;
}

/** A bay of the nave's north wall at column x: worn to `top`, with a pointed window; `lean` picks the side its head leans to. */
function naveBay(s: Structure, rnd: (k: number) => number, x: number, top: number, lean: number): void {
  for (let i = 0; i < 4; i++) {
    const t = top - (i === 0 || i === 3 ? 1 + Math.floor(rnd(100 + x + i) * 4) : 0);
    put(s, x + i, 1, t, M.stoneDark, T_FLAT);
    put(s, x + i, 2, t, M.stone, T_WALL);
  }
  for (let z = 3; z <= top - 4; z++) { mark(s, x + 1, 2, z, M.opening); mark(s, x + 2, 2, z, M.opening); }
  if (top >= 7) mark(s, x + 1 + lean, 2, top - 3, M.opening);
}

/** Fallen stone: `count` blocks strewn over the rectangle, lower the further east they lie. */
function rubble(s: Structure, rnd: (k: number) => number, key: number, x0: number, y0: number, w: number, d: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const x = x0 + Math.floor(rnd(key + k) * w), y = y0 + Math.floor(rnd(key + 20 + k) * d);
    if (s.top[y * s.w + x] > 0) continue;
    const t = 1 + rnd(key + 40 + k) * 2.5 * (1 - (x - x0) / (w + 3));
    put(s, x, y, t, k & 1 ? M.stone : M.stoneDark, k & 1 ? T_WALL : T_FLAT);
    if (rnd(key + 60 + k) < 0.6 && x + 1 < s.w && s.top[y * s.w + x + 1] === 0) put(s, x + 1, y, t * 0.8, M.stoneDark, T_WALL);
  }
}

function ruinWithTransept(s: Structure, rnd: (k: number) => number): void {
  // North wall: bays four cells wide, worn to different heights, each with a pointed window.
  for (let bay = 0; bay < 7; bay++) naveBay(s, rnd, 4 + bay * 4, 12 + Math.floor(rnd(bay) * 8), bay & 1);
  // Piers of the arcade, two still joined by their arch.
  for (let k = 0; k < 5; k++) {
    const x = 5 + k * 5, t = k === 1 || k === 2 ? 9 : 4 + Math.floor(rnd(40 + k) * 5);
    for (const dx of [0, 1]) { put(s, x + dx, 7, t, M.stoneDark, T_FLAT); put(s, x + dx, 8, t, M.stone, T_WALL); }
  }
  for (let x = 12; x <= 14; x++) { put(s, x, 7, 9, M.stoneDark, T_FLAT); put(s, x, 8, 9, M.stone, T_WALL); }
  for (let z = 1; z <= 6; z++) for (let x = 12; x <= 14; x++) if (z <= 5 || x === 13) mark(s, x, 8, z, M.opening, 112);
  // South wall: stubs, with gaps.
  for (let x = 4; x < 19; x++) {
    if (x >= 10 && x <= 12) continue;
    const t = rnd(60 + (x >> 1)) < 0.3 ? 0 : 1.5 + Math.floor(rnd(70 + (x >> 1)) * 3.5);
    if (t > 0) { put(s, x, 12, t, M.stoneDark, T_FLAT); put(s, x, 13, t, M.stone, T_WALL); }
  }
  // The south transept's gable: whole on the west, broken down the east.
  for (let i = 0; i < 11; i++) {
    const x = 19 + i;
    const whole = 12 + 13 * (1 - Math.abs(i - 5) / 6);
    const t = i <= 6 ? whole : Math.max(4, whole - 3 - Math.floor(rnd(300 + i) * 5) - (i - 6) * 1.5);
    put(s, x, 14, t, M.stoneDark, T_FLAT);
    put(s, x, 15, t, M.stone, T_WALL);
  }
  // Its great window: three lights under a pointed head, and the rose above.
  for (let z = 3; z <= 13; z++) for (let dx = -2; dx <= 2; dx++) {
    if (dx === -1 && z <= 11) { mark(s, 24 + dx, 15, z, M.opening, 120); continue; }
    if (dx === 1 && z <= 11) { mark(s, 24 + dx, 15, z, M.opening, 120); continue; }
    if (Math.abs(dx) === 2 && z > 10) continue;
    if (Math.abs(dx) === 1 && z > 12) continue;
    if (dx === 0 || Math.abs(dx) === 2 || z > 11) mark(s, 24 + dx, 15, z, M.opening);
  }
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx === 0 || dz === 0) mark(s, 24 + dx, 15, 18 + dz, M.opening);
  // The east end: the chancel's low curve.
  for (let j = 3; j <= 11; j++) { const t = 3 + Math.floor(rnd(90 + j) * 5); put(s, 32, j, t, M.stoneDark, T_FLAT); put(s, 33, j, Math.max(1, t - 2), M.stoneDark, T_FLAT); }
  // The tower's stump at the west end, and the tower lying to the south-west of it.
  for (let j = 3; j <= 8; j++) for (let i = 0; i <= 4; i++) {
    const edge = i === 0 || i === 4 || j === 3 || j === 8;
    if (!edge) continue;
    const t = 8 + Math.floor(rnd(120 + i * 7 + j) * 7);
    put(s, i, j, t, j === 8 ? M.stone : M.stoneDark, j === 8 ? T_WALL : T_FLAT);
  }
  for (const x of [1, 3]) for (let z = 3; z <= 6; z++) mark(s, x, 8, z, M.opening);
  rubble(s, rnd, 150, 0, 10, 12, 6, 14);
}

function ruinWithTower(s: Structure, rnd: (k: number) => number): void {
  // North wall: six bays, one of them fallen to its footings.
  const fallen = 1 + Math.floor(rnd(1) * 4);
  for (let bay = 0; bay < 6; bay++) {
    const x = 8 + bay * 4;
    if (bay === fallen) {
      for (let i = 0; i < 4; i++) if (rnd(20 + i) < 0.7) { const t = 1 + Math.floor(rnd(30 + i) * 2); put(s, x + i, 1, t, M.stoneDark, T_FLAT); put(s, x + i, 2, t, M.stone, T_WALL); }
    } else naveBay(s, rnd, x, 8 + Math.floor(rnd(bay) * 8), bay & 1);
  }
  // The tower at the west end: four walls round a hollow, standing to the belfry; one corner has come down.
  const full = 21 + Math.floor(rnd(2) * 3), gone = rnd(3) < 0.5 ? 0 : 5;
  const wallTop = (i: number, j: number): number => {
    const near = Math.abs(i - gone);
    const drop = near <= 2 ? (3 - near) * 3 : 0;
    return full - drop + Math.floor(rnd(120 + i * 7 + j) * 2);
  };
  for (let j = 3; j <= 8; j++) for (let i = 0; i <= 5; i++) {
    if (i !== 0 && i !== 5 && j !== 3 && j !== 8) continue;
    put(s, 1 + i, j, wallTop(i, j), j === 8 ? M.stone : M.stoneDark, j === 8 ? T_WALL : T_FLAT);
  }
  for (let i = 0; i <= 5; i++) {
    const t = s.top[8 * s.w + 1 + i];
    // A string course, the belfry's paired openings where the wall still reaches them, a slit and the door.
    if (t >= 14) mark(s, 1 + i, 8, 12, M.stoneDark, 104);
    if ((i === 1 || i === 2 || i === 4) && t >= 18) for (let z = 14; z <= Math.min(18, t - 2); z++) mark(s, 1 + i, 8, z, M.opening);
  }
  mark(s, 4, 8, 7, M.opening);
  mark(s, 4, 8, 8, M.opening);
  for (let z = 1; z <= 3; z++) { mark(s, 3, 8, z, M.opening, 112); mark(s, 4, 8, z, M.opening, 112); }
  // The south arcade: piers five cells apart; the first two or three still carry their arches.
  const joined = 2 + Math.floor(rnd(4) * 2);
  for (let k = 0; k < 5; k++) {
    const x = 9 + k * 5, t = k <= joined ? 10 : 2 + Math.floor(rnd(40 + k) * 4);
    for (const dx of [0, 1]) { put(s, x + dx, 11, t, M.stoneDark, T_FLAT); put(s, x + dx, 12, t, M.stone, T_WALL); }
  }
  for (let g = 0; g < joined; g++) {
    for (let x = 11 + 5 * g; x <= 13 + 5 * g; x++) {
      put(s, x, 11, 10, M.stoneDark, T_FLAT);
      put(s, x, 12, 10, M.stone, T_WALL);
      for (let z = 1; z <= (x === 12 + 5 * g ? 8 : 7); z++) mark(s, x, 12, z, M.opening, 112);
    }
  }
  // A scrap of clerestory over the first arch, its window a hole in the sky.
  const scrap = 13 + Math.floor(rnd(5) * 3);
  for (let x = 9; x <= 14; x++) {
    const t = scrap - (x >= 13 ? (x - 12) * 1.5 : 0) - Math.floor(rnd(50 + x) * 2);
    put(s, x, 11, t, M.stoneDark, T_FLAT);
    put(s, x, 12, t, M.stone, T_WALL);
  }
  mark(s, 11, 12, scrap - 2, M.opening);
  mark(s, 11, 12, scrap - 3, M.opening);
  // The east end: the chancel's low curve, and what fell from the transept.
  for (let j = 3; j <= 12; j++) { const t = 2 + Math.floor(rnd(90 + j) * 6); put(s, 32, j, t, M.stoneDark, T_FLAT); put(s, 33, j, Math.max(1, t - 2), M.stoneDark, T_FLAT); }
  for (let x = 24; x <= 30; x++) if (rnd(70 + x) < 0.6) { const t = 1.5 + Math.floor(rnd(80 + x) * 3); put(s, x, 14, t, M.stoneDark, T_FLAT); put(s, x, 15, t, M.stone, T_WALL); }
  rubble(s, rnd, 150, 14, 13, 12, 3, 9);
  rubble(s, rnd, 250, 9, 4, 20, 6, 7);
}

/**
 * The churchyard yew (28 × 22): a wall with a gate, a great dark yew (13 × 13, 15 tall) and a small chapel
 * (within 10 × 9, 12 tall) with a bellcote and a cross, a few headstones and the worn way from the gate to
 * the door. `kind` 0 is an oval yard, a single-domed yew and a chapel side-on to the camera; kind 1 a
 * squarer yard, a broad twin-stemmed yew and a chapel gable-on. The seed picks which side the yew stands.
 */
export function churchyard(seed: number, kind: number = (seed >>> 2) & 1): Structure {
  const s = sculpt(28, 22);
  const rnd = (k: number): number => (hash2(k, seed, 0xc4a9) & 1023) / 1024;
  const cx = 13.5, cy = 10.5, rx = 13, ry = 10;
  const square = (kind & 1) === 1;
  const inside = (x: number, y: number): boolean => {
    const u = ((x - cx) * (x - cx)) / (rx * rx), v = ((y - cy) * (y - cy)) / (ry * ry);
    return square ? u * u + v * v <= 1 : u + v <= 1;
  };
  const gate = square ? 11 : 17;
  for (let y = 0; y < 22; y++) for (let x = 0; x < 28; x++) {
    if (!inside(x, y)) continue;
    // The wall is the outermost ring of cells; the gate is in its south side.
    const ring = !inside(x + (x < cx ? -1 : 1), y) || !inside(x, y + (y < cy ? -1 : 1));
    if (ring && !(y > cy + 6 && x >= gate - 1 && x <= gate + 1)) put(s, x, y, 1.6, M.stoneDark, T_WALL);
    else s.paint[y * 28 + x] = M.hay;
  }
  // The yew: domes and lobes, so its outline is lumpy. Tops vary with the seed; the spread is fixed at 13.
  const lobes: [number, number, number, number][] = square
    ? [[7.2, 10.5, 4.6, 12.5 + rnd(1) * 1.5], [10.6, 11, 4.4, 14 + rnd(2) * 2], [8.5, 7.8, 3, 9.5 + rnd(3) * 2], [9, 14, 3, 9 + rnd(4) * 2]]
    : [[8.5, 10.5, 6, 13.5 + rnd(1) * 3], [6, 12.2, 3.4, 9 + rnd(2) * 2.5], [11.2, 8, 3.6, 10.5 + rnd(3) * 3], [10.5, 13.5, 3.2, 9.5 + rnd(4) * 2.5]];
  for (const [lx, ly, r, top] of lobes) {
    for (let y = Math.floor(ly - r); y <= Math.ceil(ly + r); y++) for (let x = Math.floor(lx - r); x <= Math.ceil(lx + r); x++) {
      const d2 = (x - lx) * (x - lx) + (y - ly) * (y - ly);
      if (d2 > r * r || x < 0 || y < 0 || x >= 28 || y >= 22) continue;
      const t = top * (0.4 + 0.6 * Math.sqrt(1 - d2 / (r * r))) + ((hash2(x, y, seed) & 3) - 1.5) * 0.35;
      if (t > s.top[y * 28 + x]) put(s, x, y, t, M.yew, 0);
    }
  }
  let doorX: number, doorY: number;
  if (!square) {
    // The chapel east of the tree, side-on: a bellcote on one end of its ridge, with a cross.
    house(s, 16, 6, 9, 6, 5, 4, { gable: 0, wallMat: M.stoneDark, roofMat: M.roofSlate, openings: 2, chimney: false });
    doorX = 20; doorY = 11;
    const bx = rnd(5) < 0.5 ? 16 : 24;
    put(s, bx, 8, 11, M.stoneDark, T_WALL);
    mark(s, bx, 8, 9, M.opening);
    for (let k = 1; k <= 3; k++) mark(s, bx, 8, 11 + k, M.gilt, 150);
    mark(s, bx - 1, 8, 13, M.gilt, 150);
    mark(s, bx + 1, 8, 13, M.gilt, 150);
  } else {
    // The chapel gable-on: the door under a lancet, the bellcote on the gable's point.
    house(s, 17, 4, 6, 9, 6, 4, { gable: 1, wallMat: M.stone, roofMat: M.roofSlate, openings: 0, chimney: false });
    doorX = 19; doorY = 12;
    for (let z = 5; z <= 7; z++) mark(s, 20, 12, z, M.opening);
    for (const x of [19, 20]) put(s, x, 12, 11.5, M.stone, T_WALL);
    mark(s, 19, 12, 10, M.opening);
    mark(s, 20, 12, 10, M.opening);
    for (let k = 1; k <= 3; k++) mark(s, 19, 12, 12 + k, M.gilt, 150);
    mark(s, 18, 12, 14, M.gilt, 150);
    mark(s, 20, 12, 14, M.gilt, 150);
  }
  mark(s, doorX, doorY, 1, M.timber, 92);
  mark(s, doorX, doorY, 2, M.timber, 92);
  // The way in: from the gate up the yard, then along to the door.
  for (let y = doorY + 2; y <= 21; y++) if (s.top[y * 28 + gate] === 0 && inside(gate, y)) s.paint[y * 28 + gate] = M.path;
  for (let x = Math.min(gate, doorX); x <= Math.max(gate, doorX); x++) if (s.top[(doorY + 2) * 28 + x] === 0) s.paint[(doorY + 2) * 28 + x] = M.path;
  if (s.top[(doorY + 1) * 28 + doorX] === 0) s.paint[(doorY + 1) * 28 + doorX] = M.path;
  // Headstones in the grass.
  for (let k = 0; k < 9; k++) {
    const x = 3 + Math.floor(rnd(30 + k) * 22), y = 13 + Math.floor(rnd(50 + k) * 6);
    const i = y * 28 + x;
    if (s.top[i] > 0 || s.paint[i] !== M.hay || s.top[i - 28] > 0 || s.top[i + 28] > 0 || s.top[i - 1] > 0 || s.top[i + 1] > 0) continue;
    put(s, x, y, 1.3, M.stone, T_WALL);
  }
  return rnd(999) < 0.5 ? mirrored(s) : s;
}

/** The southmost cell painted as path in a structure's raster (a gate, a door's step): local x, y, or null. */
export function gateOf(s: Structure): [number, number] | null {
  for (let y = s.h - 1; y >= 0; y--) for (let x = 0; x < s.w; x++) if (s.paint[y * s.w + x] === M.path) return [x, y];
  return null;
}

/**
 * The town's church (15 × 8, 16 tall): a nave under tile with lancets and a door, a lower chancel to the
 * east, a cross on the west end of the ridge. It stands on the square by the bell tower.
 */
export function parishChurch(): Structure {
  const s = sculpt(15, 8);
  house(s, 0, 0, 11, 8, 8, 5, { gable: 0, wallMat: M.stone, roofMat: M.roofTile, openings: 2, chimney: false });
  house(s, 11, 1, 4, 6, 6, 3, { gable: 0, wallMat: M.stone, roofMat: M.roofTile, openings: 0, chimney: false });
  for (let z = 1; z <= 2; z++) mark(s, 2, 7, z, M.timber, 92);
  mark(s, 12, 6, 3, M.opening);
  mark(s, 12, 6, 4, M.opening);
  for (let k = 1; k <= 3; k++) mark(s, 1, 3, 13 + k, M.gilt, 150);
  mark(s, 0, 3, 15, M.gilt, 150);
  mark(s, 2, 3, 15, M.gilt, 150);
  return s;
}

// ---------------------------------------------------------------------------
// What stands on a free site.

/** A wayside cross on three steps (5 × 5, 9 tall). */
export function waysideCross(): Structure {
  const s = sculpt(5, 5);
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) put(s, x, y, 1, M.stoneDark, y === 3 ? T_WALL : T_FLAT);
  put(s, 2, 2, 2, M.stone, T_FLAT);
  put(s, 2, 2, 7, M.stone, 140);
  for (let z = 8; z <= 9; z++) mark(s, 2, 2, z, M.stone, 140);
  mark(s, 1, 2, 7, M.stone, 140);
  mark(s, 3, 2, 7, M.stone, 140);
  return s;
}

/** A dry-stone sheepfold (6 × 6): a ring of wall with a gap in its south side. */
export function sheepfold(): Structure {
  const s = sculpt(6, 6);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const edge = x === 0 || y === 0 || x === 5 || y === 5;
    const corner = (x === 0 || x === 5) && (y === 0 || y === 5);
    if (edge && !corner && !(y === 5 && x === 3)) put(s, x, y, 1.6, M.stone, y === 5 ? T_WALL : 150);
    else if (!edge) s.paint[y * 6 + x] = M.ley;
  }
  return s;
}

/** A plank jetty `len` cells long running south from its north end: base at the water, 1.2 above it. */
export function jetty(len: number): Structure {
  const s = sculpt(4, len);
  for (let y = 0; y < len; y++) for (let x = 1; x <= 2; x++) put(s, x, y, 1.2, M.timber, y === len - 1 ? T_WALL : 140);
  for (let y = 2; y < len; y += 3) { put(s, 0, y, 1.8, M.timber, 90); put(s, 3, y, 1.8, M.timber, 90); }
  return s;
}

/** A small boat at its mooring (4 × 3): a hull and, on some, a furled mast. */
export function boat(seed: number): Structure {
  const s = sculpt(5, 3);
  const hull = (seed & 3) === 0 ? M.whitewash : M.timber;
  for (let x = 0; x < 5; x++) put(s, x, 1, x === 0 || x === 4 ? 0.7 : 1, hull, x === 0 || x === 4 ? 100 : 135);
  for (let x = 1; x < 4; x++) put(s, x, 2, 0.8, hull, T_WALL);
  if ((seed & 4) !== 0) for (let z = 2; z <= 5; z++) mark(s, 2, 1, z, M.timber, 90);
  return s;
}

/** A house of the countryside: sizes, ridge and materials from a hash of where it stands. */
export function countryHouse(seed: number, slate: boolean): Structure {
  const w = 5 + (seed & 3), d = 4 + ((seed >>> 2) & 1) + ((seed >>> 3) & 1);
  const gable = ((seed >>> 4) & 3) === 0 ? 1 : 0;
  const s = sculpt(gable ? Math.min(w, 6) : w, d);
  const wallMat = slate ? (((seed >>> 6) & 3) === 0 ? M.whitewash : M.stoneDark) : ((seed >>> 6) & 3) === 0 ? M.stone : M.whitewash;
  house(s, 0, 0, s.w, d, 3 + ((seed >>> 8) & 1), 3, { gable, wallMat, roofMat: slate ? M.roofSlate : ((seed >>> 9) & 3) === 0 ? M.roofSlate : M.roofTile, openings: 1, chimney: ((seed >>> 11) & 1) === 0 });
  return s;
}

/** Lightens or darkens every roof cell of a structure by `by` light units: old tile and new, wet slate and dry. */
function weather(s: Structure, by: number): void {
  for (let i = 0; i < s.top.length; i++) {
    if (s.mat[i] !== M.roofTile && s.mat[i] !== M.roofSlate) continue;
    const t = s.tone[i] + by;
    s.tone[i] = t < 70 ? 70 : t > 200 ? 200 : t;
  }
}

/**
 * A town house. No two streets are alike: a cottage (low, small, often under slate), an ordinary plastered
 * house, a tall narrow one with its gable to the street, or a broad merchant's house with two chimneys.
 * `rank` runs from 0 on the quay and at the middle to about 1.5 at the top and the edges of the town: the
 * lower it is, the likelier the larger kinds. Most roofs are terracotta, new or weathered; about one in five is slate.
 */
export function townHouse(seed: number, rank = 0.7): Structure {
  const pick = ((seed >>> 16) & 255) / 256 + 0.35 * (rank - 0.7);
  const wall = (seed >>> 6) & 7;
  const slate = ((seed >>> 22) & 15) < 3;
  const tint = (((seed >>> 26) & 7) - 3) * 6;
  let s: Structure;
  if (pick > 0.72) {
    // A cottage.
    const w = 5 + (seed % 2), d = 4 + ((seed >>> 3) & 1);
    s = sculpt(w, d);
    house(s, 0, 0, w, d, 3 + ((seed >>> 9) & 1), 2.5, { gable: 0, wallMat: wall < 4 ? M.whitewash : wall < 6 ? M.stone : M.plaster, roofMat: slate || (seed >>> 12) % 3 === 0 ? M.roofSlate : M.roofTile, openings: 1, chimney: ((seed >>> 13) & 1) === 0 });
  } else if (pick > 0.3) {
    // An ordinary house.
    const w = 5 + (seed % 4), d = 5 + ((seed >>> 3) & 1);
    const gable = ((seed >>> 4) & 3) === 0 ? 1 : 0;
    s = sculpt(gable ? Math.min(w, 7) : w, d);
    house(s, 0, 0, s.w, d, 6 + ((seed >>> 9) % 3), 3 + ((seed >>> 12) & 1), { gable, wallMat: wall < 3 ? M.whitewash : wall < 6 ? M.plaster : M.stone, roofMat: slate ? M.roofSlate : M.roofTile, openings: 1, chimney: ((seed >>> 13) & 3) === 0 });
  } else if (pick > 0.12) {
    // Tall and narrow, gable to the street.
    const w = 4 + (seed & 1), d = 5 + ((seed >>> 3) & 1);
    s = sculpt(w, d);
    house(s, 0, 0, w, d, 9 + ((seed >>> 9) % 3), 3, { gable: 1, wallMat: wall < 4 ? M.plaster : M.whitewash, roofMat: slate ? M.roofSlate : M.roofTile, openings: 1, chimney: false });
  } else {
    // A merchant's house: broad, three floors, a chimney at either end.
    const w = 9 + (seed % 3), d = 6;
    s = sculpt(w, d);
    house(s, 0, 0, w, d, 8, 3.5, { gable: 0, wallMat: wall < 5 ? M.plaster : M.stone, roofMat: M.roofTile, openings: 1, chimney: true });
    put(s, 1, 2, s.top[2 * w + 1] + 2, M.stoneDark, T_WALL);
    for (let x = 3; x < w - 2; x += 2) { mark(s, x, d - 1, 4, M.opening); mark(s, x, d - 1, 6, M.opening); }
  }
  weather(s, tint);
  return s;
}

/**
 * The palazzo (15 × 8, 16 tall): the town's great house, on the square. Three floors of plaster over a stone
 * arcade, a string course between them, rows of tall windows, and a hipped tile roof with a little lantern.
 */
export function palazzo(seed: number): Structure {
  const s = sculpt(15, 8), W = 15;
  // The hipped roof: four planes rising from the eaves to a short ridge.
  for (let j = 0; j < 7; j++) for (let i = 0; i < W; i++) {
    const ex = Math.min(i, W - 1 - i), ey = Math.min(j, 6 - j), e = Math.min(ex, ey, 3);
    const tone = e >= 3 ? T_RIDGE : ex <= ey ? (i < W / 2 ? T_WEST : T_EAST) : j > 3 ? T_SOUTH : T_NORTH;
    put(s, i, j, 11 + 1.3 * e, M.roofTile, tone);
  }
  for (let i = 0; i < W; i++) put(s, i, 7, 11, i === 0 || i === W - 1 ? M.stone : M.plaster, T_WALL);
  put(s, 7, 3, 17, M.stone, T_WALL);
  mark(s, 7, 3, 16, M.opening);
  // The south front: an arcade of five arches, a string course, and two floors of windows.
  for (let i = 0; i < W; i++) {
    for (let z = 1; z <= 3; z++) mark(s, i, 7, z, i % 3 === 1 ? M.opening : M.stone, i % 3 === 1 ? (z === 3 ? 118 : 104) : 126);
    mark(s, i, 7, 4, M.stoneDark, 112);
    mark(s, i, 7, 11, M.stoneDark, 108);
    if (i % 2 === 1) { mark(s, i, 7, 6, M.opening); mark(s, i, 7, 7, M.opening); mark(s, i, 7, 9, M.opening); }
  }
  mark(s, 7, 7, 1, M.timber, 92);
  mark(s, 7, 7, 2, M.timber, 92);
  weather(s, ((seed & 3) - 1) * 5);
  return s;
}

/** A quay warehouse (13 × 5, 8 tall): a long stone shed under slate or old tile, with two cart doors and a row of small high windows. */
export function warehouse(seed: number): Structure {
  const s = sculpt(13, 5);
  house(s, 0, 0, 13, 5, 5, 3, { gable: 0, wallMat: (seed & 1) === 0 ? M.stone : M.stoneDark, roofMat: (seed & 6) === 0 ? M.roofTile : M.roofSlate, openings: 0, chimney: false });
  for (const x of [2, 3, 8, 9]) for (let z = 1; z <= 3; z++) mark(s, x, 4, z, M.timber, z === 3 ? 100 : 88);
  for (const x of [0, 5, 6, 11, 12]) mark(s, x, 4, 4, M.opening);
  weather(s, -8);
  return s;
}

// ---------------------------------------------------------------------------
// Staging: what people planted round a landmark.

/** Small round crowns in rows on sown grass: an orchard w × h. `crown` is the trees. material, `step` their spacing. */
export function orchard(w: number, h: number, seed: number, crown: number = M.alder, step = 4): Structure {
  const s = sculpt(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // A ragged edge.
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge >= 1 + (hash2(x >> 1, y >> 1, seed) & 1)) s.paint[y * w + x] = M.ley;
  }
  for (let ty = 2; ty < h - 2; ty += step) for (let tx = 2 + (Math.floor(ty / step) & 1) * 2; tx < w - 2; tx += step) {
    const hsh = hash2(tx, ty, seed);
    if ((hsh & 15) === 0) continue;
    const cx = tx + ((hsh >>> 4) & 1) * 0.5, cy = ty + ((hsh >>> 5) & 1) * 0.5, r = 1.35 + ((hsh >>> 6) & 3) * 0.1;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= r * r) put(s, x, y, 1.2 + 1.8 * Math.sqrt(1 - d2 / (r * r)), crown, 0);
    }
  }
  s.onGround = true;
  return s;
}

/**
 * An olive grove w × h: grey-green crowns, broader and lower than an orchard's, standing where they were
 * planted long ago and not in rows, on dry pale ground with a ragged edge.
 */
export function oliveGrove(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge >= 1 + (hash2(x >> 1, y >> 1, seed) & 1)) s.paint[y * w + x] = M.vine;
  }
  for (let ty = 2; ty < h - 2; ty += 3) for (let tx = 2; tx < w - 2; tx += 4) {
    const hsh = hash2(tx, ty, seed ^ 0x01e5);
    if ((hsh & 7) < 2) continue;
    const cx = tx + ((hsh >>> 4) & 3) * 0.6 + ((ty / 3) & 1) * 1.5, cy = ty + ((hsh >>> 6) & 3) * 0.4, r = 1.5 + ((hsh >>> 8) & 3) * 0.2;
    const mat = ((hsh >>> 10) & 3) === 0 ? M.alder : M.shrub;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r * r || x < 0 || y < 0 || x >= w || y >= h) continue;
      const t = 1 + 1.5 * Math.sqrt(1 - d2 / (r * r));
      if (t > s.top[y * w + x]) put(s, x, y, t, mat, 0);
    }
  }
  s.onGround = true;
  return s;
}

/** A garden plot w × h on the edge of a town: vines in rows, or beds of vegetables between dug paths, as the seed has it. */
export function gardenPlot(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  const vines = (seed & 1) === 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge < (hash2(x >> 1, y >> 1, seed) & 1)) continue;
    s.paint[y * w + x] = vines ? (y % 2 === 0 ? M.vineRow : M.vine) : y % 3 === 2 ? M.ploughRow : (y / 3 & 1) === 0 ? M.ley : M.barley;
  }
  s.onGround = true;
  return s;
}

/** A wood w × h: broadleaf crowns of mixed size, close set, thinning at the edge. */
export function grove(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const hsh = hash2(x, y, seed);
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if ((hsh & 255) > (edge < 3 ? 14 : 34)) continue;
    const r = 1.6 + ((hsh >>> 8) & 7) * 0.2, top = 1.2 * r + 2;
    const mat = M.broadleafCool + ((hsh >>> 12) % 3);
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      const d2 = (xx - x) * (xx - x) + (yy - y) * (yy - y);
      if (d2 > r * r || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const t = top * (0.35 + 0.65 * Math.sqrt(1 - d2 / (r * r)));
      if (t > s.top[yy * w + xx]) put(s, xx, yy, t, mat, 0);
    }
  }
  for (let i = 0; i < w * h; i++) if (s.top[i] === 0) { const x = i % w, y = (i - x) / w; if (Math.min(x, y, w - 1 - x, h - 1 - y) >= 2) s.paint[i] = M.floorBroadleaf; }
  s.onGround = true;
  return s;
}

/** One broadleaf crown of radius r at (x, y), its top measured from the ground under it. */
function crown(s: Structure, x: number, y: number, r: number, mat: number): void {
  const top = 1.2 * r + 2;
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
    const d2 = (xx - x) * (xx - x) + (yy - y) * (yy - y);
    if (d2 > r * r || xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue;
    const t = top * (0.35 + 0.65 * Math.sqrt(1 - d2 / (r * r)));
    if (t > s.top[yy * s.w + xx]) put(s, xx, yy, t, mat, 0);
  }
}

/**
 * What is left round a ruin or a lonely building (w × h, the building's box of bw × bd at its centre):
 * a boundary wall in broken runs with a gap where the way comes in (`gateX`, `gateY`: a unit direction
 * from the centre), a few old trees standing in and outside it, and stones in the grass. It lies on the
 * ground as it finds it.
 */
export function precinct(w: number, h: number, bw: number, bd: number, seed: number, gateX: number, gateY: number): Structure {
  const s = sculpt(w, h);
  const rnd = (k: number): number => (hash2(k, seed, 0x93e1) & 1023) / 1024;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  // The wall: a rounded rectangle a few cells clear of the building, sagging in and out a little.
  const hx = bw / 2 + 5 + rnd(1) * 3, hy = bd / 2 + 4 + rnd(2) * 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
    const wob = ((hash2((x + y) >> 2, (x - y + 64) >> 2, seed) & 3) - 1.5) * 0.5;
    const ox = dx - (hx - 3), oy = dy - (hy - 3);
    const out = (ox > 0 && oy > 0 ? Math.sqrt(ox * ox + oy * oy) : Math.max(ox, oy)) - 3 + wob;
    if (out < -0.5 || out >= 0.5) continue;
    // Runs of eight cells, about half of them fallen; none across the way in.
    const along = dy - (hy - 3) > dx - (hx - 3) ? x : y + 97;
    const run = hash2(along >> 3, (x < cx ? 1 : 0) + (y < cy ? 2 : 0), seed ^ 0x51ab);
    const toGate = (x - cx) * gateX + (y - cy) * gateY, off = Math.abs((x - cx) * gateY - (y - cy) * gateX);
    if ((run & 7) < 3 || (toGate > 0 && off < 3.5)) continue;
    put(s, x, y, (run & 8) !== 0 && (along & 7) < 2 ? 0.8 : 1.5, M.stoneDark, T_WALL);
  }
  // Trees: a few by the wall, more outside it towards the corners, never in the building's box or the way in.
  const count = 7 + Math.floor(rnd(3) * 5);
  for (let k = 0; k < count; k++) {
    const x = 3 + rnd(10 + k) * (w - 6), y = 3 + rnd(40 + k) * (h - 6);
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
    if (dx < bw / 2 + 3 && dy < bd / 2 + 3) continue;
    // Clear of the south front: the camera looks at the building over this ground.
    if (dx < bw / 2 + 1 && y > cy) continue;
    const toGate = (x - cx) * gateX + (y - cy) * gateY, off = Math.abs((x - cx) * gateY - (y - cy) * gateX);
    if (toGate > 0 && off < 5) continue;
    crown(s, x, y, 1.9 + rnd(70 + k) * 1.5, M.broadleafCool + Math.floor(rnd(90 + k) * 3));
  }
  // Stones that rolled clear.
  for (let k = 0; k < 8; k++) {
    const x = Math.floor(cx + (rnd(110 + k) - 0.5) * (bw + 12)), y = Math.floor(cy + bd / 2 + 1 + rnd(130 + k) * 4);
    if (x < 0 || y < 0 || x >= w || y >= h || s.top[y * w + x] > 0) continue;
    put(s, x, y, 0.8 + rnd(150 + k), M.stoneDark, T_WALL);
  }
  s.onGround = true;
  return s;
}

/** A handful of trees (w × h) round an open middle of radius `clear`: the edge of a clearing, or a knoll's company. */
export function copse(w: number, h: number, clear: number, count: number, seed: number): Structure {
  const s = sculpt(w, h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let k = 0; k < count; k++) {
    const hsh = hash2(k, seed, 0x2c0b);
    const x = 3 + ((hsh & 1023) / 1024) * (w - 6), y = 3 + (((hsh >>> 10) & 1023) / 1024) * (h - 6);
    const dx = x - cx, dy = y - cy;
    // Nothing in the middle, and nothing due south of it, where the camera looks in.
    if (dx * dx + dy * dy < clear * clear || (Math.abs(dx) < clear && dy > 0)) continue;
    crown(s, x, y, 1.8 + ((hsh >>> 20) & 7) * 0.2, M.broadleafCool + ((hsh >>> 24) % 3));
  }
  s.onGround = true;
  return s;
}

/** A quarry derrick (5 × 3, 9 tall): a mast, a jib and its stay. */
export function derrick(): Structure {
  const s = sculpt(6, 3);
  put(s, 1, 1, 1, M.timber, T_WALL);
  for (let z = 2; z <= 9; z++) mark(s, 1, 1, z, M.timber, 80);
  for (let k = 1; k <= 4; k++) mark(s, 1 + k, 1, 9 - k, M.timber, 96);
  for (let z = 2; z <= 4; z++) mark(s, 5, 1, z, M.opening, 120);
  mark(s, 5, 1, 1, M.rockSlate, T_WALL);
  return s;
}
