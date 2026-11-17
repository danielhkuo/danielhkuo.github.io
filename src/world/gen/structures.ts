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
 * A ruined cathedral (34 × 16, 25 tall): the roofless nave's north wall with its tall empty windows, the
 * south wall down to stubs, a row of piers, and the south transept's gable still standing to its point on
 * one side and broken on the other, its great window and the rose above it open to the sky. The tower's
 * stump stands at the west end; the tower lies where it fell.
 */
export function ruinedCathedral(seed: number): Structure {
  const s = sculpt(34, 16);
  const rnd = (k: number): number => (hash2(k, seed, 0x7a1e) & 1023) / 1024;
  // North wall: bays four cells wide, worn to different heights, each with a pointed window.
  for (let bay = 0; bay < 7; bay++) {
    const top = 12 + Math.floor(rnd(bay) * 8);
    for (let i = 0; i < 4; i++) {
      const x = 4 + bay * 4 + i;
      const t = top - (i === 0 || i === 3 ? 1 + Math.floor(rnd(100 + x) * 4) : 0);
      put(s, x, 1, t, M.stoneDark, T_FLAT);
      put(s, x, 2, t, M.stone, T_WALL);
    }
    for (let z = 3; z <= top - 4; z++) { mark(s, 5 + bay * 4, 2, z, M.opening); mark(s, 6 + bay * 4, 2, z, M.opening); }
    mark(s, 5 + bay * 4 + (bay & 1), 2, top - 3, M.opening);
  }
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
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rnd(150 + k) * 12), y = 10 + Math.floor(rnd(170 + k) * 6);
    const t = 1 + rnd(190 + k) * 2.5 * (1 - x / 15);
    put(s, x, y, t, k & 1 ? M.stone : M.stoneDark, k & 1 ? T_WALL : T_FLAT);
    if (rnd(210 + k) < 0.6) put(s, x + 1, y, t * 0.8, M.stoneDark, T_WALL);
  }
  return s;
}

/**
 * The churchyard yew (28 × 22): an oval wall with a gate, a great dark yew (13 × 13, 15 tall) and a small
 * chapel (9 × 6, 12 tall) with a bellcote and a cross.
 */
export function churchyard(seed: number): Structure {
  const s = sculpt(28, 22);
  const cx = 13.5, cy = 10.5, rx = 13, ry = 10;
  for (let y = 0; y < 22; y++) for (let x = 0; x < 28; x++) {
    const q = Math.sqrt(((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry));
    if (q > 1.0) continue;
    // The wall is the outermost ring of cells; the gate is in its south side.
    const qx = Math.sqrt(((x + (x < cx ? -1 : 1) - cx) * (x + (x < cx ? -1 : 1) - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry));
    const qy = Math.sqrt(((x - cx) * (x - cx)) / (rx * rx) + ((y + (y < cy ? -1 : 1) - cy) * (y + (y < cy ? -1 : 1) - cy)) / (ry * ry));
    if ((qx > 1 || qy > 1) && !(y > cy + 6 && x >= 16 && x <= 18)) put(s, x, y, 1.6, M.stoneDark, T_WALL);
    else s.paint[y * 28 + x] = M.hay;
  }
  // The yew: one great dome and three lobes, so its outline is lumpy.
  const lobes: [number, number, number, number][] = [[8.5, 10.5, 6, 14], [6, 12.2, 3.4, 10], [11.2, 8, 3.6, 12], [10.5, 13.5, 3.2, 10.5]];
  for (const [lx, ly, r, top] of lobes) {
    for (let y = Math.floor(ly - r); y <= Math.ceil(ly + r); y++) for (let x = Math.floor(lx - r); x <= Math.ceil(lx + r); x++) {
      const d2 = (x - lx) * (x - lx) + (y - ly) * (y - ly);
      if (d2 > r * r || x < 0 || y < 0 || x >= 28 || y >= 22) continue;
      const t = top * (0.4 + 0.6 * Math.sqrt(1 - d2 / (r * r))) + ((hash2(x, y, seed) & 3) - 1.5) * 0.35;
      if (t > s.top[y * 28 + x]) put(s, x, y, t, M.yew, 0);
    }
  }
  // The chapel, east of the tree.
  house(s, 16, 6, 9, 6, 5, 4, { gable: 0, wallMat: M.stoneDark, roofMat: M.roofSlate, openings: 2, chimney: false });
  mark(s, 20, 11, 1, M.timber, 92);
  mark(s, 20, 11, 2, M.timber, 92);
  // Bellcote on the west end of the ridge, with a cross.
  put(s, 16, 8, 11, M.stoneDark, T_WALL);
  mark(s, 16, 8, 9, M.opening);
  for (let k = 1; k <= 3; k++) mark(s, 16, 8, 11 + k, M.gilt, 150);
  mark(s, 15, 8, 13, M.gilt, 150);
  mark(s, 17, 8, 13, M.gilt, 150);
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

/** A town house: tall and narrow, plastered, under terracotta tile. */
export function townHouse(seed: number): Structure {
  const w = 5 + (seed % 4), d = 5 + ((seed >>> 3) & 1);
  const gable = ((seed >>> 4) & 3) === 0 ? 1 : 0;
  const s = sculpt(gable ? Math.min(w, 7) : w, d);
  const pick = (seed >>> 6) & 7;
  const wallMat = pick < 3 ? M.whitewash : pick < 6 ? M.plaster : M.stone;
  house(s, 0, 0, s.w, d, 6 + ((seed >>> 9) % 3), 3 + ((seed >>> 12) & 1), { gable, wallMat, roofMat: M.roofTile, openings: 1, chimney: ((seed >>> 13) & 3) === 0 });
  return s;
}

// ---------------------------------------------------------------------------
// Staging: what people planted round a landmark.

/** Small round crowns in rows on sown grass: an orchard w × h. */
export function orchard(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // A ragged edge.
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge >= 1 + (hash2(x >> 1, y >> 1, seed) & 1)) s.paint[y * w + x] = M.ley;
  }
  for (let ty = 2; ty < h - 2; ty += 4) for (let tx = 2 + ((ty >> 2) & 1) * 2; tx < w - 2; tx += 4) {
    const hsh = hash2(tx, ty, seed);
    if ((hsh & 15) === 0) continue;
    const cx = tx + ((hsh >>> 4) & 1) * 0.5, cy = ty + ((hsh >>> 5) & 1) * 0.5, r = 1.35 + ((hsh >>> 6) & 3) * 0.1;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= r * r) put(s, x, y, 1.2 + 1.8 * Math.sqrt(1 - d2 / (r * r)), M.alder, 0);
    }
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

/** Corn below a mill: a wheat field and a barley field side by side, drilled in rows, a hedge between. */
export function cornFields(w: number, h: number, seed: number): Structure {
  const s = sculpt(w, h);
  const split = Math.floor(w * (0.4 + (seed & 7) / 40));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge < (hash2(x >> 2, y >> 2, seed) & 1)) continue;
    // The boundary leans a little.
    const sx = split + Math.floor((y - h / 2) / 5);
    const row = (y + Math.floor(x / 9)) % 3 === 0;
    s.paint[y * w + x] = x === sx ? M.hedge : x < sx ? (row ? M.wheatRow : M.wheat) : row ? M.barleyRow : M.barley;
  }
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
