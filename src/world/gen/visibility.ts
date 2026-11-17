// What the fixed camera can see. A node at row y with height h draws its top
// at screen row c·y − h (c = 0.8 · cells per node). A node further south whose
// top reaches that row or higher hides it. Rows wrap: the bake is a torus too.

export interface Visibility {
  /** Highest "h − c·k" over the nodes k = 1, 2, … south of each node: the height a node must exceed to be seen. */
  horizon: Float32Array;
  /** 1 where the node's top is visible (h > horizon), else 0. */
  visible: Uint8Array;
}

/**
 * @param c screen rows per node step south: 0.8 × cells per node (3.2 on G, 0.8 on cells).
 * @param reach how many nodes south can matter: ceil(HMAX_range / c) is enough.
 */
export function visibility(h: Float64Array | Float32Array, n: number, c: number, reach: number): Visibility {
  throw new Error("not implemented");
}
