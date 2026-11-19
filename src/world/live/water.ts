// Moving water: surf on the shore, a slow swell on open water, flow in the rivers and pouring falls.
//
// The shore distance and how far each fall has dropped depend only on the land. A frame the same size whose rect has
// slid by at most 16 pixels, and whose overlapping land still matches, reuses the previous distance shifted with the
// land and builds it again only along the edge the slide exposed. A jump, a resize, or a bake that changed in the
// overlap builds the whole field as before. The paint depends on time, so it still walks every water pixel.
//
// Every pixel is repainted through the palette, at another tone of its own ramp or as the river's foam, and every
// pattern is fixed to bake space and stepped in whole pixels, so nothing swims with the camera or shimmers between
// steps. Time enters only through `f.t`.

import { FALL_TONE, FOAM_TONE } from "../bake/chunk.ts";
import { hash2 } from "../core/hash.ts";
import { fbm } from "../core/noise.ts";
import { pcos } from "../core/psin.ts";
import { rngFor } from "../core/rng.ts";
import { isBuilt, MATERIAL as M } from "../look/materials.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";

// ── Tuning ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Seconds from one wave reaching a shore to the next. */
export const WAVE_PERIOD = 5.2;
/** How strongly each wave of a set runs in (0 a lull … 3 the big one); the set repeats. */
const SETS = 9;
const SET = [2, 3, 3, 1, 2, 3, 2, 0, 1] as const;
/** Bake pixels between swell crests on open water, and how fast they travel (pixels a second). */
const SWELL_LENGTH = 51.2;
const SWELL_SPEED = 3.2;
/** River flow: eighths of a unit of height lost a second on an easy reach, halves of a unit on a steep one. */
const FLOW_SPEED = 5;
const FLOW_SPEED_STEEP = 9;
/** Height lost per pixel (in eighths of a unit) from which a reach counts as steep. */
const STEEP = 5;
/** Falling water, pixels a second. */
const FALL_SPEED = 15;
/** A fall this many pixels tall or more gets the wide spray. */
export const TALL_FALL = 9;

// ── Classes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const C_LAND = 0, C_SEA = 1, C_LAKE = 2, C_RIVER = 3;
const K_BEACH = 0, K_ROCK = 1, K_CALM = 2, K_NONE = 3;
/** dist value of a pixel with no shore in reach: distance 63 half-pixels, kind none. */
const FAR = 255;
/** Surf is drawn out to this many half-pixels from the shore. */
const REACH = 32;
/**
 * Screen pixels around a new edge or a changed bake pixel whose shore distance is built again. Wide enough that a shore
 * sliding into view cannot move the picture by more than a sliver, and narrow enough to stay inside the frame budget.
 */
const REBUILD = 2;
/** Land and water within this many eighths of a world row of each other meet at a shore. */
const NEAR = 48;

const CLASS = new Uint8Array(256);
CLASS[M.sea] = C_SEA;
CLASS[M.seaClear] = C_SEA;
CLASS[M.lake] = C_LAKE;
CLASS[M.river] = C_RIVER;

/** What kind of shore each land material makes. */
const KIND = new Uint8Array(256).fill(K_CALM);
KIND[M.none] = K_NONE;
for (const m of [M.sand, M.sandPale, M.duneGrass]) KIND[m] = K_BEACH;
for (const m of [
  M.shingle, M.boulder, M.rockHard, M.rockSed, M.rockLime, M.rockSlate, M.cliffHard, M.cliffSed, M.cliffLime, M.cliffSlate,
  M.scree, M.screeSlate, M.screeStone,
]) KIND[m] = K_ROCK;
for (let m = 0; m < 256; m++) if (isBuilt[m] === 1) KIND[m] = K_CALM;

// ── Tables, built once ───────────────────────────────────────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Surf strength 0–255 by shore kind, wave strength, moment in the wave (0–255) and distance (half-pixels):
 * SURF[((kind · 4 + strength) · 256 + u) · 32 + d2]. Up to 85 is a glint, to 170 pale water, above that foam; within
 * each band the strength is the share of pixels that take it, so foam thins to lace before it goes.
 */
function surfTable(): Uint8Array {
  const out = new Uint8Array(3 * 4 * 256 * REACH);
  for (let s = 0; s < 4; s++) {
    const a = [0, 0.5, 0.78, 1][s];
    for (let ui = 0; ui < 256; ui++) {
      const u = ui / 256;
      for (let d2 = 1; d2 < REACH; d2++) {
        const d = d2 / 2;
        let beach = 0, rock = 0;
        if (a === 0) {
          // A lull: the water only laps at the sand.
          if (d <= 1.5) beach = 70 * clamp01(pcos(2 * Math.PI * u));
          if (d <= 1.5) rock = 150 * clamp01(0.4 + 0.6 * pcos(2 * Math.PI * u));
        } else {
          // Beach. The crest comes in from d0, breaks at `brk`, runs up the sand, and drains away.
          const d0 = 5 + 9 * a;
          if (u < 0.5) {
            const k = 1 - u / 0.5;
            const p = 1 + (d0 - 1) * k * Math.sqrt(k);
            const off = d - p;
            // Far out the crest is a dotted line of foam; it fills in as it nears the sand.
            const full = clamp01((d0 - p) / (d0 * 0.55));
            if (off >= -0.75 && off <= (full < 1 ? 0.75 : 1.25)) {
              beach = 178 + 77 * full;
            } else if (full >= 1 && off > 1.25) {
              // Lace left behind the broken crest.
              const trail = 1.5 + 3 * a;
              if (off < 1.25 + trail) beach = 200 * (1 - (off - 1.25) / trail);
            }
          } else if (u < 0.62) {
            if (d <= 2) beach = 255;
            else if (d <= 4) beach = 200 * (1 - (d - 2) / 2);
          } else {
            const f = 1 - (u - 0.62) / 0.38;
            if (d <= 2) beach = 255 * Math.sqrt(f);
            else if (d <= 4) beach = 190 * f * (1 - (d - 2) / 2);
          }
          // Rock. A dark swell line closes in, then white water bursts up the foot and falls back.
          const reach = 1 + 3.2 * a;
          const body = clamp01(1 - (d - 1) / reach);
          if (u < 0.4) {
            const p = 1.5 + 5 * a * (1 - u / 0.4);
            if (d - p >= -0.75 && d - p <= 0.75) rock = 75;
            if (d <= 1.5) rock = 120;
          } else if (u < 0.52) {
            const g = (u - 0.4) / 0.12;
            if (d <= 1 + reach * g) rock = 150 + 105 * body;
          } else {
            const f = 1 - (u - 0.52) / 0.48;
            if (d <= 1 + reach) rock = (130 + 125 * body) * f * Math.sqrt(f);
            if (d <= 1.5 && rock < 120) rock = 120;
          }
        }
        // Still shores (quays, lakes, grassy banks): a glint laps at the edge.
        const calm = d <= 1.5 ? 80 * clamp01(pcos(2 * Math.PI * u) * 1.4 - 0.4) : 0;
        out[((K_BEACH * 4 + s) * 256 + ui) * REACH + d2] = beach;
        out[((K_ROCK * 4 + s) * 256 + ui) * REACH + d2] = rock;
        out[((K_CALM * 4 + s) * 256 + ui) * REACH + d2] = calm;
      }
    }
  }
  return out;
}

/** How long a streak must be to show at each moment of the swell: 255 none; lower lets more of each streak through. */
function swellTable(): Uint8Array {
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const e = clamp01((pcos((i / 256) * 2 * Math.PI) - 0.3) / 0.7);
    out[i] = e === 0 ? 255 : Math.round(250 - 125 * Math.sqrt(e));
  }
  return out;
}

const WARP = 256;
const STREAKS = 512;

/** Smooth noise 0–255, 256² and wrapping: it bends the wave fronts and the swell so no two stretches keep time. */
function warpTile(seed: number): Uint8Array {
  const raw = new Float32Array(WARP * WARP);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < WARP; y++) for (let x = 0; x < WARP; x++) {
    const v = fbm(x / 64, y / 64, 4, 2, 0.5, seed ^ 0x3a7e);
    raw[y * WARP + x] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Uint8Array(WARP * WARP);
  for (let i = 0; i < raw.length; i++) out[i] = Math.round((255 * (raw[i] - lo)) / (hi - lo));
  return out;
}

/** White noise 0–255, 256²: which pixels of a thinning foam go first. */
function gritTile(seed: number): Uint8Array {
  const out = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) out[i] = hash2(i & 255, i >> 8, seed ^ 0x6a17) & 255;
  return out;
}

/**
 * The swell's streaks, 512² and wrapping: short level dashes, 255 at the middle falling to 130 at the tips, some with
 * a second, shorter stroke under one end. A dash shows where its value beats the swell's threshold, so it grows from
 * its middle as a crest arrives and shrinks back as it leaves.
 */
function streakTile(seed: number): Uint8Array {
  const out = new Uint8Array(STREAKS * STREAKS);
  const rng = rngFor(seed, "live-water-streaks");
  const stroke = (cx: number, cy: number, half: number, peak: number): void => {
    for (let k = -half; k <= half; k++) {
      const v = Math.round(peak - ((k < 0 ? -k : k) / half) * (peak - 130));
      const i = (cy & (STREAKS - 1)) * STREAKS + ((cx + k) & (STREAKS - 1));
      if (v > out[i]) out[i] = v;
    }
  };
  // One dash to every 150 pixels or so, on a jittered grid so they never crowd or leave holes.
  const cellW = 15, cellH = 5;
  for (let gy = 0; gy * cellH < STREAKS; gy++) for (let gx = 0; gx * cellW < STREAKS; gx++) {
    const cx = gx * cellW + rng.int(cellW), cy = gy * cellH + rng.int(cellH);
    const half = 2 + rng.int(5);
    const two = rng.int(3) === 0;
    const side = rng.int(2) === 0 ? -1 : 1;
    if (rng.int(5) === 0) continue;
    stroke(cx, cy, half, 255);
    if (two) stroke(cx + side * (half + 1), cy + 1, 1 + (half >> 1), 215);
  }
  return out;
}

// ── The layer ────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_FEET = 96;

/** `dst` takes `src` moved by `delta` (dst[k] = src[k + delta]) wherever both are in range: a whole kept field, slid. */
function shiftInto(src: Uint8Array, dst: Uint8Array, delta: number): void {
  const n = src.length;
  if (delta >= 0) dst.set(src.subarray(delta, n), 0);
  else dst.set(src.subarray(0, n + delta), -delta);
}

/** The overlap agrees: current bake (x, y) is the kept bake (x + dx, y + dy). */
function sameBake(bake: Uint32Array, kept: Uint32Array, w: number, h: number, dx: number, dy: number): boolean {
  const x0 = dx < 0 ? -dx : 0, x1 = dx > 0 ? w - dx : w;
  const y0 = dy < 0 ? -dy : 0, y1 = dy > 0 ? h - dy : h;
  const span = x1 - x0;
  if (span <= 0 || y1 <= y0) return true;
  // Plain typed-array reads: Node's Buffer is fast in Node but a byte-by-byte polyfill in the browser.
  for (let y = y0; y < y1; y++) {
    let i = y * w + x0, j = (y + dy) * w + x0 + dx;
    for (const end = i + span; i < end; i++, j++) if (bake[i] !== kept[j]) return false;
  }
  return true;
}

export interface WaterOptions {
  /** Walk every pixel and look everything up: the plain path the tests hold the fast one to. */
  plain?: boolean;
}

/** The moving water. `seed` is the world's. */
export function waterLayer(seed: number, opts: WaterOptions = {}): LiveLayer {
  const plain = opts.plain === true;
  const surf = surfTable();
  const swell = swellTable();
  /** The lowest the swell's threshold goes: a streak value at or under it never shows. */
  const swellMin = swell.reduce((a, b) => (b < a ? b : a), 255);
  const warp = warpTile(seed);
  const grit = gritTile(seed);
  const streaks = streakTile(seed);
  // Scratch, sized to the frame on first use and kept. `dist` / `fallRun` hold the last finished field; `workD` /
  // `workF` are the ones being written. `keptBake` is the land those fields were built from.
  let dist = new Uint8Array(0);
  let workD = new Uint8Array(0);
  // Whether each pixel of the field can ever draw (laid out as `dist`, and kept and slid with it): not land, not an inked
  // line, and not open water out of the surf's reach with no streak under it. The paint steps over the rest unread.
  let live = new Uint8Array(0);
  let workL = new Uint8Array(0);
  let fallRun = new Uint8Array(0);
  let workF = new Uint8Array(0);
  let keptBake = new Uint32Array(0);
  let colMark = new Uint8Array(0);
  let sized = 0;
  let have = false;
  let keptX = 0, keptY = 0;
  /** The bake version the kept work was built from; -1 when unknown. */
  let keptVersion = -1;
  let marked = new Int16Array(0);
  let nMarked = 0;
  const feet = new Int32Array(MAX_FEET);
  const feetRun = new Uint8Array(MAX_FEET);

  // Down one span: shore distance from above and from the left.
  const forwardSpan = (bake: Uint32Array, ry: number, w: number, pw: number, dstD: Uint8Array, py: number, px0: number, px1: number): void => {
    const by = ry + py;
    const base = Math.floor(by / 256) * 2560, baseUp = Math.floor((by - 1) / 256) * 2560;
    let i = py * w + px0, j = (py + 1) * pw + px0 + 1;
    for (let px = px0; px < px1; px++, i++, j++) {
      const v = bake[i];
      if (CLASS[v & 255] === C_LAND) { dstD[j] = KIND[v & 255]; continue; }
      const qL = dstD[j - 1], qU = dstD[j - pw], qUL = dstD[j - pw - 1], qUR = dstD[j - pw + 1];
      // Open water: every neighbour is already as far from shore as the field records.
      if ((qL & qU & qUL & qUR) === FAR) { dstD[j] = FAR; continue; }
      const row = base + (v >>> 16);
      let d = FAR, q = qL;
      if (q >= 4) d = q + 8;
      else if (q !== K_NONE && near(row, base + (bake[i - 1] >>> 16))) d = q + 8;
      q = qU;
      if (q >= 4) { if (q + 8 < d) d = q + 8; }
      else if (q !== K_NONE && q + 8 < d && near(row, baseUp + (bake[i - w] >>> 16))) d = q + 8;
      q = qUL;
      if (q >= 4) { if (q + 12 < d) d = q + 12; }
      else if (q !== K_NONE && q + 12 < d && near(row, baseUp + (bake[i - w - 1] >>> 16))) d = q + 12;
      q = qUR;
      if (q >= 4) { if (q + 12 < d) d = q + 12; }
      else if (q !== K_NONE && q + 12 < d && near(row, baseUp + (bake[i - w + 1] >>> 16))) d = q + 12;
      dstD[j] = d >= REACH * 4 ? FAR : d;
    }
  };

  // Height of each fall in the span. A column that holds one is remembered so the run below a reused row is rebuilt.
  const fallSpan = (bake: Uint32Array, ry: number, w: number, dstF: Uint8Array, py: number, px0: number, px1: number): void => {
    const by = ry + py;
    const base = Math.floor(by / 256) * 2560, baseUp = Math.floor((by - 1) / 256) * 2560;
    const shift = baseUp - base;
    let i = py * w + px0;
    for (let px = px0; px < px1; px++, i++) {
      const v = bake[i];
      if ((v & 255) !== M.river || ((v >>> 8) & 15) < 12) continue;
      const up = py > 0 ? bake[i - w] : 0;
      // The height counts through a gap of a pixel or two where rock shows.
      const above = isFallPair(v, up, shift) ? dstF[i - w] : py > 2 && fallsOn(bake, i - 2 * w) ? dstF[i - 2 * w] + 1 : py > 3 && fallsOn(bake, i - 3 * w) ? dstF[i - 3 * w] + 2 : 0;
      dstF[i] = above < 250 ? above + 1 : 255;
      if (colMark[px] === 0) { colMark[px] = 1; marked[nMarked++] = px; }
    }
  };

  // Back up one span: the distance from below and from the right.
  const backSpan = (bake: Uint32Array, ry: number, w: number, pw: number, dstD: Uint8Array, py: number, px0: number, px1: number): void => {
    const by = ry + py;
    const base = Math.floor(by / 256) * 2560, baseDown = Math.floor((by + 1) / 256) * 2560;
    let i = py * w + px1 - 1, j = (py + 1) * pw + px1;
    for (let px = px1 - 1; px >= px0; px--, i--, j--) {
      const v = bake[i];
      if (CLASS[v & 255] === C_LAND) continue;
      const qR = dstD[j + 1], qD = dstD[j + pw], qDR = dstD[j + pw + 1], qDL = dstD[j + pw - 1];
      let d = dstD[j];
      if (d === FAR && (qR & qD & qDR & qDL) === FAR) continue;
      const row = base + (v >>> 16);
      let q = qR;
      if (q >= 4) { if (q + 8 < d) d = q + 8; }
      else if (q !== K_NONE && q + 8 < d && near(row, base + (bake[i + 1] >>> 16))) d = q + 8;
      q = qD;
      if (q >= 4) { if (q + 8 < d) d = q + 8; }
      else if (q !== K_NONE && q + 8 < d && near(row, baseDown + (bake[i + w] >>> 16))) d = q + 8;
      q = qDR;
      if (q >= 4) { if (q + 12 < d) d = q + 12; }
      else if (q !== K_NONE && q + 12 < d && near(row, baseDown + (bake[i + w + 1] >>> 16))) d = q + 12;
      q = qDL;
      if (q >= 4) { if (q + 12 < d) d = q + 12; }
      else if (q !== K_NONE && q + 12 < d && near(row, baseDown + (bake[i + w - 1] >>> 16))) d = q + 12;
      if (d >= REACH * 4) d = FAR;
      dstD[j] = d;
    }
  };

  // Whether each pixel of one span can draw, from its land and its finished shore distance (see `live`).
  const liveSpan = (bake: Uint32Array, rx: number, ry: number, w: number, pw: number, dstD: Uint8Array, dstL: Uint8Array, py: number, px0: number, px1: number): void => {
    const streakRow = ((ry + py) & (STREAKS - 1)) * STREAKS;
    let i = py * w + px0, j = (py + 1) * pw + px0 + 1;
    for (let px = px0; px < px1; px++, i++, j++) {
      const v = bake[i];
      const c = CLASS[v & 255], light = (v >>> 8) & 255;
      // Open water draws only a streak, and only above the swell's threshold (see paint).
      const still = c === C_LAND || light >= 64 ||
        (c !== C_RIVER && dstD[j] === FAR && ((light & 15) === 0 || streaks[streakRow + ((rx + px) & (STREAKS - 1))] <= swellMin));
      dstL[j] = still ? 0 : 1;
    }
  };

  const paint = (f: LiveFrame, w: number, h: number, rx: number, ry: number, pw: number, dist: Uint8Array, fallRun: Uint8Array, live: Uint8Array): void => {
    const { out, bake, palette, t } = f;
    // The clocks, each stepped in whole units.
    const wave = Math.floor(((t < 0 ? 0 : t) / WAVE_PERIOD) * 256);
    const swellT = Math.floor(t * SWELL_SPEED * (256 / SWELL_LENGTH));
    const flow = Math.floor(t * FLOW_SPEED), flowSteep = Math.floor(t * FLOW_SPEED_STEEP);
    const flowStill = Math.floor(t * 28);
    const twinkle = Math.floor(t * 40);
    const boil = Math.floor(t * 110);
    const fallT = t * FALL_SPEED;
    const foam = (M.river << 8) | FOAM_TONE;
    const fallPale = (M.river << 8) | FALL_TONE;
    let nFeet = 0;
    // The tables, as locals: the loops below would otherwise read each one through the closure on every pixel.
    const classOf = CLASS, surfAt = surf, swellAt = swell, warpAt = warp, gritAt = grit, streakAt = streaks;
    const swellLow = swellMin, skipOpen = !plain, skipStill = !plain;
    const words = new Uint32Array(live.buffer, live.byteOffset, live.length >> 2);

    for (let py = h - 1; py >= 0; py--) {
      const by = ry + py;
      const base = Math.floor(by / 256) * 2560, baseDown = Math.floor((by + 1) / 256) * 2560;
      const gritRow = (by & 255) << 8, warpRow = ((by >> 1) & 255) << 8, streakRow = (by & (STREAKS - 1)) * STREAKS;
      const swellRow = by * 5 - swellT;
      for (let px = w - 1, i = py * w + w - 1, j = (py + 1) * pw + w; px >= 0; px--, i--, j--) {
        if (skipStill && live[j] === 0) {
          // A run of pixels that cannot draw (mostly land and open sea): stepped over in a bare loop, several times
          // faster than this loop's body can turn them away, four at a time where a whole aligned word of them is still.
          const first = j - px;
          do {
            px--;
            i--;
            j--;
            if ((j & 3) === 3) {
              while (j - 3 >= first && words[(j - 3) >> 2] === 0) {
                px -= 4;
                i -= 4;
                j -= 4;
              }
            }
          } while (px >= 0 && live[j] === 0);
          if (px < 0) break;
        }
        const v = bake[i];
        const m = v & 255;
        const c = classOf[m];
        if (c === C_LAND) continue;
        const d = dist[j];
        const row = base + (v >>> 16);

        const light = (v >>> 8) & 255;
          // Inked water is a drawn line: it stays.
          if (light >= 64) continue;
          const tone = light & 15, shade = light & 0x30;
          const bx = rx + px;

          if (c !== C_RIVER) {
            // Sea and lake. Out of the surf's reach a pixel draws only a streak, and only above the swell's threshold:
            // where the streak is no higher than the threshold ever goes (most of the open sea), nothing is drawn, so
            // the bend and the swell are not looked up.
            if (skipOpen && d === FAR && (tone === 0 || streakAt[streakRow + (bx & (STREAKS - 1))] <= swellLow)) continue;
            const bend = warpAt[warpRow | ((bx >> 1) & 255)];
            if (d !== FAR) {
              const kind = c === C_LAKE ? K_CALM : d & 3;
              // Two trains of waves half a period apart: one is breaking while the last drains.
              const ph = wave + bend, ph2 = ph + 128;
              const at = (kind * 4 * 256) * REACH + (d >> 2);
              const I1 = surfAt[at + ((SET[(ph >> 8) % SETS] << 8) | (ph & 255)) * REACH];
              const I2 = surfAt[at + ((SET[((ph2 >> 8) + 4) % SETS] << 8) | (ph2 & 255)) * REACH];
              const I = I1 > I2 ? I1 : I2;
              if (I !== 0) {
                const g = gritAt[gritRow | (bx & 255)];
                if (I > 170) {
                  if (g < (I - 170) * 3) out[i] = palette[foam | shade];
                  else if (tone !== 0) out[i] = palette[(m << 8) | shade];
                } else if (tone !== 0) {
                  if (I > 85) out[i] = palette[(m << 8) | (g < (I - 85) * 3 ? 0 : tone - 1) | shade];
                  else if (g < I * 3) out[i] = palette[(m << 8) | (tone - 1) | shade];
                }
                continue;
              }
              if (d < 64) continue;
            }
            // Open water: streaks that swell and fade as each crest passes.
            if (tone === 0) continue;
            let thr = swellAt[(swellRow + bend) & 255];
            if (thr === 255) continue;
            if (c === C_LAKE) thr += 35;
            const sv = streakAt[streakRow + (bx & (STREAKS - 1))];
            if (sv > thr) {
              const lift = sv > thr + 70 ? 3 : 2;
              out[i] = palette[(m << 8) | (tone > lift ? tone - lift : 1) | shade];
            }
            continue;
          }

          // River.
          const g = gritAt[gritRow | (bx & 255)];
          if (tone < 8) {
            // A wide river. Its surface level is in the pixel: 0.8 of the depth's world row, less the frame row.
            const e = px + 1 < w ? bake[i + 1] : 0, s = py + 1 < h ? bake[i + w] : 0;
            const eRiver = (e & 255) === M.river, sRiver = (s & 255) === M.river;
            // The fall to the east and to the south, in eighths of a unit for each pixel.
            const dropE = eRiver ? ((e >>> 16) - (v >>> 16)) * 0.8 : 0;
            const dropS = sRiver ? (baseDown + (s >>> 16) - row) * 0.8 - 8 : 0;
            const fall = (dropE < 0 ? -dropE : dropE) + (dropS < 0 ? -dropS : dropS);
            if (fall >= 1) {
              // A sloping reach: marks keep to a level that sinks with time, so they run downhill, in lanes.
              const steep = fall >= STEEP;
              const level = Math.floor(row * 0.8) - by * 8;
              const lane = eRiver && ((e >>> 8) & 15) === tone ? bx : by;
              const lg = gritAt[((lane & 255) << 8) | 91];
              // On a steep reach the level is read coarser, or a drop of a unit a pixel would light a whole column at once.
              const at = ((steep ? (level >> 2) + flowSteep : level + flow) + (lg >> 4)) & 7;
              if (steep) {
                // A riffle: broken white water.
                if (at < 3 && g < 170) out[i] = palette[(at === 0 && g < 90 ? foam : fallPale) | shade];
              } else if (lg < 150 && at < 2) out[i] = palette[(at === 0 && g < 36 ? foam : (m << 8) | 13) | shade];
              continue;
            }
            // A level reach gives no direction: short strokes along the channel come and go where they lie.
            const along = px >= 2 && px + 2 < w && (bake[i - 2] & 255) === M.river && (bake[i + 2] & 255) === M.river;
            const down = !along && py >= 2 && py + 2 < h && (bake[i - 2 * w] & 255) === M.river && (bake[i + 2 * w] & 255) === M.river;
            if (!along && !down) continue;
            const thr = swellAt[(warpAt[warpRow | ((bx >> 1) & 255)] * 2 + flowStill) & 255];
            if (thr === 255) continue;
            const sv = along ? streakAt[streakRow + (bx & (STREAKS - 1))] : streakAt[(bx & (STREAKS - 1)) * STREAKS + (by & (STREAKS - 1))];
            if (sv > thr + 20) out[i] = palette[(m << 8) | 13 | shade];
            continue;
          }
          if (tone < 12) {
            // A stream: a glint now and then.
            if (((g + twinkle) & 255) < 14) out[i] = palette[(m << 8) | (tone + 2 > 13 ? 13 : tone + 2) | shade];
            continue;
          }
          // Falling water and its foam.
          const up = py > 0 ? bake[i - w] : 0, down = py + 1 < h ? bake[i + w] : 0;
          const baseUp = Math.floor((by - 1) / 256) * 2560;
          const column = isFallPair(v, up, baseUp - base) || isFallPair(v, down, baseDown - base);
          if (!column) {
            if (tone === 12 || tone === 13) {
              if (((g + twinkle) & 255) < 14) out[i] = palette[(m << 8) | 13 | shade];
              continue;
            }
            // Foam on the water at a fall's lip or foot: it boils, each pixel in its own time.
            if (tone === FOAM_TONE && ((g + boil) & 255) < 90) out[i] = palette[fallPale | shade];
            else if (tone === FALL_TONE && ((g + boil) & 255) < 60) out[i] = palette[foam | shade];
            continue;
          }
          // The foot: no more of the fall under this pixel, nor just past a gap where rock shows through.
          if (tone >= FALL_TONE && !isFallPair(v, down, baseDown - base) && nFeet < MAX_FEET && !fallsOn(bake, i + 2 * w) && !fallsOn(bake, i + 3 * w)) {
            feet[nFeet] = i;
            feetRun[nFeet++] = fallRun[i];
          }
          // Rock showing through the fall stays where it is.
          if (tone < FALL_TONE) continue;
          // Each column pours at its own pace: runs of foam and of pale water slide down it.
          const cg = gritAt[((bx & 255) << 8) | 173];
          const slid = by - Math.floor(fallT * (0.8 + (cg & 63) / 160)) + cg;
          const band = gritAt[((bx * 7) & 255) | (((slid >> 1) & 255) << 8)];
          out[i] = palette[(band < 150 ? foam : fallPale) | shade];
        }
      }

      // 3. Spray at the foot of each fall: foam round it that swells and sinks.
      for (let k = 0; k < nFeet; k++) {
        const i = feet[k];
        const px = i % w, py = (i - px) / w;
        const tall = feetRun[k] >= TALL_FALL;
        const r = tall ? 4 : 2;
        const bx0 = rx + px, by0 = ry + py;
        // The cloud breathes about every two seconds, each fall on its own beat.
        const beat = pcos((t / 2.1 + (hash2(bx0 >> 3, by0 >> 3, seed) & 255) / 256) * 2 * Math.PI);
        const footRow = Math.floor(by0 / 256) * 2560 + (bake[i] >>> 16);
        for (let dy = tall ? -2 : 0; dy <= r; dy++) {
          const y = py + dy;
          if (y < 0 || y >= h) continue;
          const base = Math.floor((ry + y) / 256) * 2560;
          for (let dx = -r; dx <= r; dx++) {
            const x = px + dx;
            if (x < 0 || x >= w) continue;
            const o = y * w + x;
            const v = bake[o];
            const far = dx * dx + dy * dy * 1.5;
            let share: number, shade = (v >>> 8) & 0x30;
            if (classOf[v & 255] !== C_LAND) {
              if (((v >>> 8) & 255) >= 64) continue;
              share = 215 - (far * 190) / (r * r) + 45 * beat;
            } else {
              // A tall fall's cloud also drifts over the rock at its foot, never over ground that stands in front of it.
              const gap = base + (v >>> 16) - footRow;
              if (!tall || (v & 255) === M.none || gap < -24 || gap > 64) continue;
              share = 125 - (far * 130) / (r * r) + 60 * beat;
              // Spray hangs in the air and catches the light, even in a gorge.
              if (shade > 0x10) shade = 0x10;
            }
            if (share <= 0) continue;
            const g = gritAt[(((ry + y) & 255) << 8) | ((rx + x) & 255)];
            if (((g + boil) & 255) < share) out[o] = palette[foam | shade];
          }
        }
      }
  };

  return {
    name: "water",
    draw(f: LiveFrame): void {
      const { bake } = f;
      const w = f.rect.w, h = f.rect.h, rx = f.rect.x, ry = f.rect.y;
      // Nothing to do over dry land: every mark this layer makes is on or beside water in view.
      let wet = false;
      for (let i = 0, end = w * h; i < end; i++) if (CLASS[bake[i] & 255] !== C_LAND) { wet = true; break; }
      if (!wet) return;
      const pw = w + 2;
      if (sized !== w * 65536 + h) {
        const cells = w * h, plane = pw * (h + 2);
        dist = new Uint8Array(plane);
        workD = new Uint8Array(plane);
        live = new Uint8Array(plane);
        workL = new Uint8Array(plane);
        fallRun = new Uint8Array(cells);
        workF = new Uint8Array(cells);
        keptBake = new Uint32Array(cells);
        colMark = new Uint8Array(w);
        marked = new Int16Array(w);
        sized = w * 65536 + h;
        have = false;
      }

      const dx = rx - keptX, dy = ry - keptY;
      const slide = have && (dx | 0) === dx && (dy | 0) === dy && dx <= 16 && dx >= -16 && dy <= 16 && dy >= -16;
      // The view says the land hasn't changed since the kept frame: no need to compare it pixel by pixel.
      const trusted = f.bakeVersion !== undefined && f.bakeVersion === keptVersion;
      // Still, and the land is the land we built from: only the paint depends on the clock.
      if (slide && dx === 0 && dy === 0 && (trusted || sameBake(bake, keptBake, w, h, 0, 0))) {
        paint(f, w, h, rx, ry, pw, dist, fallRun, live);
        return;
      }
      const moved = slide && (trusted || sameBake(bake, keptBake, w, h, dx, dy));
      let sx0 = 0, sx1 = 0, sy0 = 0, sy1 = 0;
      if (nMarked !== 0) { colMark.fill(0); nMarked = 0; }
      if (moved) {
        // Safe interior: far enough from every edge the slide exposed or covered that the kept distance still holds.
        sx0 = 0; sx1 = w; sy0 = 0; sy1 = h;
        if (dx !== 0) {
          const ox0 = dx < 0 ? -dx : 0, ox1 = dx > 0 ? w - dx : w;
          sx0 = ox0 + REBUILD; sx1 = ox1 - REBUILD;
        }
        if (dy !== 0) {
          const oy0 = dy < 0 ? -dy : 0, oy1 = dy > 0 ? h - dy : h;
          sy0 = oy0 + REBUILD; sy1 = oy1 - REBUILD;
        }
        if (sx1 < sx0) { sx0 = 0; sx1 = 0; }
        if (sy1 < sy0) { sy0 = 0; sy1 = 0; }
      }

      const dstD = workD, dstF = workF, dstL = workL;
      if (moved && sx1 > sx0 && sy1 > sy0) {
        // The kept fields, slid with the land in one copy each. Only the safe interior keeps what it is handed: every
        // other pixel is built again below, before anything reads it (falls are read only where a fall is written).
        shiftInto(dist, dstD, dy * pw + dx);
        shiftInto(live, dstL, dy * pw + dx);
        shiftInto(fallRun, dstF, dy * w + dx);
      }
      // Only the frame's own border has no shore in reach; every interior sample is written below.
      dstD.fill(FAR, 0, pw);
      dstD.fill(FAR, pw * (h + 1), pw * (h + 2));
      for (let y = 1; y <= h; y++) { dstD[y * pw] = FAR; dstD[y * pw + pw - 1] = FAR; }
      for (let py = 0; py < h; py++) {
        if (!moved || py < sy0 || py >= sy1) {
          forwardSpan(bake, ry, w, pw, dstD, py, 0, w);
          fallSpan(bake, ry, w, dstF, py, 0, w);
        } else {
          if (sx0 > 0) { forwardSpan(bake, ry, w, pw, dstD, py, 0, sx0); fallSpan(bake, ry, w, dstF, py, 0, sx0); }
          if (sx1 > sx0) {
            for (let m = 0; m < nMarked; m++) {
              const px = marked[m];
              if (px >= sx0 && px < sx1) fallSpan(bake, ry, w, dstF, py, px, px + 1);
            }
          }
          if (sx1 < w) { forwardSpan(bake, ry, w, pw, dstD, py, sx1, w); fallSpan(bake, ry, w, dstF, py, sx1, w); }
        }
      }
      for (let py = h - 1; py >= 0; py--) {
        if (!moved || py < sy0 || py >= sy1) backSpan(bake, ry, w, pw, dstD, py, 0, w);
        else {
          if (sx1 < w) backSpan(bake, ry, w, pw, dstD, py, sx1, w);
          if (sx0 > 0) backSpan(bake, ry, w, pw, dstD, py, 0, sx0);
        }
      }
      // Which pixels can draw, on the spans whose distance was built again; the interior's came with its distance.
      for (let py = 0; py < h; py++) {
        if (!moved || py < sy0 || py >= sy1) liveSpan(bake, rx, ry, w, pw, dstD, dstL, py, 0, w);
        else {
          if (sx0 > 0) liveSpan(bake, rx, ry, w, pw, dstD, dstL, py, 0, sx0);
          if (sx1 < w) liveSpan(bake, rx, ry, w, pw, dstD, dstL, py, sx1, w);
        }
      }

      paint(f, w, h, rx, ry, pw, dstD, dstF, dstL);

      workD = dist; dist = dstD;
      workL = live; live = dstL;
      workF = fallRun; fallRun = dstF;
      if (bake.length === w * h) keptBake.set(bake);
      else for (let i = 0, n = w * h; i < n; i++) keptBake[i] = bake[i];
      keptX = rx; keptY = ry;
      keptVersion = f.bakeVersion ?? -1;
      have = true;
    },
  };
}

/** Land and water this close in depth (eighths of a world row) lie side by side on the ground. */
function near(a: number, b: number): boolean {
  const d = a - b;
  return d <= NEAR && d >= -NEAR;
}

/**
 * Two pixels, one over the other, of the same fall: both the river's, no more than a world row apart in depth (a fall is
 * a cell drawn tall, or a few such cells in steps; level water gains a row and a quarter with each pixel), both in the
 * fall's tones and one of them falling water or foam. `shift` is b's chunk row base less a's, in eighths.
 */
function isFallPair(a: number, b: number, shift: number): boolean {
  if ((b & 255) !== M.river || (a & 255) !== M.river) return false;
  const gap = (a >>> 16) - (b >>> 16) - shift;
  if (gap > 8 || gap < -8) return false;
  const ta = (a >>> 8) & 15, tb = (b >>> 8) & 15;
  return ta >= 12 && tb >= 12 && (ta >= FALL_TONE || tb >= FALL_TONE);
}

/** Falling water or its foam at bake index i (false off the frame). */
function fallsOn(bake: Uint32Array, i: number): boolean {
  if (i >= bake.length) return false;
  const v = bake[i];
  return (v & 255) === M.river && ((v >>> 8) & 15) >= FALL_TONE;
}
