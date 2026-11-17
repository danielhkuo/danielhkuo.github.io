// Fields the cover needs that no single cell can know: what stands uphill of
// it, and whether it lies in a hollow or on a crest. Both are worked out from
// the tile's rebuilt ground, and both are pure functions of the ground within
// a fixed reach of the cell, so any window gives the same answer.

/** Scree spreads this many cells down the fall line from the foot of a cliff. */
export const FAN_REACH = 8;
/** Relief is measured against the ground this many cells round. */
export const RELIEF_R = 4;
/** Ground this steep feeds scree to what lies below it; it is a full source from CLIFF_FULL. */
export const CLIFF_FEED = 1.3;
export const CLIFF_FULL = 1.6;
/** A fan loses this share of its strength with each cell it runs. */
const DECAY = 0.88;
/** Cells of margin the helper reads beyond the region it fills: the form's curvature ring and its smoothing, and a fan's reach likewise. */
export const COVER_FIELDS_MARGIN = 12;

export interface CoverFields {
  /**
   * 0–1: how strongly a cliff uphill of the cell feeds it. 1 at the cliff's
   * foot, fading to 0 FAN_REACH cells down the fall line, and spreading
   * sideways as it goes, so the cells it marks make a fan.
   */
  cliffAbove: Float32Array;
  /** Height of the cell above the mean of the ground RELIEF_R cells round it: positive on crests and knolls, negative in gullies. */
  relief: Float32Array;
  /**
   * The slope of the land's form: the mean fall to a ring RELIEF_R cells out,
   * on ground smoothed over SMOOTH_R cells, scaled so a plane reads its own
   * slope. Gullies do not show in it, and a sharp crest reads the slope of
   * its flanks where the gradient itself is nil.
   */
  steep: Float32Array;
  /** The height of the land's form: the ground smoothed over SMOOTH_R cells, so a contour of it runs straight across gullies. */
  form: Float32Array;
  /** As relief, on the smoothed ground against a ring CURVE_R cells out: positive on ridges and spurs, negative in corries and valley heads. */
  curve: Float32Array;
}

/** The form is the ground averaged over a square this many cells either way. */
export const SMOOTH_R = 3;
/** The form's curvature is measured against the ground this many cells round. */
export const CURVE_R = 8;
/** A cliff feeds scree only where the smoothed ground is this steep too: a gully's wall on a moderate slope is no cliff. */
export const FEED_FORM = 1;
/** Mean |cos| over the ring's eight directions: what a plane's fall to the ring is, as a share of its slope. */
const RING_MEAN = 0.628;

const NX = [1, 1, 0, -1, -1, -1, 0, 1];
const NY = [0, 1, 1, 1, 0, -1, -1, -1];
const ND = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * The fields for the cells [x0, x0 + w) × [y0, y0 + h) of a W × H window of
 * ground heights (land above 0). The window must reach COVER_FIELDS_MARGIN
 * cells beyond the region on every side. Arrays are indexed like `ground`.
 */
export function coverFields(ground: Float32Array, W: number, H: number, x0: number, y0: number, w: number, h: number): CoverFields {
  if (x0 < COVER_FIELDS_MARGIN || y0 < COVER_FIELDS_MARGIN || x0 + w + COVER_FIELDS_MARGIN > W || y0 + h + COVER_FIELDS_MARGIN > H) {
    throw new Error("coverFields: the window is too small for the region");
  }
  const cliffAbove = new Float32Array(W * H);
  const relief = new Float32Array(W * H);
  const steep = new Float32Array(W * H);
  const curve = new Float32Array(W * H);

  // The form: a box mean, each cell summed in the same order whatever the window, so windows agree to the bit.
  const R = SMOOTH_R, far = CURVE_R + 1;
  const sx0 = x0 - far, sy0 = y0 - far, sx1 = x0 + w + far, sy1 = y0 + h + far;
  const rows = new Float32Array(W * H), smooth = new Float32Array(W * H);
  for (let y = sy0 - R; y < sy1 + R; y++) {
    for (let x = sx0; x < sx1; x++) {
      const i = y * W + x;
      let t = 0;
      for (let k = -R; k <= R; k++) t += ground[i + k];
      rows[i] = t;
    }
  }
  const area = (2 * R + 1) * (2 * R + 1);
  for (let y = sy0; y < sy1; y++) {
    for (let x = sx0; x < sx1; x++) {
      const i = y * W + x;
      let t = 0;
      for (let k = -R; k <= R; k++) t += rows[i + k * W];
      smooth[i] = t / area;
    }
  }
  {
    const a = RELIEF_R, b = RELIEF_R - 1, ca = CURVE_R, cb = CURVE_R - 2;
    const ia = 1 / a, ib = 1 / (b * Math.SQRT2);
    for (let y = y0 - 1; y < y0 + h + 1; y++) {
      for (let x = x0 - 1; x < x0 + w + 1; x++) {
        const i = y * W + x, g = smooth[i];
        const fall =
          (Math.abs(smooth[i - a] - g) + Math.abs(smooth[i + a] - g) + Math.abs(smooth[i - a * W] - g) + Math.abs(smooth[i + a * W] - g)) * ia +
          (Math.abs(smooth[i - b - b * W] - g) + Math.abs(smooth[i + b - b * W] - g) + Math.abs(smooth[i - b + b * W] - g) + Math.abs(smooth[i + b + b * W] - g)) * ib;
        steep[i] = fall / (8 * RING_MEAN);
        const ring =
          smooth[i - ca] + smooth[i + ca] + smooth[i - ca * W] + smooth[i + ca * W] +
          smooth[i - cb - cb * W] + smooth[i + cb - cb * W] + smooth[i - cb + cb * W] + smooth[i + cb + cb * W];
        curve[i] = g - ring / 8;
      }
    }
  }

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
      // Only a cliff of the land's own form sheds scree: a gully's wall is steep, but the smoothed ground there is not.
      const fx = (smooth[i + 1] - smooth[i - 1]) * 0.5, fy = (smooth[i + W] - smooth[i - W]) * 0.5;
      if (fx * fx + fy * fy < FEED_FORM * FEED_FORM) continue;
      const v = s >= CLIFF_FULL ? 1 : (s - CLIFF_FEED) / (CLIFF_FULL - CLIFF_FEED);
      cliffAbove[i] = v;
      cells.push(i);
    }
  }
  if (cells.length === 0) return { cliffAbove, relief, steep, curve, form: smooth };

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
  return { cliffAbove, relief, steep, curve, form: smooth };
}
