// A binary min-heap and an index sort, both in total (key, index) order.

/** True when (ka, ia) is strictly before (kb, ib). */
function before(ka: number, ia: number, kb: number, ib: number): boolean {
  return ka < kb || (ka === kb && ia < ib);
}

export class MinHeap {
  keys: Float64Array;
  indices: Uint32Array;
  count: number;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.indices = new Uint32Array(capacity);
    this.count = 0;
  }

  push(key: number, index: number): void {
    if (this.count >= this.keys.length) throw new RangeError("MinHeap capacity exceeded");
    let i = this.count;
    this.count = i + 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = this.keys[p];
      const pi = this.indices[p];
      if (!before(key, index, pk, pi)) break;
      this.keys[i] = pk;
      this.indices[i] = pi;
      i = p;
    }
    this.keys[i] = key;
    this.indices[i] = index;
  }

  /** Removes the smallest (key, index) and returns its index. */
  pop(): number {
    const root = this.indices[0];
    this.count--;
    if (this.count === 0) return root;
    const key = this.keys[this.count];
    const index = this.indices[this.count];
    const n = this.count;
    let i = 0;
    while (true) {
      let c = i * 2 + 1;
      if (c >= n) break;
      const right = c + 1;
      if (right < n && before(this.keys[right], this.indices[right], this.keys[c], this.indices[c])) c = right;
      if (!before(this.keys[c], this.indices[c], key, index)) break;
      this.keys[i] = this.keys[c];
      this.indices[i] = this.indices[c];
      i = c;
    }
    this.keys[i] = key;
    this.indices[i] = index;
    return root;
  }

  peekKey(): number {
    return this.keys[0];
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }
}

/** Indices 0..n−1 ordered by (keys[i], i). */
export function sortIndicesBy(keys: ArrayLike<number>): Uint32Array {
  const n = keys.length;
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) heap.push(keys[i], i);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = heap.pop();
  return out;
}
