// Proves one module runs unchanged under `node --test` and inside a Next worker.
import { stir } from "./probe-dep.ts";

const TABLE = [3, 1, 4, 1, 5, 9, 2, 6];

export function probe(seed: number): string {
  let h = seed >>> 0;
  for (const t of TABLE) h = stir((h + t) >>> 0);
  return h.toString(16).padStart(8, "0");
}
