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

/** Heights above the water. The rails sit just over the sleepers; the sleepers are awash. The halt's planks are 2.45. */
export const TRACK_DECK = 0.3;
const SLEEPER = 0.15;
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
export const BATH_ROWS = { court: [0, 17], pools: [[17, 22], [22, 27], [27, 32]], quay: [32, 38] } as const;
export const BATH_W = 52;
export const BATH_H = 38;

/**
 * The thermal baths (52 × 38; nothing stands more than 30 over the court). Base: the sea. On the cliff top a
 * bathhouse in three stacked copper roofs, cream walls banded with red rails and warm windows, and a boiler
 * house with a tall chimney on the bare north-east; below it three copper-roofed storeys on lacquered walls,
 * one small pool, and a brick bridge on the west; at the water a quay, an arched bridge along it, and four
 * landings up the east side to a gate. `top` is the cliff top's height above the sea.
 */
export function thermalBaths(top: number, seed: number): Structure {
  const W = BATH_W, s = sculpt(W, BATH_H);
  const lv = bathLevels(top), L = lv.court;
  // Nine columns on the west are the cliff bridge. The house fills columns 11…41. The way up is columns 43…49.
  const X0 = 10, X1 = 43;

  // The court: paving at the cliff top. The buildings stand on it.
  for (let y = 0; y < 17; y++) for (let x = X0; x <= 49; x++) put(s, x, y, L, M.cobble, T_FLAT);

  // Three roofs, each taller and narrower than the one in front of it, so the south wall of each shows
  // three or four pixels above the copper in front. The crown's ridge is 22 over the court; the boiler chimney stands at 30.
  const front = hall(s, 11, 10, 31, 6, L + 11, 2, M.plaster);
  lacquerFront(s, 11, 41, front, L, 3, 3);
  const middle = hall(s, 16, 5, 20, 5, L + 16, 1.5, M.plaster);
  lacquerFront(s, 16, 35, middle, L + 13, 1, 3);
  const crown = hall(s, 21, 1, 10, 4, L + 20.5, 1.5, M.whitewash);
  lacquerFront(s, 21, 30, crown, L + 17, 1, 3);
  // The door, under a short copper hood, and a gilt ball on the crown's ridge.
  const door = 26;
  for (let z = 1; z <= 4; z++) {
    mark(s, door - 1, front, L + z, M.timber, 96);
    mark(s, door, front, L + z, M.opening, z === 4 ? 150 : 100);
    mark(s, door + 1, front, L + z, M.timber, 96);
  }
  for (let x = door - 2; x <= door + 2; x++) mark(s, x, front, Math.floor(L + 5), M.copper, 160);
  let bx = 26, by = 2, bt = 0;
  for (let y = 1; y <= 4; y++) for (let x = 21; x <= 30; x++) {
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
  stack(13, 12);
  stack(39, 12);
  stack(18, 7);
  stack(33, 7);

  // The boiler house on the bare north-east court, and a chimney three cells wide: lit on the west, dark on the east.
  house(s, 43, 2, 7, 8, L + 6, 1.6, { gable: 0, wallMat: M.brick, roofMat: M.roofSlate, openings: 0, chimney: false });
  const flue = [160, 128, 96];
  for (let y = 4; y <= 6; y++) for (let i = 0; i < 3; i++) put(s, 45 + i, y, L + 30, M.brick, y === 6 ? flue[i] : T_NORTH);

  // A red rail along the court's south edge, open at the door.
  for (let x = X0; x <= X1; x++) if (Math.abs(x - door) > 2) put(s, x, 16, L + 1.3, x % 5 === 0 ? M.stone : M.brick, x % 5 === 0 ? 150 : 118);

  // A brick bridge on the west, its deck at the court, spanning the cut down toward the upper pool.
  for (let y = 12; y <= 15; y++) for (let x = 0; x <= 10; x++) put(s, x, y, L, M.cobble, T_FLAT);
  for (const y of [12, 15]) for (let x = 0; x <= 10; x++) {
    const post = x % 3 === 0;
    put(s, x, y, post ? L + 2.2 : L + 1.2, M.brick, post ? 148 : 168);
  }
  for (let x = 0; x <= 10; x++) {
    if (x === 1 || x === 6) {
      for (let z = Math.floor(lv.pools[0]); z <= Math.floor(L); z++) mark(s, x, 15, z, M.stone, T_WALL);
      continue;
    }
    for (let z = Math.floor(lv.pools[0] + 1); z <= Math.floor(L - 2); z++) mark(s, x, 15, z, M.opening, 104);
  }

  // The terraces are storeys: a copper top, the front row its ridge, and a lacquered wall down to the next.
  // One small pool, on the upper storey.
  const mid = 26;
  for (let k = 0; k < 3; k++) {
    const [y0, y1] = BATH_ROWS.pools[k];
    const level = lv.pools[k], below = k < 2 ? lv.pools[k + 1] : lv.quay;
    const t0 = X0 + 3 * k, t1 = X1 - 3 * k, drop = level - below, front = y1 - 1;
    for (let y = y0; y <= front; y++) for (let x = t0; x <= t1; x++) {
      const tone = k === 0 ? (y === front ? 182 : 162) : y === front ? T_RIDGE : T_SOUTH;
      put(s, x, y, level, M.copper, tone);
    }
    const stories = Math.max(1, Math.floor(drop / 3));
    lacquerFront(s, t0, t1, front, below, stories, 3);
    if (k === 0) {
      for (let y = y0 + 1; y <= y0 + 2; y++) for (let x = mid - 1; x <= mid + 1; x++) {
        if (x > t0 && x < t1 && y < front) put(s, x, y, level - 0.35, M.seaClear, T_FLAT);
      }
    }
    for (const x of [t0, t1]) put(s, x, y0 + 2, level + 2.2, M.yew, 0);
  }
  // A small open bath hall on the upper terrace, west of the pool.
  const bath = hall(s, 12, 18, 7, 4, lv.pools[0] + 4, 1.6, M.plaster);
  for (const x of [13, 15, 17]) {
    mark(s, x, bath, Math.floor(lv.pools[0] + 1), M.opening, 110);
    mark(s, x, bath, Math.floor(lv.pools[0] + 2), M.lantern, 200);
  }

  // The quay, and along its south edge an east–west bridge: a deck, a brick rail on posts, three arches.
  const [qy0, qy1] = BATH_ROWS.quay;
  const deck = lv.quay + 3, by0 = qy1 - 4, face = qy1 - 1, q0 = 13, q1 = 49;
  for (let y = qy0; y < by0; y++) for (let x = 9; x < W; x++) put(s, x, y, lv.quay, M.cobble, T_FLAT);
  for (let y = by0; y < face; y++) for (let x = q0; x <= q1; x++) put(s, x, y, deck, M.cobble, 168);
  for (let x = q0; x <= q1; x++) {
    const post = (x - q0) % 3 === 0;
    put(s, x, face, deck + (post ? 2.3 : 1.15), M.brick, post ? 148 : T_WALL);
  }
  const span = q1 - q0 + 1, bays = 3, bay = span / bays, arch = bay / 2 - 1.2, voussoir = Math.floor(deck);
  for (let x = q0; x <= q1; x++) {
    const along = x + 0.5 - q0, v = along - (Math.floor(along / bay) + 0.5) * bay;
    for (let z = 1; z < voussoir; z++) mark(s, x, face, z, M.stone, T_WALL);
    if (Math.abs(v) >= arch) continue;
    const rise = Math.min(deck - 2, 1 + arch * Math.sqrt(Math.max(0, 1 - (v * v) / (arch * arch))));
    for (let z = 1; z <= rise; z++) mark(s, x, face, z, M.opening, z >= rise - 1 ? 92 : 104);
    if (rise + 1 < voussoir) mark(s, x, face, Math.floor(rise) + 1, M.stoneDark, 132);
  }

  // Steps two rows deep down the east side, from the court to the bridge: a stone tread, a dark riser, brick rails.
  const bx0 = 43, bx1 = 49, yTop = 15, yBot = by0 - 1;
  const steps = Math.floor((yBot - yTop + 1) / 2);
  for (let k = 0; k < steps; k++) {
    const y0 = yTop + 2 * k, y1 = k === steps - 1 ? yBot : y0 + 1;
    const z = L + (deck - L) * (k / Math.max(1, steps - 1));
    for (let y = y0; y <= y1; y++) {
      const tread = y === y0;
      for (let x = bx0 + 1; x < bx1; x++) put(s, x, y, z, M.stone, tread ? 182 : 100);
      put(s, bx0, y, z + 0.6, M.brick, 160);
      put(s, bx1, y, z + 0.6, M.brick, 104);
    }
  }
  const gate = hall(s, 43, 11, 7, 5, L + 5, 2, M.plaster);
  lacquerFront(s, 44, 48, gate, L, 1, 4);
  for (let z = 1; z <= 3; z++) mark(s, 46, gate, L + z, M.opening, 120);
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
 * The track from (ax, ay) to (bx, by), in world cells: two stone rails and a timber sleeper every second cell,
 * the sleepers awash, bowed `bow` cells off the straight at its middle so it is not ruled, with a telegraph
 * pole every ten cells on the north side. Base: the sea. It comes as pieces at most `piece` cells long, each
 * a small raster, so no bake window carries the whole line.
 */
export function tideTrack(ax: number, ay: number, bx: number, by: number, bow: number, piece = 40): Structure[] {
  const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
  const out: Structure[] = [];
  if (len < 4) return out;
  const ux = dx / len, uy = dy / len;
  const off = (a: number): number => trackBow(bow, a / len);
  // Positive lat lies along (−uy, ux). The sign that points north (decreasing y).
  const north = ux >= 0 ? -1 : 1;
  const along = (a: number, lat: number): [number, number] => {
    const o = off(a);
    return [ax + ux * a - uy * o - uy * lat, ay + uy * a + ux * o + ux * lat];
  };
  const count = Math.ceil(len / piece);
  for (let k = 0; k < count; k++) {
    const a0 = (len * k) / count, a1 = (len * (k + 1)) / count;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of [a0, (a0 + a1) / 2, a1]) for (const lat of [-2.6, 0, 2.6]) {
      const [px, py] = along(a, lat);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    const ox = Math.floor(x0) - 2, oy = Math.floor(y0) - 2;
    const s = sculpt(Math.ceil(x1) + 3 - ox, Math.ceil(y1) + 3 - oy);
    s.x = ox;
    s.y = oy;
    s.base = 0;
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const px = ox + i + 0.5 - ax, py = oy + j + 0.5 - ay;
      const a = px * ux + py * uy;
      if (a < a0 - 0.5 || a >= a1 + 0.5 || a < 0 || a > len) continue;
      const lat = -px * uy + py * ux - off(a);
      if (lat < -2 || lat >= 2) continue;
      if (Math.floor(a) % 2 === 0) put(s, i, j, SLEEPER, M.timber, 96);
      if (lat < -1 || lat >= 1) put(s, i, j, TRACK_DECK, M.stone, 190);
    }
    const stepX = Math.abs(ux) >= Math.abs(uy) ? (ux >= 0 ? 1 : -1) : 0;
    const stepY = stepX === 0 ? (uy >= 0 ? 1 : -1) : 0;
    for (let a = Math.ceil(Math.max(a0, 8) / 10) * 10; a < a1 && a <= len - 4; a += 10) {
      const [px, py] = along(a, north * 2.3);
      const i = Math.round(px) - ox, j = Math.round(py) - oy;
      if (i < 1 || j < 0 || i >= s.w - 1 || j >= s.h) continue;
      for (let z = 1; z <= 7; z++) mark(s, i, j, z, M.timber, 92);
      mark(s, i - stepX, j - stepY, 7, M.timber, 108);
      mark(s, i, j, 7, M.timber, 120);
      mark(s, i + stepX, j + stepY, 7, M.timber, 108);
    }
    out.push(s);
  }
  return out;
}

/**
 * The lone halt at the track's end (36 × 11, 13 tall): a plaster platform north of the line, an 8 × 3 slate
 * shelter on it, and two copper cars on the rails. The rails run six cells past the platform. Base: the sea.
 * The track arrives along row `HALT_TRACK_ROW`; `east` is true when it comes in from the west and ends at the
 * east. The last rail is local column 27: the line to the far shore begins just past it. The halt has no poles
 * of its own.
 */
export const HALT_TRACK_ROW = 7;
export const HALT_RAIL_END = 27;
export function tideHalt(east: boolean): Structure {
  const s = sculpt(36, 11), deck = HALT_DECK + 0.6;
  // Rails on rows 5 and 8. Sleepers every second cell across the four rows of the track, awash between the rails.
  for (let x = 0; x <= HALT_RAIL_END; x++) {
    if (x % 2 === 0) for (const y of [5, 6, 7, 8]) put(s, x, y, SLEEPER, M.timber, 96);
    put(s, x, 5, TRACK_DECK, M.stone, 190);
    put(s, x, 8, TRACK_DECK, M.stone, 190);
  }
  // Two cars on rows 6–8. The face is row 8: underframe, windows and a white band, all above the water.
  const carTop = TRACK_DECK + 4;
  const car = (x0: number, x1: number): void => {
    for (let x = x0; x <= x1; x++) {
      put(s, x, 6, carTop, M.copper, T_NORTH);
      put(s, x, 7, carTop, M.copper, T_FLAT);
      put(s, x, 8, carTop, M.copper, 150);
      mark(s, x, 8, 1, M.stoneDark, 90);
      if ((x - x0) % 2 === 0) mark(s, x, 8, 2, M.opening, 100);
      mark(s, x, 8, 3, M.whitewash, 210);
    }
    const pan = x0 + 4;
    mark(s, pan, 8, 5, M.stoneDark, 72);
    mark(s, pan, 8, 6, M.stoneDark, 90);
  };
  car(1, 10);
  car(12, 21);
  for (const y of [6, 7, 8]) put(s, 11, y, TRACK_DECK + 1.2, M.timber, y === 6 ? T_NORTH : 110);
  // The platform, rows 1–3, plaster at 2.45, north of the track.
  for (let y = 1; y <= 3; y++) for (let x = 0; x <= 21; x++) put(s, x, y, deck, M.plaster, (x + y) % 3 === 0 ? 150 : 168);
  for (let x = 0; x <= 21; x++) if (x < 4 || x > 11) mark(s, x, 3, 1, M.timber, 90);
  // The shelter on the platform: 8 × 3, slate, gable to the south.
  house(s, 4, 1, 8, 3, 4, 1.6, { gable: 1, wallMat: M.whitewash, roofMat: M.roofSlate, openings: 0, chimney: false });
  for (let z = 1; z <= 6; z++) mark(s, 16, 3, Math.floor(deck + z), M.timber, 90);
  mark(s, 15, 3, Math.floor(deck + 6), M.timber, 100);
  mark(s, 15, 3, Math.floor(deck + 5), M.lantern, 236);
  lap(s, 0x7a15);
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
 * bell tower stands in the water, its face pale stone with ivy on the west; east of it the nave lies drowned,
 * its walls clean runs of stone with a tree growing out of them and a half-ring apse at the east end, and a
 * churchyard cross or two awash.
 */
export function drownedChurch(seed: number): Structure {
  const s = sculpt(CHURCH_W, CHURCH_H), W = CHURCH_W;
  const rnd = (k: number): number => (hash2(k, seed, 0xd20c) & 1023) / 1024;
  // The north wall stands, with a lancet in every third column. The south wall is stubs. One height for a run, then a gap.
  const runs = (face: number, x0: number, x1: number, key: number): void => {
    let x = x0;
    const north = face === 4;
    while (x <= x1) {
      const n = hash2(x, key, seed);
      const gap = 1 + (n % 3), run = 3 + ((n >>> 2) % 3);
      const h = north ? 5 + ((n >>> 5) % 4) : 1 + ((n >>> 5) % 2);
      x += gap;
      for (let i = 0; i < run && x + i <= x1; i++) {
        const xx = x + i;
        put(s, xx, face, h, M.stone, T_WALL);
        put(s, xx, face - 1, h + 0.6, M.stone, 175);
        if (!north || xx % 3 !== 0) continue;
        mark(s, xx, face, 1, M.moss, 156);
        for (let z = 2; z <= h - 2; z++) mark(s, xx, face, z, M.opening, 108);
      }
      x += run;
    }
  };
  runs(4, 9, 28, 1);
  runs(12, 9, 28, 2);
  // A half-ring apse, radius 4, closing the east end.
  const acx = 26, acy = 8, ar = 4, cols = new Map<number, number>();
  for (let y = acy - ar; y <= acy + ar; y++) for (let x = acx; x <= acx + ar; x++) {
    const dx = x + 0.5 - acx, dy = y + 0.5 - acy;
    if (dx < 0) continue;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < ar - 0.8 || d > ar + 0.45) continue;
    const prev = cols.get(x);
    if (prev === undefined || y > prev) cols.set(x, y);
  }
  for (const [x, face] of cols) {
    const h = 2 + (hash2(x, 4, seed) % 4) * 0.5;
    put(s, x, face, h, M.stone, T_WALL);
    put(s, x, face - 1, h + 0.6, M.stone, 175);
    if (x % 3 === 0) mark(s, x, face, 1, M.moss, 156);
  }
  // A tree growing out of the nave: a broad crown, not a column. Tone 0: the bake shades it. Roots show on the south stubs.
  const rx = 5.5, ry = 3.2, ccx = 17, ccy = 8;
  for (let y = Math.floor(ccy - ry); y <= Math.ceil(ccy + ry); y++) for (let x = Math.floor(ccx - rx); x <= Math.ceil(ccx + rx); x++) {
    const nx = (x - ccx) / rx, ny = (y - ccy) / ry;
    if (nx * nx + ny * ny > 1 || x < 0 || y < 0 || x >= W || y >= CHURCH_H) continue;
    const t = 6.5 * Math.sqrt(1 - nx * nx - ny * ny);
    if (t > s.top[y * W + x]) put(s, x, y, t, M.broadleafMid, 0);
  }
  for (const x of [15, 17, 19]) for (let z = 1; z <= 2; z++) mark(s, x, 12, z, M.timber, 88 + z * 6);
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
  // Ivy spilled over the south wall, four to six cells, clear of the tree.
  const ivyN = 4 + (hash2(9, 3, seed) % 3);
  for (let k = 0; k < ivyN; k++) put(s, [11, 14, 15, 18, 22, 27][k], 13, 0.9 + (k & 1) * 0.5, M.ivy, 146);
  // The tower, built here: tower() is shared, and this spire is a parapet with a short lead roof. 6 × 7 shaft.
  const tx = CHURCH_TOWER[0] - 3, ty = CHURCH_TOWER[1] - 3, south = ty + 6, shaft = 17;
  for (let i = 0; i < 6; i++) put(s, tx + i, south, shaft, M.stone, T_WALL);
  let tip = 0, tipX = tx + 2, tipY = ty + 3;
  for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
    const outer = i === 0 || i === 5 || j === 0 || j === 5;
    if (outer) {
      const h = (i + j) % 2 === 0 ? 17.8 : 17.2;
      const tone = j === 5 ? 150 : i === 0 ? 178 : i === 5 ? 110 : 168;
      put(s, tx + i, ty + j, h, M.stone, tone);
      continue;
    }
    const lift = 13 * (1 - Math.max(Math.abs(i - 2.5), Math.abs(j - 2.5)) / 2);
    const h = shaft + lift;
    const ax = Math.abs(i - 2.5), ay = Math.abs(j - 2.5);
    const tone = ax >= ay ? (i < 2.5 ? T_WEST : T_EAST) : j > 2.5 ? T_SOUTH : T_NORTH;
    put(s, tx + i, ty + j, h, M.roofLead, ax < 0.6 && ay < 0.6 ? T_RIDGE : tone);
    if (h > tip + 1e-6 || (Math.abs(h - tip) <= 1e-6 && ty + j >= tipY)) { tip = h; tipX = tx + i; tipY = ty + j; }
  }
  const cz = Math.floor(tip + 0.5);
  for (let k = 1; k <= 4; k++) mark(s, tipX, tipY, cz + k, M.gilt, 150);
  mark(s, tipX - 1, tipY, cz + 3, M.gilt, 150);
  mark(s, tipX + 1, tipY, cz + 3, M.gilt, 150);
  for (let x = tx; x < tx + 6; x++) {
    s.mat[south * W + x] = M.stone;
    s.tone[south * W + x] = 132;
  }
  s.top[south * W + tx] -= 1.5;
  s.top[south * W + tx + 5] -= 1.5;
  for (const x of [tx, tx + 1]) for (let z = 1; z <= 10; z++) if ((hash2(x, z, seed ^ 0x171) & 3) !== 0) mark(s, x, south, z, M.ivy, 132 + (z & 3) * 8);
  for (const x of [tx + 1, tx + 4]) for (let z = 10; z <= 12; z++) mark(s, x, south, z, M.opening, 96);
  mark(s, tx + 3, south, 5, M.opening, 100);
  mark(s, tx + 3, south, 6, M.opening, 112);
  lap(s, seed);
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
 * tower, and steps down to a jetty. `rock` is the material of the flat the hotel stands on; the cliff is the
 * raised ground around it. `cliff` is accepted so callers that still name the face material keep working.
 */
export function coveHotel(seed: number, rock: number, cliff: number): Structure {
  void cliff;
  const W = HOTEL_W, s = sculpt(W, HOTEL_H);
  const [rx0, ry0] = HOTEL_ROCK;
  const P = 6;
  // The flat of the rock. Outside it the cliff shows, so there is no painted rim.
  for (let y = 0; y < 24; y++) for (let x = 0; x < W; x++) {
    const dx = (x - rx0) / 19.5, dy = (y - ry0) / 11;
    const lump = ((hash2(x >> 1, y >> 1, seed) & 7) - 3.5) * 0.02;
    const q = Math.sqrt(dx * dx + dy * dy) + lump;
    if (q > 0.78) continue;
    put(s, x, y, P, rock, 0);
  }
  // The garden terrace west of the hotel: pasture, a balustrade, four parasols and a pergola, one pine.
  for (let y = 5; y <= 15; y++) for (let x = 3; x <= 13; x++) put(s, x, y, P, M.pastureMid, T_FLAT);
  for (let x = 3; x <= 13; x++) put(s, x, 15, P + 1.1, x % 3 === 0 ? M.stoneDark : M.stone, x % 3 === 0 ? 108 : T_WALL);
  const parasol = (x: number, y: number, cloth: number, tone: number): void => {
    for (let z = 1; z <= 3; z++) mark(s, x, y, P + z, M.stoneDark, 90);
    for (const dx of [-1, 0, 1]) mark(s, x + dx, y, P + 4, cloth, tone);
    mark(s, x, y, P + 5, cloth, tone);
  };
  parasol(9, 9, M.sailcloth, 210);
  parasol(12, 12, M.brick, 160);
  parasol(8, 13, M.sailcloth, 210);
  parasol(12, 14, M.brick, 160);
  for (let x = 3; x <= 13; x += 3) for (let z = 1; z <= 3; z++) mark(s, x, 6, P + z, M.timber, 96);
  for (let x = 3; x <= 13; x++) mark(s, x, 6, P + 4, M.timber, 120);
  const [px, py, pr] = [5, 10, 2.1] as const;
  for (let y = Math.floor(py - pr); y <= Math.ceil(py + pr); y++) for (let x = Math.floor(px - pr); x <= Math.ceil(px + pr); x++) {
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 <= pr * pr && x >= 0 && y >= 0) put(s, x, y, P + 4 + 2.5 * Math.sqrt(1 - d2 / (pr * pr)), M.yew, 0);
  }

  // The terrace in front of the hotel, a pale balustrade along its south edge.
  for (let y = 4; y <= 17; y++) for (let x = 14; x <= 33; x++) put(s, x, y, P, M.cobble, T_FLAT);
  for (let x = 14; x <= 33; x++) {
    put(s, x, 17, P + 1.1, x % 4 === 0 ? M.stoneDark : M.stone, x % 4 === 0 ? 100 : T_WALL);
    mark(s, x, 17, P, M.stoneDark, 112);
  }

  // The hotel: four floors of whitewash under a hipped tile roof, the long side to the sea.
  const bx = 14, by = 3, bw = 16, wall = P + 11;
  house(s, bx, by, bw, 8, wall, 3.4, { gable: 0, wallMat: M.whitewash, roofMat: M.roofTile, openings: 0, chimney: false, hip: true });
  // South roof courses, every other row a step darker, so the tile reads. A lit band on the rows under the ridge.
  for (const y of [by + 6, by + 4]) for (let i = 0; i < bw; i++) {
    const idx = y * W + (bx + i);
    if (s.mat[idx] !== M.roofTile) continue;
    const t = s.tone[idx] - 22;
    s.tone[idx] = t < 60 ? 60 : t;
  }
  for (const y of [by + 2, by + 3]) for (let i = 2; i <= bw - 3; i++) {
    const idx = y * W + (bx + i);
    s.top[idx] = wall + 3.4;
    s.tone[idx] = 188;
  }
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
  lap(s, seed, (x, y) => y >= 24 && s.top[y * W + x] < 5);
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

/** Every second pixel from (x0, z0) to (x1, z1), so a guy reads as wire. */
function dotted(p: Picture, x0: number, z0: number, x1: number, z1: number, mat: number, tone: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))));
  for (let k = 0; k <= steps; k += 2) {
    const t = k / steps;
    dot(p, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, mat, tone);
  }
}

/** A straight stroke from (x0, z0) to (x1, z1), `thick` pixels deep, its upper edge lighter by `lift`. */
function stroke(p: Picture, x0: number, z0: number, x1: number, z1: number, thick: number, mat: number, tone: number, lift = 0): void {
  const steps = Math.max(1, Math.ceil(2 * Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    for (let q = 0; q < thick; q++) dot(p, x, z + q, mat, tone + (q === thick - 1 ? lift : 0));
  }
}

/** Stands the picture on row `row` of the structure, its column 0 on column `x0`, and casts its shadow. */
function hang(s: Structure, p: Picture, x0: number, row: number): void {
  for (let z = 1; z <= p.tall; z++) for (let x = 0; x < p.w; x++) {
    const m = p.mat[z * p.w + x];
    if (m === 0) continue;
    mark(s, x0 + x, row, z, m, p.tone[z * p.w + x]);
    castPicture(s, x0 + x, z, row);
  }
}

function shadeCell(s: Structure, x: number, y: number, depth: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h || depth <= 0) return;
  if (!s.shadow) s.shadow = new Uint8Array(s.w * s.h);
  const i = y * s.w + x;
  if (s.shadow[i] < depth) s.shadow[i] = depth > 3 ? 3 : depth;
}

/**
 * A picture pixel at (x, z) on row `row` shades the ground to the south-east, where the sun's ray from that
 * height meets the base. Depth 2 on the cell it hits, depth 1 on a dithered rim.
 */
function castPicture(s: Structure, x: number, z: number, row: number): void {
  const k = z / 2.83;
  const ix = Math.floor(x + k), iy = Math.floor(row + k);
  shadeCell(s, ix, iy, 2);
  const rim = (rx: number, ry: number): void => {
    if ((hash2(rx, ry, 0x5ad1) & 1) === 0) shadeCell(s, rx, ry, 1);
  };
  rim(ix + 1, iy);
  rim(ix, iy + 1);
  rim(ix + 1, iy + 1);
}

/**
 * A broken foam line: every empty cell 4-adjacent to a standing cell, where a hash falls under 50%, gets a
 * thin white cap. `wet`, when given, counts only those standing cells (the pontoon, not the hotel above it).
 */
function lap(s: Structure, seed: number, wet?: (x: number, y: number) => boolean): void {
  const W = s.w, extra: number[] = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < W; x++) {
    if (s.top[y * W + x] > 0) continue;
    let beside = false;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= s.h || s.top[ny * W + nx] <= 0) continue;
      if (wet && !wet(nx, ny)) continue;
      beside = true;
      break;
    }
    if (beside && (hash2(x, y, seed) & 1023) < 512) extra.push(x, y);
  }
  for (let k = 0; k < extra.length; k += 2) put(s, extra[k], extra[k + 1], 0.12, M.whitewash, 205);
}

/**
 * An oval of ground paint with a ragged edge, and a dither on the last cell of that edge, so the paint does
 * not end in a ruled curve. `seed` only shifts the dither; the raggedness is the water meadow's.
 */
function raggedPaint(s: Structure, cx: number, cy: number, rx: number, ry: number, mat: number, seed: number): void {
  const W = s.w;
  const inside = (x: number, y: number): boolean => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    const ragged = ((hash2(x >> 2, y >> 2, seed ^ 0x3ead) & 7) - 3.5) * 0.04;
    return dx * dx + dy * dy <= 1 + ragged;
  };
  for (let y = 0; y < s.h; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    const ox = x > cx ? 1 : x < cx ? -1 : 0, oy = y > cy ? 1 : y < cy ? -1 : 0;
    if ((ox !== 0 || oy !== 0) && !inside(x + ox, y + oy) && (hash2(x, y, seed ^ 0xd17e) & 1) !== 0) continue;
    s.paint[y * W + x] = mat;
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
  // The yard: rough grass inside the wall, its edge ragged, a beaten path from the door to the gate.
  raggedPaint(s, 16.5, 11.5, 15.5, 10.5, M.pastureCool, seed);
  const [gx, gy] = marshGate(ux, uy), [gc, gs] = onWall(ux, uy);
  for (let k = 0; k <= 24; k++) {
    const t = k / 24, x = Math.floor(16.5 + (gx - 16.5) * t), y = Math.floor(14.5 + (gy - 14.5) * t);
    if (x >= 0 && y >= 0 && x < W && y < MARSH_H) s.paint[y * W + x] = M.path;
  }
  // The garden wall: an oval of rubble in runs, open at the gate. On the water side, only three or four fragments.
  const waterSlots = new Set<number>();
  {
    const keep = 3 + (hash2(2, 9, seed) & 1);
    for (let slot = 0; slot < 8; slot++) {
      const h = hash2(slot, 6, seed);
      let rank = 0;
      for (let other = 0; other < 8; other++) {
        const ho = hash2(other, 6, seed);
        if (ho < h || (ho === h && other < slot)) rank++;
      }
      if (rank < keep) waterSlots.add(slot);
    }
  }
  for (let y = 1; y <= 22; y++) for (let x = 1; x <= 32; x++) {
    const dx = (x - 16.5) / 15, dy = (y - 11.5) / 10;
    const q = Math.sqrt(dx * dx + dy * dy);
    if (q < 0.93 || q > 1.04) continue;
    const near = (dx * gc + dy * gs) / q;
    if (near > 0.98558) continue;
    const ang = turn(dx, dy);
    if (ang > 0.45 && ang < 1.55) {
      const slot = Math.floor(((ang - 0.45) / 1.1) * 8);
      if (!waterSlots.has(slot)) continue;
    }
    const run = hash2(Math.floor(ang * 8), 7, seed);
    if ((run & 7) < 2 && near < 0.92106 && !(ang > 0.45 && ang < 1.55)) continue;
    put(s, x, y, (run & 8) !== 0 ? 1 : 1.6, M.stoneDark, T_WALL);
  }
  // Gate posts, 0.22 of a radian either side of the gate.
  for (const k of [-1, 1]) {
    const c = gc * 0.9759 - k * gs * 0.21823, sn = gs * 0.9759 + k * gc * 0.21823;
    put(s, Math.floor(16.5 + 15 * c), Math.floor(11.5 + 10 * sn), 2.4, M.stone, T_WALL);
  }

  // The house: a long front under a steep hipped lead roof, a cross-gable in the middle, dormers on the slope.
  const hx = 6, hy = 5, hw = 16, hd = 9, wall = 9, south = hy + hd - 1;
  house(s, hx, hy, hw, hd, wall, 6, { gable: 0, wallMat: M.whitewash, roofMat: M.roofLead, openings: 0, chimney: false, hip: true });
  house(s, hx + 5, hy + 3, 6, 6, wall, 4.5, { gable: 1, wallMat: M.whitewash, roofMat: M.roofLead, openings: 0, chimney: false });
  // Brick chimneys at the two ends of the ridge, the west cell of each lit. The ridge sits near the middle of the roof rows.
  for (const cx of [hx + 2, hx + 13]) {
    const cy = hy + 3;
    const t = s.top[cy * W + cx];
    if (t > 0 && t + 2.8 <= 19) {
      put(s, cx, cy, t + 2.6, M.brick, T_EAST);
      put(s, cx - 1, cy, t + 2.6, M.brick, 176);
    }
  }
  // Dormers on the south slope, each two cells wide under a slate cap.
  for (const dx of [2, 13]) {
    const x = hx + dx, y = hy + 6;
    const roofZ = s.top[y * W + x];
    if (roofZ <= 0 || roofZ + 2.8 > 19) continue;
    for (let i = 0; i < 2; i++) {
      put(s, x + i, y, roofZ + 2.2, M.whitewash, T_WALL);
      mark(s, x + i, y, Math.floor(roofZ + 1), M.opening, 124);
      put(s, x + i, y - 1, roofZ + 2.8, M.roofLead, T_RIDGE);
    }
  }
  // Windows in a grid. One, high up, is lit; the rest are dark glass. The foot of the wall is damp.
  const open = marshLamp(seed);
  for (const z of [2, 5, 8]) for (const x of [7, 9, 11, 13, 15, 17, 19, open]) {
    const lit = z === 8 && x === open;
    mark(s, x, south, z, lit ? M.lantern : M.opening, lit ? 220 : 104);
    mark(s, x, south, z + 1, lit ? M.lantern : M.opening, lit ? 200 : 124);
  }
  // A porch only over the door, so the ground-floor windows to either side stay in view.
  for (let x = hx + 6; x <= hx + 10; x++) put(s, x, south + 1, 4.2, M.roofLead, T_SOUTH);
  put(s, hx + 6, south + 2, 3.6, M.timber, T_WALL);
  put(s, hx + 10, south + 2, 3.6, M.timber, T_WALL);
  for (let z = 1; z <= 3; z++) mark(s, hx + 8, south, z, M.timber, 88);
  for (let x = hx; x < hx + hw; x++) if (x !== hx + 8) mark(s, x, south, 1, M.stoneDark, 128);

  // The east wing: a lower hipped lead roof against the house, its front open.
  house(s, hx + hw - 1, 8, 7, 6, 5, 2.2, { gable: 0, wallMat: M.plaster, roofMat: M.roofLead, openings: 0, chimney: false, hip: true });
  for (let x = hx + hw; x <= hx + hw + 4; x++) {
    mark(s, x, 13, 1, M.opening, 100);
    mark(s, x, 13, 2, M.opening, 112);
    mark(s, x, 13, 4, M.opening, 120);
  }
  for (let y = 0; y < s.h; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (s.mat[i] !== M.roofLead) continue;
    const tone = s.tone[i];
    const gable = x >= hx + 5 && x <= hx + 10 && y >= hy + 3 && y <= hy + 7;
    if (tone === T_SOUTH || (gable && (tone === T_WEST || tone === T_EAST))) s.tone[i] = 124;
    else if (tone === T_RIDGE) s.tone[i] = 186;
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
  // Reeds in the water outside the wall, along its south side, clear of the gate.
  for (let k = 0; k < 8; k++) {
    const n = hash2(k, 21, seed);
    const x = [7, 11, 15, 19, 23, 27, 5, 29][k] + (n & 1);
    const y = [22, 22, 23, 23, 22, 21, 20, 18][k];
    const qdx = (x - 16.5) / 15, qdy = (y - 11.5) / 10;
    if (qdx * qdx + qdy * qdy < 1.12) continue;
    if (Math.abs(x - gx) < 3 && Math.abs(y - gy) < 3) continue;
    if (x < 0 || y < 0 || x >= W || y >= MARSH_H || s.top[y * W + x] > 0) continue;
    put(s, x, y, 0.8 + ((n >>> 3) & 7) / 7 * 0.8, M.reeds, (n & 4) === 0 ? 130 : 170);
  }
  return s;
}

/** The height of the causeway's crown above the sea. */
export const CAUSEWAY_TOP = 1.3;

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
      if (Math.abs(lat) > 0.55) put(s, i, j, 0.9, M.stoneDark, 112);
      else put(s, i, j, CAUSEWAY_TOP, M.path, 150);
      if (lat > 0.55 && Math.floor(a) % 8 === 0) { mark(s, i, j, 3, M.timber, 84); mark(s, i, j, 4, M.timber, 84); }
    }
    lap(s, hash2(ox, oy, 0xc5e1));
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The airship mast.

export const MAST_W = 58;
export const MAST_H = 34;
/** The mast's foot in its raster, and its height to the lamp. */
export const MAST_FOOT = [14, 10] as const;
export const MAST_TALL = 46;

/**
 * The airship mast (58 × 34, 46 tall). Base: the pad. A tapering tower of slate lattice on four stone feet,
 * guyed, with two galleries and a banded cone; an airship moored at the cone. Beside it a small winch house,
 * two low gas holders, the anchor blocks of the yaw lines and a windsock.
 */
export function airshipMast(seed: number): Structure {
  const s = sculpt(MAST_W, MAST_H);
  const [fx, fy] = MAST_FOOT;
  // The feet: two in front, two behind.
  for (const x of [fx - 6, fx - 5, fx + 5, fx + 6]) { put(s, x, fy, 1.6, M.stone, T_WALL); put(s, x, fy - 4, 1.6, M.stone, T_WALL); }

  // Near iron is slate; the far legs stay dark stone. The picture is wide enough for the guys.
  const iron = M.stoneDark, slate = M.roofSlate, p = picture(29, MAST_TALL), c = 14;
  const half = (z: number): number => (z >= 34 ? 1.3 : 7.4 - 5.6 * (z / 34));
  // Guys, drawn first so the tower stands in front of them. The upper pair only, dotted, down to the ground.
  dotted(p, c - 1, 30, 1, 1, M.stone, 150);
  dotted(p, c + 1, 30, 27, 1, M.stone, 150);
  // The far legs, seen through the bracing. They start above the feet, so the stone shows.
  for (let z = 5; z <= 34; z++) { dot(p, c - half(z) + 1.4, z, iron, 128); dot(p, c + half(z) - 1.4, z, iron, 128); }
  // A cross in every panel, each panel about as tall as the tower is wide there.
  const girders: number[] = [1];
  for (let z = 1; z < 33;) { z += Math.max(3, Math.floor(2 * half(z))); girders.push(Math.min(z, 34)); }
  for (let k = 0; k + 1 < girders.length; k++) {
    const z0 = girders[k], z1 = girders[k + 1];
    stroke(p, c - half(z0), z0, c + half(z1), z1, 1, slate, 88);
    stroke(p, c + half(z0), z0, c - half(z1), z1, 1, slate, 76);
    stroke(p, c - half(z1), z1, c + half(z1), z1, 1, slate, 64);
  }
  // The near legs, and the main up the middle.
  for (let z = 1; z <= 36; z++) {
    dot(p, c - half(Math.min(z, 34)), z, slate, 88);
    dot(p, c + half(Math.min(z, 34)), z, slate, 64);
    if (z < 34 && z % 2 === 0) dot(p, c, z, slate, 80);
  }
  // Two galleries. The upper one is only the cabin's width, and carries the mooring cabin.
  for (let x = -6; x <= 6; x++) { dot(p, c + x, 12, slate, 72); if (Math.abs(x) % 2 === 1 || Math.abs(x) === 6) dot(p, c + x, 13, slate, 88); }
  for (let x = -3; x <= 3; x++) { dot(p, c + x, 33, slate, 72); if (Math.abs(x) === 3) dot(p, c + x, 34, slate, 84); }
  for (let x = -2; x <= 2; x++) {
    for (let z = 34; z <= 36; z++) dot(p, c + x, z, M.roofLead, x < 0 ? 150 : 120);
    dot(p, c + x, 37, M.copper, 160);
  }
  dot(p, c - 1, 35, M.lantern, 210);
  dot(p, c + 1, 35, M.opening, 100);
  // An iron cap, then the spindle and the banded mooring cone, a lamp at the tip.
  for (let z = 38; z <= 40; z++) for (let x = -1; x <= 1; x++) dot(p, c + x, z, iron, 84);
  dot(p, c, 41, iron, 84);
  for (let z = 42; z <= 44; z++) {
    const band = z % 2 === 0 ? M.brick : M.sailcloth, hw = z >= 44 ? 0 : 1;
    for (let x = -hw; x <= hw; x++) dot(p, c + x, z, band, x < 0 ? 168 : x > 0 ? 128 : 150);
  }
  dot(p, c - 3, 42, iron, 80);
  dot(p, c + 3, 42, iron, 72);
  dot(p, c, 45, iron, 80);
  dot(p, c, 46, M.lantern, 230);
  hang(s, p, fx - c, fy);
  // The airship, moored nose-on to the cone, hung behind the mast so the lattice stands in front of it.
  const ship = picture(27, 46), zc = 42;
  for (let x = 0; x < 27; x++) {
    const t = x / 26, u = (t - 0.47) / 0.53;
    if (u * u >= 1) continue;
    const rad = 4.4 * Math.sqrt(1 - u * u), top = Math.floor(rad), rib = x % 4 === 0, n = top * 2 + 1;
    for (let dz = -top; dz <= top; dz++) {
      const idx = top - dz;
      let tone = idx < 3 ? 205 : idx >= n - 2 ? 118 : 165;
      if (rib) tone -= 28;
      const pz = zc + dz;
      if (pz < 1 || pz > MAST_TALL) continue;
      ship.mat[pz * ship.w + x] = M.sailcloth;
      ship.tone[pz * ship.w + x] = tone;
    }
  }
  // Tail fins, one or two pixels, never above the mast.
  const finAt = (x: number, up: number, down: number): void => {
    const fu = (x / 26 - 0.47) / 0.53;
    const fr = 4.4 * Math.sqrt(Math.max(0, 1 - fu * fu));
    const cap = zc + Math.floor(fr), keel = zc - Math.floor(fr);
    for (let k = 1; k <= up; k++) {
      const pz = cap + k;
      if (pz > MAST_TALL) continue;
      ship.mat[pz * ship.w + x] = M.sailcloth;
      ship.tone[pz * ship.w + x] = 205;
    }
    for (let k = 1; k <= down; k++) {
      const pz = keel - k;
      if (pz < 1) continue;
      ship.mat[pz * ship.w + x] = M.sailcloth;
      ship.tone[pz * ship.w + x] = 118;
    }
  };
  finAt(24, 2, 2);
  finAt(25, 1, 1);
  for (let x = 8; x <= 13; x++) for (let z = 36; z <= 37; z++) dot(ship, x, z, M.timber, 112);
  const filled = (x: number, z: number): boolean => x >= 0 && x < ship.w && z >= 1 && z <= ship.tall && ship.mat[z * ship.w + x] !== 0;
  const edge: number[] = [];
  for (let z = 1; z <= ship.tall; z++) for (let x = 0; x < ship.w; x++) {
    if (!filled(x, z)) continue;
    if (!filled(x - 1, z) || !filled(x + 1, z) || !filled(x, z - 1) || !filled(x, z + 1)) edge.push(x, z);
  }
  for (let k = 0; k < edge.length; k += 2) dot(ship, edge[k], edge[k + 1], M.opening, 70);
  dot(ship, 10, 37, M.opening, 96);
  dot(ship, 11, 37, M.opening, 108);
  hang(s, ship, 15, fy - 3);

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
/** Cells of bare deck at the bridge's east end past the last house, and at its west end past the clock tower. */
const BRIDGE_BARE = 4;
const BRIDGE_BARE_WEST = 4;

/**
 * The bridge town (len + 12 wide, 13 deep; its roofs stand up to 17 over the deck). Base: the river. An old
 * stone bridge of round arches on cutwater piers, `len` cells long and `deck` above the water, built over for
 * its middle: a clock tower at the west end, then tall narrow houses crowded along both sides of the
 * street, plastered in several colours under steep roofs and chimneys. Where the south row parts, a small
 * square in front of the bridge chapel. The ends are bare deck between parapets, so the arches show; a
 * wayside cross stands at the east end. `wet` is the river's width, kept for callers.
 */
export function bridgeTown(len: number, wet: number, deck: number, seed: number): Structure {
  void wet;
  const W = len + 2 * BRIDGE_END, s = sculpt(W, BRIDGE_H);
  const x0 = BRIDGE_END, x1 = x0 + len - 1, y0 = BRIDGE_ROW, south = y0 + BRIDGE_DEPTH - 1, mid = x0 + (len >> 1);
  // The road on to it.
  paint(s, 0, y0 + 3, x0, 2, M.road);
  paint(s, x1 + 1, y0 + 3, BRIDGE_END, 2, M.road);
  // The deck and its parapets.
  for (let y = y0; y <= south; y++) for (let x = x0; x <= x1; x++) put(s, x, y, deck, M.cobble, T_FLAT);
  for (let x = x0; x <= x1; x++) { put(s, x, y0, deck + 1, M.stone, T_FLAT); put(s, x, south, deck + 1, M.stone, T_WALL); }

  // The clock tower on the south side at the west end. Its tip is the deck plus 17.
  tower(s, x0, y0 + 4, 5, 4, deck + 13.5, 3.5, M.stone, M.roofSlate, false);
  for (let i = 0; i < 5; i++) mark(s, x0 + i, south, deck + 12, M.stoneDark, 108);
  for (let dx = -1; dx <= 1; dx++) for (let dz = 8; dz <= 10; dz++) mark(s, x0 + 2 + dx, south, deck + dz, M.dial, 170);
  mark(s, x0 + 2, south, deck + 9, M.gilt, 200);
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
      const gable = (n & 1) === 0 ? 1 : 0;
      let wall = wall0 + ((n >>> 4) % 5) - 2;
      let roof = roof0 + (((n >>> 3) & 15) / 15) * 3 - 1.5;
      if (roof < 1.2) roof = 1.2;
      if (wall + roof > limit - 2.6) roof = Math.max(1.2, limit - 2.6 - wall);
      if (wall + roof > limit) wall = limit - roof;
      const wallMat = walls[(k + salt) % walls.length];
      const roofMat = (k + salt) % 4 === 3 ? roofs[(k + salt) % roofs.length] : M.roofTile;
      house(s, x, y, w, d, wall, roof, { gable, wallMat, roofMat, openings: 0, chimney: false });
      const face = y + d - 1;
      // A light face, so the plaster colour survives the shade on the south wall.
      for (let i = 0; i < w; i++) s.tone[face * W + x + i] = 176;
      if (far) {
        // A corner post, a timber string and two small windows, so each front stands apart.
        for (let z = Math.floor(deck + 6); z < wall; z++) mark(s, x, face, z, M.timber, 96);
        for (let i = 0; i < w; i++) mark(s, x + i, face, deck + 6, M.timber, 110);
        if (deck + 8 < wall) {
          const lit = k % 2 === 0;
          mark(s, x + 1, face, deck + 8, lit ? M.lantern : M.opening, lit ? 214 : 108);
          if (w > 3) mark(s, x + w - 2, face, deck + 8, M.opening, 108);
        }
      } else {
        const floors = [deck + 1, deck + 2];
        for (let i = 0; i < w; i++) {
          const bay = i % 2 === 1;
          for (const z of floors) {
            if (z >= wall) continue;
            const lit = bay && z === floors[floors.length - 1] && (k + i) % 3 === 0;
            mark(s, x + i, face, z, bay ? (lit ? M.lantern : M.opening) : M.timber, bay ? (lit ? 214 : 108) : 100);
            if (bay && z + 1 < wall) mark(s, x + i, face, z + 1, lit ? M.lantern : M.opening, lit ? 196 : 124);
          }
          if (i < w - 1 && deck + 3 < wall) mark(s, x + i, face, deck + 3, i % 2 === 0 ? M.brick : M.sailcloth, 160);
        }
      }
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

  // Three arches on the south face, centred on the middle of the bridge. The ends are blind stone under the string course.
  const bay = 9, origin = mid - 1.5 * bay, a = bay / 2 - 1.2;
  const top = Math.floor(deck);
  for (let x = x0; x <= x1; x++) {
    const along = x + 0.5 - origin;
    const inSpan = along >= 0 && along < 3 * bay;
    const v = inSpan ? along - (Math.floor(along / bay) + 0.5) * bay : 0;
    const central = inSpan && Math.floor(along / bay) === 1;
    for (let z = 1; z < top; z++) mark(s, x, south, z, M.stone, 150);
    mark(s, x, south, top, M.stoneDark, 112);
    if (!inSpan || Math.abs(v) >= a) {
      if (inSpan && Math.abs(v) > bay / 2 - 0.6 && x > x0 + 1 && x < x1 - 1) put(s, x, south + 1, deck - 2.5, M.stone, v > 0 ? 150 : 104);
      continue;
    }
    const rise = Math.min(deck - 2, 1 + a * Math.sqrt(1 - (v * v) / (a * a)));
    for (let z = 1; z <= rise; z++) mark(s, x, south, z, central && z <= 2 ? M.river : M.opening, z >= rise - 1 ? 92 : 104);
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
  raggedPaint(s, (w - 1) / 2, 0, w / 2, h, M.pastureMid, seed);
  return s;
}

// ---------------------------------------------------------------------------
// The great oak.

export const OAK_W = 55;
export const OAK_H = 29;
/** The trunk's foot in the oak's raster, and the oak's height. */
export const OAK_TRUNK = [27, 7] as const;
export const OAK_TALL = 47;
/** In the raster: where the swing's seat hangs. */
export const OAK_SWING = [38, 7] as const;

/**
 * The great oak (55 × 29, 47 tall). Base: the ground at its foot. One tree: a thick trunk, roots and
 * a hollow, three limbs, and a billowing dome of broadleaf in three tiers; a swing to the east.
 */
export function greatOak(seed: number): Structure {
  const W = OAK_W, s = sculpt(W, OAK_H);
  const [cx, row] = OAK_TRUNK;
  const p = picture(W, OAK_TALL);
  const bark = M.timber;
  // Three tiers, about 50 wide. The side lobes of the lowest tier end at z 18.
  // Each pixel takes the highest lobe that holds it.
  const lobes: readonly (readonly [number, number, number, number])[] = [
    [12, 24, 9.4, 6], [42, 24.2, 9.4, 6.2], [27, 24, 13.75, 5.5], [7, 21.6, 5.25, 3.6], [47, 21.6, 5.5, 3.6],
    [27, 33, 20.6, 13], [27, 37, 11.25, 7],
    [19.5, 40, 9, 4.2], [34.5, 40, 9, 4.2],
  ];
  const inLobe = (mx: number, mz: number, rx: number, rz: number, x: number, z: number): boolean => {
    const nx = (x - mx) / rx, nz = (z - mz) / rz;
    const edge = 1 + ((hash2(x, z, seed ^ 0x51) & 3) - 1.5) * 0.04;
    return nx * nx + nz * nz <= edge;
  };
  for (let z = 14; z <= 46; z++) for (let x = 0; x < W; x++) {
    let best = -1, bnx = 0, bnz = 0;
    for (let i = 0; i < lobes.length; i++) {
      const [mx, mz, rx, rz] = lobes[i];
      if (!inLobe(mx, mz, rx, rz, x, z)) continue;
      if (best < 0 || mz > lobes[best][1]) { best = i; bnx = (x - mx) / rx; bnz = (z - mz) / rz; }
    }
    if (best < 0) continue;
    const light = 0.8 * bnz - 0.6 * bnx;
    let tone = 140 + 70 * light, seam = false;
    for (const [mx, mz, rx, rz] of lobes) {
      if (seam || !inLobe(mx, mz, rx, rz, x, z)) continue;
      const nz = (z - mz) / rz;
      if (nz < 0 && !inLobe(mx, mz, rx, rz, x, z - 1)) seam = true;
    }
    if (seam) tone -= 25;
    const mat = light > 0.45 ? M.broadleafWarm : light > 0 ? M.broadleafMid : M.broadleafCool;
    const t = Math.floor(tone);
    p.mat[z * W + x] = mat;
    p.tone[z * W + x] = t < 0 ? 0 : t > 255 ? 255 : t;
  }
  // The trunk: half-width 5 at the root, 4.5 by z 14. A bark streak on every second column. Lit from the west.
  const barkTone = (x: number, c: number, hw: number, z: number): number => {
    const streak = (x & 1) === 0 ? -12 : 0;
    return 118 - 36 * ((x - c) / (hw || 1)) + ((hash2(x, z >> 2, seed ^ 0x7b) & 3) - 1.5) * 6 + streak;
  };
  for (let z = 1; z <= 14; z++) {
    const hw = 5 - ((z - 1) / 13) * 0.5;
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) dot(p, x, z, bark, barkTone(x, cx, hw, z));
  }
  // Three limbs under the lowest lobes, each three cells thick.
  for (let z = 14; z <= 26; z++) {
    const t = (z - 14) / 12;
    const centers = [cx - 3 - t * (cx - 3 - 12), cx, cx + 3 + t * (42 - cx - 3)];
    for (const c of centers) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(c) + dx, px = Math.floor(x + 0.5);
      const m = px >= 0 && px < W ? p.mat[z * W + px] : 0;
      if (m === M.broadleafCool || m === M.broadleafMid || m === M.broadleafWarm) continue;
      dot(p, x, z, bark, barkTone(x, c, 1.5, z));
    }
  }
  // Five roots, four or five cells out from the trunk, and a ragged hollow on the west of it.
  stroke(p, cx - 5, 5, cx - 10, 1, 2, bark, 100);
  stroke(p, cx - 4, 4, cx - 8, 1, 2, bark, 112);
  stroke(p, cx + 3, 4, cx + 8, 1, 2, bark, 96);
  stroke(p, cx + 5, 5, cx + 10, 1, 2, bark, 88);
  stroke(p, cx + 4, 3, cx + 8, 1, 1, bark, 80);
  for (let x = cx - 3; x <= cx - 2; x++) for (let z = 1; z <= 3; z++) {
    const edge = x === cx - 3 || z === 1 || z === 3;
    if (edge && (hash2(x, z, seed ^ 0x0a11) & 3) === 0) continue;
    dot(p, x, z, M.opening, 70 + z * 8);
  }
  if ((hash2(cx - 4, 2, seed) & 1) === 0) dot(p, cx - 4, 2, M.opening, 78);
  if ((hash2(cx - 1, 1, seed) & 1) === 0) dot(p, cx - 1, 2, M.opening, 74);
  // The swing: two ropes from the east bough and a painted seat.
  const [sx] = OAK_SWING;
  for (let z = 5; z <= 18; z++) { dot(p, sx - 1, z, M.timber, 168); dot(p, sx + 2, z, M.timber, 168); }
  for (let x = sx - 1; x <= sx + 2; x++) dot(p, x, 4, M.brick, 160);
  // The crown's rim, darker than the leaves inside it, so the tree stands out from whatever lies behind it.
  const leaf = (x: number, z: number): boolean => {
    const m = x < 0 || x >= p.w || z < 1 || z > p.tall ? 0 : p.mat[z * p.w + x];
    return m === M.broadleafCool || m === M.broadleafMid || m === M.broadleafWarm;
  };
  const empty = (x: number, z: number): boolean => x < 0 || x >= p.w || z < 1 || z > p.tall || p.mat[z * p.w + x] === 0;
  for (let z = 1; z <= p.tall; z++) for (let x = 0; x < p.w; x++) {
    if (leaf(x, z) && (empty(x - 1, z) || empty(x + 1, z) || empty(x, z - 1) || empty(x, z + 1))) {
      p.mat[z * p.w + x] = M.timber;
      p.tone[z * p.w + x] = 62;
    }
  }
  hang(s, p, 0, row);

  for (let x = cx - 3; x <= cx + 3; x++) put(s, x, row, 1.2, bark, T_WALL);
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
function domeHouse(s: Structure, cx: number, cy: number, r: number, drum: number, rise: number, slit: number, domeMat: number = M.copper): void {
  const inner = r - 1.1;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 > r * r) continue;
    if (d2 > inner * inner) { put(s, x, y, drum, M.whitewash, clampTone(132 - 34 * dx / r)); continue; }
    const k = Math.sqrt(1 - d2 / (inner * inner));
    const lift = Math.min(k, 0.9);
    const slit0 = Math.floor(cx) + 1;
    const open = x >= slit0 && x < slit0 + slit && dy > 1.5;
    const jamb = x === slit0 - 1 && dy > 1.5;
    const col = Math.round(x - cx);
    const rib = col !== 0 && col % 3 === 0 ? -8 : 0;
    let tone = 160 - (56 * dx) / r - (30 * dy) / r + rib;
    if (jamb) tone = 185;
    tone = Math.floor(tone);
    if (tone > 205) tone = 205;
    if (tone < 60) tone = 60;
    put(s, x, y, drum + 1 + rise * lift - (open ? 0.4 : 0), open ? M.opening : domeMat, open ? 112 : tone);
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
 * drum, its shutter open on the lower half and the telescope's mouth in the slit; a slate-roofed hall for the astronomers
 * east of it, a small stone dome for the transit instrument beyond, and a walled terrace with a meridian pillar,
 * a wind gauge and steps down to the path.
 */
export function observatory(seed: number): Structure {
  const W = OBS_W, s = sculpt(W, OBS_H);
  const [cx, cy] = OBS_DOME;
  // The terrace: two pads with the corners cut, so the snow stays south of the dome.
  const onTerrace = (x: number, y: number): boolean => {
    const pad = (x0: number, x1: number, y0: number, y1: number): boolean => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      return Math.min(x - x0, x1 - x) + Math.min(y - y0, y1 - y) >= 3;
    };
    return pad(5, 26, 1, 20) || pad(21, 44, 5, 16);
  };
  for (let y = 1; y <= 20; y++) for (let x = 5; x <= 44; x++) if (onTerrace(x, y)) put(s, x, y, 1.4, M.cobble, T_FLAT);
  for (let x = 1; x <= 44; x++) {
    if (x >= 29 && x <= 33) continue;
    const j = faceRow(s, x);
    if (j < 0) continue;
    put(s, x, j, 2.4, M.stoneDark, T_WALL);
    mark(s, x, j, 2, M.stoneDark, 96);
    if (x % 3 === 0) mark(s, x, j, 1, M.stoneDark, 70);
  }
  // Steps along the face, not out from it.
  for (let k = 0; k < 5; k++) put(s, 29 + k, 17, 2.2 - k * 0.35, M.stone, 160);
  // A line of snow on the terrace's north and west borders.
  for (let x = 1; x <= 44; x++) for (let y = 1; y <= 21; y++) {
    if (s.mat[y * W + x] !== M.cobble) continue;
    put(s, x, y, 1.6, M.snow, 210);
    break;
  }
  for (let y = 1; y <= 21; y++) for (let x = 1; x <= 44; x++) {
    if (s.mat[y * W + x] !== M.cobble && s.mat[y * W + x] !== M.snow) continue;
    put(s, x, y, 1.6, M.snow, 200);
    break;
  }

  // The great dome.
  const drum = 10.2, rise = 5.6;
  domeHouse(s, cx, cy, 8, drum, rise, 1);
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
  const tz = Math.floor(drum + rise);
  mark(s, cx + 1, cy + 2, tz, M.stoneDark, 84);
  mark(s, cx + 2, cy + 2, tz + 1, M.stoneDark, 96);
  mark(s, cx + 2, cy + 2, tz + 2, M.gilt, 170);
  mark(s, cx + 3, cy + 2, tz + 2, M.gilt, 150);

  // The astronomers' hall, plaster under a slate roof, with a chimney.
  house(s, 23, 7, 12, 7, 6.6, 2.8, { gable: 0, wallMat: M.plaster, roofMat: M.roofSlate, openings: 0, chimney: true });
  for (let i = 1; i < 12; i += 2) { mark(s, 23 + i, 13, 3, M.opening, 108); mark(s, 23 + i, 13, 4, M.lantern, 190); }
  for (let z = 2; z <= 3; z++) mark(s, 30, 13, z, M.timber, 92);
  for (let i = 0; i < 12; i++) mark(s, 23 + i, 13, 6, M.roofSlate, 140);
  // The transit house.
  domeHouse(s, 40, 10.5, 3.6, 5.4, 3.4, 1, M.stone);
  mark(s, 40, 14, 2, M.timber, 92);
  mark(s, 40, 14, 3, M.timber, 92);

  // On the terrace: the meridian pillar with its gilt ball, and a wind gauge on a mast.
  put(s, 6, 18, 4.4, M.stone, T_WALL);
  mark(s, 6, 18, 5, M.gilt, 170);
  const gx = 34 + (seed & 1);
  put(s, gx, 15, 2, M.stoneDark, T_WALL);
  for (let z = 3; z <= 9; z++) mark(s, gx, 15, z, M.timber, 88);
  for (const dx of [-2, -1, 1, 2]) mark(s, gx + dx, 15, 9, M.stoneDark, Math.abs(dx) === 2 ? 150 : 90);
  mark(s, gx, 15, 10, M.brick, 160);
  return s;
}
