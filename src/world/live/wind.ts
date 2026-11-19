// Wind: gusts brushing across grass and crops, and tree crowns stirring as they pass.
//
// A gust is a slanted band of a fixed noise field sliding east over bake space in whole pixels. Grass under it is drawn
// one tone lighter, through the palette; the band's edge is feathered by a grain fixed to the land, so each pixel turns
// once as the gust arrives and once as it leaves. Under the heart of a gust a crown's shading leans a pixel downwind,
// in patches that take turns, and its outline never moves.

import { hash2 } from "../core/hash.ts";
import { isCanopy, isGrass } from "../look/materials.ts";
import { modP } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";

/** The gust field: 800 bake pixels wide (the world is a whole number of them round) and 256 rows of two pixels. */
const GW = 800;
const GH = 256;
/** Bake pixels a second the gusts travel east. */
export const GUST_SPEED = 14;
/** Share of the land under a gust at any moment, and under its heart, as levels of the field (0–255, even in area). */
const GUST = 196;
const HEART = 236;
/** How wide the feathered edge is, in levels. */
const FEATHER = 20;
/** Seconds a patch of crown leans before it swings back. */
const SWAY = 0.9;

const K_GRASS = 1, K_CROWN = 2;
const KIND = new Uint8Array(256);
for (let m = 0; m < 256; m++) KIND[m] = isGrass[m] === 1 ? K_GRASS : isCanopy[m] === 1 ? K_CROWN : 0;

/** The field's lattice: fronts some 40 pixels through and 130 long, before they are leaned. */
const CELL_X = 40;
const CELL_ROWS = 64;

/** Smooth value noise on a lattice of cw × ch that wraps round the field; 0–1. */
function lattice(x: number, y: number, cw: number, ch: number, seed: number): number {
  const nx = GW / cw, ny = GH / ch;
  const gx = x / cw, gy = y / ch;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x1 = (ix + 1) % nx, y1 = (iy + 1) % ny;
  const a = hash2(ix, iy, seed) & 1023, b = hash2(x1, iy, seed) & 1023;
  const c = hash2(ix, y1, seed) & 1023, d = hash2(x1, y1, seed) & 1023;
  const top = a + (b - a) * u, bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) / 1023;
}

/** The gusts, levelled so each value 0–255 covers the same area: long fronts with ragged ends. */
function gustField(seed: number): Uint8Array {
  const raw = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    raw[y * GW + x] = lattice(x, y, CELL_X, CELL_ROWS, seed ^ 0x77a1) + 0.3 * lattice(x, y, CELL_X / 2, CELL_ROWS / 4, seed ^ 0x1e55);
  }
  const order = new Uint32Array(GW * GH);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => raw[a] - raw[b]);
  const out = new Uint8Array(GW * GH);
  for (let k = 0; k < order.length; k++) out[order[k]] = Math.floor((k * 256) / order.length);
  return out;
}

function grainTile(seed: number): Uint8Array {
  const out = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) out[i] = hash2(i & 255, i >> 8, seed ^ 0x51d3) % FEATHER;
  return out;
}

/**
 * The runs of each row of the field at `floor` or more, as [start, end) pairs in `runs`, row r's from at[r] to at[r + 1].
 * At GUST − FEATHER (below which even the grain cannot lift a pixel to GUST) they are where the wind can move anything:
 * about a third of the field, so the layer looks at only that share of the frame.
 */
function gustRuns(gust: Uint8Array, floor: number): { at: Int32Array; runs: Int32Array } {
  const at = new Int32Array(GH + 1);
  const list: number[] = [];
  for (let r = 0; r < GH; r++) {
    at[r] = list.length;
    for (let x = 0; x < GW; ) {
      if (gust[r * GW + x] < floor) { x++; continue; }
      const start = x;
      while (x < GW && gust[r * GW + x] >= floor) x++;
      list.push(start, x);
    }
  }
  at[GH] = list.length;
  return { at, runs: Int32Array.from(list) };
}

export interface WindOptions {
  /** Look at every pixel of the frame, not only those under the gusts: the plain path the tests hold the fast one to. */
  plain?: boolean;
}

/** The wind in the grass and the trees. `seed` is the world's. */
export function windLayer(seed: number, opts: WindOptions = {}): LiveLayer {
  const gust = gustField(seed);
  const { at: runAt, runs } = gustRuns(gust, opts.plain ? 0 : GUST - FEATHER);
  const grain = grainTile(seed);
  /** Which patches of crown lean on which beat: 64 × 64 patches of 8 × 6 pixels. */
  const turn = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) turn[i] = hash2(i & 63, i >> 6, seed ^ 0x2c9f) % 3;

  return {
    name: "wind",
    draw(f: LiveFrame): void {
      const { out, bake, palette, t } = f;
      const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
      const shift = Math.floor(t * GUST_SPEED);
      const beat = Math.floor(t / SWAY) % 3;
      // The tables, as locals: read through the closure, each would be fetched again on every pixel.
      const field = gust, at = runAt, spans = runs, feather = grain, turns = turn, kindOf = KIND;
      for (let py = 0; py < h; py++) {
        const by = ry + py;
        const half = by >> 1;
        const fieldRow = half & (GH - 1);
        const row = fieldRow * GW;
        const grainRow = (by & 255) << 8;
        const turnRow = (Math.floor(by / 6) & 63) << 6;
        // The fronts lean: the field is sheared a pixel for every two rows. Pixel px reads the field at g0 + px, wrapped.
        const g0 = modP(rx + half - shift, GW);
        const line = py * w;
        // Each run, and its copies a field further on, against the frame's span of the field [g0, g0 + w).
        for (let q = at[fieldRow], qEnd = at[fieldRow + 1]; q < qEnd; q += 2) {
          for (let copy = 0; spans[q] + copy - g0 < w; copy += GW) {
            const lo = spans[q] + copy - g0, hi = spans[q + 1] + copy - g0;
            const px0 = lo < 0 ? 0 : lo, px1 = hi > w ? w : hi;
            for (let px = px0, i = line + px0, g = row + px0 + g0 - copy; px < px1; px++, i++, g++) {
              const level = field[g];
              const v = bake[i];
              const k = kindOf[v & 255];
              if (k === 0) continue;
              const light = (v >>> 8) & 255;
              // Ink is a drawn line: it stays.
              if (light >= 64) continue;
              if (k === K_GRASS) {
                const tone = light & 15;
                if (tone === 15) continue;
                const lifted = level + feather[grainRow | ((rx + px) & 255)];
                if (lifted < GUST) continue;
                out[i] = palette[(((v & 255) << 8) | light) + (lifted >= HEART && tone < 14 ? 2 : 1)];
              } else {
                if (level < GUST || px === 0) continue;
                if (turns[turnRow | (((rx + px) >> 3) & 63)] !== beat) continue;
                const u = bake[i - 1];
                const ul = (u >>> 8) & 255;
                if (kindOf[u & 255] !== K_CROWN || ul >= 64) continue;
                out[i] = palette[((u & 255) << 8) | ul];
              }
            }
          }
        }
      }
    },
  };
}
