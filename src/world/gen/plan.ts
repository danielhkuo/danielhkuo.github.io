// S1 Plan: island cores, fold-belt spines, uplift U, erodibility K, rock and
// soft region weights, all on the coarse grid C.

import { fbm, gradNoise, octaveMatrixPower } from "../core/noise.ts";
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
// 6400 world and scale with n.

/** Half-width at a ridge's two ends as a share of its half-width amidships: belts are spindles, not stadiums. */
const TAPER = 0.5;
/**
 * Ridges stand this share of a belt's full width apart (or ridgeGap, if that
 * is wider), so neighbouring belts meet on their shoulders: the uplift keeps a
 * valley between them and the island stays one piece of land.
 */
const RIDGE_SPACING = 0.6;
/** An island's own strike may lean this far (as a slope) from the global strike. */
const LEAN = 0.1;
/** Flanking ridges run this share of the main spine's length. */
const FLANK_LENGTH: readonly [number, number] = [0.5, 0.9];
/** …and are this share of its width. */
const FLANK_WIDTH: readonly [number, number] = [0.6, 1];
/** Coast warp: the normalised distance to a ridge is scaled by 1 ± this, by strike-stretched noise. */
const COAST_WARP = 0.3;
const COAST_OCTAVES = 3;
/**
 * Fibre shear: the land is sampled at a point slid along strike by noise that
 * changes quickly across strike and slowly along it. Belt ends interfinger as
 * headlands and rias; flanks, which run along strike, stay straight.
 */
const FIBRE_SHIFT = 420;
const FIBRE_SHARE = 0.2;
const FIBRE_CELLS = 320;
const FIBRE_STRETCH = 6;
const FIBRE_OCTAVES = 2;
const UPLIFT_OCTAVES = 4;
/** Rock stripes are displaced across strike by up to this many warp features. */
const STRIPE_WARP = 0.5;
/** Open water kept between island outlines at placement, and between a skerry and anything. */
const CHANNEL = 260;
const SKERRY_CHANNEL = 110;
/** Gain that brings strike-averaged noise back to the spread of plain gradient noise. */
const BLUR_GAIN = 2.4;

function smoothstep(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
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
      s = Math.max(-1, Math.min(1, (s / (2 * taps + 1)) * BLUR_GAIN));
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
 * the ridge's middle and length on that axis.
 */
interface Ridge {
  x: Float64Array;
  y: Float64Array;
  a: Float64Array;
  mid: number;
  len: number;
  half: number;
}

interface Island {
  core: Core;
  spec: ArchetypeSpec;
  ridges: Ridge[];
  /** Half-width of one ridge's belt amidships, in cells. */
  half: number;
  /** Largest |x| or |y| the outline reaches from the core, with a margin. */
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

/** The across-strike offset of a spine, given as (along, across) vertices, at an along-strike position. */
function spineAcross(al: Float64Array, ac: Float64Array, a: number): number {
  const last = al.length - 1;
  if (a <= al[0]) return ac[0];
  for (let i = 0; i < last; i++) {
    if (a <= al[i + 1]) return ac[i] + ((a - al[i]) / (al[i + 1] - al[i])) * (ac[i + 1] - ac[i]);
  }
  return ac[last];
}

/** An island's shape about a core at the origin; placeIslands gives the core its place. */
function buildIsland(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, slope: number): Island {
  const s = p.n / 6400;
  const width = length * spec.aspect;
  const ridgeCount = p.spine.ridges[0] + rng.int(p.spine.ridges[1] - p.spine.ridges[0] + 1);
  // Each ridge carries its own belt, the flanking ones narrower; together they span the island's width.
  const flankShare = new Float64Array(ridgeCount);
  let shares = 0;
  for (let r = 1; r < ridgeCount; r++) {
    flankShare[r] = rng.range(FLANK_WIDTH[0], FLANK_WIDTH[1]);
    shares += flankShare[r];
  }
  const half = width / ((1 + RIDGE_SPACING) * shares + (ridgeCount === 2 ? 1 + RIDGE_SPACING : 2 * RIDGE_SPACING));
  const run = length - 2 * TAPER * half;
  const segs = p.spine.segments[0] + rng.int(p.spine.segments[1] - p.spine.segments[0] + 1);
  const segLen = run / segs;

  // The island's own strike: the global one, leaning a little, still inside ±maxSlope.
  const maxSlope = p.strike.maxSlope;
  const own = Math.max(-maxSlope, Math.min(maxSlope, slope + rng.range(-LEAN, LEAN)));
  const norm = Math.sqrt(1 + own * own);
  const ux = 1 / norm, uy = own / norm, vx = -uy, vy = ux;

  // Main spine in (along, across); only inner vertices bend, so its ends stay on strike.
  const al = new Float64Array(segs + 1), ac = new Float64Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const inner = i > 0 && i < segs;
    al[i] = -run / 2 + (i + (inner ? rng.range(-0.2, 0.2) : 0)) * segLen;
    ac[i] = inner ? rng.range(-p.spine.bend, p.spine.bend) * segLen : 0;
  }
  // Slide the spine across strike so it passes through the core.
  const centre = spineAcross(al, ac, 0);
  for (let i = 0; i <= segs; i++) ac[i] -= centre;

  const toRidge = (a: Float64Array, c: Float64Array, mid: number, len: number, halfWidth: number): Ridge => {
    const x = new Float64Array(a.length), y = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) {
      x[i] = a[i] * ux + c[i] * vx;
      y[i] = a[i] * uy + c[i] * vy;
    }
    return { x, y, a, mid, len, half: halfWidth };
  };

  const ridges: Ridge[] = [toRidge(al, ac, 0, run, half)];
  const firstSide = rng.float() < 0.5 ? 1 : -1;
  const echelon = rng.float() < 0.5 ? 1 : -1;
  for (let r = 1; r < ridgeCount; r++) {
    // Flanking ridges are shorter, follow the spine's bends, and step en
    // echelon: one reaches towards each end of the island.
    const side = r === 1 ? firstSide : -firstSide;
    const len = run * rng.range(FLANK_LENGTH[0], FLANK_LENGTH[1]);
    const shift = (side * echelon * rng.range(0.5, 1) * (run - len)) / 2;
    const flankHalf = half * flankShare[r];
    const offset = side * Math.max(p.spine.ridgeGap, RIDGE_SPACING * (half + flankHalf));
    const fa = new Float64Array(segs + 1), fc = new Float64Array(segs + 1);
    for (let i = 0; i <= segs; i++) {
      fa[i] = shift - len / 2 + (i * len) / segs;
      fc[i] = spineAcross(al, ac, fa[i]) + offset + rng.range(-p.spine.bend, p.spine.bend) * (len / segs) * 0.4;
    }
    ridges.push(toRidge(fa, fc, shift, len, flankHalf));
  }

  const gn = Math.sqrt(1 + slope * slope);
  const gx = 1 / gn, gy = slope / gn;
  let reach = 0, loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
  for (const r of ridges) {
    for (let i = 0; i < r.x.length; i++) {
      reach = Math.max(reach, Math.abs(r.x[i]) + r.half, Math.abs(r.y[i]) + r.half);
      const a = r.x[i] * gx + r.y[i] * gy, b = r.y[i] * gx - r.x[i] * gy;
      const end = i === 0 || i === r.x.length - 1 ? r.half * TAPER : 0;
      loA = Math.min(loA, a - end);
      hiA = Math.max(hiA, a + end);
      loB = Math.min(loB, b - r.half);
      hiB = Math.max(hiB, b + r.half);
    }
  }

  // Rock stripes across strike. A class with odds of a half or less never
  // takes two stripes running, so slate alternates and hard karst may repeat.
  const stripeWidth = rng.range(p.rock.stripeWidth[0], p.rock.stripeWidth[1]);
  const stripeHalf = Math.ceil(p.n / stripeWidth) + 3;
  const stripes = new Uint8Array(2 * stripeHalf + 1);
  let prev = -1;
  for (let i = 0; i < stripes.length; i++) {
    const banned = prev >= 0 && spec.rockBias[prev] <= 0.5 ? prev : -1;
    prev = drawRock(rng, spec.rockBias, banned);
    stripes[i] = prev;
  }
  return {
    core: { x: 0, y: 0, archetype: spec.id, radius: length / 2, spine: new Float64Array(2 * (segs + 1)) },
    spec,
    ridges,
    half,
    reach: reach + 300 * s,
    midAlong: (loA + hiA) / 2,
    midAcross: (loB + hiB) / 2,
    extAlong: (hiA - loA) / 2,
    extAcross: (hiB - loB) / 2,
    ux,
    uy,
    along: al,
    across: ac,
    fibre: Math.min(FIBRE_SHIFT * s, FIBRE_SHARE * length),
    blend: rng.range(p.regions.blend[0], p.regions.blend[1]),
    stripeWidth,
    stripePhase: rng.float(),
    stripes,
    stripeHalf,
    amp: spec.peak * p.uplift.scale,
  };
}

/** Results of measuring one point against one island. */
let outEdge = 0;
let outT = 0;

/**
 * Distance from a point (relative to the core) to the island's ridges: outEdge
 * is the distance to the unwarped outline in cells (negative inside), outT the
 * distance to the nearest ridge as a share of the half-width there. Both only
 * ever lower the values already held.
 */
function measure(isl: Island, px: number, py: number): void {
  let edge = outEdge, t = outT;
  for (const r of isl.ridges) {
    const x = r.x, y = r.y, a = r.a;
    for (let i = 0; i + 1 < x.length; i++) {
      const ax = x[i], ay = y[i];
      const bx = x[i + 1] - ax, by = y[i + 1] - ay;
      const qx = px - ax, qy = py - ay;
      let tau = (qx * bx + qy * by) / (bx * bx + by * by);
      tau = tau < 0 ? 0 : tau > 1 ? 1 : tau;
      const ex = qx - tau * bx, ey = qy - tau * by;
      const dist = Math.sqrt(ex * ex + ey * ey);
      const q = Math.min(1, Math.abs((2 * (a[i] + tau * (a[i + 1] - a[i]) - r.mid)) / r.len));
      const hw = r.half * (TAPER + (1 - TAPER) * (1 - q * q));
      if (dist - hw < edge) edge = dist - hw;
      if (dist < t * hw) t = dist / hw;
    }
  }
  outEdge = edge;
  outT = t;
}

/** measure() against the nearest image of the island; near the far side of the torus that is not always the image whose core is nearest. */
function measureTorus(isl: Island, dx: number, dy: number, n: number): void {
  const far = n / 2 - isl.reach;
  const dx2 = dx > far ? dx - n : dx < -far ? dx + n : dx;
  const dy2 = dy > far ? dy - n : dy < -far ? dy + n : dy;
  outEdge = Infinity;
  outT = Infinity;
  measure(isl, dx, dy);
  if (dx2 !== dx) measure(isl, dx2, dy);
  if (dy2 !== dy) {
    measure(isl, dx, dy2);
    if (dx2 !== dx) measure(isl, dx2, dy2);
  }
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
    let done = false;
    for (let attempt = 0; attempt < attempts && !done; attempt++) {
      // Cores sit on node centres. Outlines keep a channel of open water apart
      // for the first half of the attempts; after that the channel, then the
      // outlines, give way, down to the bare Poisson radius.
      const x = (rng.int(p.cN) + 0.5) * cell, y = (rng.int(p.cN) + 0.5) * cell;
      const mx = x + isl.midAlong * ux - isl.midAcross * uy, my = y + isl.midAlong * uy + isl.midAcross * ux;
      const ease = Math.min(1, (2 * (attempts - attempt)) / attempts);
      let ok = true;
      for (let o = 0; o < c && ok; o++) {
        const other = islands[o];
        const cx = torusDelta(other.core.x, x, p.n), cy = torusDelta(other.core.y, y, p.n);
        if (cx * cx + cy * cy < r2) ok = false;
        const skerry = isl.spec.id === ARCHETYPE.skerry || other.spec.id === ARCHETYPE.skerry;
        const channel = (skerry ? SKERRY_CHANNEL : CHANNEL) * s;
        const a = (isl.extAlong + other.extAlong + channel) * ease, b = (isl.extAcross + other.extAcross + channel) * ease;
        const dx = torusDelta(midX[o], mx, p.n), dy = torusDelta(midY[o], my, p.n);
        const along = dx * ux + dy * uy, across = dy * ux - dx * uy;
        if ((along * along) / (a * a) + (across * across) / (b * b) < 1) ok = false;
      }
      if (ok) {
        isl.core.x = x;
        isl.core.y = y;
        midX[c] = mx;
        midY[c] = my;
        const main = isl.ridges[0];
        for (let i = 0; i < main.x.length; i++) {
          isl.core.spine[2 * i] = x + main.x[i];
          isl.core.spine[2 * i + 1] = y + main.y[i];
        }
        done = true;
      }
    }
    if (!done) throw new Error(`cannot place cores: no room for core ${c + 1} of ${islands.length} at spacing ${p.cores.poissonR}`);
  }
  return islands;
}

export function planWorld(p: WorldParams, seed: number): Plan {
  const rng = rngFor(seed, "plan");
  const n = p.n, cN = p.cN, cell = n / cN, nodes = cN * cN;

  // One strike for the whole world, as a slope: direction (1, slope) / √(1 + slope²).
  const slope = rng.range(-p.strike.maxSlope, p.strike.maxSlope);
  const upliftSeed = rng.next(), coastSeed = rng.next(), warpSeed = rng.next(), fibreSeed = rng.next();
  const norm = Math.sqrt(1 + slope * slope);
  const ux = 1 / norm, uy = slope / norm;

  const islands = placeIslands(p, rng, slope);

  // Feature sizes are rounded so each noise has a whole number of periods round the world.
  const featurePeriod = Math.max(1, Math.round(n / p.uplift.featureCells));
  const grain = strikeNoise(n, featurePeriod, UPLIFT_OCTAVES, 0.5, p.uplift.stretch, ux, uy, upliftSeed);
  const coast = strikeNoise(n, featurePeriod, COAST_OCTAVES, 0.55, p.uplift.stretch, ux, uy, coastSeed);
  const fibrePeriod = Math.max(1, Math.round(6400 / FIBRE_CELLS));
  const fibre = strikeNoise(n, fibrePeriod, FIBRE_OCTAVES, 0.55, FIBRE_STRETCH, ux, uy, fibreSeed);
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
        measureTorus(isl, torusDelta(isl.core.x, x, n), torusDelta(isl.core.y, y, n), n);
        edgeOf[c] = outEdge;
        if (outEdge < isl.fibre + isl.half) anyNear = true;
        if (outEdge < ownerEdge) {
          ownerEdge = outEdge;
          owner = c;
        }
        // Membership: 1 at the outline, rising inland, halving one blend out to sea.
        const q = outEdge / isl.blend;
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
        const bite = 1 + COAST_WARP * coast.signed(x, y);
        const slide = fibre.signed(x, y);
        let best = 0;
        for (let c = 0; c < islands.length; c++) {
          const isl = islands[c];
          if (edgeOf[c] >= isl.fibre + isl.half) continue;
          const shift = isl.fibre * slide;
          measureTorus(isl, torusDelta(isl.core.x, x, n) + shift * isl.ux, torusDelta(isl.core.y, y, n) + shift * isl.uy, n);
          const t = outT * bite;
          if (t >= 1) continue;
          const plateau = 1 - smoothstep((t - p.spine.plateau) / (1 - p.spine.plateau));
          best = Math.max(best, isl.amp * plateau);
        }
        if (best > 0) uplift[i] = best * (p.uplift.base + p.uplift.ridgedAmp * grain.ridged(x, y));
      }

      // Rock: stripes across the owning island's strike. They follow the
      // spine's bends and wander by the warp noise.
      const isl = islands[owner];
      const dx = torusDelta(isl.core.x, x, n), dy = torusDelta(isl.core.y, y, n);
      const along = dx * isl.ux + dy * isl.uy;
      const across = dy * isl.ux - dx * isl.uy - spineAcross(isl.along, isl.across, along) + warpAmp * fbm((x * warpPeriod) / n, (y * warpPeriod) / n, warpPeriod, 2, 0.5, warpSeed);
      const stripe = Math.floor(across / isl.stripeWidth + isl.stripePhase) + isl.stripeHalf;
      rock[i] = isl.stripes[Math.max(0, Math.min(isl.stripes.length - 1, stripe))];
      k[i] = p.rock.kBase * p.rock.kMul[rock[i]];
    }
  }

  return { n: cN, cores: islands.map((isl) => isl.core), uplift, k, d, rock, regions };
}
