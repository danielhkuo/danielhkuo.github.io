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
  /** `rugged` per archetype (home, highland, slate, lakes, karst, skerry): 0 a smooth fold belt, 1 a massif of branching ridges. */
  uplift: { scale: number; base: number; ridgedAmp: number; stretch: number; featureCells: number; rugged: readonly number[] };
  rock: { kMul: readonly [number, number, number]; kBase: number; warpCells: number };
  regions: { blend: readonly [number, number] };
  /** S7 hydrology on G (see gen/hydro.ts HydroParams). */
  /** S5 talus: repose per rock class (height per cell) and sweeps; land is scaled down uniformly if it rises above `cap`. */
  talus: { repose: readonly [number, number, number]; sweeps: number; cap: number; scree: { shed: number; rate: number; repose: number; wash: number; passes: number; sweeps: number } };
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
    skew: number;
    oxbowEvery: number;
    oxbowMax: number;
    oxbowMinWidth: number;
    barMinWidth: number;
    wiggle: number;
    wiggleLambda: readonly [number, number];
    mergeGap: number;
    combSpacing: number;
    combShare: number;
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
    /** Threshold slope per rock class (hard, medium, soft), in height per cell: steeper ground fails as the rivers cut. */
    sc: readonly [number, number, number];
    /** The threshold holds for ground draining scArea cells²; ground draining A stands at (scArea / A)^¼ of it, within scRange. */
    scArea: number;
    scRange: readonly [number, number];
    /** On G the threshold varies by ±grain, and erodibility against it, in knots of grainCells. */
    grain: number;
    grainCells: number;
    /** Hillslope diffusion per archetype, in C-node units (×4 on G). */
    d: readonly number[];
  };
  /** S3: the sea rises by `rise` units after erosion and heights are re-zeroed. */
  drown: { rise: number };
  /** S4. Lengths in cells, depths in units, areas in cells². */
  glacial: {
    /** A region weight of at least this puts a node inside that region's mask. */
    mask: number;
    /** `sill` is the share of a lake's depth made by a rock bar at its outlet (the rest is dug from the floor); the bar falls downstream at `sillSlope`; a fan shelves into the head at `fanSlope`; the floor is dug by at most `maxDig`, easing in over the first `head` of the reach. */
    lakes: { count: readonly [number, number]; length: readonly [number, number]; depth: readonly [number, number]; halfWidth: readonly [number, number]; minArea: number; minFloor: number; sill: number; sillSlope: number; fanSlope: number; maxDig: number; head: number };
    /** A tarn lies in a cirque `length` long, at the head of a valley draining between `minArea` and `maxArea`, on ground whose fall is within `slope`; its headwall climbs at `wall` and its lip falls away at `fall` and more on steeper ground; the old ground behind and beside the water is nowhere lower than `rise` against the water's level (negative: a shallow gully may notch it), and the site with the most is taken. */
    tarns: { count: readonly [number, number]; length: readonly [number, number]; depth: number; minHeight: number; minArea: number; maxArea: number; slope: readonly [number, number]; wall: number; fall: number; rise: number };
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
    /** Land behind a cap may rise from it at a slope in this range, varying along the shore. Kept clear of 0.8, the camera's row factor: a face at that slope draws as one ruled line. */
    capSlope: readonly [number, number];
    /** A cut shore at least this tall is classed cliff; lower is rocky shore. */
    minCliff: number;
    stackArea: readonly [number, number];
    stackNoise: number;
    stackNoiseCells: number;
    stackTop: readonly [number, number];
    /** Least height of the leading stack off a headland, drawn from this range. */
    stackLead: readonly [number, number];
    /** Width of the shoal ring round a stack. */
    stackApron: number;
    /** Radius added round a headland's stack group for its shoal. */
    shoalR: readonly [number, number];
    headlandStacks: readonly [number, number];
    headlandSpacing: number;
    /** Share of sea within headlandR of a shore node that makes it a convex headland. */
    headlandSea: number;
    headlandR: number;
    /** A cove's length along its stream, and the share of coves with a rock back and no sand. */
    coveLen: readonly [number, number];
    coveBoulder: number;
    /** Smallest drainage (cells²) whose channel cuts a cove into a cliff coast. */
    coveArea: number;
    /** Least distance between two coves, in cells. */
    coveSpacing: number;
    /** Smallest drainage (cells²) that counts as a channel at the coast. */
    channelArea: number;
    /**
     * S6.0 The sea evens out a soft shore: the land mask is blurred over r[0] and r[1] cells and the shore follows the
     * blur where `rock` (hard, medium, soft) and a noise of `noiseCells` allow; the noise maps [noise[0], noise[1]] to
     * none … all, times `region` per archetype (home, highland, slate, lakes, karst, skerry). Water shallower than `fill` silts up to ground[0]…ground[1]; land lower than `trim` is lost to a bed `bed` deep.
     */
    even: { r: readonly [number, number]; rock: readonly [number, number, number]; region: readonly number[]; noiseCells: number; noise: readonly [number, number]; fill: number; trim: number; ground: readonly [number, number]; bed: number };
    /** Sea share is also taken within bayR, for the small bays and points headlandR misses. */
    bayR: number;
    /** A shore more convex than this (0 straight, 1 a point in open water) is a tip: it holds no sand. */
    tip: number;
    /** A shore more exposed than beachE holds no sand; a bay head may be beachBay more exposed. */
    beachE: number;
    beachBay: number;
    /** Sand is a score: bay head, shelter, the sea's supply (a noise of sandCells), a river beside it, rock (hard, medium, soft), region; less `mud` where marsh would grow. */
    sandScore: { bay: number; shelter: number; supply: number; fed: number; rock: readonly [number, number, number]; region: number; mud: number };
    sandCells: number;
    /** Width of the sand, inland from the waterline: least and greatest. Its back stands at beachTop. */
    beachWidth: readonly [number, number];
    beachTop: number;
    /** The berm behind the sand: its width, and how far it stands over beachTop. */
    berm: readonly [number, number];
    /** A low rocky shore's shingle strand: its width, the height at the water and at its back, the bank behind it, and its shelf. */
    ledge: { width: number; base: number; top: number; bank: number; shelf: number };
    /** A low tip is a rock ledge in hard or medium rock, or where it is more exposed than ledgeE. */
    ledgeE: number;
    /** A shore with no sand, more exposed than shingleE, is a shingle strand where a noise passes `shingle`. */
    shingleE: number;
    shingle: number;
    /** Dunes stand behind a beach at least duneBeach wide and at least duneE exposed, on ground under duneTop; the band is duneWidth wide. */
    duneE: number;
    duneBeach: number;
    duneWidth: readonly [number, number];
    duneTop: number;
    /** Saltmarsh: a shore no more exposed than marshE and no steeper than marshSlope, and ground within marshReach of it no higher than marshTop. */
    marshE: number;
    marshSlope: number;
    marshReach: number;
    marshTop: number;
    /** Tidal creeks through the marsh: least distance apart, length, and half-width at the mouth. */
    creekSpacing: number;
    creekLen: readonly [number, number];
    creekWidth: number;
    /** shoreDist, sandWidth and duneWidth are set within this many cells of the shore. */
    shoreReach: number;
    beachSlope: number;
    /** A channel draining at least beachFeedArea (cells²) feeds sand to shores within beachMouth cells of its mouth; they may be as steep as beachFed. */
    beachFed: number;
    beachFeedArea: number;
    beachMouth: number;
    /** Multiplier on both slope limits per archetype: home, highland, slate, lakes, karst, skerry. */
    beachRegion: readonly number[];
    beachBase: number;
    /** Slope of the sand at the back of a cove. */
    beachRise: number;
    shelf: number;
    shelfSlope: number;
    /** Width of the gentle shelf off a wholly sheltered shore of soft rock, and its share per rock class: hard, medium, soft. */
    shelfWide: number;
    shelfRock: readonly [number, number, number];
    deltaE: number;
    /** River widths (px) from which a mouth is an estuary, and a sheltered one a delta. */
    estuaryWidth: number;
    deltaWidth: number;
    estuaryLen: number;
    deltaR: readonly [number, number];
    deltaTop: number;
    /** Spits grow from a beach at least `beach` wide whose exposure lies within `e`: their length, half-width at the root, height, and least distance apart. */
    spit: { beach: number; e: readonly [number, number]; len: readonly [number, number]; width: number; top: number; spacing: number };
    bathy: { max: number; slope: number; base: number; eGain: number };
  };
}

/**
 * Lengths are tuned on the 6400 world. A smaller world (the tests' mini-worlds) shrinks them with it; a larger world
 * keeps them and holds more land instead, so it is more of the same world, not the same world magnified.
 */
export function lengthScale(n: number): number {
  return n <= 6400 ? n / 6400 : 1;
}

/** How many 6400 worlds of area a world of n cells holds: 1 at 6400 and below. */
export function areaScale(n: number): number {
  return n <= 6400 ? 1 : (n / 6400) * (n / 6400);
}

/** A count of things per 6400 world, for a world of n cells: more of them in a larger world, never fewer. */
export function countFor(n: number, c: number): number {
  return Math.round(c * areaScale(n));
}

export function paramsFor(n: number): WorldParams {
  if (!Number.isInteger(n) || n % 64 !== 0 || n < 256) throw new Error(`world size ${n} must be a multiple of 64, at least 256`);
  const s = lengthScale(n);
  const A = ARCHETYPE;
  const many = (lo: number, hi: number): [number, number] => [countFor(n, lo), countFor(n, hi)];
  return {
    n,
    gN: n / 4,
    cN: n / 8,
    cores: {
      poissonR: 900 * s,
      archetypes: [
        { id: A.highland, count: many(1, 1), diameter: [3400 * s, 3800 * s], aspect: 0.45, peak: 130, rockBias: [0.75, 0.25, 0], ridges: [4, 5], stripeWidth: [300 * s, 600 * s] },
        { id: A.home, count: [1, 1], diameter: [2800 * s, 3200 * s], aspect: 0.5, peak: 50, rockBias: [0.15, 0.4, 0.45], ridges: [3, 4], stripeWidth: [300 * s, 600 * s] },
        { id: A.lakes, count: many(1, 1), diameter: [2700 * s, 3100 * s], aspect: 0.48, peak: 95, rockBias: [0.25, 0.6, 0.15], ridges: [3, 5], stripeWidth: [300 * s, 600 * s] },
        { id: A.slate, count: many(1, 1), diameter: [2400 * s, 2800 * s], aspect: 0.45, peak: 65, rockBias: [0.5, 0.0, 0.5], ridges: [4, 5], stripeWidth: [150 * s, 300 * s] },
        { id: A.karst, count: many(2, 2), diameter: [2000 * s, 2400 * s], aspect: 0.5, peak: 45, rockBias: [0.85, 0.15, 0.0], ridges: [2, 4], stripeWidth: [300 * s, 600 * s] },
        { id: A.skerry, count: many(5, 7), diameter: [320 * s, 720 * s], aspect: 0.8, peak: 25, rockBias: [0.9, 0.1, 0.0], ridges: [1, 6], stripeWidth: [300 * s, 600 * s] },
      ],
    },
    strike: { maxSlope: 0.4663076581549986 },
    spine: { segments: [3, 6], ridgeGap: 120 * s, bend: 0.25, plateau: 0.35 },
    uplift: { scale: 1.2e-3, base: 0.55, ridgedAmp: 0.45, stretch: 3, featureCells: 400 * s, rugged: [0, 1, 0.5, 0.8, 0.35, 0] },
    rock: { kMul: [0.4, 1, 2.2], kBase: 1e-2, warpCells: 250 * s },
    regions: { blend: [100 * s, 200 * s] },
    // Tuned 2026-11-17: mean land rain ~0.93, windward up to ~1.9, lee ~0.6.
    // Lakes ≥ 120 cells (7.5 G nodes); a channel drains ≥ 40 node-rains.
    // Rockfall: ground steeper than 0.72 sheds, and the debris lies at 0.55 where the slope eases, unless a stream carries it off.
    talus: { repose: [1.8, 1.0, 0.6], sweeps: 30, cap: 128, scree: { shed: 0.72 / s, rate: 5 * s, repose: 0.55 / s, wash: 2400 * s * s, passes: 4, sweeps: 24 } },
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
      // Round 2, tuned 2026-11-17 on 6400 crops: bends vary by half, lean, and
      // oxbows are at most two to a river; small streams wander instead of
      // running straight; runnels closer than 48 cells on one slope are thinned.
      wobble: 0.5,
      skew: 0.3,
      oxbowEvery: 8,
      oxbowMax: 2,
      oxbowMinWidth: 3,
      barMinWidth: 3,
      wiggle: 1.6,
      wiggleLambda: [16, 34],
      mergeGap: 4,
      combSpacing: 40,
      combShare: 0.6,
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
      sc: [0.7 / s, 0.6 / s, 0.5 / s],
      scArea: 600 * s * s,
      grain: 0.3,
      grainCells: 120 * s,
      scRange: [0.75, 1.5],
      // home, highland, slate, lakes, karst, skerry
      // Tuned 2026-11-17 on eroded renders: the first values smoothed away
      // every valley narrower than ~70 cells.
      d: [0.03, 0.0015, 0.01, 0.003, 0.012, 0.005],
    },
    // 2, not the design's 3: at 3 the 6400 world fell to ~26 % land (target 30–35 %).
    drown: { rise: 2 },
    glacial: {
      mask: 0.5,
      lakes: { count: [3, 6], length: [80 * s, 250 * s], depth: [6, 12], halfWidth: [18 * s, 30 * s], minArea: 1500 * s * s, minFloor: 4, sill: 0.6, sillSlope: 0.25 / s, fanSlope: 0.05 / s, maxDig: 10, head: 0.2 },
      tarns: { count: [4, 8], length: [30 * s, 48 * s], depth: 5, minHeight: 60, minArea: 640 * s * s, maxArea: 6000 * s * s, slope: [0.1 / s, 0.5 / s], wall: 1.6 / s, fall: 0.5 / s, rise: -2 },
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
      capSlope: [0.5 / s, 0.72 / s],
      minCliff: 5,
      stackArea: [8 * s * s, 120 * s * s],
      stackNoise: 0.8,
      stackNoiseCells: 40 * s,
      stackTop: [4, 36],
      stackLead: [14, 28],
      stackApron: 3.5 * s,
      shoalR: [16 * s, 40 * s],
      headlandStacks: [2, 4],
      headlandSpacing: 260 * s,
      headlandSea: 0.62,
      headlandR: 48 * s,
      coveLen: [14 * s, 52 * s],
      coveBoulder: 0.3,
      coveArea: 2000 * s * s,
      coveSpacing: 260 * s,
      channelArea: 1024 * s * s,
      even: { r: [16 * s, 44 * s], rock: [0.8, 0.9, 1], region: [0.45, 1, 1, 1, 1, 0], noiseCells: 300 * s, noise: [0.25, 0.6], fill: 3, trim: 3, ground: [0.3, 1.1], bed: 0.3 },
      bayR: 20 * s,
      tip: 0.2,
      beachE: 0.35,
      beachBay: 0.07,
      sandScore: { bay: 0.5, shelter: 0.25, supply: 0.55, fed: 0.2, rock: [0, 0.05, 0.12], region: 0.15, mud: 0.7 },
      sandCells: 360 * s,
      beachWidth: [2.5 * s, 12 * s],
      beachTop: 1.1,
      berm: [5 * s, 0.35],
      ledge: { width: 3 * s, base: 0.45, top: 0.95, bank: 1.85, shelf: 8 * s },
      ledgeE: 0.25,
      shingleE: 0.15,
      shingle: 0.2,
      duneE: 0.14,
      duneBeach: 8 * s,
      duneWidth: [6 * s, 18 * s],
      duneTop: 4,
      marshE: 0.1,
      marshSlope: 0.06 / s,
      marshReach: 28 * s,
      marshTop: 1.2,
      creekSpacing: 48 * s,
      creekLen: [18 * s, 44 * s],
      creekWidth: 1.4 * s,
      shoreReach: 64 * s,
      beachSlope: 0.15 / s,
      beachFed: 0.3 / s,
      beachFeedArea: 8000 * s * s,
      beachMouth: 40 * s,
      beachRegion: [2, 0.8, 1, 1, 1, 1],
      beachBase: 0.6,
      beachRise: 0.05 / s,
      shelf: 30 * s,
      shelfSlope: 0.04 / s,
      shelfWide: 110 * s,
      shelfRock: [0.3, 0.7, 1],
      deltaE: 0.4,
      estuaryWidth: 2,
      deltaWidth: 4,
      estuaryLen: 40 * s,
      deltaR: [45 * s, 90 * s],
      deltaTop: 0.7,
      spit: { beach: 4 * s, e: [0.05, 0.4], len: [50 * s, 110 * s], width: 3.6 * s, top: 0.55, spacing: 420 * s },
      bathy: { max: 24, slope: 0.12 / s, base: 0.6, eGain: 0.8 },
    },
  };
}
