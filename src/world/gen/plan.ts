// S1 Plan: island cores, fold-belt spines, uplift U, erodibility K, rock and
// soft region weights, all on the coarse grid C.

import { fbm, gradNoise, octaveMatrixPower, ridgedFbm } from "../core/noise.ts";
import { patan2, pcos, psin } from "../core/psin.ts";
import { rngFor, type Rng } from "../core/rng.ts";
import { torusDelta } from "../core/torus.ts";
import { ARCHETYPE, ARCHETYPE_COUNT, FORM, lengthScale, type Archetype, type ArchetypeSpec, type Form, type WorldParams } from "./params.ts";

export interface Core {
  /** Centre in cells. */
  x: number;
  y: number;
  archetype: Archetype;
  /** How the island is built (FORM): later stages shape a cone's crater, a table's cliffs and a fen's flats by it. */
  form: Form;
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
  /** 1 on nodes a fjord was cut through: the coast keeps that water deep. */
  fjord: Uint8Array;
  /** The core (index into `cores`) whose island's outline lies nearest each node. */
  owner: Uint16Array;
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
/** One belt island in BOOMERANG has a spine bowed this many times harder: a crescent, not a spindle. */
const BOOMERANG = 0.3;
const BOOMERANG_BOW = 2.4;

/**
 * Caldera: a ring of radius RING_R of the island's, RING_HALF wide on its seaward side and RING_INNER of that on the
 * lagoon side, so the wall falls sheer into the lagoon. One in RING_CLOSED is a whole ring; the rest are crescents of
 * RING_SPAN radians, open within RING_GAP of south, where the camera looks in. Islets stand in the lagoon.
 */
const RING_HALF: readonly [number, number] = [0.44, 0.52];
const RING_INNER: readonly [number, number] = [0.08, 0.14];
const RING_CLOSED = 0.4;
const RING_SPAN: readonly [number, number] = [5.5, 5.95];
const RING_GAP = 0.9;
const RING_TAPER = 0.6;
/** The mouth: a channel MOUTH_HALF wide (cells) through the ring where it is open, so the lagoon always reaches the sea. */
const MOUTH_HALF: readonly [number, number] = [16, 28];
const ISLET_LEN: readonly [number, number] = [0.2, 0.32];
const ISLET_HALF: readonly [number, number] = [0.1, 0.14];
const ISLET_HEIGHT: readonly [number, number] = [0.35, 0.55];
/** Cone: uplift climbs as the 1.75th power of the way in (see profile), so the flanks steepen to the summit. */
const CONE_POWER = 1.75;
const CONE_TAPER = 0.9;
/** Table: the flank reaches the top this share of the half-width short of the axis. */
const TABLE_PLATEAU = 0.82;
const TABLE_TAPER = 0.8;
/** Fen: lobes round a low core, a broad lowland, and bays twice as deep as elsewhere. */
const FEN_PLATEAU = 0.6;
const FEN_LOWLAND = 0.25;
const FEN_BITE = 1.5;
/**
 * Fjords: sea inlets cut across the belts from the coast to FJORD_HEAD of the main belt's half-width from the spine,
 * FJORD_HALF wide at the mouth (in cells) and FJORD_NARROW of that at the head; FJORD_SOUTH of them open on the south
 * flank, FJORD_ARM of them fork, and their line leans by up to FJORD_LEAN.
 */
const FJORDS: readonly [number, number] = [6, 9];
const FJORD_HALF: readonly [number, number] = [30, 46];
const FJORD_NARROW = 0.5;
const FJORD_HEAD: readonly [number, number] = [0, 0.35];
const FJORD_SOUTH = 0.62;
const FJORD_ARM = 0.5;
const FJORD_LEAN = 0.35;
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
  /** Half-width at the ends as a share of `half`. */
  taper: number;
  /** A ring's half-width on the side facing the core, as a share of the other; 1 for a belt. */
  inner: number;
}

/** A sea inlet cut into an island: a polyline relative to the core, with a half-width at each vertex. */
interface Cut {
  x: Float64Array;
  y: Float64Array;
  w: Float64Array;
  cx: number;
  cy: number;
  rad: number;
}

interface Island {
  core: Core;
  spec: ArchetypeSpec;
  length: number;
  ridges: Ridge[];
  cuts: Cut[];
  /** Region membership as (archetype, share) pairs. */
  look: readonly (readonly [Archetype, number])[];
  /** 0 a smooth fold belt, 1 a massif; hillslope diffusion. */
  rugged: number;
  d: number;
  /** The share of the half-width that is flat top, or −1 for the belts' own; the lowland share's scale; the profile's power (1: the belt profile). */
  plateau: number;
  lowlandScale: number;
  power: number;
  /** Scales of the bay and cove warp of the outline, and of the strike-stretched grain in the uplift. */
  biteAmp: number;
  grainAmp: number;
  /** The main spine's control points relative to the core. */
  spineX: Float64Array;
  spineY: Float64Array;
  /** Noise stretched along the island's own strike: uplift grain and fibre shear. */
  grain: StrikeNoise | null;
  shear: StrikeNoise | null;
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
  if (r.len <= 0) return r.half;
  const q = Math.min(1, Math.abs((2 * (a - r.mid)) / r.len));
  return r.half * (r.taper + (1 - r.taper) * (1 - q * q));
}

/** A ridge from its vertices relative to the core; `a` runs along it (any increasing measure). */
function ridgeOf(x: Float64Array, y: Float64Array, a: Float64Array, half: number, height: number, taper: number, inner = 1): Ridge {
  const m = a.length;
  let cx = 0, cy = 0;
  for (let i = 0; i < m; i++) {
    cx += x[i] / m;
    cy += y[i] / m;
  }
  let rad = 0;
  for (let i = 0; i < m; i++) rad = Math.max(rad, Math.sqrt((x[i] - cx) * (x[i] - cx) + (y[i] - cy) * (y[i] - cy)));
  return { x, y, a, mid: (a[0] + a[m - 1]) / 2, len: a[m - 1] - a[0], half, height, cx, cy, rad, taper, inner };
}

/** A ridge from (along, across) vertices in the island's own frame. */
function makeRidge(a: Float64Array, c: Float64Array, half: number, height: number, ux: number, uy: number, taper = TAPER): Ridge {
  const m = a.length;
  const x = new Float64Array(m), y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    x[i] = a[i] * ux - c[i] * uy;
    y[i] = a[i] * uy + c[i] * ux;
  }
  return ridgeOf(x, y, a, half, height, taper);
}

/** The island's own strike: the world's, turned by up to `turn` radians, never past maxTurn from west–east. */
function ownStrike(p: WorldParams, rng: Rng, slope: number, turn: number): [number, number] {
  const own = clamp(patan2(slope, 1) + rng.range(-turn, turn), -p.strike.maxTurn, p.strike.maxTurn);
  return [pcos(own), psin(own)];
}

interface Built {
  ridges: Ridge[];
  /** The spine as (along, across) vertices: rock stripes follow it. */
  dal: Float64Array;
  dac: Float64Array;
  /** The spine's control points relative to the core. */
  spineX: Float64Array;
  spineY: Float64Array;
  /** Sea channels cut through the island's own uplift. */
  cuts?: Cut[];
}

/** A straight spine of four control points through the core, for forms that have no fold belt. */
function plainSpine(run: number, ux: number, uy: number): { dal: Float64Array; dac: Float64Array; spineX: Float64Array; spineY: Float64Array } {
  const dal = new Float64Array([-run / 2, -run / 6, run / 6, run / 2]);
  return { dal, dac: new Float64Array(4), spineX: dal.map((a) => a * ux), spineY: dal.map((a) => a * uy) };
}

/**
 * The fold belts of an island, about a core at the origin: one bowed spine
 * the length of the island, and secondary belts stepping out en echelon on
 * both sides, shorter, narrower and lower. Returns the spine's control
 * polyline as (along, across) too.
 */
function buildBelts(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, width: number, ux: number, uy: number): Built {
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
  const bow = spec.turn > 0.5 && rng.float() < BOOMERANG ? BOOMERANG_BOW : 1;
  const arc = (rng.float() < 0.5 ? 1 : -1) * rng.range(BOW_ARC[0], BOW_ARC[1]) * length * bow;
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
  const spineX = new Float64Array(segs + 1), spineY = new Float64Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    spineX[i] = ridges[0].x[i * SPINE_PIECES];
    spineY[i] = ridges[0].y[i * SPINE_PIECES];
  }
  return { ridges, dal, dac, spineX, spineY };
}

/**
 * A caldera about a core at the origin: a ring or crescent of high ground, steep to the lagoon it holds, an islet or
 * two in the lagoon, the first on the core, and a narrow mouth cut through the ring where it is open, so the lagoon
 * is sheltered but never cut off from the sea.
 */
function buildCaldera(rng: Rng, spec: ArchetypeSpec, length: number, s: number): Built {
  const R = length / 2;
  const half = R * rng.range(RING_HALF[0], RING_HALF[1]);
  const rc = R - half;
  const closed = rng.float() < RING_CLOSED;
  const span = closed ? 2 * Math.PI : rng.range(RING_SPAN[0], RING_SPAN[1]);
  // +y is south: the mouth opens within RING_GAP of south, where the camera looks in.
  const gap = Math.PI / 2 + rng.range(-RING_GAP, RING_GAP);
  const start = gap + (2 * Math.PI - span) / 2;
  const w2 = rng.range(0.04, 0.1), w3 = rng.range(0.02, 0.06), ph2 = rng.range(0, 2 * Math.PI), ph3 = rng.range(0, 2 * Math.PI);
  const m = 36;
  const x = new Float64Array(m + 1), y = new Float64Array(m + 1), t = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) {
    const th = start + (span * i) / m;
    const r = rc * (1 + w2 * psin(2 * th + ph2) + w3 * psin(3 * th + ph3));
    x[i] = r * pcos(th);
    y[i] = r * psin(th);
    t[i] = i === 0 ? 0 : t[i - 1] + Math.sqrt((x[i] - x[i - 1]) * (x[i] - x[i - 1]) + (y[i] - y[i - 1]) * (y[i] - y[i - 1]));
  }
  const ridges: Ridge[] = [ridgeOf(x, y, t, half, 1, closed ? 1 : RING_TAPER, rng.range(RING_INNER[0], RING_INNER[1]))];

  const islets = spec.ridges[0] + rng.int(spec.ridges[1] - spec.ridges[0] + 1);
  let run = 0, sx = 1, sy = 0;
  for (let k = 0; k < islets; k++) {
    const shrink = k === 0 ? 1 : 0.6;
    const len = R * rng.range(ISLET_LEN[0], ISLET_LEN[1]) * shrink, isletHalf = R * rng.range(ISLET_HALF[0], ISLET_HALF[1]) * shrink;
    const dir = rng.range(0, Math.PI), at = rng.range(0, 2 * Math.PI), out = k === 0 ? 0 : R * rng.range(0.2, 0.26);
    const dx = pcos(dir), dy = psin(dir), ox = out * pcos(at), oy = out * psin(at);
    const kink = rng.range(-0.2, 0.2) * len;
    const ia = new Float64Array([-len / 2, 0, len / 2]);
    // The first islet's middle vertex is the core itself.
    const ix = new Float64Array([ox - (dx * len) / 2 + dy * kink, ox, ox + (dx * len) / 2 + dy * kink]);
    const iy = new Float64Array([oy - (dy * len) / 2 - dx * kink, oy, oy + (dy * len) / 2 - dx * kink]);
    ridges.push(ridgeOf(ix, iy, ia, isletHalf, rng.range(ISLET_HEIGHT[0], ISLET_HEIGHT[1]), 0.5));
    if (k === 0) {
      run = len;
      sx = dx;
      sy = dy;
    }
  }

  // The mouth runs out from the lagoon through the ring, with a dogleg, widening to the sea.
  const mouth = rng.range(MOUTH_HALF[0], MOUTH_HALF[1]) * s, bend = rng.range(-0.25, 0.25) * half;
  const gx = pcos(gap), gy = psin(gap);
  const radii = [0.3 * R, rc, R + 0.15 * R], wide = [1, 1, 1.6];
  const mx = new Float64Array(3), my = new Float64Array(3), mw = new Float64Array(3);
  for (let i = 0; i < 3; i++) {
    const off = i === 1 ? bend : 0;
    mx[i] = radii[i] * gx - off * gy;
    my[i] = radii[i] * gy + off * gx;
    mw[i] = mouth * wide[i];
  }
  const sp = plainSpine(run, sx, sy);
  return { ridges, dal: new Float64Array([-R, R]), dac: new Float64Array(2), spineX: sp.spineX, spineY: sp.spineY, cuts: [cutFrom(mx, my, mw)] };
}

/** A round island on one short axis: a volcanic cone or a table, by the profile its form gives it. A cone may carry a side vent. */
function buildRound(rng: Rng, spec: ArchetypeSpec, length: number, width: number, ux: number, uy: number): Built {
  const cone = spec.form === FORM.cone;
  const taper = cone ? CONE_TAPER : TABLE_TAPER;
  const half = width / 2;
  const run = Math.max(0.08 * length, length - 2 * half * taper);
  const sp = plainSpine(run, ux, uy);
  const ac = new Float64Array(4);
  if (!cone) {
    ac[1] = rng.range(-0.12, 0.12) * run;
    ac[2] = rng.range(-0.12, 0.12) * run;
  }
  const ridges: Ridge[] = [makeRidge(sp.dal, ac, half, 1, ux, uy, taper)];
  if (cone && rng.float() < 0.6) {
    const at = rng.range(0, 2 * Math.PI), out = half * rng.range(0.45, 0.62), ventHalf = half * rng.range(0.2, 0.3);
    const vx = out * pcos(at), vy = out * psin(at);
    ridges.push(ridgeOf(new Float64Array([vx - 1, vx, vx + 1]), new Float64Array([vy, vy, vy]), new Float64Array([-1, 0, 1]), ventHalf, rng.range(0.5, 0.65), 1));
  }
  return { ridges, ...sp };
}

/** A fen: a low core along the strike with lobes round it, so the outline is all bays and tongues. */
function buildFen(rng: Rng, spec: ArchetypeSpec, length: number, width: number, ux: number, uy: number): Built {
  const half = 0.4 * width, run = 0.55 * length;
  const sp = plainSpine(run, ux, uy);
  const ac = new Float64Array([0, rng.range(-0.1, 0.1) * run, rng.range(-0.1, 0.1) * run, 0]);
  const ridges: Ridge[] = [makeRidge(sp.dal, ac, half, 1, ux, uy, 0.7)];
  const lobes = spec.ridges[0] + rng.int(spec.ridges[1] - spec.ridges[0] + 1);
  const side0 = rng.float() < 0.5 ? 1 : -1;
  for (let k = 0; k < lobes; k++) {
    const side = k % 2 === 0 ? side0 : -side0;
    const a = (-0.55 + (1.1 * (Math.floor(k / 2) + rng.range(0.1, 0.9))) / Math.ceil(lobes / 2)) * run;
    const lobeHalf = width * rng.range(0.12, 0.2);
    const c0 = side * half * rng.range(0.45, 0.8), c1 = c0 + side * lobeHalf * rng.range(0.2, 0.6), lean = rng.range(-0.6, 0.6) * lobeHalf;
    const la = new Float64Array([0, 0.5, 1]), lx = new Float64Array(3), ly = new Float64Array(3);
    for (let j = 0; j < 3; j++) {
      const pa = a + (lean * j) / 2, pc = c0 + ((c1 - c0) * j) / 2;
      lx[j] = pa * ux - pc * uy;
      ly[j] = pa * uy + pc * ux;
    }
    ridges.push(ridgeOf(lx, ly, la, lobeHalf, rng.range(0.7, 1), 0.8));
  }
  return { ridges, ...sp };
}

/** A cut from its vertices relative to the core and its half-width at each. */
function cutFrom(x: Float64Array, y: Float64Array, w: Float64Array): Cut {
  const m = x.length;
  let cx = 0, cy = 0;
  for (let i = 0; i < m; i++) {
    cx += x[i] / m;
    cy += y[i] / m;
  }
  let rad = 0;
  for (let i = 0; i < m; i++) rad = Math.max(rad, Math.sqrt((x[i] - cx) * (x[i] - cx) + (y[i] - cy) * (y[i] - cy)) + w[i]);
  return { x, y, w, cx, cy, rad };
}

/** The fjords of a belt island: inlets from beyond the coast to short of the spine, most on the south flank. */
function buildFjords(rng: Rng, built: Built, width: number, s: number, ux: number, uy: number): Cut[] {
  const main = built.ridges[0], run = main.len;
  const count = FJORDS[0] + rng.int(FJORDS[1] - FJORDS[0] + 1);
  const cuts: Cut[] = [];
  const cutOf = (a: Float64Array, c: Float64Array, w: Float64Array): Cut => {
    const m = a.length, x = new Float64Array(m), y = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      x[i] = a[i] * ux - c[i] * uy;
      y[i] = a[i] * uy + c[i] * ux;
    }
    return cutFrom(x, y, w);
  };
  for (let k = 0; k < count; k++) {
    const side = rng.float() < FJORD_SOUTH ? 1 : -1;
    const a1 = (-0.42 + (0.84 * (k + rng.range(0.2, 0.8))) / count) * run;
    const spine = acrossAt(built.dal, built.dac, a1);
    const c1 = spine + side * halfAt(main, a1) * rng.range(FJORD_HEAD[0], FJORD_HEAD[1]), c0 = spine + side * width;
    const reach = Math.abs(c0 - c1);
    const a0 = a1 + rng.range(-FJORD_LEAN, FJORD_LEAN) * reach;
    const mouth = rng.range(FJORD_HALF[0], FJORD_HALF[1]) * s;
    const wander = rng.range(0.04, 0.1) * reach, phase = rng.range(0, 2 * Math.PI), waves = rng.range(1.5, 3);
    const m = 12;
    const a = new Float64Array(m + 1), c = new Float64Array(m + 1), w = new Float64Array(m + 1);
    for (let j = 0; j <= m; j++) {
      const t = j / m;
      a[j] = a1 + (a0 - a1) * t + wander * psin(phase + 2 * Math.PI * waves * t) * Math.min(1, 4 * t);
      c[j] = c1 + (c0 - c1) * t;
      w[j] = mouth * (FJORD_NARROW + (1 - FJORD_NARROW) * Math.min(1, 2.5 * t));
    }
    cuts.push(cutOf(a, c, w));
    if (rng.float() < FJORD_ARM) {
      // An arm forks off the lower fjord and runs along the strike, into the hills.
      const j0 = 2 + rng.int(3), dir = rng.float() < 0.5 ? 1 : -1, len = reach * rng.range(0.25, 0.45), climb = rng.range(-0.1, 0.35);
      const ma = 6, aa = new Float64Array(ma + 1), ca = new Float64Array(ma + 1), wa = new Float64Array(ma + 1);
      for (let j = 0; j <= ma; j++) {
        const t = j / ma;
        aa[j] = a[j0] + dir * len * t;
        ca[j] = c[j0] - side * climb * len * t * (1 - 0.5 * t);
        wa[j] = w[j0] * (0.9 - 0.4 * t);
      }
      cuts.push(cutOf(aa, ca, wa));
    }
  }
  return cuts;
}

/** Whether a point (relative to the core) lies in one of the island's fjords; `widen` scales their width. */
function inCut(isl: Island, px: number, py: number, widen: number): boolean {
  for (const c of isl.cuts) {
    const ox = px - c.cx, oy = py - c.cy;
    if (ox * ox + oy * oy >= (c.rad * 1.5) * (c.rad * 1.5)) continue;
    const x = c.x, y = c.y, w = c.w;
    for (let i = 0; i + 1 < x.length; i++) {
      const bx = x[i + 1] - x[i], by = y[i + 1] - y[i];
      const qx = px - x[i], qy = py - y[i];
      const tau = clamp((qx * bx + qy * by) / (bx * bx + by * by), 0, 1);
      const ex = qx - tau * bx, ey = qy - tau * by;
      const hw = (w[i] + tau * (w[i + 1] - w[i])) * widen;
      if (ex * ex + ey * ey < hw * hw) return true;
    }
  }
  return false;
}

/**
 * A skerry cluster about a core at the origin: one islet on the core and up
 * to five more scattered within the cluster's ellipse, none too close to
 * another, of mixed size, shape, lean and height. A cluster of one is a lone stack.
 */
function buildCluster(p: WorldParams, rng: Rng, spec: ArchetypeSpec, length: number, aspect: number, ux: number, uy: number): Built {
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
      const ma = a * radius, mc = c * radius * aspect;
      const ia = new Float64Array([ma - isletLen / 2, ma, ma + isletLen / 2]);
      const ic = new Float64Array([mc - (lean * isletLen) / 2, mc + kink * isletLen, mc + (lean * isletLen) / 2]);
      ridges.push(makeRidge(ia, ic, isletHalf, height, ux, uy));
      break;
    }
  }
  return { ridges, dal: al, dac: ac, spineX: Float64Array.from(ridges[0].x), spineY: Float64Array.from(ridges[0].y) };
}

/** An island's shape about a core at the origin; placeIslands gives the core its place. */
function buildIsland(p: WorldParams, rng: Rng, spec: ArchetypeSpec, drawn: number, slope: number): Island {
  const s = lengthScale(p.n);
  const [ux, uy] = ownStrike(p, rng, slope, spec.turn);
  const form = spec.form;
  // A rounder island is shorter and a longer one narrower: the drawn length is for the middle of the range, and the area holds.
  const aspect = rng.range(spec.aspect[0], spec.aspect[1]);
  const length = drawn * Math.sqrt((spec.aspect[0] + spec.aspect[1]) / (2 * aspect));
  const width = length * aspect;
  const built =
    form === FORM.cluster ? buildCluster(p, rng, spec, length, aspect, ux, uy)
    : form === FORM.caldera ? buildCaldera(rng, spec, length, s)
    : form === FORM.cone || form === FORM.table ? buildRound(rng, spec, length, width, ux, uy)
    : form === FORM.fen ? buildFen(rng, spec, length, width, ux, uy)
    : buildBelts(p, rng, spec, length, width, ux, uy);
  const ridges = built.ridges;
  const cuts = form === FORM.fjord ? buildFjords(rng, built, width, s, ux, uy) : (built.cuts ?? []);
  const half = ridges[0].half;
  const belted = form === FORM.belts || form === FORM.fjord || form === FORM.cluster;
  const fibre = belted ? Math.min(FIBRE_SHIFT * s, FIBRE_SHARE * length) : 0;
  const look = spec.look ?? [[spec.id, 1] as const];
  let d = spec.d ?? 0;
  if (spec.d === undefined) for (const [a, share] of look) d += share * p.erode.d[a];

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
  // The island's strike against the world's: a belt's tapered ends point along its own.
  const cos = Math.abs(ux * gx + uy * gy), sin = Math.abs(uy * gx - ux * gy);
  let maxHalf = 0;
  for (const r of ridges) maxHalf = Math.max(maxHalf, r.half);
  const near = fibre + (1 / BITE_MIN - 1) * maxHalf + 8 * s;
  let reach = 0, loA = Infinity, hiA = -Infinity, loB = Infinity, hiB = -Infinity;
  for (const r of ridges) {
    const taper = belted ? r.taper : 1;
    const endA = r.half * Math.min(1, taper * cos + sin), endB = r.half * Math.min(1, cos + taper * sin);
    for (let i = 0; i < r.x.length; i++) {
      reach = Math.max(reach, Math.abs(r.x[i]) + r.half, Math.abs(r.y[i]) + r.half);
      const a = r.x[i] * gx + r.y[i] * gy, b = r.y[i] * gx - r.x[i] * gy;
      loA = Math.min(loA, a - endA);
      hiA = Math.max(hiA, a + endA);
      loB = Math.min(loB, b - endB);
      hiB = Math.max(hiB, b + endB);
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
    core: { x: 0, y: 0, archetype: spec.id, form, radius: length / 2, spine: new Float64Array(built.spineX.length * 2) },
    spec,
    length,
    ridges,
    cuts,
    look,
    rugged: spec.rugged ?? p.uplift.rugged[spec.id],
    d,
    plateau: spec.plateau ?? (form === FORM.table ? TABLE_PLATEAU : form === FORM.fen ? FEN_PLATEAU : form === FORM.cone || form === FORM.caldera ? 0.1 : -1),
    lowlandScale: form === FORM.table || form === FORM.cone || form === FORM.caldera ? 0 : 1,
    power: form === FORM.cone ? CONE_POWER : 1,
    biteAmp: spec.bite ?? (form === FORM.fen ? FEN_BITE : form === FORM.caldera ? 0.5 : form === FORM.cone || form === FORM.table ? 0.6 : 1),
    grainAmp: spec.grain ?? (form === FORM.cone ? 0.25 : form === FORM.table || form === FORM.fen ? 0.5 : 1),
    spineX: built.spineX,
    spineY: built.spineY,
    grain: null,
    shear: null,
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
    lowland: (spec.id === ARCHETYPE.home && form === FORM.belts ? HOME_LOWLAND : form === FORM.fen ? FEN_LOWLAND : 0) + (spec.lowland ?? 0),
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
      // A ring is narrower on the side that faces the core.
      const side = r.inner < 1 && ex * (px - ex) + ey * (py - ey) < 0 ? r.inner : 1;
      const e = Math.sqrt(ex * ex + ey * ey) - halfAt(r, a[i] + tau * (a[i + 1] - a[i])) * side;
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
function profile(f: number, lowland: number, plateau: number, power: number): number {
  if (f <= 0) return 0;
  if (power !== 1) {
    // A cone: f^1.75, as f · √f · ⁴√f.
    const g = Math.min(1, f), r = Math.sqrt(g);
    return g * r * Math.sqrt(r);
  }
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
      const side = r.inner < 1 && ex * (px - ex) + ey * (py - ey) < 0 ? r.inner : 1;
      const hw = halfAt(r, a[i] + tau * (a[i + 1] - a[i])) * side;
      const dist = Math.sqrt(ex * ex + ey * ey);
      if (dist < t * hw) t = dist / hw;
    }
    const v = r.height * profile(1 - t * bite - cut, lowland, plateau, isl.power);
    if (v > rel) rel = v;
  }
  return rel;
}

/** Draws the quota of islands, largest first, and gives each core its place by Poisson disk. */
function placeIslands(p: WorldParams, rng: Rng, slope: number): Island[] {
  const s = lengthScale(p.n);
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
        const skerry = isl.spec.form === FORM.cluster || other.spec.form === FORM.cluster;
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
    for (let i = 0; i < isl.spineX.length; i++) {
      isl.core.spine[2 * i] = bestX + isl.spineX[i];
      isl.core.spine[2 * i + 1] = bestY + isl.spineY[i];
    }
  }
  return islands;
}

/**
 * Builds island c again from `spec`, as big as it was and where it was: the same drawn length, shrunk until its
 * outline's extents along and across the world's strike are no larger than the old one's, and centred on the old
 * outline's middle, so the open water the placement kept between islands still holds. Its draws come from a stream
 * of its own, so no other island moves.
 */
function rebuildIsland(p: WorldParams, seed: number, c: number, old: Island, spec: ArchetypeSpec, slope: number): Island {
  const norm = Math.sqrt(1 + slope * slope);
  const ux = 1 / norm, uy = slope / norm;
  const midX = old.core.x + old.midAlong * ux - old.midAcross * uy, midY = old.core.y + old.midAlong * uy + old.midAcross * ux;
  let drawn = old.length;
  let isl = buildIsland(p, rngFor(seed, `native ${c}`), spec, drawn, slope);
  for (let k = 0; k < 6; k++) {
    const f = Math.max(isl.extAlong / old.extAlong, isl.extAcross / old.extAcross);
    if (f <= 1) break;
    drawn *= 0.98 / f;
    isl = buildIsland(p, rngFor(seed, `native ${c}`), spec, drawn, slope);
  }
  const x = midX - (isl.midAlong * ux - isl.midAcross * uy), y = midY - (isl.midAlong * uy + isl.midAcross * ux);
  isl.core.x = ((x % p.n) + p.n) % p.n;
  isl.core.y = ((y % p.n) + p.n) % p.n;
  for (let i = 0; i < isl.spineX.length; i++) {
    isl.core.spine[2 * i] = isl.core.x + isl.spineX[i];
    isl.core.spine[2 * i + 1] = isl.core.y + isl.spineY[i];
  }
  return isl;
}

/**
 * Islands to build again, once every core has its place: one spec per core, in the plan's order, or null to keep
 * the island as drawn. gen/native.ts uses it to give each island the land of its climate.
 */
export type Reform = (cores: readonly Core[]) => readonly (ArchetypeSpec | null)[];

export function planWorld(p: WorldParams, seed: number, reform?: Reform): Plan {
  const rng = rngFor(seed, "plan");
  const n = p.n, cN = p.cN, cell = n / cN, nodes = cN * cN;

  // The world's strike, as a slope: direction (1, slope) / √(1 + slope²). Each island turns from it by its own amount.
  const slope = rng.range(-p.strike.maxSlope, p.strike.maxSlope);
  const upliftSeed = rng.next(), baySeed = rng.next(), coveSeed = rng.next(), lowSeed = rng.next(), summitSeed = rng.next(), warpSeed = rng.next(), fibreSeed = rng.next();
  const islands = placeIslands(p, rng, slope);
  if (reform) {
    const specs = reform(islands.map((isl) => isl.core));
    for (let c = 0; c < islands.length; c++) {
      const spec = specs[c];
      if (spec) islands[c] = rebuildIsland(p, seed, c, islands[c], spec, slope);
    }
  }
  // Drawn from a stream of their own, so the islands stand where they did before the massifs were added.
  const massifRng = rngFor(seed, "massif");
  const massifSeed = massifRng.next(), massifWarpSeed = massifRng.next(), axisSeed = massifRng.next();
  // Feature sizes are in cells of the 6400 world: a smaller world has the same number of periods round it, a larger
  // world more of them.
  const span = n <= 6400 ? 6400 : n;
  const massifPeriod = Math.round(span / MASSIF_CELLS), massifWarpPeriod = Math.round(span / MASSIF_WARP_CELLS), axisPeriod = Math.round(span / AXIS_CELLS);
  const massifWarp = MASSIF_WARP * lengthScale(n);

  // Feature sizes are rounded so each noise has a whole number of periods round the world.
  const featurePeriod = Math.max(1, Math.round(n / p.uplift.featureCells));
  // The grain and the fibre shear run along each island's own strike.
  for (const isl of islands) {
    isl.grain = strikeNoise(n, featurePeriod, UPLIFT_OCTAVES, UPLIFT_GAIN, p.uplift.stretch, isl.ux, isl.uy, upliftSeed);
    if (isl.fibre > 0) isl.shear = strikeNoise(n, Math.round(span / FIBRE_CELLS), FIBRE_OCTAVES, 0.55, FIBRE_STRETCH, isl.ux, isl.uy, fibreSeed);
  }
  const bayPeriod = Math.round(span / BAY_CELLS), covePeriod = Math.round(span / COVE_CELLS), lowPeriod = Math.round(span / LOWLAND_CELLS), summitPeriod = Math.round(span / SUMMIT_CELLS);
  const warpPeriod = Math.max(1, Math.round(n / p.rock.warpCells));
  const warpAmp = STRIPE_WARP * p.rock.warpCells;

  const uplift = new Float64Array(nodes);
  const k = new Float64Array(nodes);
  const d = new Float64Array(nodes);
  const rock = new Uint8Array(nodes);
  const regions = new Float32Array(ARCHETYPE_COUNT * nodes);
  const fjord = new Uint8Array(nodes);
  const owners = new Uint16Array(nodes);
  const weights = new Float64Array(ARCHETYPE_COUNT);
  const edgeOf = new Float64Array(islands.length);

  for (let iy = 0; iy < cN; iy++) {
    const y = iy * cell + cell / 2;
    for (let ix = 0; ix < cN; ix++) {
      const x = ix * cell + cell / 2;
      const i = iy * cN + ix;

      weights.fill(0);
      let total = 0, owner = 0, ownerEdge = Infinity, anyNear = false, dSum = 0;
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
        for (const [a, share] of isl.look) weights[a] += w * share;
        dSum += w * isl.d;
        total += w;
      }

      for (let a = 0; a < ARCHETYPE_COUNT; a++) regions[a * nodes + i] = Math.fround(weights[a] / total);
      d[i] = dSum / total;

      if (anyNear) {
        const bay = clamp(FBM_GAIN * fbm((x * bayPeriod) / n, (y * bayPeriod) / n, bayPeriod, 2, 0.5, baySeed), -1, 1);
        const cove = clamp(FBM_GAIN * fbm((x * covePeriod) / n, (y * covePeriod) / n, covePeriod, 2, 0.5, coveSeed), -1, 1);
        const warp = BAY_WARP * bay + COVE_WARP * cove;
        const low = clamp(FBM_GAIN * gradNoise((x * lowPeriod) / n, (y * lowPeriod) / n, lowPeriod, lowSeed), -1, 1);
        const lowShare = LOWLAND_SHARE[0] + (LOWLAND_SHARE[1] - LOWLAND_SHARE[0]) * (0.5 + 0.5 * low);
        let best = 0, bestRel = 0, bestRugged = 0, bestIsl = islands[0];
        let axisX = 0, axisY = 0, axisDone = false;
        for (let c = 0; c < islands.length; c++) {
          const isl = islands[c];
          if (edgeOf[c] >= isl.near) continue;
          // The shear fades to nothing on the ridge lines, so a core never leaves its spine.
          const bite = Math.max(BITE_MIN, 1 + isl.biteAmp * warp);
          const fade = clamp(1 + edgeOf[c] / isl.half, 0, 1);
          const shift = isl.shear !== null && fade > 0 ? isl.fibre * isl.shear.signed(x, y) * fade : 0;
          let dx = torusDelta(isl.core.x, x, n) + shift * isl.ux, dy = torusDelta(isl.core.y, y, n) + shift * isl.uy;
          const rugged = isl.rugged;
          const bend = rugged * AXIS_WARP * isl.half * clamp(-edgeOf[c] / isl.half, 0, 1);
          const plainX = dx, plainY = dy;
          const plateau = isl.plateau >= 0 ? isl.plateau : p.spine.plateau + rugged * (MASSIF_PLATEAU - p.spine.plateau);
          if (bend > 0) {
            if (!axisDone) {
              axisX = clamp(FBM_GAIN * fbm((x * axisPeriod) / n, (y * axisPeriod) / n, axisPeriod, 2, 0.5, axisSeed), -1, 1);
              axisY = clamp(FBM_GAIN * fbm((x * axisPeriod) / n, (y * axisPeriod) / n, axisPeriod, 2, 0.5, axisSeed + 1), -1, 1);
              axisDone = true;
            }
            dx += bend * axisX;
            dy += bend * axisY;
          }
          let cut = 0, lowland = lowShare * isl.lowlandScale + isl.lowland;
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
          // A fjord is sea: no uplift in it, and full uplift at its lip, so its walls stand as steep as the rock allows.
          if (rel > 0 && isl.cuts.length > 0) {
            const widen = 1 + 0.35 * cove;
            const px2 = otherImage(plainX, n, isl.reach), py2 = otherImage(plainY, n, isl.reach);
            if (inCut(isl, plainX, plainY, widen) || (px2 !== plainX && inCut(isl, px2, plainY, widen)) || (py2 !== plainY && (inCut(isl, plainX, py2, widen) || (px2 !== plainX && inCut(isl, px2, py2, widen))))) {
              rel = 0;
              if (isl.spec.form === FORM.fjord) fjord[i] = 1;
            }
          }
          if (isl.amp * rel > best) {
            best = isl.amp * rel;
            bestRel = rel;
            bestRugged = rugged;
            bestIsl = isl;
          }
        }
        if (best > 0) {
          const summit = clamp(FBM_GAIN * fbm((x * summitPeriod) / n, (y * summitPeriod) / n, summitPeriod, 2, 0.5, summitSeed), -1, 1);
          let shape = (1 - SUMMIT * (0.5 - 0.5 * summit)) * (p.uplift.base + p.uplift.ridgedAmp * (0.5 + bestIsl.grainAmp * ((bestIsl.grain as StrikeNoise).ridged(x, y) - 0.5)));
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
      owners[i] = owner;
      const isl = islands[owner];
      const dx = torusDelta(isl.core.x, x, n), dy = torusDelta(isl.core.y, y, n);
      const along = dx * isl.ux + dy * isl.uy;
      const across = dy * isl.ux - dx * isl.uy - acrossAt(isl.along, isl.across, along) + warpAmp * fbm((x * warpPeriod) / n, (y * warpPeriod) / n, warpPeriod, 2, 0.5, warpSeed);
      const stripe = Math.floor(across / isl.stripeWidth + isl.stripePhase) + isl.stripeHalf;
      rock[i] = isl.stripes[clamp(stripe, 0, isl.stripes.length - 1)];
      k[i] = p.rock.kBase * p.rock.kMul[rock[i]];
    }
  }

  return { n: cN, cores: islands.map((isl) => isl.core), uplift, k, d, rock, regions, fjord, owner: owners };
}
