// A small pool of bake workers. The stream view says which chunks it wants and
// how urgently; the pool keeps every worker busy with one chunk at a time, most
// urgent first, and hands baked chunks back.

/** The part of a Worker the pool uses, so tests can stand in for one. */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  /** A Worker whose script fails to load or throws at the top level reports here, not through a message. */
  onerror?: ((e: { message?: string }) => void) | null;
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
  /** `workers` counts the workers still alive: none left means nothing more will be baked. */
  stats(): { inFlight: number; queued: number; baked: number; bakeMs: number; workers: number };
  dispose(): void;
}

interface Job {
  id: number;
  cx: number;
  cy: number;
}

interface Slot {
  worker: WorkerLike;
  ready: boolean;
  job: Job | null;
  /** A worker spawned after a failure. A second failure of this worker is not replaced. */
  replacement: boolean;
  stopped: boolean;
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** One entry per chunk, first-seen order, priority lowered to the smallest value in the list. */
function collapse(list: readonly ChunkWant[]): ChunkWant[] {
  const at = new Map<string, number>();
  const out: ChunkWant[] = [];
  for (const item of list) {
    const k = chunkKey(item.cx, item.cy);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push({ cx: item.cx, cy: item.cy, priority: item.priority });
    } else if (item.priority < out[i].priority) {
      out[i].priority = item.priority;
    }
  }
  return out;
}

function parseWorkerMessage(data: unknown): FromWorker | null {
  if (typeof data !== "object" || data === null) return null;
  const rec = data as { type?: unknown; id?: unknown; cx?: unknown; cy?: unknown; px?: unknown; ms?: unknown; message?: unknown };
  if (rec.type === "ready") return { type: "ready" };
  if (rec.type === "error" && typeof rec.message === "string") return { type: "error", message: rec.message };
  if (
    rec.type === "baked" &&
    typeof rec.id === "number" &&
    typeof rec.cx === "number" &&
    typeof rec.cy === "number" &&
    rec.px instanceof Uint32Array &&
    typeof rec.ms === "number"
  ) {
    return { type: "baked", id: rec.id, cx: rec.cx, cy: rec.cy, px: rec.px, ms: rec.ms };
  }
  return null;
}

export function createPool(spawn: () => WorkerLike, size: number, init: { url: string; mask: Uint8Array }): BakePool {
  const slots: Slot[] = [];
  let wishes: ChunkWant[] = [];
  let baked = 0;
  let bakeMs = 0;
  let nextId = 0;
  let disposed = false;

  const pool: BakePool = {
    onBaked: null,
    onError: null,
    want(list) {
      if (disposed) return;
      wishes = collapse(list);
      dispatch();
    },
    stats() {
      let inFlight = 0;
      const busy = new Set<string>();
      for (const slot of slots) {
        if (!slot.job) continue;
        inFlight += 1;
        busy.add(chunkKey(slot.job.cx, slot.job.cy));
      }
      let queued = 0;
      for (const wish of wishes) if (!busy.has(chunkKey(wish.cx, wish.cy))) queued += 1;
      let workers = 0;
      for (const slot of slots) if (!slot.stopped) workers += 1;
      return { inFlight, queued, baked, bakeMs, workers };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const slot of slots) {
        slot.stopped = true;
        slot.ready = false;
        slot.job = null;
        slot.worker.terminate();
      }
      wishes = [];
    },
  };

  function removeWish(cx: number, cy: number): void {
    const k = chunkKey(cx, cy);
    wishes = wishes.filter((wish) => chunkKey(wish.cx, wish.cy) !== k);
  }

  function dispatch(): void {
    if (disposed) return;
    const busy = new Set<string>();
    for (const slot of slots) if (slot.job) busy.add(chunkKey(slot.job.cx, slot.job.cy));
    for (const slot of slots) {
      if (slot.stopped || !slot.ready || slot.job) continue;
      let best: ChunkWant | null = null;
      for (const wish of wishes) {
        if (busy.has(chunkKey(wish.cx, wish.cy))) continue;
        if (best === null || wish.priority < best.priority) best = wish;
      }
      if (best === null) return;
      nextId += 1;
      const id = nextId;
      slot.job = { id, cx: best.cx, cy: best.cy };
      busy.add(chunkKey(best.cx, best.cy));
      const msg: ToWorker = { type: "bake", id, cx: best.cx, cy: best.cy };
      slot.worker.postMessage(msg);
    }
  }

  function onMessage(slot: Slot, data: unknown): void {
    if (disposed || slot.stopped) return;
    const msg = parseWorkerMessage(data);
    if (!msg) return;
    if (msg.type === "ready") {
      slot.ready = true;
      dispatch();
      return;
    }
    if (msg.type === "error") {
      fail(slot, msg.message);
      return;
    }
    deliver(slot, msg);
  }

  function deliver(slot: Slot, msg: { id: number; cx: number; cy: number; px: Uint32Array; ms: number }): void {
    const job = slot.job;
    if (!job || job.id !== msg.id) return;
    slot.job = null;
    removeWish(job.cx, job.cy);
    try {
      pool.onBaked?.(msg.cx, msg.cy, msg.px);
    } finally {
      if (!disposed) {
        baked += 1;
        bakeMs += msg.ms;
        dispatch();
      }
    }
  }

  function fail(slot: Slot, message: string): void {
    if (slot.stopped || disposed) return;
    slot.stopped = true;
    slot.ready = false;
    // Dropping the job returns it to the queue when it is still on the wish list.
    slot.job = null;
    try {
      pool.onError?.(message);
    } finally {
      slot.worker.terminate();
    }
    if (disposed) return;
    if (!slot.replacement) startWorker(true);
    dispatch();
  }

  function startWorker(replacement: boolean): void {
    const worker = spawn();
    const slot: Slot = { worker, ready: false, job: null, replacement, stopped: false };
    slots.push(slot);
    worker.onmessage = (e) => onMessage(slot, e.data);
    worker.onerror = (e) => fail(slot, e?.message || "the bake worker failed");
    const msg: ToWorker = { type: "init", url: init.url, mask: init.mask };
    worker.postMessage(msg);
  }

  for (let i = 0; i < size; i++) startWorker(false);
  return pool;
}
