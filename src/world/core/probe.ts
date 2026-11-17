// Proves one module runs unchanged under `node --test` and inside a Next worker.
import { stir } from "./probe-dep.ts";

export function probe(seed: number): string {
  throw new Error("not implemented");
}
