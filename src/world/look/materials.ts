// Material ids: what a bake pixel is made of. The palette turns an id and a
// light byte into a colour, so anything that changes with the season or the
// region is its own id: the palette alone moves the snow line, turns the
// leaves and ripens the crops.
//
// Each large cover has three hue variants on consecutive ids, ordered cool,
// mid, warm; `base + v` with v in 0…2 picks one.

export const VARIANTS = 3;

export const MATERIAL = {
  /** Nothing baked: bare paper. */
  none: 0,

  // Water. Tone bits hold shore distance (sea, lakes) or flow phase (river).
  sea: 1,
  /** Karst-coast sea: a wider turquoise shelf over pale limestone sand. */
  seaClear: 2,
  lake: 3,
  river: 4,

  // Shore.
  sand: 5,
  /** Limestone sand of the karst coves. */
  sandPale: 6,
  shingle: 7,

  // Snow. `snow` lies all year; `snowLate` melts to fellfield in high summer.
  // Alpine meadow (below) is the winter snow band.
  snow: 8,
  snowLate: 9,

  // Rock. Tops and benches, then the faces the bake shows as walls and hatches.
  rockHard: 10,
  rockSed: 11,
  rockLime: 12,
  rockSlate: 13,
  cliffHard: 14,
  cliffSed: 15,
  cliffLime: 16,
  cliffSlate: 17,
  scree: 18,
  screeSlate: 19,

  // Upland.
  alpineCool: 20,
  alpineMid: 21,
  alpineWarm: 22,
  /** Heather: purple in late summer, brown the rest of the year. */
  heathCool: 23,
  heathMid: 24,
  heathWarm: 25,
  /** Grass moor: tawny olive. */
  moorCool: 26,
  moorMid: 27,
  moorWarm: 28,

  // Woods. Floors are what shows between crowns; crowns are stamped by scatter.
  floorBroadleaf: 29,
  floorConifer: 30,
  broadleafCool: 31,
  broadleafMid: 32,
  broadleafWarm: 33,
  coniferCool: 34,
  coniferMid: 35,
  coniferWarm: 36,
  /** Riverbank alders and marsh willows. */
  alder: 37,
  /** Low bushes of the dry scrub. */
  shrub: 38,

  // Crops, one per parcel.
  wheat: 39,
  barley: 40,
  /** Sown grass. */
  ley: 41,
  /** Mown hay meadow. */
  hay: 42,
  plough: 43,
  vine: 44,

  // Wet ground.
  marsh: 45,
  reeds: 46,

  // Lowland grass.
  meadowCool: 47,
  meadowMid: 48,
  meadowWarm: 49,
  pastureCool: 50,
  pastureMid: 51,
  pastureWarm: 52,
  scrubCool: 53,
  scrubMid: 54,
  scrubWarm: 55,

  // Small scatter.
  flowerPale: 56,
  flowerMauve: 57,
  boulder: 58,

  // Lines.
  road: 59,
  path: 60,
  hedge: 61,
  wall: 62,

  // Field texture: the furrow, row or swath lines drawn across a crop, and
  // the stubble a cut field leaves. Each is a tone or two from its field.
  wheatRow: 63,
  barleyRow: 64,
  leyStripe: 65,
  hayRow: 66,
  ploughRow: 67,
  vineRow: 68,
  stubble: 69,
  stubbleRow: 70,

  /** The small crowns of a hedge. Not canopy: a hedge is never inked. */
  hedgeCrown: 71,

  // Built things: the landmarks, the town, hamlets and what stands on free sites.
  /** Limewashed wall. */
  whitewash: 72,
  /** Warm plaster of the town's houses. */
  plaster: 73,
  /** Dressed pale stone: the abbey, the bell tower, bridges, quays. */
  stone: 74,
  /** Rubble and weathered stone: ruins, field walls, chapels, upland cottages. */
  stoneDark: 75,
  roofSlate: 76,
  /** Terracotta tile. */
  roofTile: 77,
  /** Lead and weathered copper: spires and the abbey church. */
  roofLead: 78,
  /** Planks, doors, jetties, mill caps. */
  timber: 79,
  /** The lighthouse's band: a muted brick, well clear of the dragon's vermilion. */
  brick: 80,
  /** Windows, doorways and the shade under an arch. */
  opening: 81,
  /** Streets, quays and yards. */
  cobble: 82,
  /** The dark crown of a churchyard yew. */
  yew: 83,
  /** Crosses, weathercocks and clock hands. */
  gilt: 84,
  /** A clock's face. */
  dial: 85,
  /** The lighthouse's lamp room. */
  lantern: 86,
  sailcloth: 87,
  /** Fresh slate of a quarry face and floor. */
  quarry: 88,

  /** Bracken: the warm olive of steep, sunny, unploughed hillsides; russet in autumn. */
  bracken: 89,

  /** A stone lying on scree: a tone under the buff of the fan, never dark. */
  screeStone: 90,
  /** Marram on the dunes behind a beach: pale sage. */
  duneGrass: 91,
  /** Saltmarsh: grey-green turf at the tide's edge. */
  saltmarsh: 92,
  /** The muddy creeks that cut a saltmarsh. */
  saltCreek: 93,
  /** Gorse: dark, dense bushes on open moor, still flecked with gold in summer. */
  gorse: 94,
} as const;

export type MaterialName = keyof typeof MATERIAL;

export const MATERIAL_COUNT = 95;

/** Name of each id, for previews and test messages. */
export const MATERIAL_NAMES: readonly string[] = (() => {
  const names: string[] = new Array(MATERIAL_COUNT).fill("");
  for (const [name, id] of Object.entries(MATERIAL)) names[id] = name;
  return names;
})();

function flags(ids: readonly number[]): Uint8Array {
  const t = new Uint8Array(256);
  for (const id of ids) t[id] = 1;
  return t;
}

function triple(base: number): number[] {
  return [base, base + 1, base + 2];
}

const M = MATERIAL;

/** Tone bits are shore distance or flow phase; the live layer animates these. */
export const isWater: Uint8Array = flags([M.sea, M.seaClear, M.lake, M.river]);

/** Stamped crowns: they take forest-edge ink against ground and none against each other. */
export const isCanopy: Uint8Array = flags([
  ...triple(M.broadleafCool), ...triple(M.coniferCool), M.alder, M.shrub,
]);

/** Drawn as polylines in bake-pixel space; never inked. */
export const isLine: Uint8Array = flags([M.road, M.path, M.hedge, M.wall]);

/** Parcel crops. */
export const isCrop: Uint8Array = flags([
  M.wheat, M.barley, M.ley, M.hay, M.plough, M.vine,
  M.wheatRow, M.barleyRow, M.leyStripe, M.hayRow, M.ploughRow, M.vineRow, M.stubble, M.stubbleRow,
]);

/** Anything green a river may cross: the river must stay 15 L* lighter than all of these. */
export const isVegetation: Uint8Array = flags([
  ...triple(M.alpineCool), ...triple(M.heathCool), ...triple(M.moorCool),
  M.floorBroadleaf, M.floorConifer,
  ...triple(M.broadleafCool), ...triple(M.coniferCool), M.alder, M.shrub,
  M.wheat, M.barley, M.ley, M.hay, M.plough, M.vine,
  M.wheatRow, M.barleyRow, M.leyStripe, M.hayRow, M.ploughRow, M.vineRow, M.stubble, M.stubbleRow,
  M.marsh, M.reeds,
  ...triple(M.meadowCool), ...triple(M.pastureCool), ...triple(M.scrubCool),
  M.hedge, M.hedgeCrown, M.bracken, M.duneGrass, M.saltmarsh, M.gorse,
]);

/** Made things: buildings, walls and paving. */
export const isBuilt: Uint8Array = flags([
  M.whitewash, M.plaster, M.stone, M.stoneDark, M.roofSlate, M.roofTile, M.roofLead, M.timber, M.brick, M.opening,
  M.cobble, M.gilt, M.dial, M.lantern, M.sailcloth, M.quarry,
]);

/** Grass that the live wind layer may brighten under a gust. */
export const isGrass: Uint8Array = flags([
  ...triple(M.alpineCool), ...triple(M.moorCool),
  M.wheat, M.barley, M.ley, M.hay, M.reeds,
  M.wheatRow, M.barleyRow, M.leyStripe, M.hayRow,
  ...triple(M.meadowCool), ...triple(M.pastureCool), M.duneGrass,
]);
