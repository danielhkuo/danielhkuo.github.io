// Hard pixels: the frame is scaled up by a whole number, never blurred.

/** The largest whole scale, at least 1, at which a w × h frame fits a vw × vh viewport. */
export function fitScale(vw: number, vh: number, w: number, h: number): number {
  if (vw <= 0 || vh <= 0) return 1;
  return Math.max(1, Math.floor(Math.min(vw / w, vh / h)));
}