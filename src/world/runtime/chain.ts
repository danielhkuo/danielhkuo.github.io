// The body chain: the head's path remembered, and points spaced along it behind the head, so a long body follows
// exactly where the head has been, turns and all. Positions wrap with the world.

export interface Joint {
  x: number;
  y: number;
  alt: number;
  /** Direction of travel there, radians (0 east, π/2 south). */
  heading: number;
}

export interface Chain {
  /** Records the head's position this frame (world cells, wrapped into [0, n)). */
  push(x: number, y: number, alt: number): void;
  /**
   * `count` joints, the first at the head, each `spacing` cells of path behind the last, positions wrapped into [0, n).
   * Joints past the start of the remembered path continue straight back along the path's first heading.
   */
  joints(count: number, spacing: number): Joint[];
}

/** A chain on a world `n` cells across that remembers at most `capacity` points (older ones are dropped). */
export function createChain(n: number, capacity: number): Chain {
  void n; void capacity;
  throw new Error("not implemented");
}
