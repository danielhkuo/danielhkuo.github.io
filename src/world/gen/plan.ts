// S1 Plan: island cores, fold-belt spines, uplift U, erodibility K, rock and
// soft region weights, all on the coarse grid C.

import { fbm, gradNoise, octaveMatrixPower, ridgedFbm } from "../core/noise.ts";
import { rngFor, type Rng } from "../core/rng.ts";
import { torusDelta } from "../core/torus.ts";
import { ARCHETYPE, ARCHETYPE_COUNT, type Archetype, type ArchetypeSpec, type WorldParams } from "./params.ts";

export interface Core {
  /** Centre in cells. */
  x: number;
  y: number;
  archetype: Archetype;
  /** Half the island length, in cells. */
  radius: number;
  /** Main spine polyline x0, y0, x1, y1, … in cells, unwrapped from the centre. */
  spine: Float64Array;
}

export interface Plan {
  /** Grid size: the C grid, cN nodes a side. */
  n: number;
  cores: Core[];
  /** Uplift rate per node. */
  uplift: Float64Array;
  /** Erodibility per node: kBase · kMul[rock]. */
  k: Float64Array;
  /** Hillslope diffusion per node, blended from the archetype values by region weight. */
  d: Float64Array;
  /** Rock class per node: 0 hard, 1 medium, 2 soft. */
  rock: Uint8Array;
  /** Six planes of n², archetype-major: soft membership of each node; sums to 1. */
  regions: Float32Array;
}

// Shape constants that are not world parameters. Lengths are in cells of the
// 6400 world and scale with n; noise feature sizes are whole periods of it.

/** Half-width at a belt's two ends as a share of its half-width amidships: belts are spindles. */
const TAPER = 0.35;
/** The spine bows across strike by up to these shares of the island's length: one arc, plus an S. */
const BOW_ARC: readonly [number, number] = [0.05, 0.13];
const BOW_S = 0.07;
/** Each control segment of the spine is drawn as this many straight pieces of a smooth curve. */
const SPINE_PIECES = 3;
/** An island's own strike may lean this far (as a slope) from the global strike. */
const LEAN = 0.1;
/**
 * Secondary belts flank the spine en echelon. A belt stands this share of the
 * two half-widths from the belt inside it: under 1 they meet on their
 * shoulders, where the uplift is low, so the col between them sits near sea
 * level and drowning can notch or split it.
 */
const BELT_SPACING: readonly [number, number] = [0.45, 0.9];
/** Width, length (first rank, then outer ranks) and height of a secondary belt as shares of the spine's. */
const BELT_WIDTH: readonly [number, number] = [0.45, 0.95];
const BELT_LENGTH: readonly [number, number] = [0.45, 0.8];
const OUTER_LENGTH: readonly [number, number] = [0.25, 0.55];
const BELT_HEIGHT: readonly [number, number] = [0.55, 0.9];
/** A secondary belt may overhang the end of the belt inside it by this share of its own length. */
const OVERHANG = 0.3;
/** A secondary belt drifts towards or away from the spine along its length by up to this slope. */
const BELT_DRIFT = 0.12;

/** Coast: the distance to a ridge is scaled by bay noise (large) and cove noise (small). */
const BAY_CELLS = 900;
const BAY_WARP = 0.5;
const COVE_CELLS = 190;
const COVE_WARP = 0.28;
const BITE_MIN = 0.5;
/**
 * Fibre shear: the land is sampled at a point slid along strike by noise that
 * changes quickly across strike and slowly along it. Belt ends interfinger as
 * headlands and rias; flanks, which run along strike, stay straight.
 */
const FIBRE_SHIFT = 380;
const FIBRE_SHARE = 0.12;
const FIBRE_CELLS = 320;
const FIBRE_STRETCH = 6;
const FIBRE_OCTAVES = 2;

/**
 * Uplift across a belt. From the coast in, a lowland ramp climbs to LOWLAND of
 * the belt's height over a share of the half-width that varies along the
 * coast (cliffed here, a plain there); then the flank rises to the plateau
 * and a little more to the crest.
 */
const LOWLAND = 0.13;
const LOWLAND_CELLS = 1280;
const LOWLAND_SHARE: readonly [number, number] = [0.1, 0.45];
const CREST = 0.3;
/** Summits and cols: uplift dips by up to this share along the ridges, in patches of SUMMIT_CELLS. */
const SUMMIT = 0.12;
const SUMMIT_CELLS = 490;
const UPLIFT_OCTAVES = 3;
const UPLIFT_GAIN = 0.75;

/**
 * Rugged islands (uplift.rugged per archetype) are massifs, not tents. Above the lowland their uplift follows a
 * network of ridges: ridged noise of MASSIF_CELLS, sampled at a point warped by MASSIF_WARP cells of a noise of
 * MASSIF_WARP_CELLS, so its crest lines bend and branch; between the ridges it falls to MASSIF_BASE of the belt's
 * height, which is where the rivers cut the passes and the valley heads. The belt's own axis is bent as well, by up
 * to AXIS_WARP of its half-width over AXIS_CELLS. Both fade to nothing at the coast: the outline is the tent's.
 */
const MASSIF_CELLS = 520;
const MASSIF_OCTAVES = 4;
const MASSIF_GAIN = 0.6;
const MASSIF_BASE = 0.2;
const MASSIF_WARP_CELLS = 330;
const MASSIF_WARP = 70;
const AXIS_CELLS = 760;
const AXIS_WARP = 0.45;
/** The share of a belt's height at which its uplift starts to follow the massif, and at which it follows it wholly. */
/** A massif's belts are broad-topped: the flank reaches the plateau this share of the half-width short of the axis. */
const MASSIF_PLATEAU = 0.7;
const MASSIF_RISE: readonly [number, number] = [0.16, 0.4];

/** The home island's town bay: a bite out of the south coast, east of centre, ringed by lowland. */
const BAY_RADIUS = 0.1;
const BAY_LOWLAND = 0.22;
const HOME_LOWLAND = 0.1;

/** Rock stripes are displaced across strike by up to this many warp features. */
const STRIPE_WARP = 0.5;
/** Open water kept between island outlines at placement, and between a skerry and anything. */
const CHANNEL = 260;
const SKERRY_CHANNEL = 110;
/** Gain that brings strike-averaged noise back to the spread of plain gradient noise. */
const BLUR_GAIN = 2.6;
/** Gain that brings plain fbm to about [−1, 1]. */
const FBM_GAIN = 1.7;

function smoothstep(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Noise stretched along strike. Each octave is gradient noise averaged over a
 * short window along the strike direction, so features run `stretch` times
 * longer along strike than across it, in any strike direction, and the field
 * still tiles: every sample is the periodic noise at a shifted point.
 */
interface StrikeNoise {
  /** Signed, about [−1, 1]. */
  signed(x: number, y: number): number;
  /** Ridged, [0, 1]: crests where an octave crosses zero. */
  ridged(x: number, y: number): number;
}

function strikeNoise(n: number, period: number, octaves: number, gain: number, stretch: number, ux: number, uy: number, seed: number): StrikeNoise {
  const taps = Math.max(1, Math.round(stretch));
  const step = stretch / (2 * taps);
  const m = new Float64Array(octaves * 6);
  const seeds = new Uint32Array(octaves);
  let shrink = 1;
  for (let k = 0; k < octaves; k++) {
    const [a, b, c, d] = octaveMatrixPower(k);
    m[k * 6] = a;
    m[k * 6 + 1] = b;
    m[k * 6 + 2] = c;
    m[k * 6 + 3] = d;
    // M^k is a rotation scaled by √5^k; the window direction turns with it.
    m[k * 6 + 4] = (a * ux + b * uy) * shrink * step;
    m[k * 6 + 5] = (c * ux + d * uy) * shrink * step;
    shrink /= Math.sqrt(5);
    seeds[k] = (seed + Math.imul(k, 0x9e3779b9)) >>> 0;
  }
  const scale = period / n;
  const sum = (x: number, y: number, ridge: boolean): number => {
    const qx = x * scale, qy = y * scale;
    let total = 0, weightSum = 0, weight = 1;
    for (let k = 0; k < octaves; k++) {
      const X = m[k * 6] * qx + m[k * 6 + 1] * qy, Y = m[k * 6 + 2] * qx + m[k * 6 + 3] * qy;
      const ex = m[k * 6 + 4], ey = m[k * 6 + 5];
      let s = 0;
      for (let j = -taps; j <= taps; j++) s += gradNoise(X + j * ex, Y + j * ey, period, seeds[k]);
      s = clamp((s / (2 * taps + 1)) * BLUR_GAIN, -1, 1);
      total += (ridge ? 1 - Math.abs(s) : s) * weight;
      weightSum += weight;
      weight *= gain;
    }
    return total / weightSum;
  };
  return { signed: (x, y) => sum(x, y, false), ridged: (x, y) => sum(x, y, true) };
}

/**
 * One ridge and its belt: a polyline in cells relative to the core. The belt's
 * half-width is `half` amidships and tapers along a parabola to TAPER · half
 * at the ends; `a` is each vertex's along-strike position, `mid` and `len`
 * the ridge's middle and length on that axis. `height` scales its uplift.
 * (cx, cy, rad) is a circle that holds every vertex.
 */
interface Ridge {
  x: Float64Array;
  y: Float64Array;
  a: Float64Array;
  mid: number;
  len: number;
  half: number;
  height: number;
  cx: number;
  cy: number;
  rad: number;
}

interface Island {
  core: Core;
  spec: ArchetypeSpec;
  length: number;
  ridges: Ridge[];
  /** Half-width of the main belt amidships, in cells. */
  half: number;
  /** Land can lie this far outside the unwarped outline. */
  near: number;
  /** Largest |x| or |y| the land reaches from the core. */
  reach: number;
  /** Middle of the outline relative to the core, and its half-extents, along and across the global strike. */
  midAlong: number;
  midAcross: number;
  extAlong: number;
  extAcross: number;
  /** The island's own strike (unit) and its main spine as (along, across) vertices. */
  ux: number;
  uy: number;
  along: Float64Array;
  across: Float64Array;
  /** Largest fibre shift, in cells. */
  fibre: number;
  /** Town bay, relative to the core; bayR is 0 where there is none. */
  bayX: number;
  bayY: number;
  bayR: number;
  /** Added to the lowland share everywhere on the island. */
  lowland: number;
  blend: number;
  stripeWidth: number;
  stripePhase: number;
  /** Rock class per stripe, indexed from −stripeHalf. */
  stripes: Uint8Array;
  stripeHalf: number;
  amp: number;
}

/** One rock class by odds; `banned` (or −1) is left out when another class is possible. */
function drawRock(rng: Rng, odds: readonly [number, number, number], banned: number): number {
  const r = rng.float();
  let total = 0;
  for (let c = 0; c < 3; c++) if (c !== banned) total += odds[c];
  if (total <= 0) return banned < 0 ? 0 : banned;
  let acc = 0, last = 0;
  for (let c = 0; c < 3; c++) {
    if (c === banned || odds[c] <= 0) continue;
    acc += odds[c] / total;
    last = c;
    if (r < acc) return c;
  }
  return last;
}

/** The across-strike offset of a polyline, given as (along, across) vertices, at an along-strike position. */
function acrossAt(al: Float64Array, ac: Float64Array, a: number): number {
  const last = al.length - 1;
  if (a <= al[0]) return ac[0];
  for (let i = 0; i < last; i++) {
    if (a <= al[i + 1]) return ac[i] + ((a - al[i]) / (al[i + 1] - al[i])) * (ac[i + 1] - ac[i]);
  }
  return ac[last];
}

/** A belt's half-width at an along-strike position. */
function halfAt(r: Ridge, a: number): number {
  const q = Math.min(1, Math.abs((2 * (a - r.mid)) / r.len));
  return r.half * (TAPER + (1 - TAPER) * (1 - q * q));
}

function makeRidge(a: Float64Array, c: Float64Array, half: number, height: number, ux: number, uy: number): Ridge {
  const m = a.length;
  const x = new Float64Array(m), y = new Float64Array(m);
  let cx = 0, cy = 0;
  for (let i = 0; i < m; i++) {
    x[i] = a[i] * ux - c[i] * uy;
    y[i] = a[i] * uy + c[i] * ux;
    cx += x[i] / m;
    cy += y[i] / m;
  }
  let rad = 0;
  for (let i = 0; i < m; i++) rad = Math.max(rad, Math.sqrt((x[i] - cx) * (x[i] - cx) + (y[i] - cy) * (y[i] - cy)));
  return { x, y, a, mid: (a[0] + a[m - 1]) / 2, len: a[m - 1] - a[0], half, height, cx, cy, rad };
}

/** The island's own strike: the global one, leaning a little, still inside ±maxSlope. */
function ownStrike(p: WorldParams, rng: Rng, slope: number): [number, number] {
  const own = clamp(slope + rng.range(-LEAN, LEAN), -p.strike.maxSlope, p.strike.maxSlope);
  const norm = Math.sqrt(1 + own * own);
  return [1 / norm, own / norm];
}

/**
 * The fold belts of an island, about a core at the origin: one bowed spine
 * the length of the island, and secondary belts stepping out en echelon on
 * both sides, shorter, narrower and lower. Returns the spine's control
 * polyline as (along, across) too.
 */
function buildBelts(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, ux: number, uy: number): { ridges: Ridge[]; al: Float64Array; ac: Float64Array; dal: Float64Array; dac: Float64Array } {
  const width = length * spec.aspect;
  const count = spec.ridges[0] + rng.int(spec.ridges[1] - spec.ridges[0] + 1);

  // Lay the secondaries out in units of the spine's half-width and length.
  const side0 = rng.float() < 0.5 ? 1 : -1;
  const side = new Int8Array(count), parent = new Int32Array(count);
  const share = new Float64Array(count), len = new Float64Array(count), mid = new Float64Array(count);
  const step = new Float64Array(count), offset = new Float64Array(count), height = new Float64Array(count);
  share[0] = 1;
  len[0] = 1;
  height[0] = 1;
  let outerPlus = 0, outerMinus = 0;
  let extPlus = 1, extMinus = 1;
  for (let k = 1; k < count; k++) {
    side[k] = k % 2 === 1 ? side0 : -side0;
    parent[k] = side[k] > 0 ? outerPlus : outerMinus;
    const par = parent[k];
    share[k] = rng.range(BELT_WIDTH[0], BELT_WIDTH[1]) * (par === 0 ? 1 : 0.85);
    len[k] = par === 0 ? rng.range(BELT_LENGTH[0], BELT_LENGTH[1]) : rng.range(OUTER_LENGTH[0], OUTER_LENGTH[1]);
    const room = Math.max(0, len[par] / 2 - (0.5 - OVERHANG) * len[k]);
    mid[k] = clamp(mid[par] + rng.range(-1, 1) * room, -0.5 + len[k] / 2, 0.5 - len[k] / 2);
    step[k] = rng.range(BELT_SPACING[0], BELT_SPACING[1]) * (share[par] + share[k]);
    offset[k] = offset[par] + step[k];
    height[k] = rng.range(BELT_HEIGHT[0], BELT_HEIGHT[1]) * height[par];
    if (side[k] > 0) {
      outerPlus = k;
      extPlus = Math.max(extPlus, offset[k] + share[k]);
    } else {
      outerMinus = k;
      extMinus = Math.max(extMinus, offset[k] + share[k]);
    }
  }
  const half = width / (extPlus + extMinus);
  const run = length - 2 * TAPER * half;

  // The spine's control polyline in (along, across): an arc and an S, so it
  // bows; only inner vertices leave the strike line, so its ends stay on it.
  const segs = p.spine.segments[0] + rng.int(p.spine.segments[1] - p.spine.segments[0] + 1);
  const segLen = run / segs;
  const arc = (rng.float() < 0.5 ? 1 : -1) * rng.range(BOW_ARC[0], BOW_ARC[1]) * length;
  const ess = rng.range(-BOW_S, BOW_S) * length;
  const al = new Float64Array(segs + 1), ac = new Float64Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const inner = i > 0 && i < segs;
    al[i] = -run / 2 + (i + (inner ? rng.range(-0.15, 0.15) : 0)) * segLen;
    const q = (2 * al[i]) / run;
    ac[i] = inner ? (1 - q * q) * (arc + 2.6 * ess * q) + rng.range(-p.spine.bend, p.spine.bend) * segLen * 0.3 : 0;
  }
  // The belts follow a smooth curve through the control points (Catmull–Rom).
  const dal = new Float64Array(segs * SPINE_PIECES + 1), dac = new Float64Array(segs * SPINE_PIECES + 1);
  for (let i = 0; i < segs; i++) {
    const p0 = ac[Math.max(i - 1, 0)], p1 = ac[i], p2 = ac[i + 1], p3 = ac[Math.min(i + 2, segs)];
    for (let j = 0; j < SPINE_PIECES; j++) {
      const t = j / SPINE_PIECES;
      dal[i * SPINE_PIECES + j] = al[i] + t * (al[i + 1] - al[i]);
      dac[i * SPINE_PIECES + j] = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    }
  }
  dal[segs * SPINE_PIECES] = al[segs];
  dac[segs * SPINE_PIECES] = ac[segs];
  // Slide the spine across strike so it passes through the core.
  const centre = acrossAt(dal, dac, 0);
  for (let i = 0; i <= segs; i++) ac[i] -= centre;
  for (let i = 0; i < dac.length; i++) dac[i] -= centre;

  const ridges: Ridge[] = [makeRidge(dal, dac, half, 1, ux, uy)];
  const cells = new Float64Array(count);
  for (let k = 1; k < count; k++) {
    cells[k] = cells[parent[k]] + Math.max(p.spine.ridgeGap, step[k] * half);
    const pieces = Math.max(3, Math.round(segs * SPINE_PIECES * len[k]));
    const drift = rng.range(-BELT_DRIFT, BELT_DRIFT);
    const a = new Float64Array(pieces + 1), c = new Float64Array(pieces + 1);
    for (let j = 0; j <= pieces; j++) {
      a[j] = (mid[k] - len[k] / 2 + (j / pieces) * len[k]) * run;
      c[j] = acrossAt(dal, dac, a[j]) + side[k] * cells[k] + drift * (a[j] - mid[k] * run);
    }
    ridges.push(makeRidge(a, c, half * share[k], height[k], ux, uy));
  }
  return { ridges, al, ac, dal, dac };
}

/**
 * A skerry cluster about a core at the origin: one islet on the core and up
 * to five more scattered within the cluster's ellipse, none too close to
 * another, of mixed size, shape, lean and height. A cluster of one is a lone stack.
 */
function buildCluster(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, ux: number, uy: number): { ridges: Ridge[]; al: Float64Array; ac: Float64Array; dal: Float64Array; dac: Float64Array } {
  const count = spec.ridges[0] + rng.int(spec.ridges[1] - spec.ridges[0] + 1);
  const radius = length / 2;
  const segs = p.spine.segments[0] + rng.int(p.spine.segments[1] - p.spine.segments[0] + 1);
  const run = length * rng.range(0.25, 0.45);
  const half = (run * rng.range(0.3, 0.6)) / 2;
  const al = new Float64Array(segs + 1), ac = new Float64Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const inner = i > 0 && i < segs;
    al[i] = -run / 2 + (i * run) / segs;
    ac[i] = inner ? rng.range(-p.spine.bend, p.spine.bend) * (run / segs) * 0.6 : 0;
  }
  const centre = acrossAt(al, ac, 0);
  for (let i = 0; i <= segs; i++) ac[i] -= centre;
  const ridges: Ridge[] = [makeRidge(al, ac, half, 1, ux, uy)];

  const pa = new Float64Array(count), pc = new Float64Array(count);
  let placed = 1;
  for (let k = 1; k < count; k++) {
    const isletLen = length * rng.range(0.08, 0.3);
    const isletHalf = (isletLen * rng.range(0.35, 0.9)) / 2;
    const lean = rng.range(-0.3, 0.3), kink = rng.range(-0.2, 0.2), height = rng.range(0.45, 1);
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = rng.range(-1, 1), c = rng.range(-1, 1);
      if (a * a + c * c > 1) continue;
      let ok = true;
      for (let o = 0; o < placed && ok; o++) {
        const da = a - pa[o], dc = c - pc[o];
        if (da * da + dc * dc < 0.3) ok = false;
      }
      if (!ok) continue;
      pa[placed] = a;
      pc[placed] = c;
      placed++;
      const ma = a * radius, mc = c * radius * spec.aspect;
      const ia = new Float64Array([ma - isletLen / 2, ma, ma + isletLen / 2]);
      const ic = new Float64Array([mc - (lean * isletLen) / 2, mc + kink * isletLen, mc + (lean * isletLen) / 2]);
      ridges.push(makeRidge(ia, ic, isletHalf, height, ux, uy));
      break;
    }
  }
  return { ridges, al, ac, dal: al, dac: ac };
}

/** An island's shape about a core at the origin; placeIslands gives the core its place. */
function buildIsland(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, slope: number): Island {
  const s = p.n / 6400;
  const [ux, uy] = ownStrike(p, rng, slope);
  const skerry = spec.id === ARCHETYPE.skerry;
  const built = skerry ? buildCluster(p, rng, spec, length, ux, uy) : buildBelts(p, rng, spec, length, ux, uy);
  const ridges = built.ridges;
  const half = ridges[0].half;
  const fibre = Math.min(FIBRE_SHIFT * s, FIBRE_SHARE * length);

  // Town bay: on the south coast (+across), east of the core, its centre just off the outline.
  let bayX = 0, bayY = 0, bayR = 0;
  if (spec.id === ARCHETYPE.home) {
    const a = rng.range(0.02, 0.28) * ridges[0].len;
    let edge = -Infinity;
    for (const r of ridges) {
      if (Math.abs(a - r.mid) > 0.42 * r.len) continue;
      const c = new Float64Array(r.a.length);
      for (let i = 0; i < c.length; i++) c[i] = r.y[i] * ux - r.x[i] * uy;
      edge = Math.max(edge, acrossAt(r.a, c, a) + halfAt(r, a));
    }
    bayR = BAY_RADIUS * length;
    const c = edge + 0.1 * bayR;
    bayX = a * ux - c * uy;
    bayY = a * uy + c * ux;
  }

  const gn = Math.sqrt(1 + slope * slope);
  const gx = 1 / gn, gy = slope / gn;
  let maxHalf = 0;
  for (const r of ridges) maxHalf = Math.max(maxHalf, r.half);
  const near = fibre + (1 / BITE_MIN - 1) * maxHalf + 8 * s;
  let reach = 0, loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
  for (const r of ridges) {
    for (let i = 0; i < r.x.length; i++) {
      reach = Math.max(reach, Math.abs(r.x[i]) + r.half, Math.abs(r.y[i]) + r.half);
      const a = r.x[i] * gx + r.y[i] * gy, b = r.y[i] * gx - r.x[i] * gy;
      const end = r.half * TAPER;
      loA = Math.min(loA, a - end);
      hiA = Math.max(hiA, a + end);
      loB = Math.min(loB, b - r.half);
      hiB = Math.max(hiB, b + r.half);
    }
  }

  // Rock stripes across strike. A class with odds of a half or less never
  // takes two stripes running, so slate alternates and hard karst may repeat.
  const stripeWidth = rng.range(spec.stripeWidth[0], spec.stripeWidth[1]);
  const stripeHalf = Math.ceil(p.n / stripeWidth) + 3;
  const stripes = new Uint8Array(2 * stripeHalf + 1);
  let prev = -1;
  for (let i = 0; i < stripes.length; i++) {
    const banned = prev >= 0 && spec.rockBias[prev] <= 0.5 ? prev : -1;
    prev = drawRock(rng, spec.rockBias, banned);
    stripes[i] = prev;
  }

  return {
    core: { x: 0, y: 0, archetype: spec.id, radius: length / 2, spine: new Float64Array(built.al.length * 2) },
    spec,
    length,
    ridges,
    half,
    near,
    reach: reach + near,
    midAlong: (loA + hiA) / 2,
    midAcross: (loB + hiB) / 2,
    extAlong: (hiA - loA) / 2,
    extAcross: (hiB - loB) / 2,
    ux,
    uy,
    along: built.dal,
    across: built.dac,
    fibre,
    bayX,
    bayY,
    bayR,
    lowland: spec.id === ARCHETYPE.home ? HOME_LOWLAND : 0,
    blend: rng.range(p.regions.blend[0], p.regions.blend[1]),
    stripeWidth,
    stripePhase: rng.float(),
    stripes,
    stripeHalf,
    amp: spec.peak * p.uplift.scale,
  };
}

/** The other image of a min-image offset that might be nearer to something `reach` wide. */
function otherImage(d: number, n: number, reach: number): number {
  const far = n / 2 - reach;
  return d >= 0 ? (d > far ? d - n : d) : d < -far ? d + n : d;
}

/** Distance from a point (relative to the core) to the island's unwarped outline, in cells; negative inside. Never above `best`. */
function edgeAt(isl: Island, px: number, py: number, best: number): number {
  let edge = best;
  for (const r of isl.ridges) {
    const ox = px - r.cx, oy = py - r.cy;
    if (Math.sqrt(ox * ox + oy * oy) - r.rad - r.half >= edge) continue;
    const x = r.x, y = r.y, a = r.a;
    for (let i = 0; i + 1 < x.length; i++) {
      const bx = x[i + 1] - x[i], by = y[i + 1] - y[i];
      const qx = px - x[i], qy = py - y[i];
      const tau = clamp((qx * bx + qy * by) / (bx * bx + by * by), 0, 1);
      const ex = qx - tau * bx, ey = qy - tau * by;
      const e = Math.sqrt(ex * ex + ey * ey) - halfAt(r, a[i] + tau * (a[i + 1] - a[i]));
      if (e < edge) edge = e;
    }
  }
  return edge;
}

/** edgeAt() against the nearest image of the island on the torus. */
function edgeTorus(isl: Island, dx: number, dy: number, n: number): number {
  const dx2 = otherImage(dx, n, isl.reach), dy2 = otherImage(dy, n, isl.reach);
  let e = edgeAt(isl, dx, dy, Infinity);
  if (dx2 !== dx) e = edgeAt(isl, dx2, dy, e);
  if (dy2 !== dy) {
    e = edgeAt(isl, dx, dy2, e);
    if (dx2 !== dx) e = edgeAt(isl, dx2, dy2, e);
  }
  return e;
}

/** Uplift across a belt as a share of its height, from `f` (0 at the coast, 1 on the ridge) and the lowland share. */
function profile(f: number, lowland: number, plateau: number): number {
  if (f <= 0) return 0;
  if (f < lowland) return (LOWLAND * f) / lowland;
  const top = Math.max(1 - plateau, lowland + 0.05);
  const rise = smoothstep((f - lowland) / (top - lowland));
  const crest = f > top ? (f - top) / (1 - top) : 0;
  return LOWLAND + (1 - LOWLAND) * rise * (1 - CREST + CREST * crest);
}

/**
 * The island's uplift at a point (relative to the core) as a share of its
 * peak: the best belt's profile. `bite` scales distances to the ridges, `cut`
 * is taken off f. Never below `best`.
 */
function reliefAt(isl: Island, px: number, py: number, bite: number, cut: number, lowland: number, plateau: number, best: number): number {
  let rel = best;
  for (const r of isl.ridges) {
    const ox = px - r.cx, oy = py - r.cy;
    if ((Math.sqrt(ox * ox + oy * oy) - r.rad) * bite >= r.half) continue;
    const x = r.x, y = r.y, a = r.a;
    let t = Infinity;
    for (let i = 0; i + 1 < x.length; i++) {
      const bx = x[i + 1] - x[i], by = y[i + 1] - y[i];
      const qx = px - x[i], qy = py - y[i];
      const tau = clamp((qx * bx + qy * by) / (bx * bx + by * by), 0, 1);
      const ex = qx - tau * bx, ey = qy - tau * by;
      const hw = halfAt(r, a[i] + tau * (a[i + 1] - a[i]));
      const dist = Math.sqrt(ex * ex + ey * ey);
      if (dist < t * hw) t = dist / hw;
    }
    const v = r.height * profile(1 - t * bite - cut, lowland, plateau);
    if (v > rel) rel = v;
  }
  return rel;
}

/** Draws the quota of islands, largest first, and gives each core its place by Poisson disk. */
function placeIslands(p: WorldParams, rng: Rng, slope: number): Island[] {
  const s = p.n / 6400;
  const cell = p.n / p.cN;
  const wanted: { spec: ArchetypeSpec; length: number }[] = [];
  for (const spec of p.cores.archetypes) {
    const count = spec.count[0] + rng.int(spec.count[1] - spec.count[0] + 1);
    for (let i = 0; i < count; i++) wanted.push({ spec, length: rng.range(spec.diameter[0], spec.diameter[1]) });
  }
  // Largest first: a stable insertion sort by length.
  for (let i = 1; i < wanted.length; i++) {
    const w = wanted[i];
    let j = i - 1;
    while (j >= 0 && wanted[j].length < w.length) {
      wanted[j + 1] = wanted[j];
      j--;
    }
    wanted[j + 1] = w;
  }
  const islands = wanted.map((w) => buildIsland(p, rng, w.spec, w.length, slope));

  const norm = Math.sqrt(1 + slope * slope);
  const ux = 1 / norm, uy = slope / norm;
  const attempts = 64 * islands.length;
  const r2 = p.cores.poissonR * p.cores.poissonR;
  const midX = new Float64Array(islands.length), midY = new Float64Array(islands.length);
  for (let c = 0; c < islands.length; c++) {
    const isl = islands[c];
    // Best candidate: of the attempts that keep the Poisson radius, take the
    // one whose outline stands clearest of the others, measured against the
    // sum of the two outlines' half-extents plus a channel of open water.
    let bestX = 0, bestY = 0, bestScore = -Infinity;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = (rng.int(p.cN) + 0.5) * cell, y = (rng.int(p.cN) + 0.5) * cell;
      const mx = x + isl.midAlong * ux - isl.midAcross * uy, my = y + isl.midAlong * uy + isl.midAcross * ux;
      let score = 1e9;
      for (let o = 0; o < c && score > -Infinity; o++) {
        const other = islands[o];
        const cx = torusDelta(other.core.x, x, p.n), cy = torusDelta(other.core.y, y, p.n);
        if (cx * cx + cy * cy < r2) {
          score = -Infinity;
          break;
        }
        const skerry = isl.spec.id === ARCHETYPE.skerry || other.spec.id === ARCHETYPE.skerry;
        const channel = (skerry ? SKERRY_CHANNEL : CHANNEL) * s;
        const a = isl.extAlong + other.extAlong + channel, b = isl.extAcross + other.extAcross + channel;
        const dx = torusDelta(midX[o], mx, p.n), dy = torusDelta(midY[o], my, p.n);
        const along = dx * ux + dy * uy, across = dy * ux - dx * uy;
        score = Math.min(score, (along * along) / (a * a) + (across * across) / (b * b));
      }
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
    if (bestScore === -Infinity) throw new Error(`cannot place cores: no room for core ${c + 1} of ${islands.length} at spacing ${p.cores.poissonR}`);
    isl.core.x = bestX;
    isl.core.y = bestY;
    midX[c] = bestX + isl.midAlong * ux - isl.midAcross * uy;
    midY[c] = bestY + isl.midAlong * uy + isl.midAcross * ux;
    const al = isl.core.spine.length / 2;
    const main = isl.ridges[0];
    const stride = (main.x.length - 1) / (al - 1);
    for (let i = 0; i < al; i++) {
      isl.core.spine[2 * i] = bestX + main.x[i * stride];
      isl.core.spine[2 * i + 1] = bestY + main.y[i * stride];
    }
  }
  return islands;
}

export function planWorld(p: WorldParams, seed: number): Plan {
  const rng = rngFor(seed, "plan");
  const n = p.n, cN = p.cN, cell = n / cN, nodes = cN * cN;

  // One strike for the whole world, as a slope: direction (1, slope) / √(1 + slope²).
  const slope = rng.range(-p.strike.maxSlope, p.strike.maxSlope);
  const upliftSeed = rng.next(), baySeed = rng.next(), coveSeed = rng.next(), lowSeed = rng.next(), summitSeed = rng.next(), warpSeed = rng.next(), fibreSeed = rng.next();
  const norm = Math.sqrt(1 + slope * slope);
  const ux = 1 / norm, uy = slope / norm;

  const islands = placeIslands(p, rng, slope);
  // Drawn from a stream of their own, so the islands stand where they did before the massifs were added.
  const massifRng = rngFor(seed, "massif");
  const massifSeed = massifRng.next(), massifWarpSeed = massifRng.next(), axisSeed = massifRng.next();
  const massifPeriod = Math.round(6400 / MASSIF_CELLS), massifWarpPeriod = Math.round(6400 / MASSIF_WARP_CELLS), axisPeriod = Math.round(6400 / AXIS_CELLS);
  const massifWarp = (MASSIF_WARP * n) / 6400;

  // Feature sizes are rounded so each noise has a whole number of periods round the world.
  const featurePeriod = Math.max(1, Math.round(n / p.uplift.featureCells));
  const grain = strikeNoise(n, featurePeriod, UPLIFT_OCTAVES, UPLIFT_GAIN, p.uplift.stretch, ux, uy, upliftSeed);
  const fibre = strikeNoise(n, Math.round(6400 / FIBRE_CELLS), FIBRE_OCTAVES, 0.55, FIBRE_STRETCH, ux, uy, fibreSeed);
  const bayPeriod = Math.round(6400 / BAY_CELLS), covePeriod = Math.round(6400 / COVE_CELLS), lowPeriod = Math.round(6400 / LOWLAND_CELLS), summitPeriod = Math.round(6400 / SUMMIT_CELLS);
  const warpPeriod = Math.max(1, Math.round(n / p.rock.warpCells));
  const warpAmp = STRIPE_WARP * p.rock.warpCells;

  const uplift = new Float64Array(nodes);
  const k = new Float64Array(nodes);
  const d = new Float64Array(nodes);
  const rock = new Uint8Array(nodes);
  const regions = new Float32Array(ARCHETYPE_COUNT * nodes);
  const weights = new Float64Array(ARCHETYPE_COUNT);
  const edgeOf = new Float64Array(islands.length);

  for (let iy = 0; iy < cN; iy++) {
    const y = iy * cell + cell / 2;
    for (let ix = 0; ix < cN; ix++) {
      const x = ix * cell + cell / 2;
      const i = iy * cN + ix;

      weights.fill(0);
      let total = 0, owner = 0, ownerEdge = Infinity, anyNear = false;
      for (let c = 0; c < islands.length; c++) {
        const isl = islands[c];
        const edge = edgeTorus(isl, torusDelta(isl.core.x, x, n), torusDelta(isl.core.y, y, n), n);
        edgeOf[c] = edge;
        if (edge < isl.near) anyNear = true;
        if (edge < ownerEdge) {
          ownerEdge = edge;
          owner = c;
        }
        // Membership: 1 at the outline, rising inland, halving one blend out to sea.
        const q = edge / isl.blend;
        const w = q <= 0 ? 1 + q * q : 1 / (1 + q * q);
        weights[isl.core.archetype] += w;
        total += w;
      }

      let mix = 0;
      for (let a = 0; a < ARCHETYPE_COUNT; a++) {
        const w = Math.fround(weights[a] / total);
        regions[a * nodes + i] = w;
        mix += w * p.erode.d[a];
      }
      d[i] = mix;

      if (anyNear) {
        const bay = clamp(FBM_GAIN * fbm((x * bayPeriod) / n, (y * bayPeriod) / n, bayPeriod, 2, 0.5, baySeed), -1, 1);
        const cove = clamp(FBM_GAIN * fbm((x * covePeriod) / n, (y * covePeriod) / n, covePeriod, 2, 0.5, coveSeed), -1, 1);
        const bite = Math.max(BITE_MIN, 1 + BAY_WARP * bay + COVE_WARP * cove);
        const low = clamp(FBM_GAIN * gradNoise((x * lowPeriod) / n, (y * lowPeriod) / n, lowPeriod, lowSeed), -1, 1);
        const lowShare = LOWLAND_SHARE[0] + (LOWLAND_SHARE[1] - LOWLAND_SHARE[0]) * (0.5 + 0.5 * low);
        const slide = fibre.signed(x, y);
        let best = 0, bestRel = 0, bestRugged = 0;
        let axisX = 0, axisY = 0, axisDone = false;
        for (let c = 0; c < islands.length; c++) {
          const isl = islands[c];
          if (edgeOf[c] >= isl.near) continue;
          // The shear fades to nothing on the ridge lines, so a core never leaves its spine.
          const shift = isl.fibre * slide * clamp(1 + edgeOf[c] / isl.half, 0, 1);
          let dx = torusDelta(isl.core.x, x, n) + shift * isl.ux, dy = torusDelta(isl.core.y, y, n) + shift * isl.uy;
          const rugged = p.uplift.rugged[isl.core.archetype];
          const bend = rugged * AXIS_WARP * isl.half * clamp(-edgeOf[c] / isl.half, 0, 1);
          const plainX = dx, plainY = dy;
          const plateau = p.spine.plateau + rugged * (MASSIF_PLATEAU - p.spine.plateau);
          if (bend > 0) {
            if (!axisDone) {
              axisX = clamp(FBM_GAIN * fbm((x * axisPeriod) / n, (y * axisPeriod) / n, axisPeriod, 2, 0.5, axisSeed), -1, 1);
              axisY = clamp(FBM_GAIN * fbm((x * axisPeriod) / n, (y * axisPeriod) / n, axisPeriod, 2, 0.5, axisSeed + 1), -1, 1);
              axisDone = true;
            }
            dx += bend * axisX;
            dy += bend * axisY;
          }
          let cut = 0, lowland = lowShare + isl.lowland;
          if (isl.bayR > 0) {
            const bx = dx - isl.bayX, by = dy - isl.bayY;
            const q = Math.sqrt(bx * bx + by * by) / isl.bayR;
            cut = 1 - smoothstep(q);
            lowland += BAY_LOWLAND * (1 - smoothstep(q / 2.4));
          }
          lowland = Math.min(lowland, 0.55);
          const dx2 = otherImage(dx, n, isl.reach), dy2 = otherImage(dy, n, isl.reach);
          let rel = reliefAt(isl, dx, dy, bite, cut, lowland, plateau, 0);
          if (dx2 !== dx) rel = reliefAt(isl, dx2, dy, bite, cut, lowland, plateau, rel);
          if (dy2 !== dy) {
            rel = reliefAt(isl, dx, dy2, bite, cut, lowland, plateau, rel);
            if (dx2 !== dx) rel = reliefAt(isl, dx2, dy2, bite, cut, lowland, plateau, rel);
          }
          if (bend > 0 && rel === 0) {
            // The bent axis must not open water inside the outline: such a point keeps the straight belt's uplift.
            const px2 = otherImage(plainX, n, isl.reach), py2 = otherImage(plainY, n, isl.reach);
            rel = reliefAt(isl, plainX, plainY, bite, cut, lowland, plateau, 0);
            if (px2 !== plainX) rel = reliefAt(isl, px2, plainY, bite, cut, lowland, plateau, rel);
            if (py2 !== plainY) {
              rel = reliefAt(isl, plainX, py2, bite, cut, lowland, plateau, rel);
              if (px2 !== plainX) rel = reliefAt(isl, px2, py2, bite, cut, lowland, plateau, rel);
            }
          }
          if (isl.amp * rel > best) {
            best = isl.amp * rel;
            bestRel = rel;
            bestRugged = rugged;
          }
        }
        if (best > 0) {
          const summit = clamp(FBM_GAIN * fbm((x * summitPeriod) / n, (y * summitPeriod) / n, summitPeriod, 2, 0.5, summitSeed), -1, 1);
          let shape = (1 - SUMMIT * (0.5 - 0.5 * summit)) * (p.uplift.base + p.uplift.ridgedAmp * grain.ridged(x, y));
          const follow = bestRugged * smoothstep((bestRel - MASSIF_RISE[0]) / (MASSIF_RISE[1] - MASSIF_RISE[0]));
          if (follow > 0) {
            const wx = x + massifWarp * FBM_GAIN * fbm((x * massifWarpPeriod) / n, (y * massifWarpPeriod) / n, massifWarpPeriod, 2, 0.5, massifWarpSeed);
            const wy = y + massifWarp * FBM_GAIN * fbm((x * massifWarpPeriod) / n, (y * massifWarpPeriod) / n, massifWarpPeriod, 2, 0.5, massifWarpSeed + 1);
            const ridge = ridgedFbm((wx * massifPeriod) / n, (wy * massifPeriod) / n, massifPeriod, MASSIF_OCTAVES, MASSIF_GAIN, massifSeed);
            shape += follow * (MASSIF_BASE + (1 - MASSIF_BASE) * ridge * ridge - shape);
          }
          uplift[i] = best * shape;
        }
      }

      // Rock: stripes across the owning island's strike. They follow the
      // spine's bow and wander by the warp noise.
      const isl = islands[owner];
      const dx = torusDelta(isl.core.x, x, n), dy = torusDelta(isl.core.y, y, n);
      const along = dx * isl.ux + dy * isl.uy;
      const across = dy * isl.ux - dx * isl.uy - acrossAt(isl.along, isl.across, along) + warpAmp * fbm((x * warpPeriod) / n, (y * warpPeriod) / n, warpPeriod, 2, 0.5, warpSeed);
      const stripe = Math.floor(across / isl.stripeWidth + isl.stripePhase) + isl.stripeHalf;
      rock[i] = isl.stripes[clamp(stripe, 0, isl.stripes.length - 1)];
      k[i] = p.rock.kBase * p.rock.kMul[rock[i]];
    }
  }

  return { n: cN, cores: islands.map((isl) => isl.core), uplift, k, d, rock, regions };
}
