import { bakeBenchChunk, type TileCache } from "./bake-bench.ts";
import { makeBenchField, makeBenchMask } from "./field.ts";
import { probe } from "../core/probe.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
};

const field = makeBenchField(2560, 7);
const mask = makeBenchMask(1);
let cache: TileCache = new Map();

interface BenchRequest {
  kind: string;
  chunks?: [number, number][];
  col?: number;
  startRow?: number;
  ms?: number;
}

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as BenchRequest;
  if (msg.kind === "probe") {
    scope.postMessage({ kind: "probe", value: probe(42) });
    return;
  }
  if (msg.kind === "cold") {
    cache = new Map();
    const started = performance.now();
    for (const [cx, cy] of msg.chunks ?? []) bakeBenchChunk(field, cx, cy, cache, mask);
    scope.postMessage({ kind: "cold", ms: performance.now() - started });
    return;
  }
  if (msg.kind === "warm") {
    cache = new Map();
    const col = (msg.col ?? 0) % 10;
    let row = msg.startRow ?? 0;
    const limit = msg.ms ?? 0;
    let chunks = 0;
    const started = performance.now();
    while (performance.now() - started < limit) {
      bakeBenchChunk(field, col, row, cache, mask);
      chunks += 1;
      row = (row - 1 + 8) % 8;
    }
    scope.postMessage({ kind: "warm", chunks, ms: performance.now() - started });
  }
};

scope.postMessage({ kind: "ready" });
