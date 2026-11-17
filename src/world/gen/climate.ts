// S8 inputs: smooth climate fields on the coarse grid C, from G-grid data.

/** 2 × 2 box average from G (gN²) to C ((gN/2)²). */
export function toCoarse(g: ArrayLike<number>, gN: number): Float32Array {
  throw new Error("not implemented");
}

/** Separable box blur on an n × n torus, `radius` nodes, `passes` times (3 passes ≈ Gaussian). */
export function blurTorus(a: Float32Array, n: number, radius: number, passes: number): Float32Array {
  throw new Error("not implemented");
}

export interface ClimateParams {
  /** Moisture blur radius, C nodes. */
  moistureRadius: number;
  /** Upwind search distance, C nodes. */
  windReach: number;
  /** Height the upwind horizon drops per C node of distance. */
  windDropPerNode: number;
  /** Height difference that spans the full exposure range. */
  windScale: number;
}

export interface Climate {
  /** 0–1: blurred rain, divided by its 95th percentile over land, clamped. */
  moisture: Float32Array;
  /** 0–1: exposure to the south-west wind; 1 over open sea. */
  wind: Float32Array;
}

/** h and rain on G; returns fields on C (gN / 2). */
export function climateFields(h: Float64Array, rain: Float64Array, isSea: Uint8Array, gN: number, p: ClimateParams): Climate {
  throw new Error("not implemented");
}
