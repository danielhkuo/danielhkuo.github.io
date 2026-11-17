// Priority-Flood (Barnes 2014, +ε), steepest-descent receivers and drainage
// accumulation on the torus.

export interface Jitter {
  amp: number;
  /** Per-node offsets in node units, in [−amp, amp]. */
  jx: Float32Array;
  jy: Float32Array;
}

export function makeJitter(n: number, amp: number, seed: number): Jitter {
  throw new Error("not implemented");
}

/** Fills pits so every land node drains to the sea; `order` is all n² nodes in pop order. */
export function priorityFlood(h: Float64Array, n: number, isSea: Uint8Array, eps: number): { filled: Float64Array; order: Uint32Array } {
  throw new Error("not implemented");
}

/** Steepest descent among the 8 wrapped neighbours; ties go to the lowest node index; sea nodes point at themselves. */
export function receivers(f: Float64Array, n: number, isSea: Uint8Array, jitter: Jitter | null): { rcv: Int32Array; dist: Float64Array } {
  throw new Error("not implemented");
}

/** Drainage area: land starts at rain[i] (or 1), sea at 0, summed down the reversed order. */
export function accumulate(order: Uint32Array, rcv: Int32Array, isSea: Uint8Array, rain: Float64Array | null): Float64Array {
  throw new Error("not implemented");
}
