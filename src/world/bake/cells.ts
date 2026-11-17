// Cell tiles: the land rebuilt per world cell from the generator's grids.
// Ground by cubic B-spline, water, cover, scatter stamped into height and
// material, light and cast shadows. Every output is a pure function of the
// wrapped cell position, so any window equals the same crop of any other.

import { wrap } from "../core/torus.ts";
import type { CoverInput, Palette, Stamp } from "../look/contract.ts";
import { boxBlur, shade, shadowDepth, SHADOW_DROP, SHADOW_REACH, sweepShadow } from "./light.ts";
import { forEachRiverPoint } from "./lines.ts";
import { HMAX, type BakeWorld } from "./world.ts";

export const TILE = 256;

/** What the cover and palette side hands the bake. */
export interface Look {
  cover(c: CoverInput, mask: Uint8Array): number;
  scatter(c: CoverInput, groundMat: number, mask: Uint8Array, riverDist?: number): Stamp | null;
  /** Per material id: 1 for water. */
  isWater: Uint8Array;
  /** Per material id: 1 for tree crowns. */
  isCanopy: Uint8Array;
  palette: Palette;
  /** Per material id: 1 where ink is never drawn (fields, roads, sand). Optional. */
  noInk?: Uint8Array;
}

/** Cell flags. */
export const F_SHADOW = 0x03;
export const F_CANOPY = 0x04;
/** Ground slope ≥ 2: a cliff, the only ground that shows rock walls and hatching. */
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
  /** Water cells: shore distance 0–15 (sea, lakes) or flow phase 0–15 (rivers). */
  aux: Uint8Array;
}

// Margins round the core, in cells.
/** Trees shade at most this many diagonal steps. */
const TREE_REACH = 4;
/** A stamp reaches at most this far from the cell that placed it. */
const STAMP_REACH = 6;
const BLUR_R = 8;
const SHORE_CAP = 15;
const RIVER_CAP = 8;
/** Cover is evaluated this far north-west and south-east of the core. */
const COVER_N = TREE_REACH + STAMP_REACH;
const COVER_S = 1 + STAMP_REACH;
/** Heights are needed this far out. */
const PAD_N = SHADOW_REACH + 1;
const PAD_S = RIVER_CAP + COVER_S + 1;

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

/** Chamfer 3–4 distance transform in place over a w × h window; `d` holds 0 at sources and `big` elsewhere. */
function chamfer(d: Int16Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > 0 && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x + 1 < w && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x + 1 < w && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y + 1 < h) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x + 1 < w && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
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
        if (e < top) {
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
  const blur = new Float32Array(count), tmp = new Float32Array(count);
  boxBlur(dry, W, H, BLUR_R, blur, tmp);

  // 4. Shore distance on the water side, in cells, capped.
  const dist = new Int16Array(count);
  const big = 3 * 64;
  for (let i = 0; i < count; i++) dist[i] = water[i] ? big : 0;
  chamfer(dist, W, H);

  // 5. Rivers: the cells under each curve, the flow phase there, and the distance to the nearest.
  const riv = new Int16Array(count).fill(big);
  const phase = new Uint8Array(count);
  let rivers = false;
  forEachRiverPoint(world, wx0, wy0, wx0 + W, wy0 + H, (px, py, width, run) => {
    const r = width / 2, r2 = r * r;
    const cx = Math.floor(px) - wx0, cy = Math.floor(py) - wy0;
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
        const ph = Math.floor(run) & 15;
        if (riv[i] !== 0 || ph < phase[i]) phase[i] = ph;
        riv[i] = 0;
        rivers = true;
      }
    }
  });
  if (rivers) chamfer(riv, W, H);

  // 6. Cover, then scatter stamped into a crown layer.
  const cw = w + COVER_N + COVER_S, ch = h + COVER_N + COVER_S;
  const cOff = PAD_N - COVER_N;
  const gmat = new Uint8Array(count);
  const crown = new Float32Array(count).fill(-Infinity);
  const crownMat = new Uint8Array(count);
  const slope = new Float32Array(count);
  const rockAt = new Uint8Array(count);
  const shoreAt = new Uint8Array(count);
  const region = new Float32Array(6);
  const c: CoverInput = { x: 0, y: 0, e: 0, slope: 0, northness: 0, hand: 0, moisture: 0, wind: 0, exposure: 0, debris: 0, rock: 0, region, water: 0, shore: 0 };
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
      const e = ground[i];
      const dx = (ground[i + 1] - ground[i - 1]) * 0.5, dy = (ground[i + W] - ground[i - W]) * 0.5;
      const s = Math.sqrt(dx * dx + dy * dy);
      slope[i] = s;

      const gfx = gF[x];
      const g00 = gr0 + gI0[x], g10 = gr0 + gI1[x], g01 = gr1 + gI0[x], g11 = gr1 + gI1[x];
      const ha = hand[g00] + (hand[g10] - hand[g00]) * gfx, hb = hand[g01] + (hand[g11] - hand[g01]) * gfx;
      const sh = shore[gfy < 0.5 ? (gfx < 0.5 ? g00 : g10) : gfx < 0.5 ? g01 : g11];
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

      const rd = riv[i] / 3;
      const st = look.scatter(c, m, mask, rd > RIVER_CAP ? RIVER_CAP : rd);
      if (!st) continue;
      // The stamp's centre in window cells, and the ground it stands on.
      const scx = st.x - c.x + (x + cOff), scy = st.y - c.y + (y + cOff);
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
      const m = hasCrown ? crownMat[i] : gmat[i];
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
      if (water[i] !== 0) {
        const d = Math.floor((dist[i] - 1) / 3);
        out.aux[o] = d > SHORE_CAP ? SHORE_CAP : d < 0 ? 0 : d;
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }
      if (riv[i] === 0) {
        out.aux[o] = phase[i];
        out.light[o] = 128;
        out.flags[o] = flags | F_QUIET;
        continue;
      }

      const gx = (surf[i + 1] - surf[i - 1]) * 0.5, gy = (surf[i + W] - surf[i - W]) * 0.5;
      const tone = shade(gx, gy, dry[i] - blur[i], ground[i]);
      out.light[o] = Math.floor(tone * 255 + 0.5);

      const canopy = hasCrown && look.isCanopy[m] === 1;
      if (canopy) flags |= F_CANOPY;
      else {
        if (!hasCrown && slope[i] >= 2) flags |= F_CLIFF;
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
