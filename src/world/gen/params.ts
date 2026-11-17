// World generation parameters. Lengths are in cells for the 6400 world and
// scaled by paramsFor(n); heights are absolute units and never scale.
// These values set the land's character and are tuned on renders.

export const ARCHETYPE = { home: 0, highland: 1, slate: 2, lakes: 3, karst: 4, skerry: 5 } as const;
export type Archetype = (typeof ARCHETYPE)[keyof typeof ARCHETYPE];
export const ARCHETYPE_COUNT = 6;

export const ROCK = { hard: 0, medium: 1, soft: 2 } as const;

export interface ArchetypeSpec {
  id: Archetype;
  /** Inclusive range of how many cores take this archetype. */
  count: readonly [number, number];
  /** Island length along strike, in cells. */
  diameter: readonly [number, number];
  /** Island width across strike as a share of its length. */
  aspect: number;
  /** Target peak height in units. */
  peak: number;
  /** Relative odds of hard, medium and soft rock within the island. */
  rockBias: readonly [number, number, number];
  /** Inclusive range of ridges: fold belts on an island, islets in a skerry cluster. */
  ridges: readonly [number, number];
  /** Width of a rock stripe across strike, in cells. */
  stripeWidth: readonly [number, number];
}

export interface WorldParams {
  n: number;
  gN: number;
  cN: number;
  cores: { poissonR: number; archetypes: readonly ArchetypeSpec[] };
  /** tan 25°: spines run within 25° of west–east. */
  strike: { maxSlope: number };
  spine: { segments: readonly [number, number]; ridgeGap: number; bend: number; plateau: number };
  uplift: { scale: number; base: number; ridgedAmp: number; stretch: number; featureCells: number };
  rock: { kMul: readonly [number, number, number]; kBase: number; warpCells: number };
  regions: { blend: readonly [number, number] };
  /** S7 hydrology on G (see gen/hydro.ts HydroParams). */
  /** S5 talus: repose per rock class (height per cell) and sweeps; land is scaled down uniformly if it rises above `cap`. */
  talus: { repose: readonly [number, number, number]; sweeps: number; cap: number };
  /** S8 climate fields on C (see gen/climate.ts ClimateParams); lengths in C nodes. */
  climate: { moistureRadius: number; windReach: number; windDropPerNode: number; windScale: number };
  hydro: { rainBase: number; orographic: number; recharge: number; depletion: number; lakeMinNodes: number; lakeMinDepth: number; qChannel: number };
  /** S7 rivers (see gen/rivers.ts RiverParams). Pixel-scale lengths are in cells and never scale. */
  rivers: {
    qScale: number;
    smoothPasses: number;
    simplify: number;
    chaikin: number;
    spacing: number;
    meanderSlope: number;
    meanderFade: number;
    meanderMinWidth: number;
    omega: readonly [number, number];
    omegaFullWidth: number;
    lambdaMin: number;
    lambdaPerWidth: number;
    wobble: number;
    oxbowEvery: number;
    oxbowMinWidth: number;
    floorLift: number;
    floorRise: number;
    bankBase: number;
    bankPerWidth: number;
    fallDrop: number;
    fallStandout: number;
    rapidsDrop: number;
    rapidsMaxCut: number;
  };
  erode: {
    cSteps: number;
    gSteps: number;
    dtC: number;
    dtG: number;
    eps: number;
    jitter: number;
    upsampleNoise: number;
    uniformRainSteps: number;
    stopAt: number;
    diffusionSweeps: number;
    /** Hillslope diffusion per archetype, in C-node units (×4 on G). */
    d: readonly number[];
  };
}

export function paramsFor(n: number): WorldParams {
  if (!Number.isInteger(n) || n % 64 !== 0 || n < 256) throw new Error(`world size ${n} must be a multiple of 64, at least 256`);
  const s = n / 6400;
  const A = ARCHETYPE;
  return {
    n,
    gN: n / 4,
    cN: n / 8,
    cores: {
      poissonR: 900 * s,
      archetypes: [
        { id: A.highland, count: [1, 1], diameter: [3400 * s, 3800 * s], aspect: 0.45, peak: 130, rockBias: [0.75, 0.25, 0], ridges: [4, 5], stripeWidth: [300 * s, 600 * s] },
        { id: A.home, count: [1, 1], diameter: [2800 * s, 3200 * s], aspect: 0.5, peak: 50, rockBias: [0.15, 0.4, 0.45], ridges: [3, 4], stripeWidth: [300 * s, 600 * s] },
        { id: A.lakes, count: [1, 1], diameter: [2700 * s, 3100 * s], aspect: 0.48, peak: 95, rockBias: [0.25, 0.6, 0.15], ridges: [3, 5], stripeWidth: [300 * s, 600 * s] },
        { id: A.slate, count: [1, 1], diameter: [2400 * s, 2800 * s], aspect: 0.45, peak: 65, rockBias: [0.5, 0.0, 0.5], ridges: [4, 5], stripeWidth: [150 * s, 300 * s] },
        { id: A.karst, count: [2, 2], diameter: [2000 * s, 2400 * s], aspect: 0.5, peak: 45, rockBias: [0.85, 0.15, 0.0], ridges: [2, 4], stripeWidth: [300 * s, 600 * s] },
        { id: A.skerry, count: [5, 7], diameter: [320 * s, 720 * s], aspect: 0.8, peak: 25, rockBias: [0.9, 0.1, 0.0], ridges: [1, 6], stripeWidth: [300 * s, 600 * s] },
      ],
    },
    strike: { maxSlope: 0.4663076581549986 },
    spine: { segments: [3, 6], ridgeGap: 120 * s, bend: 0.25, plateau: 0.35 },
    uplift: { scale: 1.2e-3, base: 0.55, ridgedAmp: 0.45, stretch: 3, featureCells: 400 * s },
    rock: { kMul: [0.4, 1, 2.2], kBase: 1e-2, warpCells: 250 * s },
    regions: { blend: [100 * s, 200 * s] },
    // Tuned 2026-11-17: mean land rain ~0.93, windward up to ~1.9, lee ~0.6.
    // Lakes ≥ 120 cells (7.5 G nodes); a channel drains ≥ 40 node-rains.
    talus: { repose: [1.8, 1.0, 0.6], sweeps: 30, cap: 128 },
    // Moisture blurred over ~120 cells; wind horizon searched 300 cells upwind, dropping 0.1 per cell.
    climate: { moistureRadius: 15, windReach: 38, windDropPerNode: 0.8, windScale: 30 },
    hydro: { rainBase: 1, orographic: 0.08, recharge: 0.3, depletion: 0.004, lakeMinNodes: 8, lakeMinDepth: 1.5, qChannel: 40 },
    // Tuned 2026-11-17 on the 6400 world, where the largest river carries
    // ~14 000 node-rains: 420 makes it 6 px and leaves 92 % of channel nodes
    // at 1 px. Smaller worlds have smaller basins, so the scale shrinks with
    // them and a test world still grows rivers wide enough to meander.
    rivers: {
      qScale: 420 * s,
      smoothPasses: 3,
      simplify: 0.75,
      chaikin: 2,
      spacing: 1,
      meanderSlope: 0.012,
      meanderFade: 3,
      meanderMinWidth: 2,
      omega: [0.6, 1.2],
      omegaFullWidth: 4,
      lambdaMin: 20,
      lambdaPerWidth: 12,
      wobble: 0.45,
      oxbowEvery: 5,
      oxbowMinWidth: 3,
      floorLift: 0.5,
      floorRise: 0.02,
      bankBase: 0.5,
      bankPerWidth: 0.3,
      fallDrop: 4,
      fallStandout: 1.6,
      rapidsDrop: 2,
      rapidsMaxCut: 6,
    },
    erode: {
      cSteps: 150,
      gSteps: 60,
      dtC: 10,
      dtG: 10,
      eps: 1e-6,
      jitter: 0.4,
      upsampleNoise: 0.02,
      uniformRainSteps: 75,
      stopAt: 0.75,
      diffusionSweeps: 8,
      // home, highland, slate, lakes, karst, skerry
      // Tuned 2026-11-17 on eroded renders: the first values smoothed away
      // every valley narrower than ~70 cells.
      d: [0.03, 0.004, 0.01, 0.007, 0.012, 0.005],
    },
  };
}
