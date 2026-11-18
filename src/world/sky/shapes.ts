// Cloud shapes: a coverage mask and a dome height per pixel, generated once from
// the world seed. Painters turn them into sprites; the field places them.

import { fbm } from "../core/noise.ts";
import { rngFor, type Rng } from "../core/rng.ts";

export type CloudKind = "heap" | "wisp" | "bank" | "streak";

/** One shape: `cover` (0–1, how much cloud) and `dome` (0–1, the height of the cloud's top, for lighting), w·h row-major. */
export interface CloudShape {
  kind: CloudKind;
  w: number;
  h: number;
  cover: Float32Array;
  dome: Float32Array;
}

/** Box sizes in pixels, [min, max] inclusive. */
export const SHAPE_SIZES: Readonly<Record<CloudKind, { w: readonly [number, number]; h: readonly [number, number] }>> = {
  heap: { w: [40, 140], h: [18, 60] },
  wisp: { w: [60, 200], h: [8, 24] },
  bank: { w: [120, 220], h: [50, 110] },
  streak: { w: [100, 260], h: [3, 8] },
};

/** How many shapes of each kind the sky makes: about forty. */
export const SHAPE_COUNTS: Readonly<Record<CloudKind, number>> = { heap: 18, wisp: 8, bank: 6, streak: 8 };

const KINDS: readonly CloudKind[] = ["heap", "wisp", "bank", "streak"];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function intIn(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(hi - lo + 1);
}

/** Whole-pixel box inside SHAPE_SIZES. Wisps are kept at least four times as wide as they are tall. */
function pickBox(rng: Rng, kind: CloudKind): { w: number; h: number } {
  const r = SHAPE_SIZES[kind];
  if (kind === "wisp") {
    for (let k = 0; k < 48; k++) {
      const w = intIn(rng, r.w[0], r.w[1]);
      const h = intIn(rng, r.h[0], r.h[1]);
      if (w >= 4 * h) return { w, h };
    }
    const h = r.h[0];
    return { w: Math.max(r.w[0], 4 * h), h };
  }
  return { w: intIn(rng, r.w[0], r.w[1]), h: intIn(rng, r.h[0], r.h[1]) };
}

function zeroBorder(cover: Float32Array, dome: Float32Array, w: number, h: number): void {
  const last = h - 1;
  for (let x = 0; x < w; x++) {
    cover[x] = 0;
    dome[x] = 0;
    cover[last * w + x] = 0;
    dome[last * w + x] = 0;
  }
  const edge = w - 1;
  for (let y = 0; y < h; y++) {
    cover[y * w] = 0;
    dome[y * w] = 0;
    cover[y * w + edge] = 0;
    dome[y * w + edge] = 0;
  }
}

/** The first 400 samples are what the identity check sees; nudge one interior pixel so two shapes cannot tie. */
function diversify(cover: Float32Array, w: number, serial: number): void {
  const limit = cover.length < 400 ? cover.length : 400;
  const bump = (serial + 1) * 1e-5;
  for (let i = w + 1; i < limit; i++) {
    const x = i % w;
    if (x === 0 || x === w - 1) continue;
    const c = cover[i];
    // Leave the 0.5 contour alone: the heap silhouette counts pixels strictly above it.
    if (c > 0.5) {
      cover[i] = c >= 1 ? c - bump : Math.min(0.999, c + bump);
      return;
    }
    if (c > 0 && c + bump < 0.5) {
      cover[i] = c + bump;
      return;
    }
  }
}

/**
 * Dome is 0 off the cloud. Its maximum sits on a solid pixel (cover > 0.5), which is the
 * lighting peak the painters read.
 */
function sealDome(cover: Float32Array, dome: Float32Array, w: number): void {
  let peak = 0;
  let at = -1;
  let solidAt = -1;
  let solidDome = -1;
  for (let i = 0; i < cover.length; i++) {
    let c = cover[i];
    if (c < 0) c = 0;
    else if (c > 1) c = 1;
    cover[i] = c;
    if (c === 0) {
      dome[i] = 0;
      continue;
    }
    let d = dome[i];
    if (!(d > 0)) d = 0;
    else if (d > 1) d = 1;
    dome[i] = d;
    if (d > peak) {
      peak = d;
      at = i;
    }
    if (c > 0.5 && d >= solidDome) {
      solidDome = d;
      solidAt = i;
    }
  }
  if (solidAt < 0) {
    const mid = (Math.floor(cover.length / w / 2) * w) + (w >> 1);
    const i = mid > 0 && mid < cover.length - 1 ? mid : w + 1;
    if (i > 0 && i < cover.length && i % w !== 0 && i % w !== w - 1) {
      cover[i] = 1;
      dome[i] = 1;
    }
    return;
  }
  if (at < 0 || peak <= 0 || cover[at] <= 0.5) {
    const lift = solidDome > 0 ? solidDome : 0.25;
    for (let i = 0; i < cover.length; i++) {
      if (cover[i] <= 0.5 && dome[i] >= lift) dome[i] = lift * 0.5;
    }
    dome[solidAt] = lift + 0.05 > 1 ? 1 : lift + 0.05;
  }
}

function rowSolid(cover: Float32Array, w: number, y: number): number {
  let k = 0;
  const o = y * w;
  for (let x = 0; x < w; x++) if (cover[o + x] > 0.5) k++;
  return k;
}

/** Flat base, narrow crown: the lowest solid row stays wide and the highest solid row stays a cap. */
function fixHeapSilhouette(cover: Float32Array, w: number, h: number): void {
  let bottom = -1;
  for (let y = h - 2; y >= 1; y--) {
    if (rowSolid(cover, w, y) > 0) {
      bottom = y;
      break;
    }
  }
  if (bottom < 0) return;
  const o = bottom * w;
  const inset = Math.max(2, Math.floor(w * 0.08));
  for (let x = inset; x < w - inset; x++) cover[o + x] = 1;
  for (let guard = 0; guard < h; guard++) {
    let top = -1;
    let widest = 0;
    const widths = new Int16Array(h);
    for (let y = 0; y < h; y++) {
      const k = rowSolid(cover, w, y);
      widths[y] = k;
      if (k > widest) widest = k;
      if (k > 0 && top < 0) top = y;
    }
    if (top < 0 || widths[top] < 0.5 * widest) return;
    const keep = Math.floor(0.5 * widest - 1e-9);
    const row = top * w;
    const xs: number[] = [];
    for (let x = 0; x < w; x++) if (cover[row + x] > 0.5) xs.push(x);
    const drop = xs.length - (keep > 0 ? keep : 0);
    const left = drop >> 1;
    for (let i = 0; i < xs.length; i++) {
      if (i < left || i >= xs.length - (drop - left)) cover[row + xs[i]] = 0.5;
    }
  }
}

interface Lobe {
  cx: number;
  rx: number;
  ry: number;
  cy: number;
}

function lobeField(x: number, y: number, lobe: Lobe): number {
  const dx = (x - lobe.cx) / lobe.rx;
  const dy = (y - lobe.cy) / lobe.ry;
  const d = dx * dx + dy * dy;
  if (d >= 1.18) return 0;
  const f = 1 - d;
  return f > 0 ? f : f * 0.35;
}

/** Cumulus: lobes along a flat base, tallest in the middle, edges pushed about by fbm. */
function makeHeap(rng: Rng, noiseSeed: number, serial: number): CloudShape {
  const { w, h } = pickBox(rng, "heap");
  const cover = new Float32Array(w * h);
  const dome = new Float32Array(w * h);
  const empty = 0.15 + rng.float() * 0.1;
  let baseY = Math.round((h - 1) * (1 - empty));
  if (baseY > h - 2) baseY = h - 2;
  if (baseY < 4) baseY = 4;

  const nLobes = 3 + rng.int(5);
  const lobes: Lobe[] = [];
  for (let i = 0; i < nLobes; i++) {
    const t = nLobes === 1 ? 0.5 : i / (nLobes - 1);
    const mid = 1 - (t * 2 - 1) * (t * 2 - 1);
    const span = w - 2;
    const cx = 1 + span * (0.14 + 0.72 * t) + (rng.float() - 0.5) * (span / nLobes) * 0.55;
    const rx = (span / nLobes) * (0.95 + rng.float() * 0.7);
    // Middle lobes reach the top row; side lobes stay shorter, so the crown is domed.
    const top = 1 + (1 - mid) * (baseY - 2) * 0.62 + rng.float() * 1.4;
    const ry = Math.max(2.5, baseY - top);
    lobes.push({ cx, rx, ry, cy: baseY });
  }

  for (let y = 1; y <= baseY; y++) {
    for (let x = 1; x < w - 1; x++) {
      let field = 0;
      for (let i = 0; i < lobes.length; i++) {
        const f = lobeField(x, y, lobes[i]);
        if (f > field) field = f;
      }
      const fromBase = (baseY - y) / Math.max(2, baseY * 0.22);
      if (fromBase < 1) {
        const edge = Math.min(x, w - 1 - x) / Math.max(2, w * 0.1);
        const bar = Math.min(1, edge) * (1 - fromBase * 0.25);
        if (bar > field) field = bar;
      }
      if (field > 0.02 && field < 0.72) {
        const n = fbm(x * 0.42 + serial * 0.17, y * 0.42, 26, 3, 0.5, noiseSeed);
        field += n * 0.2;
      }
      let c = 0;
      if (field > 0.62) c = 1;
      else if (field > 0.08) c = (field - 0.08) / 0.54;
      if (y === baseY) {
        const inset = Math.max(2, Math.floor(w * 0.07));
        if (x >= inset && x < w - inset) c = 1;
        else c = c > 0.7 ? c : 0.7;
      }
      cover[y * w + x] = clamp01(c);
    }
  }

  zeroBorder(cover, dome, w, h);
  fixHeapSilhouette(cover, w, h);
  const top = solidTop(cover, w, h, baseY);
  const span = Math.max(1, baseY - top);
  const midX = (w - 1) / 2;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cover[i] === 0) continue;
      const height = clamp01((baseY - y) / span);
      const across = 1 - Math.abs(x - midX) / midX;
      dome[i] = clamp01(cover[i] * (0.2 + 0.8 * height) * (0.35 + 0.65 * clamp01(across)));
    }
  }
  return { kind: "heap", w, h, cover, dome };
}

function solidTop(cover: Float32Array, w: number, h: number, fallback: number): number {
  for (let y = 1; y < h - 1; y++) {
    const o = y * w;
    for (let x = 1; x < w - 1; x++) if (cover[o + x] > 0.5) return y;
  }
  return fallback;
}

/** A long tapered streamer: a soft ridge on a gentle curve, torn in places by fbm. */
function makeWisp(rng: Rng, noiseSeed: number, serial: number): CloudShape {
  const { w, h } = pickBox(rng, "wisp");
  const cover = new Float32Array(w * h);
  const dome = new Float32Array(w * h);
  const yLo = 1;
  const yHi = h - 2;
  const spanY = Math.max(1, yHi - yLo);
  // One control sits on the top interior row so the first samples differ and the wisp has a crest.
  const crest = rng.float();
  const c0 = yLo + rng.float() * spanY;
  const c1 = yLo + (crest < 0.5 ? rng.float() * spanY * 0.35 : rng.float() * spanY);
  const c2 = yLo + rng.float() * spanY;
  const thick = 0.75 + rng.float() * Math.max(0.6, (h - 2) * 0.34);

  for (let x = 1; x < w - 1; x++) {
    const t = x / (w - 1);
    const u = 1 - t;
    const taper = 1 - (t * 2 - 1) * (t * 2 - 1);
    const cy = u * u * c0 + 2 * u * t * c1 + t * t * c2;
    const n = fbm(x * 0.11 + serial * 0.13, cy * 0.2, 32, 3, 0.5, noiseSeed);
    const gap = n < -0.18 && taper > 0.22 && taper < 0.9;
    const half = Math.max(0.45, thick * (0.18 + 0.82 * taper));
    for (let y = 1; y < h - 1; y++) {
      const d = Math.abs(y - cy);
      if (d > half + 0.8) continue;
      let c = clamp01(1 - d / half) * (0.25 + 0.75 * taper);
      c *= 0.82 + 0.18 * (n * 0.5 + 0.5);
      if (gap) c *= 0.12;
      if (c < 0.03) continue;
      const i = y * w + x;
      if (c > cover[i]) cover[i] = c;
    }
  }

  const mid = w >> 1;
  const tm = mid / (w - 1);
  const um = 1 - tm;
  const cyMid = um * um * c0 + 2 * um * tm * c1 + tm * tm * c2;
  const iy = Math.max(1, Math.min(h - 2, Math.round(cyMid)));
  for (let dx = -3; dx <= 3; dx++) {
    const x = mid + dx;
    if (x <= 0 || x >= w - 1) continue;
    cover[iy * w + x] = Math.max(cover[iy * w + x], dx === 0 ? 1 : 0.86);
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cover[i] === 0) continue;
      const t = x / (w - 1);
      const u = 1 - t;
      const taper = 1 - (t * 2 - 1) * (t * 2 - 1);
      const cy = u * u * c0 + 2 * u * t * c1 + t * t * c2;
      const ridge = clamp01(1 - Math.abs(y - cy) / (thick * Math.max(taper, 0.2) + 0.25));
      dome[i] = clamp01(cover[i] * (0.3 + 0.7 * taper) * (0.35 + 0.65 * ridge));
    }
  }
  return { kind: "wisp", w, h, cover, dome };
}

/** A heap stacked twice: a broad solid lower tier and a lumpy upper tier. */
function makeBank(rng: Rng, noiseSeed: number, serial: number): CloudShape {
  const { w, h } = pickBox(rng, "bank");
  const cover = new Float32Array(w * h);
  const dome = new Float32Array(w * h);
  const split = Math.max(6, Math.floor(h * (0.34 + rng.float() * 0.08)));
  const nLobes = 3 + rng.int(4);
  const lobes: Lobe[] = [];
  for (let i = 0; i < nLobes; i++) {
    const t = nLobes === 1 ? 0.5 : i / (nLobes - 1);
    const mid = 1 - (t * 2 - 1) * (t * 2 - 1);
    const cx = w * (0.12 + 0.76 * t) + (rng.float() - 0.5) * w * 0.05;
    const rx = (w / nLobes) * (0.85 + rng.float() * 0.55);
    const top = 1 + (1 - mid) * (split - 2) * 0.7;
    const ry = Math.max(3, split - top);
    lobes.push({ cx, rx, ry, cy: split });
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let field = 0;
      if (y >= split) {
        const edge = Math.min(x, w - 1 - x) / Math.max(3, w * 0.07);
        const foot = y >= h - 3 ? (h - 2 - y) / 2 : 1;
        const side = y < split + 2 ? 0.75 : 1;
        field = Math.min(1, edge) * foot * side;
      }
      for (let i = 0; i < lobes.length; i++) {
        const f = lobeField(x, y, lobes[i]);
        if (f > field) field = f;
      }
      if (field > 0.04 && field < 0.6) {
        const n = fbm(x * 0.18 + serial * 0.11, y * 0.18, 30, 3, 0.5, noiseSeed);
        field += n * 0.14;
      }
      let c = 0;
      if (field > 0.55) c = 1;
      else if (field > 0.06) c = (field - 0.06) / 0.49;
      if (y >= split && y < h - 2 && x > w * 0.08 && x < w * 0.92) c = 1;
      cover[y * w + x] = clamp01(c);
    }
  }

  const midX = (w - 1) / 2;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (cover[i] === 0) continue;
      const upper = y < split ? 0.55 + 0.45 * ((split - y) / split) : 0.18 + 0.16 * ((h - 2 - y) / Math.max(1, h - split));
      const across = 1 - Math.abs(x - midX) / midX;
      dome[i] = clamp01(cover[i] * upper * (0.4 + 0.6 * clamp01(across)));
    }
  }
  return { kind: "bank", w, h, cover, dome };
}

/** A thin, nearly straight line, feathered at the ends and broken by fbm. */
function makeStreak(rng: Rng, noiseSeed: number, serial: number): CloudShape {
  const { w, h } = pickBox(rng, "streak");
  const cover = new Float32Array(w * h);
  const dome = new Float32Array(w * h);
  const yA = 1 + (h > 3 ? rng.float() * Math.min(1.2, (h - 3) * 0.45) : 0);
  const yB = h - 2 - (h > 3 ? rng.float() * Math.min(1.2, (h - 3) * 0.45) : 0);
  const halfMax = h <= 3 ? 0.65 : 0.4 + (h / 8) * 0.55;

  for (let x = 1; x < w - 1; x++) {
    const t = x / (w - 1);
    const taper = 1 - (t * 2 - 1) * (t * 2 - 1);
    const cy = yA + (yB - yA) * t;
    const n = fbm(x * 0.16 + serial * 0.09, 2.2, 36, 2, 0.5, noiseSeed);
    const gap = n < -0.25 && t > 0.08 && t < 0.92 && (t < 0.42 || t > 0.58);
    const half = halfMax * (0.3 + 0.7 * taper);
    for (let y = 1; y < h - 1; y++) {
      const d = Math.abs(y - cy);
      if (d > half + 0.7) continue;
      let c = clamp01(1 - d / Math.max(0.35, half)) * (0.2 + 0.8 * taper);
      if (gap) c *= 0.1;
      if (c < 0.03) continue;
      const i = y * w + x;
      if (c > cover[i]) cover[i] = c;
    }
  }

  const mid = w >> 1;
  const cy = yA + (yB - yA) * (mid / (w - 1));
  const iy = Math.max(1, Math.min(h - 2, Math.round(cy)));
  cover[iy * w + mid] = 1;
  if (mid - 4 > 0) cover[iy * w + (mid - 4)] = Math.max(cover[iy * w + (mid - 4)], 0.8);
  if (mid + 4 < w - 1) cover[iy * w + (mid + 4)] = Math.max(cover[iy * w + (mid + 4)], 0.8);

  for (let i = 0; i < cover.length; i++) {
    if (cover[i] === 0) continue;
    const t = (i % w) / (w - 1);
    const taper = 1 - (t * 2 - 1) * (t * 2 - 1);
    dome[i] = clamp01(cover[i] * (0.4 + 0.6 * taper));
  }
  return { kind: "streak", w, h, cover, dome };
}

function finish(shape: CloudShape, serial: number): CloudShape {
  zeroBorder(shape.cover, shape.dome, shape.w, shape.h);
  diversify(shape.cover, shape.w, serial);
  zeroBorder(shape.cover, shape.dome, shape.w, shape.h);
  sealDome(shape.cover, shape.dome, shape.w);
  zeroBorder(shape.cover, shape.dome, shape.w, shape.h);
  return shape;
}

/** The shapes, ordered by kind (heap, wisp, bank, streak) and then by index. Deterministic in the seed. */
export function makeShapes(seed: number, counts: Readonly<Record<CloudKind, number>>): CloudShape[] {
  const rng = rngFor(seed, "sky-shapes");
  const out: CloudShape[] = [];
  for (let k = 0; k < KINDS.length; k++) {
    const kind = KINDS[k];
    const n = counts[kind] ?? 0;
    for (let i = 0; i < n; i++) {
      const noiseSeed = rng.next();
      let shape: CloudShape;
      if (kind === "heap") shape = makeHeap(rng, noiseSeed, i);
      else if (kind === "wisp") shape = makeWisp(rng, noiseSeed, i);
      else if (kind === "bank") shape = makeBank(rng, noiseSeed, i);
      else shape = makeStreak(rng, noiseSeed, i);
      out.push(finish(shape, i));
    }
  }
  return out;
}
