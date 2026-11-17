// Fields the cover needs that no single cell can know: what stands uphill of
// it, and whether it lies in a hollow or on a crest. Both are worked out from
// the tile's rebuilt ground, and both are pure functions of the ground within
// a fixed reach of the cell, so any window gives the same answer.

/** Scree spreads this many cells down the fall line from the foot of a cliff. */
export const FAN_REACH = 10;
/** Relief is measured against the ground this many cells round. */
export const RELIEF_R = 4;
/** Ground this steep feeds scree to what lies below it; it is a full source from CLIFF_FULL. */
export const CLIFF_FEED = 1.0;
export const CLIFF_FULL = 1.35;
/** A fan loses this share of its strength with each cell it runs. */
const DECAY = 0.86;
/** Cells of margin the helper reads beyond the region it fills. */
export const COVER_FIELDS_MARGIN = FAN_REACH + 2;

export interface CoverFields {
  /**
   * 0–1: how strongly a cliff uphill of the cell feeds it. 1 at the cliff's
   * foot, fading to 0 FAN_REACH cells down the fall line, and spreading
   * sideways as it goes, so the cells it marks make a fan.
   */
  cliffAbove: Float32Array;
  /** Height of the cell above the mean of the ground RELIEF_R cells round it: positive on crests and knolls, negative in gullies. */
  relief: Float32Array;
}

const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NY = [0, 1, 1, 1, 0, -1, -1, -1];
const ND = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * Both fields for the cells [x0, x0 + w) × [y0, y0 + h) of a W × H window of
 * ground heights (land above 0). The window must reach COVER_FIELDS_MARGIN
 * cells beyond the region on every side. Arrays are indexed like `ground`.
 */
export function coverFields(ground: Float32Array, W: number, H: number, x0: number, y0: number, w: number, h: number): CoverFields {
  if (x0 < COVER_FIELDS_MARGIN || y0 < COVER_FIELDS_MARGIN || x0 + w + COVER_FIELDS_MARGIN > W || y0 + h + COVER_FIELDS_MARGIN > H) {
    throw new Error("coverFields: the window is too small for the region");
  }
  const cliffAbove = new Float32Array(W * H);
  const relief = new Float32Array(W * H);

  // Relief: against eight points on a ring.
  const d = RELIEF_R, q = RELIEF_R - 1;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = y * W + x;
      const ring =
        ground[i - d] + ground[i + d] + ground[i - d * W] + ground[i + d * W] +
        ground[i - q - q * W] + ground[i + q - q * W] + ground[i - q + q * W] + ground[i + q + q * W];
      relief[i] = ground[i] - ring / 8;
    }
  }

  // Sources: cliffs anywhere within reach of the region.
  const lx = x0 - FAN_REACH, ly = y0 - FAN_REACH, hx = x0 + w + FAN_REACH, hy = y0 + h + FAN_REACH;
  let cells: number[] = [];
  for (let y = ly; y < hy; y++) {
    for (let x = lx; x < hx; x++) {
      const i = y * W + x;
      if (ground[i] <= 0) continue;
      const dx = (ground[i + 1] - ground[i - 1]) * 0.5, dy = (ground[i + W] - ground[i - W]) * 0.5;
      const s = Math.sqrt(dx * dx + dy * dy);
      if (s <= CLIFF_FEED) continue;
      const v = s >= CLIFF_FULL ? 1 : (s - CLIFF_FEED) / (CLIFF_FULL - CLIFF_FEED);
      cliffAbove[i] = v;
      cells.push(i);
    }
  }
  if (cells.length === 0) return { cliffAbove, relief };

  // Each step carries the strength of every cell marked in the last step to
  // the cells below it: in full straight down the fall line, less to either
  // side. Offers are gathered first and taken afterwards, a cell keeping the
  // strongest, so the result does not depend on the order of the sweep or on
  // the window, and no cell is carried on twice in a step.
  const offer = new Float32Array(W * H);
  for (let step = 0; step < FAN_REACH && cells.length > 0; step++) {
    const touched: number[] = [];
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const v = cliffAbove[i];
      const x = i % W, y = (i - x) / W;
      const g = ground[i];
      let steepest = 0;
      for (let n = 0; n < 8; n++) {
        const drop = (g - ground[i + NX[n] + NY[n] * W]) / ND[n];
        if (drop > steepest) steepest = drop;
      }
      if (steepest <= 0) continue;
      for (let n = 0; n < 8; n++) {
        const xx = x + NX[n], yy = y + NY[n];
        if (xx < lx || yy < ly || xx >= hx || yy >= hy) continue;
        const j = yy * W + xx;
        if (ground[j] <= 0) continue;
        const drop = (g - ground[j]) / ND[n];
        if (drop <= 0.3 * steepest) continue;
        const pass = v * DECAY * (0.45 + 0.55 * (drop / steepest));
        if (pass > cliffAbove[j] && pass > 0.05 && pass > offer[j]) {
          if (offer[j] === 0) touched.push(j);
          offer[j] = pass;
        }
      }
    }
    for (let k = 0; k < touched.length; k++) {
      const j = touched[k];
      cliffAbove[j] = offer[j];
      offer[j] = 0;
    }
    cells = touched;
  }
  return { cliffAbove, relief };
}
