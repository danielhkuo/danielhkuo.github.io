// The contract between the cover/palette side (what each cell is and what
// colour it takes) and the bake (where it lands on screen). Both sides import
// these types; neither side changes them without the lead's say.

/**
 * Bake pixel, 4 bytes: material (u8) | light (u8) << 8 | depth (u16) << 16.
 * light = tone (4 bits) | shadow depth (2 bits) << 4 | ink (2 bits) << 6.
 * On water pixels the tone bits hold shore distance (sea, lakes) or flow phase (rivers).
 */
export const LIGHT_TONE_MASK = 0x0f;
export const LIGHT_SHADOW_SHIFT = 4;
export const LIGHT_INK_SHIFT = 6;

/** What the bake knows about one world cell when it asks for its cover. */
export interface CoverInput {
  /** World cell, wrapped into [0, n). */
  x: number;
  y: number;
  /** Ground height in units (after all generator stages, before scatter). */
  e: number;
  /** |∇h| in height per cell. */
  slope: number;
  /** −1 (faces south) … 1 (faces north). */
  northness: number;
  /** Height above nearest drainage, units. */
  hand: number;
  /** 0–1 fields from the generator. */
  moisture: number;
  wind: number;
  exposure: number;
  debris: number;
  /** 0 hard, 1 medium, 2 soft; may be fractional where two rocks meet. */
  rock: number;
  /** Six archetype weights (home, highland, slate, lakes, karst, skerry), summing to 1. */
  region: ArrayLike<number>;
  /**
   * Optional: sea-level temperature, 0 at the pole … 1 at the equator, 0.5 on the temperate plateau
   * (gen/climate.ts). Absent, or exactly 0.5, the cover is the temperate one. The cover cools it with height.
   */
  temp?: number;
  /** 0 land, 1 sea, 2 lake, 3 river. */
  water: number;
  /** Shore class from the coast stage: 0 none, 1 beach, 2 rocky, 3 cliff, 4 cove. */
  shore: number;
  /**
   * Optional: the x-part of the unit uphill direction, as northness is its
   * y-part (∂h/∂x ÷ slope). With it, parcels and furrows follow the contour.
   */
  westness?: number;
  /**
   * Optional: offset in cells from the nearest river cell to this one; 0, 0
   * on the river and where none lies within 8 cells. With it, a river is a
   * field boundary and trees keep the river in view.
   */
  riverDx?: number;
  riverDy?: number;
  /**
   * Optional: 1 on a river cell that is a one-cell stream, not a river with banks. A stream is the first water a
   * climate takes: dry in a desert, lost under the snow on an ice cap.
   */
  stream?: number;
  /**
   * Optional: 1 when the river in sight due north or south of this cell is at
   * least 2 cells wide. Only such rivers carry riverside trees; a line of
   * trees along every rill reads as a comb.
   */
  riverWide?: number;
  /**
   * Optional (bake/coverFields.ts): 0–1, how strongly a cliff uphill of this
   * cell feeds it scree: 1 at the cliff's foot, fading down the fall line and
   * spreading as it goes.
   */
  cliffAbove?: number;
  /**
   * Optional (bake/coverFields.ts): height of the cell above the mean of the
   * ground four cells round it. Positive on crests and knolls, negative in
   * gullies and couloirs.
   */
  relief?: number;
  /**
   * Optional (bake/coverFields.ts): the slope of the land's form, with
   * gullies smoothed out; on a sharp crest it reads the slope of the flanks.
   * Without it the cover falls back on `slope`.
   */
  steep?: number;
  /**
   * Optional (bake/coverFields.ts): the height of the land's form, the ground
   * smoothed over a few cells. Strata and crag bands follow its contours, so
   * they run straight across gullies. Without it the cover uses `e`.
   */
  form?: number;
  /**
   * Optional (bake/coverFields.ts): height of the smoothed ground above the
   * mean of the ground eight cells round it. Positive on ridges and spurs,
   * negative in corries and valley heads.
   */
  curve?: number;
  /**
   * Optional (bake/coverFields.ts): the aspect of the land's form, as
   * northness is the cell's: −1 faces south … 1 faces north. Gullies do not
   * turn it, so snow and woods judged on it do not speckle. Without it the
   * cover uses `northness`.
   */
  formNorth?: number;
}

/** A crown or rock stamped into height and material by the bake. */
export interface Stamp {
  /** Centre, world cells (may be fractional). */
  x: number;
  y: number;
  /** Radius, cells. */
  r: number;
  /** Height above the ground at the centre, units. */
  h: number;
  /** Material of the stamped cells. */
  mat: number;
  /** 0 dome (broadleaf, boulder), 1 cone (conifer). */
  shape: number;
}

/** Palette lookup: index (material << 8) | light → packed RGBA (little-endian 0xAABBGGRR). */
export type Palette = Uint32Array;

export interface PaletteOptions {
  /** 0–1 through the day: 0.25 morning, 0.5 noon, 0.8 dusk, 0.95 night. */
  time: number;
  /** 0 spring, 0.25 summer, 0.5 autumn, 0.75 winter. */
  season: number;
  /** 0 clear … 1 overcast. */
  overcast: number;
}
