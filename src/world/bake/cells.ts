// Cell tiles: the land rebuilt per world cell from the generator's grids.
// Ground by cubic B-spline, water, cover, scatter stamped into height and
// material, light and cast shadows. Every output is a pure function of the
// wrapped cell position, so any window equals the same crop of any other.

import { gradNoise } from "../core/noise.ts";
import { wrap } from "../core/torus.ts";
import type { CoverInput, Palette, Stamp } from "../look/contract.ts";
import { boxBlur, shade, shadowDepth, SHADOW_DROP, SHADOW_REACH, sweepShadow } from "./light.ts";
import { conformed, conformReach, conformsIn, conformWeight, imageOffset, structuresIn } from "../gen/built.ts";
import { forEachLinePoint, forEachRiverPoint } from "./lines.ts";
import { HMAX, type BakeWorld } from "./world.ts";

export const TILE = 256;

/** What the cover and palette side hands the bake. */
export interface Look {
  cover(c: CoverInput, mask: Uint8Array): number;
  /** `riverDist`: cells to the nearest river due north and due south of this cell, Infinity beyond RIVER_SIGHT. */
  scatter(c: CoverInput, groundMat: number, mask: Uint8Array, riverDist?: { north: number; south: number }): Stamp | null;
  /** Per material id: 1 for water. */
  isWater: Uint8Array;
  /** Per material id: 1 for tree crowns. */
  isCanopy: Uint8Array;
  palette: Palette;
  /** Per material id: 1 for standing water (sea, lakes), whose shores take a coast line. Optional: isWater when absent. */
  isStill?: Uint8Array;
  /** Per material id: 1 where ink is never drawn (fields, roads, sand). Optional. */
  noInk?: Uint8Array;
}

/** Cell flags. */
export const F_SHADOW = 0x03;
export const F_CANOPY = 0x04;
/** Ground slope ≥ STEEP_SLOPE (aux 1) or ≥ CLIFF_SLOPE (aux 2: a cliff), the only ground that shows rock walls and hatching. */
export const F_CLIFF = 0x08;
/** Deep in shadow cast by terrain (never by trees). */
export const F_DEEP = 0x10;
/** Sedimentary rock: bedding lines; clear means hard rock and vertical strokes. */
export const F_BEDDED = 0x20;
/** Never inked: water, rivers, beaches, fields. */
export const F_QUIET = 0x40;
/** Land of a cliffed coast: inked where it meets the water. */
export const F_SEACLIFF = 0x80;

export interface Cells {
  w: number;
  h: number;
  /** Drawn height: ground, crown top or water surface, within [0, HMAX]. */
  surf: Float32Array;
  mat: Uint8Array;
  /** Tone 0–255 before dithering. */
  light: Uint8Array;
  flags: Uint8Array;
  /** Water cells: shore distance 0–15 (sea, lakes) or flow phase 0–15 (rivers). Steep land: hatch level 1 or 2. */
  aux: Uint8Array;
}

// Margins round the core, in cells.
/** Trees shade at most this many diagonal steps. */
const TREE_REACH = 4;
/** A stamp reaches at most this far from the cell that placed it. */
const STAMP_REACH = 6;
const BLUR_R = 8;
const SHORE_CAP = 15;
/** Shore classes apply this many cells inland. */
const SHORE_BAND = 9;
/** Shore-distance tones run this many cells out; deeper tones follow the sea bed. */
const SHELF = 8;
/** The cover is told the way to the nearest river within this many cells. */
const RIVER_OFFSET = 8;
/** Rivers are looked for this many cells due north and due south of a cell. */
export const RIVER_SIGHT = 12;
/** A 1 px stream on ground steeper than this is not drawn: it would read as a rain streak. */
export const STREAM_MAX_SLOPE = 0.9;
/** Ground at least this steep is a cliff: it shows rock and takes hatching (the cover table draws faces from 1.7). */
export const CLIFF_SLOPE = 1.7;
/** Ground from this slope takes sparse hatching, so a long steep face never reads as a flat wall. */
export const STEEP_SLOPE = 1.15;
/** Cover is evaluated this far north-west and south-east of the core. */
const COVER_N = TREE_REACH + STAMP_REACH;
const COVER_S = 1 + STAMP_REACH;
/** Heights are needed this far out. */
const PAD_N = SHADOW_REACH + 1;
const PAD_S = RIVER_SIGHT + COVER_S + 1;

const WEIGHTS: Float64Array = (() => {
  const out = new Float64Array(16);
  for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4 - 0.5 - Math.floor((k + 0.5) / 4 - 0.5);
    const t2 = t * t, t3 = t2 * t, om = 1 - t;
    out[k * 4] = (om * om * om) / 6;
    out[k * 4 + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    out[k * 4 + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    out[k * 4 + 3] = t3 / 6;
  }
  return out;
})();

/** Ground heights of cells [x0, x0 + w) × [y0, y0 + h) by periodic cubic B-spline of G; matches core/bspline.ts. */
export function upsampleGround(src: Float32Array, gN: number, x0: number, y0: number, w: number, h: number, out: Float32Array): void {
  // Node rows needed: floor(v) − 1 … floor(v) + 2 for v = (y + 0.5)/4 − 0.5.
  const jMin = Math.floor((y0 + 0.5) / 4 - 0.5) - 1;
  const jMax = Math.floor((y0 + h - 0.5) / 4 - 0.5) + 2;
  const rows = jMax - jMin + 1;
  const tmp = new Float64Array(rows * w);
  const ix = new Int32Array(w * 4), wk = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const j = Math.floor((x0 + x + 0.5) / 4 - 0.5);
    wk[x] = wrap(x0 + x, 4);
    for (let q = 0; q < 4; q++) ix[x * 4 + q] = wrap(j - 1 + q, gN);
  }
  for (let r = 0; r < rows; r++) {
    const s = wrap(jMin + r, gN) * gN, d = r * w;
    for (let x = 0; x < w; x++) {
      const k = wk[x] * 4, q = x * 4;
      tmp[d + x] = WEIGHTS[k] * src[s + ix[q]] + WEIGHTS[k + 1] * src[s + ix[q + 1]] + WEIGHTS[k + 2] * src[s + ix[q + 2]] + WEIGHTS[k + 3] * src[s + ix[q + 3]];
    }
  }
  for (let y = 0; y < h; y++) {
    const j = Math.floor((y0 + y + 0.5) / 4 - 0.5);
    const k = wrap(y0 + y, 4) * 4;
    const r0 = (j - 1 - jMin) * w, d = y * w;
    const w0 = WEIGHTS[k], w1 = WEIGHTS[k + 1], w2 = WEIGHTS[k + 2], w3 = WEIGHTS[k + 3];
    for (let x = 0; x < w; x++) {
      out[d + x] = w0 * tmp[r0 + x] + w1 * tmp[r0 + w + x] + w2 * tmp[r0 + 2 * w + x] + w3 * tmp[r0 + 3 * w + x];
    }
  }
}

/** Ground height at one cell. */
export function groundAt(world: BakeWorld, x: number, y: number): number {
  const out = new Float32Array(1);
  upsampleGround(world.ground, world.gN, Math.floor(x), Math.floor(y), 1, 1, out);
  return out[0];
}

/** Chamfer 3–4 distance transform in place over the cells from (lo, lo) to the end of a w × h window; `d` holds 0 at sources and `big` elsewhere. */
function chamfer(d: Int16Array, w: number, h: number, lo: number): void {
  for (let y = lo; y < h; y++) {
    const row = y * w;
    for (let x = lo; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > lo && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > lo) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > lo && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x + 1 < w && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= lo; y--) {
    const row = y * w;
    for (let x = w - 1; x >= lo; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x + 1 < w && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y + 1 < h) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x + 1 < w && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > lo && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
      }
      d[i] = v;
    }
  }
}

/** Cells [x0, x0 + w) × [y0, y0 + h) of the world. Coordinates are unwrapped; any integers. */
export function buildCells(world: BakeWorld, look: Look, mask: Uint8Array, x0: number, y0: number, w: number, h: number): Cells {
  const { n, gN, cN } = world;
  const W = w + PAD_N + PAD_S, H = h + PAD_N + PAD_S;
  const wx0 = x0 - PAD_N, wy0 = y0 - PAD_N;
  const count = W * H;

  // 1. Ground.
  const ground = new Float32Array(count);
  upsampleGround(world.ground, gN, wx0, wy0, W, H, ground);
  // Pads, street terraces and the harbour, cut at cell size.
  const bi = world.built;
  // Under street terraces the cover is chosen from the hillside as it was, so a riser is a wall and not a crag.
  let natural: Float32Array | null = null;
  // Pads: 255 at the heart of a levelled pad, fading over its skirt; nothing is planted there.
  let pad: Uint8Array | null = null;
  let band: Uint8Array | null = null;
  if (bi) {
    for (const id of conformsIn(bi, wx0, wy0, wx0 + W, wy0 + H)) {
      const cf = bi.built.conforms[id];
      if (cf.kind === "terrace" && !natural) { natural = Float32Array.from(ground); band = new Uint8Array(count); }
      if (cf.kind === "flat" && cf.rx >= 5 && !pad) pad = new Uint8Array(count);
      const [rx, ry] = conformReach(cf);
      const ex = Math.floor(cf.x - rx), ey = Math.floor(cf.y - ry), sw = Math.ceil(2 * rx) + 2, sh = Math.ceil(2 * ry) + 2;
      const ox = imageOffset(ex, sw, wx0, n), oy = imageOffset(ey, sh, wy0, n);
      const ccx = cf.x - ex + ox, ccy = cf.y - ey + oy;
      for (let yy = Math.max(0, oy); yy < Math.min(H, oy + sh); yy++) for (let xx = Math.max(0, ox); xx < Math.min(W, ox + sw); xx++) {
        const k = yy * W + xx;
        const before = ground[k];
        ground[k] = conformed(cf, before, xx + 0.5 - ccx, yy + 0.5 - ccy);
        // Street terraces: which step a cell stands on, 1…3, cycling up the hill.
        if (cf.kind === "terrace" && band && ground[k] !== before) band[k] = 1 + (((Math.floor((ground[k] - cf.level) / cf.limit + 0.5) % 3) + 3) % 3);
        if (pad && cf.kind === "flat" && cf.rx >= 5) {
          const v = Math.floor(255 * conformWeight(cf, xx + 0.5 - ccx, yy + 0.5 - ccy));
          if (v > pad[k]) pad[k] = v;
        }
      }
    }
  }

  // 2. Water: lakes where the ground lies under a neighbouring lake node's level, sea at or below 0.
  const water = new Uint8Array(count);
  const level = new Float32Array(count);
  const gxa = Math.floor((wx0 + 0.5) / 4 - 0.5), gya = Math.floor((wy0 + 0.5) / 4 - 0.5);
  const gW = Math.floor((wx0 + W - 0.5) / 4 - 0.5) + 2 - gxa, gH = Math.floor((wy0 + H - 0.5) / 4 - 0.5) + 2 - gya;
  const lakeLevel = new Float32Array(gW * gH);
  let lakes = false;
  for (let j = 0; j < gH; j++) {
    const row = wrap(gya + j, gN) * gN;
    for (let i = 0; i < gW; i++) {
      const g = row + wrap(gxa + i, gN);
      if (world.waterKind[g] === 2) {
        lakeLevel[j * gW + i] = world.waterLevel[g];
        lakes = true;
      } else lakeLevel[j * gW + i] = -Infinity;
    }
  }
  for (let y = 0; y < H; y++) {
    const gj = Math.floor((wy0 + y + 0.5) / 4 - 0.5) - gya;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = ground[i];
      if (lakes) {
        const gi = Math.floor((wx0 + x + 0.5) / 4 - 0.5) - gxa;
        const a = gj * gW + gi;
        let top = lakeLevel[a];
        if (lakeLevel[a + 1] > top) top = lakeLevel[a + 1];
        if (lakeLevel[a + gW] > top) top = lakeLevel[a + gW];
        if (lakeLevel[a + gW + 1] > top) top = lakeLevel[a + gW + 1];
        // A lake's edge follows the ground where the bed is cut; on a flattened floor it follows the lake nodes' bilinear outline.
        let inside = e < top;
        if (!inside && top > -Infinity && e < top + 0.6) {
          const fx = (wx0 + x + 0.5) / 4 - 0.5 - (gi + gxa), fy = (wy0 + y + 0.5) / 4 - 0.5 - (gj + gya);
          const m = (lakeLevel[a] > -Infinity ? (1 - fx) * (1 - fy) : 0) + (lakeLevel[a + 1] > -Infinity ? fx * (1 - fy) : 0) +
            (lakeLevel[a + gW] > -Infinity ? (1 - fx) * fy : 0) + (lakeLevel[a + gW + 1] > -Infinity ? fx * fy : 0);
          inside = m >= 0.5;
        }
        if (inside) {
          water[i] = 2;
          level[i] = top < 0 ? 0 : top;
          continue;
        }
      }
      if (e <= 0) water[i] = 1;
    }
  }

  // The dry surface: ground, or the water standing on it, within the cap.
  const dry = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = water[i] ? level[i] : ground[i];
    dry[i] = v < 0 ? 0 : v > HMAX ? HMAX : v;
  }

  // 3. Terrain shadow ray and relief.
  const ray = new Float32Array(count);
  sweepShadow(dry, W, H, ray);
  const blur = new Float32Array(count), tmp = new Float64Array(count + W);
  boxBlur(dry, W, PAD_N, PAD_N + w, BLUR_R, blur, tmp);

  // 4. Shore distance on the water side, in cells, capped.
  const dist = new Int16Array(count);
  const big = 3 * 64;
  for (let i = 0; i < count; i++) dist[i] = water[i] ? big : 0;
  chamfer(dist, W, H, PAD_N - SHORE_CAP - 1);

  // Cells from the sea on the land side, so shore bands follow the coast and not the G nodes.
  const inland = new Int16Array(count);
  for (let i = 0; i < count; i++) inland[i] = water[i] === 1 ? 0 : big;
  chamfer(inland, W, H, PAD_N - COVER_N - SHORE_BAND - 2);

  // 5. Rivers: the cells under each curve, the flow phase there, and the distance to the nearest.
  const riv = new Int16Array(count).fill(big);
  const phase = new Uint8Array(count);
  /** River cells of a river at least 2 cells wide: the ones that carry riverside trees. */
  const wide = new Uint8Array(count);
  let rivers = false;
  forEachRiverPoint(world, wx0, wy0, wx0 + W, wy0 + H, (px, py, width, run) => {
    const r = width / 2, r2 = r * r;
    const cx = Math.floor(px) - wx0, cy = Math.floor(py) - wy0;
    if (width === 1) {
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) return;
      const k = cy * W + cx;
      const sx = (ground[k + 1] - ground[k - 1]) * 0.5, sy = (ground[k + W] - ground[k - W]) * 0.5;
      if (sx * sx + sy * sy > STREAM_MAX_SLOPE * STREAM_MAX_SLOPE) return;
    }
    const reach = Math.floor(r + 0.5);
    for (let yy = cy - reach; yy <= cy + reach; yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = cx - reach; xx <= cx + reach; xx++) {
        if (xx < 0 || xx >= W) continue;
        const dx = xx + 0.5 + wx0 - px, dy = yy + 0.5 + wy0 - py;
        if ((xx !== cx || yy !== cy) && dx * dx + dy * dy > r2) continue;
        const i = yy * W + xx;
        if (water[i]) continue;
        // Several curve points land on one cell; the lowest run wins so the phase never depends on their order.
        // Tones 0–7: flow phase of a river; 8: a 1 px stream; 15: foam (set at falls).
        const ph = width === 1 ? 8 : Math.floor(run) & 7;
        if (riv[i] !== 0 || ph < phase[i]) phase[i] = ph;
        riv[i] = 0;
        if (width >= 2) wide[i] = 1;
        rivers = true;
      }
    }
  });
  // Waterfalls: foam on the river at the drop, and a plunge pool just south of it.
  const falls = world.falls;
  for (let f = 0; f < falls.length; f += 3) {
    let fx = falls[f] - wx0, fy = falls[f + 1] - wy0;
    fx -= Math.floor(fx / n) * n;
    fy -= Math.floor(fy / n) * n;
    for (let oy = fy > H + 8 ? fy - n : fy; oy < H + 8; oy += n) for (let ox = fx > W + 8 ? fx - n : fx; ox < W + 8; ox += n) {
      const cx = Math.floor(ox), cy = Math.floor(oy);
      for (let yy = cy - 3; yy <= cy + 6; yy++) for (let xx = cx - 3; xx <= cx + 3; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = yy * W + xx;
        if (water[i]) continue;
        const dx = xx + 0.5 - ox, dy = yy + 0.5 - oy;
        if (riv[i] === 0 && dx * dx + dy * dy <= 6.5) phase[i] = 15;
        else if (dx * dx + (dy - 3.5) * (dy - 3.5) <= 5) { if (riv[i] !== 0) phase[i] = 0; riv[i] = 0; rivers = true; }
      }
    }
  }

  // Cells to the nearest river due north and due south, within sight.
  const rivN = new Uint8Array(count).fill(255), rivS = new Uint8Array(count).fill(255);
  if (rivers) {
    for (let x = 0; x < W; x++) {
      let d = 255;
      for (let y = 0; y < H; y++) {
        const i = y * W + x;
        d = riv[i] === 0 ? 0 : d < RIVER_SIGHT ? d + 1 : 255;
        rivN[i] = d;
      }
      d = 255;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * W + x;
        d = riv[i] === 0 ? 0 : d < RIVER_SIGHT ? d + 1 : 255;
        rivS[i] = d;
      }
    }
  }
  // Roads: the cells under each line (1 a path, 2 a road), and the cells within two of one, where nothing is planted.
  const road = new Uint8Array(count), roadNear = new Uint8Array(count);
  if (world.roads && world.roads.segments.length) {
    let any = false;
    forEachLinePoint(world.roads, wx0, wy0, wx0 + W, wy0 + H, (px, py, width) => {
      const cx = Math.floor(px) - wx0, cy = Math.floor(py) - wy0;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      const k = cy * W + cx;
      if (water[k] || riv[k] === 0) return;
      if (width > road[k]) road[k] = width > 2 ? 2 : width;
      any = true;
    });
    if (any) {
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const k = y * W + x;
        if (road[k] === 0) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 5) roadNear[k + dy * W + dx] = 1;
      }
    }
  }
  const sight = { north: Infinity, south: Infinity };
  // Distance to the nearest river in any direction, for the cover's field boundaries. River cells stay 0.
  if (rivers) chamfer(riv, W, H, PAD_N - COVER_N - RIVER_OFFSET - 1);

  // 6. Cover, then scatter stamped into a crown layer.
  const cw = w + COVER_N + COVER_S, ch = h + COVER_N + COVER_S;
  const cOff = PAD_N - COVER_N;
  const gmat = new Uint8Array(count);
  const crown = new Float32Array(count).fill(-Infinity);
  const crownMat = new Uint8Array(count);
  const slope = new Float32Array(count);
  const terr = new Uint8Array(count);
  const rockAt = new Uint8Array(count);
  const shoreAt = new Uint8Array(count);
  const region = new Float32Array(6);
  const c: CoverInput = { x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0, rock: 0, region, water: 0, shore: 0, westness: 0, riverDx: 0, riverDy: 0, riverWide: 0 };
  const cc = cN * cN;
  const rockW = new Float64Array(3);
  // Stamps may only touch cells whose crowns matter: the core, TREE_REACH to the north-west and one cell round.
  const sLo = PAD_N - TREE_REACH, sHiX = PAD_N + w + 1, sHiY = PAD_N + h + 1;

  // Column lookups for the two grids.
  const gI0 = new Int32Array(cw), gI1 = new Int32Array(cw), gF = new Float32Array(cw);
  const cI0 = new Int32Array(cw), cI1 = new Int32Array(cw), cF = new Float32Array(cw);
  for (let x = 0; x < cw; x++) {
    const wx = wx0 + cOff + x;
    const gu = (wx + 0.5) / 4 - 0.5, gj = Math.floor(gu);
    gI0[x] = wrap(gj, gN); gI1[x] = wrap(gj + 1, gN); gF[x] = gu - gj;
    const cu = (wx + 0.5) / 8 - 0.5, cj = Math.floor(cu);
    cI0[x] = wrap(cj, cN); cI1[x] = wrap(cj + 1, cN); cF[x] = cu - cj;
  }
  const { hand, shore, moisture, wind, exposure, debris, rock, regions } = world;

  for (let y = 0; y < ch; y++) {
    const wy = wy0 + cOff + y;
    const gv = (wy + 0.5) / 4 - 0.5, gj = Math.floor(gv), gfy = gv - gj;
    const gr0 = wrap(gj, gN) * gN, gr1 = wrap(gj + 1, gN) * gN;
    const cv = (wy + 0.5) / 8 - 0.5, cj = Math.floor(cv), cfy = cv - cj;
    const cr0 = wrap(cj, cN) * cN, cr1 = wrap(cj + 1, cN) * cN;
    c.y = wrap(wy, n);
    for (let x = 0; x < cw; x++) {
      const i = (y + cOff) * W + x + cOff;
      const terraced = band !== null && band[i] !== 0;
      const src = terraced ? (natural as Float32Array) : ground;
      const e = src[i];
      const dx = (src[i + 1] - src[i - 1]) * 0.5, dy = (src[i + W] - src[i - W]) * 0.5;
      const s = Math.sqrt(dx * dx + dy * dy);
      slope[i] = s;
      if (terraced) terr[i] = 1;

      const gfx = gF[x];
      const g00 = gr0 + gI0[x], g10 = gr0 + gI1[x], g01 = gr1 + gI0[x], g11 = gr1 + gI1[x];
      const ha = hand[g00] + (hand[g10] - hand[g00]) * gfx, hb = hand[g01] + (hand[g11] - hand[g01]) * gfx;
      const sh = inland[i] <= 3 * SHORE_BAND ? shore[gfy < 0.5 ? (gfx < 0.5 ? g00 : g10) : gfx < 0.5 ? g01 : g11] : 0;
      shoreAt[i] = sh;

      const cfx = cF[x];
      const w00 = (1 - cfx) * (1 - cfy), w10 = cfx * (1 - cfy), w01 = (1 - cfx) * cfy, w11 = cfx * cfy;
      const c00 = cr0 + cI0[x], c10 = cr0 + cI1[x], c01 = cr1 + cI0[x], c11 = cr1 + cI1[x];
      // Rock is a class, so it takes the heaviest corner vote and its borders run smooth, not in 8-cell steps.
      rockW[0] = 0; rockW[1] = 0; rockW[2] = 0;
      rockW[rock[c00]] += w00; rockW[rock[c10]] += w10; rockW[rock[c01]] += w01; rockW[rock[c11]] += w11;
      const rk = rockW[0] >= rockW[1] ? (rockW[0] >= rockW[2] ? 0 : 2) : rockW[1] >= rockW[2] ? 1 : 2;
      rockAt[i] = rk;

      c.x = wrap(wx0 + cOff + x, n);
      c.e = e;
      c.slope = s;
      c.northness = s > 1e-6 ? dy / s : 0;
      c.westness = s > 1e-6 ? dx / s : 0;
      // The way from the nearest river to here: the gradient of the river distance, scaled to that distance.
      c.riverDx = 0;
      c.riverDy = 0;
      c.riverWide = 0;
      if (rivers) {
        if (rivS[i] !== 255 && wide[i + rivS[i] * W] === 1) c.riverWide = 1;
        else if (rivN[i] !== 255 && wide[i - rivN[i] * W] === 1) c.riverWide = 1;
      }
      if (rivers && riv[i] > 0 && riv[i] < 3 * RIVER_OFFSET) {
        const rx = riv[i + 1] - riv[i - 1], ry = riv[i + W] - riv[i - W];
        const rl = Math.sqrt(rx * rx + ry * ry);
        if (rl > 0) {
          c.riverDx = (rx / rl) * (riv[i] / 3);
          c.riverDy = (ry / rl) * (riv[i] / 3);
        }
      }
      c.hand = ha + (hb - ha) * gfy;
      c.moisture = w00 * moisture[c00] + w10 * moisture[c10] + w01 * moisture[c01] + w11 * moisture[c11];
      c.wind = w00 * wind[c00] + w10 * wind[c10] + w01 * wind[c01] + w11 * wind[c11];
      c.exposure = w00 * exposure[c00] + w10 * exposure[c10] + w01 * exposure[c01] + w11 * exposure[c11];
      c.debris = w00 * debris[c00] + w10 * debris[c10] + w01 * debris[c01] + w11 * debris[c11];
      c.rock = rk;
      for (let a = 0; a < 6; a++) {
        const o = a * cc;
        region[a] = w00 * regions[o + c00] + w10 * regions[o + c10] + w01 * regions[o + c01] + w11 * regions[o + c11];
      }
      c.shore = sh;
      c.water = water[i] ? water[i] : riv[i] === 0 ? 3 : 0;
      const m = look.cover(c, mask);
      gmat[i] = m;
      if (c.water !== 0) continue;
      if (roadNear[i] !== 0) {
        if (road[i] !== 0 && bi) gmat[i] = road[i] === 2 ? bi.built.mats.road : bi.built.mats.path;
        continue;
      }
      if (band !== null && band[i] !== 0) {
        // The town's hillside is gardens and vines, a terrace of each in turn, with few trees.
        if (bi) gmat[i] = band[i] === 2 ? bi.built.mats.vine : bi.built.mats.yard;
        if ((mask[((c.y + 201) & 255) * 256 + ((c.x + 9) & 255)] & 31) !== 0) continue;
      }
      if (pad !== null && pad[i] > 40) {
        // A pad is a clearing: grass, speckled out over its skirt, and nothing planted.
        if (bi && pad[i] > mask[((c.y + 37) & 255) * 256 + ((c.x + 101) & 255)]) gmat[i] = bi.built.mats.yard;
        continue;
      }

      sight.north = rivN[i] === 255 ? Infinity : rivN[i];
      sight.south = rivS[i] === 255 ? Infinity : rivS[i];
      const st = look.scatter(c, m, mask, sight);
      if (!st) continue;
      if (st.h <= 0) {
        // A flat stamp (flowers) only recolours the ground it is rooted on.
        gmat[i] = st.mat;
        continue;
      }
      // The stamp's centre in window cells, and the ground it stands on.
      let ox = st.x - c.x, oy = st.y - c.y;
      if (ox > n / 2) ox -= n; else if (ox < -n / 2) ox += n;
      if (oy > n / 2) oy -= n; else if (oy < -n / 2) oy += n;
      const scx = ox + (x + cOff), scy = oy + (y + cOff);
      const r = st.r > STAMP_REACH - 1.5 ? STAMP_REACH - 1.5 : st.r;
      const bx = Math.floor(scx), by = Math.floor(scy);
      if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
      const base = ground[by * W + bx];
      const r2 = r * r;
      const lx = Math.max(sLo, Math.ceil(scx - r - 0.5)), hx = Math.min(sHiX - 1, Math.floor(scx + r - 0.5));
      const ly = Math.max(sLo, Math.ceil(scy - r - 0.5)), hy = Math.min(sHiY - 1, Math.floor(scy + r - 0.5));
      for (let yy = ly; yy <= hy; yy++) {
        for (let xx = lx; xx <= hx; xx++) {
          const ddx = xx + 0.5 - scx, ddy = yy + 0.5 - scy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > r2) continue;
          const k = yy * W + xx;
          if (water[k] || riv[k] === 0) continue;
          const f = st.shape === 1 ? 1 - (0.85 * Math.sqrt(d2)) / r : 0.35 + 0.65 * Math.sqrt(1 - d2 / r2);
          const top = base + st.h * f;
          if (top > crown[k] && top > ground[k]) {
            crown[k] = top;
            crownMat[k] = st.mat;
          }
        }
      }
    }
  }

  // Structures: their tops go into the crown layer over whatever grew there; their yards repaint the ground.
  const fixed = new Uint8Array(count), made = new Uint8Array(count);
  if (bi) {
    for (const id of structuresIn(bi, wx0, wy0, wx0 + W, wy0 + H)) {
      const s = bi.built.structures[id];
      const ox = imageOffset(s.x, s.w, wx0, n), oy = imageOffset(s.y, s.h, wy0, n);
      for (let j = 0; j < s.h; j++) {
        const yy = oy + j;
        if (yy < 0 || yy >= H) continue;
        for (let q = 0; q < s.w; q++) {
          const xx = ox + q;
          if (xx < 0 || xx >= W) continue;
          const a = j * s.w + q, k = yy * W + xx;
          if (s.top[a] > 0) {
            crown[k] = s.base + s.top[a];
            crownMat[k] = s.mat[a];
            fixed[k] = s.tone[a];
            made[k] = 2;
          } else if (s.paint[a] !== 0 && made[k] !== 2) {
            crown[k] = -Infinity;
            if (!water[k] && riv[k] !== 0) { gmat[k] = s.paint[a]; made[k] = 1; }
          }
        }
      }
    }
  }

  // 7. The drawn surface over the crown region.
  const surf = new Float32Array(count);
  for (let y = sLo - 1; y <= sHiY; y++) {
    for (let x = sLo - 1; x <= sHiX; x++) {
      const i = y * W + x;
      const v = crown[i] > dry[i] ? crown[i] : dry[i];
      surf[i] = v > HMAX ? HMAX : v;
    }
  }

  // 8. Light, shadow and flags for the core.
  const out: Cells = { w, h, surf: new Float32Array(w * h), mat: new Uint8Array(w * h), light: new Uint8Array(w * h), flags: new Uint8Array(w * h), aux: new Uint8Array(w * h) };
  const noInk = look.noInk;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + PAD_N) * W + x + PAD_N;
      const o = y * w + x;
      const top = surf[i];
      const hasCrown = crown[i] > dry[i];
      let m = hasCrown ? crownMat[i] : gmat[i];
      const structure = hasCrown && made[i] === 2;
      // A street terrace's riser is a retaining wall.
      if ((made[i] === 1 || terr[i] === 1) && !hasCrown && bi && ground[i] - ground[i + W] > 1.2) m = bi.built.mats.retaining;
      let flags = 0;

      // Shadow: terrain by the exact sweep, crowns and rocks by a short march.
      let over = ray[i];
      const deep = over - top >= 9;
      for (let k = 1; k <= TREE_REACH; k++) {
        const v = surf[i - k * (W + 1)] - k * SHADOW_DROP;
        if (v > over) over = v;
      }
      flags |= shadowDepth(over, top);

      out.surf[o] = top;
      out.mat[o] = m;
      if (water[i] !== 0 && !structure) {
        // Tone: cells from the shore across the shallows, then the depth of the water beyond them.
        // Blue noise per cell breaks the steps between tones into a wash.
        const dither = (mask[((wrap(y0 + y, n) + 91) & 255) * 256 + ((wrap(x0 + x, n) + 157) & 255)] + 0.5) / 256;
        const d = (dist[i] - 3) / 3;
        const depth = (water[i] === 2 ? level[i] : 0) - ground[i];
        // Low-frequency mottling: a wash, not a gradient.
        const per = n / 32;
        const mottle = 1.1 * gradNoise(wrap(x0 + x, n) / 32, wrap(y0 + y, n) / 32, per, 0x5ea) + 0.5 * gradNoise(wrap(x0 + x, n) / 8, wrap(y0 + y, n) / 8, n / 8, 0x5eb);
        const far = SHELF + (depth - 1) / 3.5 + mottle;
        const v = Math.floor((d < SHELF ? (d < 0.5 ? 0 : d + dither - 0.5) : far < SHELF ? SHELF : far + dither - 0.5));
        out.aux[o] = v < 0 ? 0 : v > 15 ? 15 : v;
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }
      if (riv[i] === 0 && !structure) {
        out.aux[o] = phase[i];
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }

      const gx = (surf[i + 1] - surf[i - 1]) * 0.5, gy = (surf[i + W] - surf[i - W]) * 0.5;
      let bump = 0;
      if (!hasCrown && slope[i] > 0.9) {
        // Micro-relief: steep ground is ribbed by gullies running down it, drawn as light only.
        const u = wrap(x0 + x, n) / 3, v = wrap(y0 + y, n) / 4, per = n / 4;
        const rib = gradNoise(u * 0.75, v, per, 0x61b) + gradNoise(u * 0.75, v + 1, per, 0x61b) + 0.6 * gradNoise(u * 0.75 + 40.5, v + 17, per, 0x7c3);
        bump = 1.2 * rib * (slope[i] > 1.9 ? 1 : slope[i] - 0.9);
      }
      let tone = shade(gx + bump, gy, dry[i] - blur[i], ground[i]);
      if (hasCrown) {
        // A crown is modelled by its own dome, but keeps the light of the hillside it stands on, so woods show the land's form.
        const under = shade((ground[i + 1] - ground[i - 1]) * 0.5, (ground[i + W] - ground[i - W]) * 0.5, dry[i] - blur[i], ground[i]);
        tone = under + 0.55 * (shade(gx, gy, 0, 0) - 0.5);
        tone = tone < 0 ? 0 : tone > 1 ? 1 : tone;
      }
      out.light[o] = structure && fixed[i] !== 0 ? fixed[i] : Math.floor(tone * 255 + 0.5);

      const canopy = hasCrown && look.isCanopy[m] === 1;
      if (canopy) flags |= F_CANOPY;
      else {
        if (!hasCrown && made[i] === 0 && terr[i] === 0 && slope[i] >= STEEP_SLOPE) {
          // Steep ground is hatched: sparsely from STEEP_SLOPE, densely on true cliffs. The level rides in aux.
          flags |= F_CLIFF;
          out.aux[o] = slope[i] >= CLIFF_SLOPE ? 2 : 1;
        }
        if (deep) flags |= F_DEEP;
      }
      if (rockAt[i] !== 0) flags |= F_BEDDED;
      const sh = shoreAt[i];
      if ((noInk && noInk[m] === 1) || (sh === 1 && slope[i] < 0.5 && ground[i] < 3)) flags |= F_QUIET;
      if (sh === 3) flags |= F_SEACLIFF;
      out.flags[o] = flags;
    }
  }
  return out;
}

/** The 256² cell tile (tx, ty). */
export function buildTile(world: BakeWorld, look: Look, mask: Uint8Array, tx: number, ty: number): Cells {
  return buildCells(world, look, mask, tx * TILE, ty * TILE, TILE, TILE);
}
