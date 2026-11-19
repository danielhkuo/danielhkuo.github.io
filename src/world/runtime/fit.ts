// Hard pixels, edge to edge: the frame covers the whole window at a whole number of device pixels per frame pixel, and
// the window's shape decides how much of the world it shows across and up and down. Never blurred, never stretched.

/**
 * The most frame pixels a window gets. The frame loop costs about 0.03 ms more per thousand frame pixels at 4× CPU
 * throttle (scripts/world-fly.mjs --viewport: 400 × 225 against 480 × 270), and today's 400 × 225 frame is at 3.6 ms of
 * its 4 ms there; this keeps 1080p (384 × 216) and 1440p (366 × 206) under today's frame, and any window within 7 % of
 * it. Phones stay under it too.
 */
export const FRAME_PIXELS = 96_000;

/** A frame for a window: w × h frame pixels, each `scale` device pixels square. */
export interface FrameFit {
  w: number;
  h: number;
  scale: number;
}

/**
 * The frame for a viewport of vw × vh CSS pixels at device pixel ratio `dpr`: the finest whole scale (device pixels per
 * frame pixel) at which a frame covering the viewport has at most `budget` pixels, and that frame. It overhangs the
 * viewport by less than a frame pixel on the right and at the bottom.
 */
export function fitFrame(vw: number, vh: number, dpr: number, budget = FRAME_PIXELS): FrameFit {
  const dw = Math.max(1, Math.round(vw * dpr)), dh = Math.max(1, Math.round(vh * dpr));
  // No coarser scale than needed: below √(area / budget) even the device pixels alone are too many.
  let scale = Math.max(1, Math.floor(Math.sqrt((dw * dh) / budget)));
  while (Math.ceil(dw / scale) * Math.ceil(dh / scale) > budget) scale++;
  return { w: Math.ceil(dw / scale), h: Math.ceil(dh / scale), scale };
}

/** A viewport can shrink this share of its height (a phone's toolbars coming and going) and keep its frame. */
export const TOOLBAR_SHARE = 0.25;

/**
 * Whether a frame fitted to a viewport of `fitted` CSS pixels should be fitted again for one of `now`: when the width
 * changes (turned, or the window resized), when it grows taller (the frame would no longer cover it), or when it
 * shrinks by more than TOOLBAR_SHARE. A toolbar showing and hiding leaves the frame as it is, overhanging under it.
 */
export function refits(fitted: { w: number; h: number }, now: { w: number; h: number }): boolean {
  if (now.w !== fitted.w || now.h > fitted.h) return true;
  return now.h < fitted.h * (1 - TOOLBAR_SHARE);
}
