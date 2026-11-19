// S8 inputs: smooth climate fields on the coarse grid C, from G-grid data.
//
// The world is a torus, and its climate makes it read as round: temperature is a band of latitude that loops,
// equator to pole to equator, so flying north far enough crosses a polar cap and comes down into the tropics.
// Temperature here is the sea-level one; the cover cools it with height, cell by cell.

import { sortIndicesBy } from "../core/heap.ts";
import { gradNoise } from "../core/noise.ts";
import { torusDelta } from "../core/torus.ts";

/** 2 × 2 box average from G (gN²) to C ((gN/2)²). */
export function toCoarse(g: ArrayLike<number>, gN: number): Float32Array {
  const cN = gN / 2;
  const out = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      const gx = 2 * cx;
      const gy = 2 * cy;
      const v =
        g[gy * gN + gx] +
        g[gy * gN + gx + 1] +
        g[(gy + 1) * gN + gx] +
        g[(gy + 1) * gN + gx + 1];
      out[cy * cN + cx] = v / 4;
    }
  }
  return out;
}

function blurAxisX(src: Float32Array, dst: Float32Array, n: number, radius: number): void {
  const w = 2 * radius + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const x = ((k % n) + n) % n;
      sum += src[row + x];
    }
    dst[row] = sum / w;
    for (let x = 1; x < n; x++) {
      sum += src[row + (x + radius) % n] - src[row + (x - radius - 1 + n) % n];
      dst[row + x] = sum / w;
    }
  }
}

function blurAxisY(src: Float32Array, dst: Float32Array, n: number, radius: number): void {
  const w = 2 * radius + 1;
  for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const y = ((k % n) + n) % n;
      sum += src[y * n + x];
    }
    dst[x] = sum / w;
    for (let y = 1; y < n; y++) {
      sum += src[((y + radius) % n) * n + x] - src[((y - radius - 1 + n) % n) * n + x];
      dst[y * n + x] = sum / w;
    }
  }
}

/** Separable box blur on an n × n torus, `radius` nodes, `passes` times (3 passes ≈ Gaussian). */
export function blurTorus(a: Float32Array, n: number, radius: number, passes: number): Float32Array {
  const cur = new Float32Array(a);
  const tmp = new Float32Array(n * n);
  for (let pass = 0; pass < passes; pass++) {
    blurAxisX(cur, tmp, n, radius);
    blurAxisY(tmp, cur, n, radius);
  }
  return cur;
}

export interface ClimateParams {
  /** Moisture blur radius, C nodes. */
  moistureRadius: number;
  /** Upwind search distance, C nodes. */
  windReach: number;
  /** Height the upwind horizon drops per C node of distance. */
  windDropPerNode: number;
  /** Height difference that spans the full exposure range. */
  windScale: number;
  /** The zones of latitude. Absent: one temperate climate. */
  zones?: ZoneParams;
}

/** A piecewise-linear curve over latitude: (φ, value) pairs, φ ascending from 0 to 1. */
export type LatCurve = readonly (readonly [number, number])[];

export interface ZoneParams {
  /** The latitude (0 equator … 1 pole) of the home island's core; the pole lies to its north. */
  homeLat: number;
  /** Sea-level temperature by latitude, 1 at the equator … 0 at the pole; flat at TEMPERATE across the temperate belt. On the wet side: the route from the pole to the equator that passes home. */
  temp: LatCurve;
  /** What the rain is multiplied by, by latitude; 1 across the temperate belt. On the wet side. */
  rain: LatCurve;
  /**
   * The dry side: the other route from the pole to the equator. Its own curves, which must meet the wet side's at
   * φ 0 and φ 1, and which have no temperate plateau. Absent: both routes are the wet side's.
   */
  dry?: { temp: LatCurve; rain: LatCurve };
  /** `arid` rises from 0 to 1 over this much latitude from each of the two lines where the sides meet. */
  aridRamp?: number;
  /** The isotherms wander: (periods round the world, amplitude in φ) per octave. */
  warp: LatCurve;
  /** Continentality is the land's share within this many C nodes … */
  inlandRadius: number;
  /** … and ground with more land round it than `inlandFrom` is the more extreme: by up to `inlandTemp` colder in the cold belts and hotter in the hot, and by up to the share `inlandDry` drier in the dry belt. */
  inlandFrom: number;
  inlandTemp: number;
  inlandDry: number;
  /** The home rule: within homeNear cells of the home island the climate is the temperate plateau's; it fades to the latitude's own by homeFar to the north and south, and 2¼ times as far along the latitude. */
  homeNear: number;
  homeFar: number;
}

/** What the zones are laid out from: the world, and where its home island lies. */
export interface ZoneLayout {
  /** Cells a side. */
  n: number;
  seed: number;
  /** The y of the home island's core, in cells. */
  homeY: number;
  /** Per C node: 1 on the home island's land. Absent: no home rule. */
  home?: Uint8Array;
}

/** The temperature of the temperate plateau: at exactly this the cover is the temperate one, untouched. */
export const TEMPERATE = 0.5;

export interface Climate {
  /** 0–1: blurred rain, divided by its 95th percentile over land, times the zone's rain, clamped. */
  moisture: Float32Array;
  /** 0–1: exposure to the south-west wind; 1 over open sea. */
  wind: Float32Array;
  /** 0–1: sea-level temperature, 0 at the pole … 1 at the equator, TEMPERATE on the temperate plateau. Absent: temperate everywhere. */
  temp?: Float32Array;
  /** The y of the equator line, in cells; the pole line lies n / 2 from it. Set with `temp`. */
  equatorY?: number;
  /** 0–1: the dry side's share of a node. 0 on the wet side, the route that passes home; 1 on the dry side, rising from each line where the two meet. Absent: one side. */
  arid?: Float32Array;
}

function toCoarseHeight(h: Float64Array, isSea: Uint8Array, gN: number): Float32Array {
  const cN = gN / 2;
  const out = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const gx = 2 * cx + dx;
          const gy = 2 * cy + dy;
          const gi = gy * gN + gx;
          sum += isSea[gi] ? 0 : h[gi];
        }
      }
      out[cy * cN + cx] = sum / 4;
    }
  }
  return out;
}

function gNodeSea(gx: number, gy: number, isSea: Uint8Array, gN: number): boolean {
  return isSea[gy * gN + gx] !== 0;
}

function cNodeAllSea(cx: number, cy: number, isSea: Uint8Array, gN: number): boolean {
  const gx = 2 * cx;
  const gy = 2 * cy;
  return (
    gNodeSea(gx, gy, isSea, gN) &&
    gNodeSea(gx + 1, gy, isSea, gN) &&
    gNodeSea(gx, gy + 1, isSea, gN) &&
    gNodeSea(gx + 1, gy + 1, isSea, gN)
  );
}

function cNodeLand(cx: number, cy: number, isSea: Uint8Array, gN: number): boolean {
  return !cNodeAllSea(cx, cy, isSea, gN);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function percentile95Land(blurred: Float32Array, cN: number, isSea: Uint8Array, gN: number): number {
  const land: number[] = [];
  for (let cy = 0; cy < cN; cy++) {
    for (let cx = 0; cx < cN; cx++) {
      if (cNodeLand(cx, cy, isSea, gN)) {
        land.push(blurred[cy * cN + cx]);
      }
    }
  }
  const n = land.length;
  if (n === 0) return 1;
  const order = sortIndicesBy(land);
  const rank = Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1));
  const p95 = land[order[rank]];
  if (p95 <= 0) return 1;
  return p95;
}

/** The value of a latitude curve at φ: linear between its points, held beyond its ends. */
export function curveAt(curve: LatCurve, phi: number): number {
  const last = curve.length - 1;
  if (phi <= curve[0][0]) return curve[0][1];
  if (phi >= curve[last][0]) return curve[last][1];
  let k = 1;
  while (curve[k][0] < phi) k++;
  const a = curve[k - 1], b = curve[k];
  return a[1] + ((b[1] - a[1]) * (phi - a[0])) / (b[0] - a[0]);
}

/** The y of the equator line for a home island at `homeY`: the home island lies at homeLat, with the pole to its north. */
export function equatorOf(n: number, homeY: number, homeLat: number): number {
  const y = (homeY + homeLat * (n / 2)) % n;
  return y < 0 ? y + n : y;
}

/** Latitude of the row y, 0 on the equator line … 1 on the pole line, on a world of n cells. */
export function latitudeAt(y: number, n: number, equatorY: number): number {
  const d = torusDelta(equatorY, y, n);
  return (d < 0 ? -d : d) / (n / 2);
}

/**
 * Signed latitude of the row y: 0 on the equator line, rising to +1 at the pole line through the home island (the
 * wet side), and falling to −1 the other way round (the dry side). The pole to the north of home is +1 and −1 at once.
 */
export function signedLatitudeAt(y: number, n: number, equatorY: number): number {
  return -torusDelta(equatorY, y, n) / (n / 2);
}

const WARP_SEED = 0xc11a7e;

/** Chamfer steps of the home rule's distance: a node east or west costs HOME_X, one north or south HOME_Y, a diagonal HOME_D. */
const HOME_X = 4, HOME_Y = 9, HOME_D = 10;

/**
 * Chamfer distance on an n × n torus from the nodes where `d` is 0 (the rest hold a large value), in the HOME_
 * steps: a node north or south is HOME_Y, and one east or west less, so the distance reaches further along a
 * latitude than across it. Two rounds of passes carry it across the seams.
 */
function chamferTorus(d: Int32Array, n: number): void {
  for (let round = 0; round < 2; round++) {
    for (let y = 0; y < n; y++) {
      const row = y * n, up = ((y + n - 1) % n) * n;
      for (let x = 0; x < n; x++) {
        const i = row + x, xl = (x + n - 1) % n, xr = (x + 1) % n;
        let v = d[i];
        if (d[row + xl] + HOME_X < v) v = d[row + xl] + HOME_X;
        if (d[up + x] + HOME_Y < v) v = d[up + x] + HOME_Y;
        if (d[up + xl] + HOME_D < v) v = d[up + xl] + HOME_D;
        if (d[up + xr] + HOME_D < v) v = d[up + xr] + HOME_D;
        d[i] = v;
      }
    }
    for (let y = n - 1; y >= 0; y--) {
      const row = y * n, down = ((y + 1) % n) * n;
      for (let x = n - 1; x >= 0; x--) {
        const i = row + x, xl = (x + n - 1) % n, xr = (x + 1) % n;
        let v = d[i];
        if (d[row + xr] + HOME_X < v) v = d[row + xr] + HOME_X;
        if (d[down + x] + HOME_Y < v) v = d[down + x] + HOME_Y;
        if (d[down + xr] + HOME_D < v) v = d[down + xr] + HOME_D;
        if (d[down + xl] + HOME_D < v) v = d[down + xl] + HOME_D;
        d[i] = v;
      }
    }
  }
}

/**
 * 1 within `near` cells of the home island, falling smoothly to 0 at `far` cells to its north and south and some
 * 2¼ times as far to its east and west: the temperate belt swells round home, it does not ring it. All 0 with no
 * home island.
 */
function homeWeight(home: Uint8Array | undefined, cN: number, cell: number, near: number, far: number): Float32Array {
  const out = new Float32Array(cN * cN);
  if (!home) return out;
  const big = 1 << 28, d = new Int32Array(cN * cN).fill(big);
  let any = false;
  for (let i = 0; i < d.length; i++) if (home[i] !== 0) { d[i] = 0; any = true; }
  if (!any) return out;
  chamferTorus(d, cN);
  for (let i = 0; i < d.length; i++) {
    const cells = (d[i] / HOME_Y) * cell;
    if (cells <= near) out[i] = 1;
    else if (cells < far) {
      const t = 1 - (cells - near) / (far - near);
      out[i] = t * t * (3 - 2 * t);
    }
  }
  return out;
}

/** The land's share within `radius` C nodes: 0 far out to sea … 1 deep inland. */
function inlandShare(isSea: Uint8Array, gN: number, radius: number): Float32Array {
  const cN = gN / 2, land = new Float32Array(cN * cN);
  for (let cy = 0; cy < cN; cy++) for (let cx = 0; cx < cN; cx++) if (cNodeLand(cx, cy, isSea, gN)) land[cy * cN + cx] = 1;
  return blurTorus(land, cN, radius, 3);
}

/**
 * The zones: sea-level temperature on C, the dry side's share on C, and the rain's zonal factor applied to
 * `moisture` in place. Latitude gives the curves, one pair a side; slow noise bends the isotherms, and with them the
 * two lines where the sides meet; land with much land round it is the more extreme; and round the home island the
 * climate is held at the temperate plateau, as a warm current bends the isotherms.
 */
function zoneFields(moisture: Float32Array, isSea: Uint8Array, gN: number, z: ZoneParams, at: ZoneLayout): { temp: Float32Array; equatorY: number; arid?: Float32Array } {
  const cN = gN / 2, n = at.n, cell = n / cN;
  const equatorY = equatorOf(n, at.homeY, z.homeLat);
  const inland = inlandShare(isSea, gN, z.inlandRadius);
  const home = homeWeight(at.home, cN, cell, z.homeNear, z.homeFar);
  const temp = new Float32Array(cN * cN);
  const arid = z.dry ? new Float32Array(cN * cN) : undefined;
  const ramp = z.aridRamp === undefined ? 0.1 : z.aridRamp;
  for (let cy = 0; cy < cN; cy++) {
    const y = (cy + 0.5) * cell;
    const lat = signedLatitudeAt(y, n, equatorY);
    for (let cx = 0; cx < cN; cx++) {
      const i = cy * cN + cx;
      const w = home[i];
      if (w >= 1) {
        temp[i] = TEMPERATE;
        continue;
      }
      const x = (cx + 0.5) * cell;
      let sl = lat;
      for (let k = 0; k < z.warp.length; k++) {
        const periods = z.warp[k][0];
        sl += z.warp[k][1] * gradNoise((x * periods) / n, (y * periods) / n, periods, (WARP_SEED + at.seed + k * 977) >>> 0);
      }
      // Latitude is a loop: bent past the pole or the equator, a node lies on the other side of it.
      if (sl > 1) sl -= 2;
      else if (sl <= -1) sl += 2;
      const dry = z.dry !== undefined && sl < 0;
      const phi = sl < 0 ? -sl : sl;
      let t = curveAt(dry ? (z.dry as { temp: LatCurve }).temp : z.temp, phi);
      let rain = curveAt(dry ? (z.dry as { rain: LatCurve }).rain : z.rain, phi);
      // Land with much land round it is the more extreme, the further from the temperate plateau the more so.
      const deep = inland[i] > z.inlandFrom ? (inland[i] - z.inlandFrom) / (1 - z.inlandFrom) : 0;
      if (deep > 0) {
        const off = t < TEMPERATE ? TEMPERATE - t : t - TEMPERATE;
        const k = off >= 0.1 ? 1 : off / 0.1;
        t += (t < TEMPERATE ? -1 : 1) * z.inlandTemp * deep * k;
        if (rain < 1) rain *= 1 - z.inlandDry * deep * (rain <= 0.6 ? 1 : (1 - rain) / 0.4);
      }
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (w > 0) {
        t += (TEMPERATE - t) * w;
        rain += (1 - rain) * w;
      }
      temp[i] = t;
      if (rain !== 1) moisture[i] = clamp01(moisture[i] * rain);
      if (arid && dry) {
        const edge = (phi < 1 - phi ? phi : 1 - phi) / ramp;
        const a = edge >= 1 ? 1 : edge * edge * (3 - 2 * edge);
        arid[i] = a * (1 - w);
      }
    }
  }
  return { temp, equatorY, arid };
}

/** h and rain on G; returns fields on C (gN / 2). With `at`, and zones in the params, the world has its climates. */
export function climateFields(h: Float64Array, rain: Float64Array, isSea: Uint8Array, gN: number, p: ClimateParams, at?: ZoneLayout): Climate {
  const cN = gN / 2;
  const cc = cN * cN;

  const blurred = blurTorus(toCoarse(rain, gN), cN, p.moistureRadius, 3);
  const p95 = percentile95Land(blurred, cN, isSea, gN);
  const moisture = new Float32Array(cc);
  for (let i = 0; i < cc; i++) {
    moisture[i] = clamp01(blurred[i] / p95);
  }

  const hC = toCoarseHeight(h, isSea, gN);
  const wind = new Float32Array(cc);
  for (let y = 0; y < cN; y++) {
    for (let x = 0; x < cN; x++) {
      const i = y * cN + x;
      if (cNodeAllSea(x, y, isSea, gN)) {
        wind[i] = 1;
        continue;
      }
      const h0 = hC[i];
      let u = hC[((y + 1) % cN) * cN + ((x - 1 + cN) % cN)] - p.windDropPerNode;
      const reach = p.windReach;
      for (let k = 2; k <= reach; k++) {
        const hu = hC[((y + k) % cN) * cN + ((x - k + cN) % cN)] - p.windDropPerNode * k;
        if (hu > u) u = hu;
      }
      wind[i] = clamp01(0.5 + (h0 - u) / p.windScale);
    }
  }

  if (!p.zones || !at) return { moisture, wind };
  const zone = zoneFields(moisture, isSea, gN, p.zones, at);
  return { moisture, wind, temp: zone.temp, equatorY: zone.equatorY, arid: zone.arid };
}