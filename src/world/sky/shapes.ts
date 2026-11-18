// Cloud shapes: a coverage mask and a dome height per pixel, generated once from
// the world seed. Painters turn them into sprites; the field places them.
//
// A heap is a row of round lobes, tallest in the middle, the outer ones smaller and
// riding higher so the ends curve in, all cut flat at the base. A bank is two tiers
// of such lobes. A wisp or a streak is a tapered ribbon along a gently bent line.
// Edges are a narrow soft band; the lobes' outlines are pushed about by slow noise,
// never by per-pixel speckle.

import { gradNoise } from "../core/noise.ts";
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
/** Empty pixels kept round every shape. */
const MARGIN = 2;
/** Width of the soft edge, pixels. */
const SOFT = 1.4;
/** How far slow noise pushes a lobe's outline, as a share of its radius. */
const WOBBLE = 0.07;
const NOISE_PERIOD = 256;

interface Lobe {
  x: number;
  y: number;
  r: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const range = (rng: Rng, lo: number, hi: number): number => lo + rng.float() * (hi - lo);
const intIn = (rng: Rng, lo: number, hi: number): number => lo + rng.int(hi - lo + 1);

/**
 * A row of `count` lobes across [x0, x1] standing on `base`: radii set by their spacing (about 0.6–0.95 of it, largest in
 * the middle), so neighbouring crowns stay distinct and the crown is highest in the middle.
 */
function lobeRow(rng: Rng, count: number, x0: number, x1: number, base: number, scale: number): Lobe[] {
  const step = (x1 - x0) / count;
  const out: Lobe[] = [];
  // Where the crown peaks: rarely dead centre, so heaps lean one way or the other.
  const peak = range(rng, 0.38, 0.62);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    // 1 at the peak, 0 at the ends.
    const mid = 1 - Math.abs(t - peak) / Math.max(peak, 1 - peak);
    const r = scale * step * (0.6 + 0.35 * mid) * range(rng, 0.9, 1.08);
    // Centres a little above the base, outer ones slightly more; being smaller, the outer crowns stay below the middle.
    const lift = 0.25 + 0.15 * (1 - mid);
    out.push({ x: x0 + step * (i + 0.5) + range(rng, -0.06, 0.06) * step, y: base - lift * r, r });
  }
  return out;
}

/** Highest point of a set of lobes above `base`. */
const crownOf = (lobes: readonly Lobe[], base: number): number => Math.max(...lobes.map((l) => base - l.y + l.r));

/**
 * Rasterises lobes cut flat at `base`: cover from the distance to the nearest outline (pushed in and out by slow noise),
 * pinched in below the widest row so the base is narrower than the cloud; dome from the lobes' spherical caps.
 */
function paintLobes(w: number, h: number, lobes: readonly Lobe[], base: number, noiseSeed: number, pinch: number, waistAt: number): { cover: Float32Array; dome: Float32Array } {
  const cover = new Float32Array(w * h), dome = new Float32Array(w * h);
  const top = crownOf(lobes, base);
  let left = w, right = 0;
  for (const l of lobes) {
    left = Math.min(left, l.x - l.r);
    right = Math.max(right, l.x + l.r);
  }
  const cx = (left + right) / 2, halfW = (right - left) / 2;
  // Below `waist` the cloud narrows toward its base, to (1 − pinch) of its width at the base itself.
  const waist = base - waistAt * top;
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    let sd = -1e9, z = 0;
    for (const l of lobes) {
      const dx = x + 0.5 - l.x, dy = y + 0.5 - l.y, d = Math.sqrt(dx * dx + dy * dy);
      // The outline wobbles slowly with the direction round the lobe, never pixel by pixel.
      const ang = d > 1e-6 ? dx / d + 2 * (dy / d) : 0;
      const r = l.r * (1 + WOBBLE * gradNoise(l.x * 0.37 + ang * 2.1, l.y * 0.37 + ang * 1.3, NOISE_PERIOD, noiseSeed));
      sd = Math.max(sd, r - d);
      if (d < r) z = Math.max(z, (base - l.y) + Math.sqrt(r * r - d * d));
    }
    if (y + 0.5 > waist) {
      const u = (y + 0.5 - waist) / (base - waist);
      sd = Math.min(sd, halfW * (1 - pinch * u * u) - Math.abs(x + 0.5 - cx));
    }
    // The flat base: a crisp cut, softened over one pixel.
    const c = clamp01(0.5 + sd / SOFT) * clamp01(0.5 - (y + 0.5 - base) / 0.8);
    cover[y * w + x] = c;
    dome[y * w + x] = c > 0 ? clamp01(z / top) : 0;
  }
  return { cover, dome };
}

/** Lobes for a box `w` wide, then the box height that fits them (inside `hr`), and the lobes moved onto its base. */
function fitLobes(w: number, hr: readonly [number, number], build: (base: number) => Lobe[]): { h: number; base: number; lobes: Lobe[] } {
  const trial = build(0);
  let h = Math.ceil(crownOf(trial, 0)) + 2 * MARGIN + 2;
  h = Math.max(hr[0], Math.min(hr[1], h));
  const base = h - MARGIN - 1;
  return { h, base, lobes: build(base) };
}

function makeHeap(rng: Rng, noiseSeed: number): CloudShape {
  const r = SHAPE_SIZES.heap;
  const w = intIn(rng, r.w[0], r.w[1]);
  const count = Math.max(3, Math.min(7, Math.round(w / 20)));
  const usable = w - 2 * MARGIN;
  const step = usable / (count + 0.6);
  const x0 = MARGIN + 0.3 * step, x1 = x0 + step * count;
  const seed = rng.next();
  // Squash the lobes when the crown would not fit the tallest heap allowed.
  const room = r.h[1] - 2 * MARGIN - 2;
  const tall = crownOf(lobeRow(rngFor(seed, "heap"), count, x0, x1, 0, 1), 0);
  const scale = Math.min(1, room / tall);
  const fit = fitLobes(w, r.h, (base) => lobeRow(rngFor(seed, "heap"), count, x0, x1, base, scale));
  return { kind: "heap", w, h: fit.h, ...paintLobes(w, fit.h, fit.lobes, fit.base, noiseSeed, 0.45, 0.5) };
}

function makeBank(rng: Rng, noiseSeed: number): CloudShape {
  const r = SHAPE_SIZES.bank;
  const w = intIn(rng, r.w[0], r.w[1]);
  const lowCount = Math.max(4, Math.min(7, Math.round(w / 32)));
  const usable = w - 2 * MARGIN;
  const step = usable / (lowCount + 0.6);
  const x0 = MARGIN + 0.3 * step, x1 = x0 + step * lowCount;
  const upCount = Math.max(2, lowCount - 2);
  const seed = rng.next();
  // A broad lower tier, and a narrower upper tier of crowns standing on its shoulders.
  const build = (base: number): Lobe[] => {
    const lower = lobeRow(rngFor(seed, "bank-low"), lowCount, x0, x1, base, 1.2);
    const shoulder = base - 1.05 * Math.max(...lower.map((l) => l.r));
    const span = 0.62 * (x1 - x0);
    const upper = lobeRow(rngFor(seed, "bank-up"), upCount, w / 2 - span / 2, w / 2 + span / 2, shoulder, 0.72);
    return [...lower, ...upper];
  };
  const fit = fitLobes(w, r.h, build);
  return { kind: "bank", w, h: fit.h, ...paintLobes(w, fit.h, fit.lobes, fit.base, noiseSeed, 0.55, 0.4) };
}

/** A ribbon along a gently bent centre line, thickest in the middle and tapering to points, with soft breaks. */
function makeRibbon(rng: Rng, noiseSeed: number, kind: "wisp" | "streak"): CloudShape {
  const r = SHAPE_SIZES[kind];
  let w = intIn(rng, r.w[0], r.w[1]), h = intIn(rng, r.h[0], r.h[1]);
  if (w < 4 * h) h = Math.max(r.h[0], Math.floor(w / 4));
  if (w < 4 * h) w = Math.min(r.w[1], 4 * h);
  const cover = new Float32Array(w * h), dome = new Float32Array(w * h);
  // Ribbons are thin: a one-pixel margin is enough to keep the border clear.
  const m = 1, half = (h - 2 * m) / 2;
  const bend = range(rng, -0.35, 0.35) * half, phase = range(rng, 0, Math.PI);
  // One end drawn out longer than the other, and the thickness swelling and thinning along the way.
  const skew = range(rng, 0.8, 1.25), swell = kind === "wisp" ? 0.55 : 0.9;
  const x0 = m, x1 = w - m;
  for (let x = x0; x < x1; x++) {
    const u = Math.pow((x + 0.5 - x0) / (x1 - x0), skew);
    const taper = Math.pow(Math.sin(Math.PI * u), 3);
    // Slow breaks: the ribbon thins and, for streaks, now and then parts.
    const n = gradNoise(x * 0.045, 7.3, NOISE_PERIOD, noiseSeed);
    const thin = clamp01(0.8 + swell * n);
    const t = half * taper * thin;
    const yc = m + half + bend * Math.sin(Math.PI * u + phase) * (1 - 2 * Math.abs(u - 0.5));
    // A column draws only if its middle pixel is solid, so no faint pixels hang off the ribbon's thinnest ends.
    const core = Math.abs(Math.floor(yc) + 0.5 - yc);
    if (t <= core) continue;
    for (let y = m; y < h - m; y++) {
      const dy = Math.abs(y + 0.5 - yc);
      // Only where the ribbon has a core: no faint pixels hanging off its thinnest ends.
      const c = t >= 0.3 ? clamp01(0.5 + (t - dy) / SOFT) : 0;
      const q = dy / (2 * t + 2);
      cover[y * w + x] = c;
      dome[y * w + x] = c > 0 ? clamp01((1 - q * q) * taper) : 0;
    }
  }
  return { kind, w, h, cover, dome };
}

/** The shapes, ordered by kind (heap, wisp, bank, streak) and then by index. Deterministic in the seed. */
export function makeShapes(seed: number, counts: Readonly<Record<CloudKind, number>>): CloudShape[] {
  const rng = rngFor(seed, "sky-shapes");
  const out: CloudShape[] = [];
  for (const kind of KINDS) {
    for (let i = 0; i < counts[kind]; i++) {
      const noiseSeed = rng.next();
      out.push(kind === "heap" ? makeHeap(rng, noiseSeed) : kind === "bank" ? makeBank(rng, noiseSeed) : makeRibbon(rng, noiseSeed, kind));
    }
  }
  return out;
}
