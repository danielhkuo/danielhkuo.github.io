// A small pool of bake workers. The stream view says which chunks it wants and
// how urgently; the pool keeps every worker busy with one chunk at a time, most
// urgent first, and hands baked chunks back.

/** The part of a Worker the pool uses, so tests can stand in for one. */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  terminate(): void;
}

export type ToWorker =
  | { type: "init"; url: string; mask: Uint8Array }
  | { type: "bake"; id: number; cx: number; cy: number };

export type FromWorker =
  | { type: "ready" }
  | { type: "baked"; id: number; cx: number; cy: number; px: Uint32Array; ms: number }
  | { type: "error"; message: string };

/** A chunk the view wants, by wrapped chunk coordinates; lower priority goes first. */
export interface ChunkWant {
  cx: number;
  cy: number;
  priority: number;
}

export interface BakePool {
  /** Replaces the wish list: queued chunks missing from it are dropped; chunks in flight finish. */
  want(list: readonly ChunkWant[]): void;
  onBaked: ((cx: number, cy: number, px: Uint32Array) => void) | null;
  onError: ((message: string) => void) | null;
  stats(): { inFlight: number; queued: number; baked: number; bakeMs: number };
  dispose(): void;
}

export function createPool(spawn: () => WorkerLike, size: number, init: { url: string; mask: Uint8Array }): BakePool {
  void spawn;
  void size;
  void init;
  throw new Error("not implemented");
}
