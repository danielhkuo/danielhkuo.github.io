// Mist: low banks lying on the water and the low open ground, drifting slowly with the wind. The palette lays only a
// thin even veil; these banks are the mist itself: rounded lumps, thick at the heart, pooled on water, marsh and
// shore, lying on fields and meadows, with the tree crowns, the roofs, the moors and the heights standing clear.
//
// The banks are a fixed field of lumps sliding over bake space in whole pixels. A pixel under a bank goes part of the
// way to the mist's colour in flat steps, like the tones of a painted cloud; the outermost edge alone is broken by a
// 4 × 4 ordered dither that thins outward, so a bank ends softly and never in a checker. The colour follows the
// light: cream by day, warm at the golden hour, violet at dusk, blue-grey by night. Only the field's runs are walked,
// up to two fifths of the frame (thick mist stills the wind layer, which more than pays for it), under the flier.

import { hash2 } from "../core/hash.ts";
import { isBuilt, isCanopy, isWater, MATERIAL as M } from "../look/materials.ts";
import { gradeRgb } from "../render/palette.ts";
import { lightKey, type Air } from "../sky/air.ts";
import { rainLean } from "../sky/rain.ts";
import { modP } from "./art.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";

/** The field: 512 bake pixels by 256 rows; the world is a whole number of them round, both ways. */
const FW = 512;
const FH = 256;
/** The field's lattices: the lumps, the smaller lumps on their flanks, and the scallops of their edges; with weights. */
const LUMP = [64, 32, 1] as const;
const FLANK = [32, 16, 0.5] as const;
const SCALLOP = [16, 8, 0.22] as const;
/** Of 256 levels, even in area: where a bank's edge starts on land in full mist. */
const EDGE = 204;
/** How many levels past the edge each step of tone starts. The last is past any land's reach: only pooled mist has a heart. */
const STEPS = [0, 12, 26, 42, 64] as const;
/** The dithered edge is this many levels deep: its cover rises from a sixteenth to whole across it. */
const SOFT = 8;
/** Water, marsh and shore are this many levels deeper in mist: the banks pool there, wider and thicker. */
const POOL = 20;
/**
 * Of 256: how far a pixel goes to the mist's colour at each step, from the edge to the heart. The body stops at a
 * little over half, so the land shows through and a bank never reads as snow; only a heart on water is thicker.
 */
const TONES = [50, 84, 114, 141, 178] as const;
/** Over tree crowns a bank is this many times shallower: it thins to its dithered edge and drifts over the wood. */
const OVER_CROWNS = 4;
/** Bake pixels a second the banks drift. */
export const MIST_DRIFT = 2.5;
/** The mist's own colour in daylight. It takes WARMTH of the day's light, so it warms and cools but stays pale. */
const MIST = 0xfff6f0ea;
const WARMTH = 0.5;
/** By night it goes this far to a blue-grey of its own, lighter than the dark land. */
const NIGHT_MIST = 0xff6e5040;
const NIGHT_SHARE = 0.7;

/** The step a pixel `deep` levels into a bank takes: a table, so the frame's loop does not divide. */
const STEP_OF = Uint8Array.from({ length: 128 }, (_, deep) => STEPS.findLastIndex((from) => deep >= from));

/** The 4 × 4 ordered dither, 0–15. */
const BAYER = Uint8Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

/**
 * What a bank does to a material: nothing (it stands clear), lies on it, pools on it (water and wet ground), or
 * drifts thinly over it (tree crowns).
 */
const CLEAR = 0, LAND = 1, WET = 2, CROWN = 3;
const KIND = new Uint8Array(256).fill(LAND);
KIND[M.none] = CLEAR;
for (let m = 0; m < 256; m++) {
  if (isBuilt[m] === 1) KIND[m] = CLEAR;
  if (isCanopy[m] === 1) KIND[m] = CROWN;
  if (isWater[m] === 1) KIND[m] = WET;
}
// The heights stand over the mist: rock, snow, the alpine meadows, the moors and heaths; and so do hedges and walls.
for (const m of [
  M.snow, M.snowLate, M.rockHard, M.rockSed, M.rockLime, M.rockSlate, M.cliffHard, M.cliffSed, M.cliffLime, M.cliffSlate,
  M.scree, M.screeSlate, M.screeStone, M.alpineCool, M.alpineMid, M.alpineWarm, M.boulder, M.wall,
  M.heathCool, M.heathMid, M.heathWarm, M.moorCool, M.moorMid, M.moorWarm, M.bracken, M.gorse, M.quarry,
]) KIND[m] = CLEAR;
for (const m of [M.hedge, M.hedgeCrown, M.yew]) KIND[m] = CROWN;
for (const m of [M.marsh, M.reeds, M.saltmarsh, M.saltCreek, M.sand, M.sandPale, M.shingle]) KIND[m] = WET;
// The quays and harbour walls are built, but low: the mist lies on the cobbles.
KIND[M.cobble] = LAND;

function mixRgb(a: number, b: number, t: number): number {
  const r = (a & 255) + ((b & 255) - (a & 255)) * t;
  const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
  const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
  return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

/** The banks' colour in this air: the mist's own in the day's light, a little greyed under cloud, blue-grey by night. */
export function mistColour(air: Air): number {
  const full = gradeRgb(MIST, { time: air.time, season: air.season, overcast: air.overcast * 0.5 });
  // Its own grey, as bright as the lit colour: the mist keeps only part of the light's hue.
  const grey = Math.round(((full & 255) * 2 + ((full >>> 8) & 255) * 5 + ((full >>> 16) & 255)) / 8);
  const lit = mixRgb((0xff000000 | (grey << 16) | (grey << 8) | grey) >>> 0, full, WARMTH);
  return mixRgb(lit, NIGHT_MIST, NIGHT_SHARE * air.night);
}

/** Smooth value noise on a lattice of cw × ch that wraps round the field; 0–1. */
function lattice(x: number, y: number, cw: number, ch: number, seed: number): number {
  const nx = FW / cw, ny = FH / ch;
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

/**
 * The indices of `keys` in ascending order, ties by index: a stable two-pass radix sort. The field's values are
 * non-negative floats, whose bits order as their values do, so this is the order a comparison sort would give, at a
 * small part of its cost (the page builds the field while it loads).
 */
function rankOrder(keys: Uint32Array): Uint32Array {
  const n = keys.length;
  let from = new Uint32Array(n), to = new Uint32Array(n);
  for (let i = 0; i < n; i++) from[i] = i;
  const count = new Uint32Array(65537);
  for (let shift = 0; shift < 32; shift += 16) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[((keys[from[i]] >>> shift) & 0xffff) + 1]++;
    for (let b = 0; b < 65536; b++) count[b + 1] += count[b];
    for (let i = 0; i < n; i++) to[count[(keys[from[i]] >>> shift) & 0xffff]++] = from[i];
    [from, to] = [to, from];
  }
  return from;
}

/** The banks, levelled so each value 0–255 covers the same area. */
export function mistField(seed: number): Uint8Array {
  const raw = new Float32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    raw[y * FW + x] = LUMP[2] * lattice(x, y, LUMP[0], LUMP[1], seed ^ 0x3157) + FLANK[2] * lattice(x, y, FLANK[0], FLANK[1], seed ^ 0x6d2b)
      + SCALLOP[2] * lattice(x, y, SCALLOP[0], SCALLOP[1], seed ^ 0x19c7);
  }
  const order = rankOrder(new Uint32Array(raw.buffer));
  const out = new Uint8Array(FW * FH);
  for (let k = 0; k < order.length; k++) out[order[k]] = Math.floor((k * 256) / order.length);
  return out;
}

/** The runs of each row of the field at `floor` or more, as [start, end) pairs, row r's from at[r] to at[r + 1]. */
function runsOf(field: Uint8Array, floor: number): { at: Int32Array; runs: Int32Array } {
  const at = new Int32Array(FH + 1);
  const list: number[] = [];
  for (let r = 0; r < FH; r++) {
    at[r] = list.length;
    for (let x = 0; x < FW; ) {
      if (field[r * FW + x] < floor) { x++; continue; }
      const start = x;
      while (x < FW && field[r * FW + x] >= floor) x++;
      list.push(start, x);
    }
  }
  at[FH] = list.length;
  return { at, runs: Int32Array.from(list) };
}

/** The mist's banks. `seed` is the world's. Draws nothing when no mist lies. */
export function mistLayer(seed: number): LiveLayer {
  const field = mistField(seed);
  const { at: runAt, runs } = runsOf(field, EDGE - POOL);
  const lean = rainLean(seed);
  let key = -1, colour = MIST;
  // The colour's two halves times each tone, worked out when the light or the mist's amount moves.
  const toneRB = new Uint32Array(TONES.length), toneG = new Uint32Array(TONES.length), toneInv = new Int32Array(TONES.length);
  let toned = -1;
  return {
    name: "mist",
    draw(f: LiveFrame): void {
      const air = f.air;
      if (!air || air.mist <= 0) return;
      const { out, bake, t } = f;
      const w = f.rect.w, h = f.rect.h, rx = Math.floor(f.rect.x), ry = Math.floor(f.rect.y);
      const amount = air.mist > 1 ? 1 : air.mist;
      const k = lightKey(air, 96, 16);
      if (k !== key) {
        key = k;
        colour = mistColour(air);
        toned = -1;
      }
      // Thin mist has smaller banks as well as fainter ones: the level a bank's edge needs rises as the mist thins.
      const edge = EDGE + Math.round((255 - EDGE) * 0.45 * (1 - amount));
      const strength = Math.round((0.35 + 0.65 * amount) * 64);
      if (toned !== strength) {
        toned = strength;
        for (let i = 0; i < TONES.length; i++) {
          const a = (TONES[i] * strength) >> 6;
          toneRB[i] = (colour & 0xff00ff) * a;
          toneG[i] = (colour & 0x00ff00) * a;
          toneInv[i] = 256 - a;
        }
      }
      const shift = Math.floor(t * MIST_DRIFT) * lean;
      const g0 = modP(rx - shift, FW);
      const levels = field, starts = runAt, spans = runs, kindOf = KIND, bayer = BAYER;
      const tRB = toneRB, tG = toneG, tInv = toneInv, stepOf = STEP_OF;
      for (let py = 0; py < h; py++) {
        const by = ry + py;
        const fieldRow = by & (FH - 1);
        const row = fieldRow * FW;
        const line = py * w;
        const bayerRow = (by & 3) << 2;
        // Each run, and its copy a field further on, against the frame's span of the field [g0, g0 + w).
        for (let q = starts[fieldRow], qEnd = starts[fieldRow + 1]; q < qEnd; q += 2) {
          for (let copy = 0; spans[q] + copy - g0 < w; copy += FW) {
            const lo = spans[q] + copy - g0, hi = spans[q + 1] + copy - g0;
            const px0 = lo < 0 ? 0 : lo, px1 = hi > w ? w : hi;
            for (let px = px0, i = line + px0, g = row + px0 + g0 - copy; px < px1; px++, i++, g++) {
              // How deep in the bank this pixel is, in levels past the edge; only wet ground is in it before the edge.
              let deep = levels[g] - edge;
              const kind = kindOf[bake[i] & 255];
              if (kind !== LAND) {
                if (kind === CLEAR) continue;
                if (kind === WET) deep += POOL;
                else if (deep > 0) deep = (deep / OVER_CROWNS) | 0;
              }
              if (deep < 0) continue;
              // The soft edge: fixed to the land, so it does not crawl as the bank drifts.
              if (deep < SOFT && bayer[bayerRow | ((rx + px) & 3)] * SOFT >= (deep + 1) * 16) continue;
              const tone = stepOf[deep];
              const dst = out[i], inv = tInv[tone];
              // Red and blue in one product, green in another; each sum stays within 32 bits.
              const rb = ((Math.imul(dst & 0xff00ff, inv) + tRB[tone]) >>> 8) & 0xff00ff;
              const gg = ((Math.imul(dst & 0x00ff00, inv) + tG[tone]) >>> 8) & 0x00ff00;
              out[i] = (0xff000000 | rb | gg) >>> 0;
            }
          }
        }
      }
    },
  };
}
