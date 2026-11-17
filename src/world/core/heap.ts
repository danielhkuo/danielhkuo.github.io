// A binary min-heap and an index sort, both in total (key, index) order.

export class MinHeap {
  constructor(capacity: number) {
    throw new Error("not implemented");
  }
  push(key: number, index: number): void {
    throw new Error("not implemented");
  }
  /** Removes the smallest (key, index) and returns its index. */
  pop(): number {
    throw new Error("not implemented");
  }
  peekKey(): number {
    throw new Error("not implemented");
  }
  get size(): number {
    throw new Error("not implemented");
  }
  clear(): void {
    throw new Error("not implemented");
  }
}

/** Indices 0..n−1 ordered by (keys[i], i). */
export function sortIndicesBy(keys: ArrayLike<number>): Uint32Array {
  throw new Error("not implemented");
}
