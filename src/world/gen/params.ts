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
  /** S3: the sea rises by `rise` units after erosion and heights are re-zeroed. */
  drown: { rise: number };
  /** S4. Lengths in cells, depths in units, areas in cells². */
  glacial: {
    /** A region weight of at least this puts a node inside that region's mask. */
    mask: number;
    /** `step` is the share of a lake's reach, from its head, over which the old floor steps down to the basin; `wall` the side's rise at the half-width, as a slope. */
    lakes: { count: readonly [number, number]; length: readonly [number, number]; depth: readonly [number, number]; halfWidth: readonly [number, number]; minArea: number; minFloor: number; step: number; wall: number };
    tarns: { count: readonly [number, number]; radius: readonly [number, number]; depth: number; minHeight: number; maxArea: number };
    dams: { count: readonly [number, number]; height: readonly [number, number]; thickness: number; span: number; minArea: number; minFloor: number };
    /** U-section: half-width range, lowest floor, smallest drainage, and the wall's height at the half-width as a slope. */
    trough: { halfWidth: readonly [number, number]; minFloor: number; minArea: number; wall: number };
  };
  /** S6. Lengths in cells, slopes in units per cell, areas in cells². */
  coast: {
    maxFetch: number;
    /** Weight of rays in the south-west quadrant; the rest weigh 1. */
    swWeight: number;
    /** Raw fetch shares that map to E = 0 and E = 1. */
    fetchRange: readonly [number, number];
    cliffE: number;
    retreat: number;
    /** Retreat multiplier per rock class: hard, medium, soft. */
    retreatK: readonly [number, number, number];
    /** Platform depth below the sea at E = cliffE and at E = 1. */
    platform: readonly [number, number];
    cliffCap: number;
    /** Shores facing within 60° of east or west (|facing·east| > gateCos), or north, are capped at gateCap. */
    gateCap: number;
    gateCos: number;
    /** Land behind a cap may rise from it at this slope. */
    capSlope: number;
    /** A cut shore at least this tall is classed cliff; lower is rocky shore. */
    minCliff: number;
    stackArea: readonly [number, number];
    stackNoise: number;
    stackNoiseCells: number;
    stackTop: readonly [number, number];
    headlandStacks: readonly [number, number];
    headlandSpacing: number;
    /** Share of sea within headlandR of a shore node that makes it a convex headland. */
    headlandSea: number;
    headlandR: number;
    coveR: readonly [number, number];
    /** Smallest drainage (cells²) whose channel cuts a cove into a cliff coast. */
    coveArea: number;
    /** Least distance between two coves, in cells. */
    coveSpacing: number;
    /** Smallest drainage (cells²) that counts as a channel at the coast. */
    channelArea: number;
    beachE: number;
    beachSlope: number;
    /** A channel draining at least beachFeedArea (cells²) feeds sand to shores within beachMouth cells of its mouth; they may be as steep as beachFed. */
    beachFed: number;
    beachFeedArea: number;
    beachMouth: number;
    /** Multiplier on both slope limits per archetype: home, highland, slate, lakes, karst, skerry. */
    beachRegion: readonly number[];
    beachLand: number;
    beachBase: number;
    beachRise: number;
    shelf: number;
    shelfSlope: number;
    deltaE: number;
    bathy: { max: number; slope: number; base: number; eGain: number };
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
    // 2, not the design's 3: at 3 the 6400 world fell to ~26 % land (target 30–35 %).
    drown: { rise: 2 },
    glacial: {
      mask: 0.5,
      lakes: { count: [3, 6], length: [80 * s, 250 * s], depth: [6, 12], halfWidth: [12 * s, 22 * s], minArea: 1500 * s * s, minFloor: 4, step: 0.25, wall: 0.5 / s },
      tarns: { count: [4, 8], radius: [12 * s, 20 * s], depth: 5, minHeight: 60, maxArea: 6000 * s * s },
      dams: { count: [2, 4], height: [4, 8], thickness: 10 * s, span: 60 * s, minArea: 6000 * s * s, minFloor: 8 },
      trough: { halfWidth: [8 * s, 16 * s], minFloor: 35, minArea: 20000 * s * s, wall: 0.5 / s },
    },
    coast: {
      maxFetch: 600 * s,
      swWeight: 2,
      fetchRange: [0.1, 0.6],
      cliffE: 0.55,
      retreat: 200 * s,
      retreatK: [0.6, 1, 0],
      platform: [1.5, 3],
      cliffCap: 45,
      gateCap: 12,
      gateCos: 0.5,
      capSlope: 0.8 / s,
      minCliff: 5,
      stackArea: [8 * s * s, 120 * s * s],
      stackNoise: 0.8,
      stackNoiseCells: 40 * s,
      stackTop: [4, 30],
      headlandStacks: [1, 4],
      headlandSpacing: 260 * s,
      headlandSea: 0.62,
      headlandR: 48 * s,
      coveR: [8 * s, 20 * s],
      coveArea: 2000 * s * s,
      coveSpacing: 260 * s,
      channelArea: 1024 * s * s,
      beachE: 0.35,
      beachSlope: 0.15 / s,
      beachFed: 0.3 / s,
      beachFeedArea: 8000 * s * s,
      beachMouth: 40 * s,
      beachRegion: [2, 0.8, 1, 1, 1, 1],
      beachLand: 10 * s,
      beachBase: 0.6,
      beachRise: 0.05 / s,
      shelf: 30 * s,
      shelfSlope: 0.04 / s,
      deltaE: 0.4,
      bathy: { max: 24, slope: 0.12 / s, base: 0.6, eGain: 0.8 },
    },
  };
}
