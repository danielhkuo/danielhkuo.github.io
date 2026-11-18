// Module worker for the bake pool. The page starts it with
// new Worker(new URL("../../world/runtime/bake.worker.ts", import.meta.url), { type: "module" }).

import { createBakeHost } from "./bakeHost.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
};

type BakeFn = (cx: number, cy: number) => Uint32Array;

interface BakeRequest {
  id: number;
  cx: number;
  cy: number;
}

let host: BakeFn | null = null;
let hostReady = false;
let failed = false;
let pumping = false;
let booting = false;
const waiting: BakeRequest[] = [];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function postError(err: unknown): void {
  scope.postMessage({ type: "error", message: errorMessage(err) });
}

function pump(): void {
  if (pumping || !hostReady || !host || failed) return;
  const bake = host;
  pumping = true;
  try {
    while (waiting.length > 0 && !failed) {
      const msg = waiting.shift();
      if (!msg) break;
      try {
        const started = performance.now();
        const px = bake(msg.cx, msg.cy);
        const ms = performance.now() - started;
        scope.postMessage(
          { type: "baked", id: msg.id, cx: msg.cx, cy: msg.cy, px, ms },
          [px.buffer as ArrayBuffer],
        );
      } catch (err) {
        failed = true;
        waiting.length = 0;
        postError(err);
      }
    }
  } finally {
    pumping = false;
  }
}

function enqueue(msg: BakeRequest): void {
  if (failed) return;
  waiting.push(msg);
  pump();
}

async function boot(url: string, mask: Uint8Array): Promise<void> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    host = await createBakeHost(new Uint8Array(buf), mask);
  } catch (err) {
    failed = true;
    waiting.length = 0;
    postError(err);
    return;
  }
  scope.postMessage({ type: "ready" });
  hostReady = true;
  pump();
}

function isBake(data: object): data is { type: "bake"; id: number; cx: number; cy: number } {
  const rec = data as { type?: unknown; id?: unknown; cx?: unknown; cy?: unknown };
  return rec.type === "bake" && typeof rec.id === "number" && typeof rec.cx === "number" && typeof rec.cy === "number";
}

scope.onmessage = (event: MessageEvent) => {
  const data = event.data as { type?: unknown; url?: unknown; mask?: unknown } | null;
  if (!data || typeof data !== "object") return;
  if (data.type === "init") {
    if (booting) return;
    booting = true;
    void boot(String(data.url), data.mask as Uint8Array);
    return;
  }
  if (isBake(data)) enqueue({ id: data.id, cx: data.cx, cy: data.cy });
};
