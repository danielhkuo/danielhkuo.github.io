// Hard pixels: the frame is scaled up by a whole number, never blurred.

/** The largest whole scale, at least 1, at which a w × h frame fits a vw × vh viewport. */
export function fitScale(vw: number, vh: number, w: number, h: number): number {
  void vw;
  void vh;
  void w;
  void h;
  throw new Error("not implemented");
}
