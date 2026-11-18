import assert from "node:assert/strict";
import { test } from "node:test";
import { createPool, type BakePool, type ChunkWant, type FromWorker, type WorkerLike } from "./pool.ts";

class FakeWorker implements WorkerLike {
  sent: unknown[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: FromWorker): void {
    this.onmessage?.({ data });
  }
  bakes(): { id: number; cx: number; cy: number }[] {
    return this.sent.filter((m) => (m as { type: string }).type === "bake") as { id: number; cx: number; cy: number }[];
  }
  /** Answers this worker's last bake request. */
  finish(ms = 5): void {
    const b = this.bakes().at(-1)!;
    this.reply({ type: "baked", id: b.id, cx: b.cx, cy: b.cy, px: new Uint32Array(4), ms });
  }
}

const MASK = new Uint8Array(16);
const INIT = { url: "/world/abc/world.bin", mask: MASK };

function setup(size: number, ready = true): { pool: BakePool; workers: FakeWorker[]; baked: string[]; errors: string[] } {
  const workers: FakeWorker[] = [];
  const pool = createPool(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  }, size, INIT);
  const baked: string[] = [], errors: string[] = [];
  pool.onBaked = (cx, cy) => baked.push(`${cx},${cy}`);
  pool.onError = (m) => errors.push(m);
  if (ready) for (const w of workers) w.reply({ type: "ready" });
  return { pool, workers, baked, errors };
}

const want = (...keys: [number, number, number][]): ChunkWant[] => keys.map(([cx, cy, priority]) => ({ cx, cy, priority }));
const allBakes = (workers: FakeWorker[]) => workers.flatMap((w) => w.bakes().map((b) => `${b.cx},${b.cy}`));

test("each worker is started with the world's address and the mask", () => {
  const { workers } = setup(3, false);
  assert.equal(workers.length, 3);
  for (const w of workers) assert.deepEqual(w.sent[0], { type: "init", url: INIT.url, mask: MASK });
});

test("nothing is sent to a worker before it is ready", () => {
  const { pool, workers } = setup(1, false);
  pool.want(want([0, 0, 0]));
  assert.equal(workers[0].bakes().length, 0);
  workers[0].reply({ type: "ready" });
  assert.deepEqual(allBakes(workers), ["0,0"]);
});

test("never more than one job per worker", () => {
  const { pool, workers } = setup(2);
  pool.want(want([0, 0, 0], [1, 0, 1], [2, 0, 2], [3, 0, 3], [4, 0, 4]));
  assert.equal(workers[0].bakes().length, 1);
  assert.equal(workers[1].bakes().length, 1);
  assert.equal(pool.stats().inFlight, 2);
  assert.equal(pool.stats().queued, 3);
  workers[0].finish();
  assert.equal(workers[0].bakes().length, 2);
  assert.equal(workers[1].bakes().length, 1);
});

test("jobs go out in priority order", () => {
  const { pool, workers } = setup(1);
  pool.want(want([1, 1, 5], [2, 2, 1], [3, 3, 3]));
  workers[0].finish();
  workers[0].finish();
  assert.deepEqual(allBakes(workers), ["2,2", "3,3", "1,1"]);
});

test("want() drops queued jobs no longer wanted, and jobs in flight still arrive", () => {
  const { pool, workers, baked } = setup(1);
  pool.want(want([0, 0, 0], [1, 0, 1], [2, 0, 2]));
  pool.want(want([2, 0, 0]));
  assert.equal(pool.stats().queued, 1);
  workers[0].finish();
  assert.deepEqual(baked, ["0,0"]);
  workers[0].finish();
  assert.deepEqual(allBakes(workers), ["0,0", "2,0"]);
  assert.deepEqual(baked, ["0,0", "2,0"]);
});

test("a chunk is never requested twice while queued or in flight", () => {
  const { pool, workers } = setup(1);
  pool.want(want([0, 0, 0], [0, 0, 4], [1, 0, 1]));
  assert.equal(pool.stats().queued, 1, "duplicates collapse");
  pool.want(want([0, 0, 0], [1, 0, 1], [1, 0, 2]));
  assert.equal(pool.stats().queued, 1);
  workers[0].finish();
  workers[0].finish();
  assert.deepEqual(allBakes(workers), ["0,0", "1,0"]);
});

test("a failing worker is reported and replaced once", () => {
  const { pool, workers, errors, baked } = setup(1);
  pool.want(want([5, 5, 0]));
  workers[0].reply({ type: "error", message: "out of memory" });
  assert.deepEqual(errors, ["out of memory"]);
  assert.ok(workers[0].terminated);
  assert.equal(workers.length, 2, "one replacement");
  assert.deepEqual(workers[1].sent[0], { type: "init", url: INIT.url, mask: MASK });
  workers[1].reply({ type: "ready" });
  assert.deepEqual(workers[1].bakes().map((b) => `${b.cx},${b.cy}`), ["5,5"], "the lost job goes to the replacement");
  workers[1].finish();
  assert.deepEqual(baked, ["5,5"]);
  pool.want(want([6, 6, 0]));
  workers[1].reply({ type: "error", message: "again" });
  assert.deepEqual(errors, ["out of memory", "again"]);
  assert.equal(workers.length, 2, "no second replacement");
});

test("after dispose every worker is stopped and nothing more is delivered", () => {
  const { pool, workers, baked } = setup(2);
  pool.want(want([0, 0, 0], [1, 0, 0]));
  pool.dispose();
  for (const w of workers) assert.ok(w.terminated);
  workers[0].finish();
  assert.deepEqual(baked, []);
});

test("stats count chunks baked and the time spent", () => {
  const { pool, workers } = setup(1);
  pool.want(want([0, 0, 0], [1, 0, 1]));
  workers[0].finish(7);
  workers[0].finish(9);
  const s = pool.stats();
  assert.deepEqual([s.baked, s.bakeMs, s.inFlight, s.queued, s.workers], [2, 16, 0, 0, 1]);
});

test("a worker whose script fails to load is reported and replaced", () => {
  const { pool, workers, errors } = setup(1, false);
  pool.want(want([3, 3, 0]));
  workers[0].onerror?.({ message: "script failed" });
  assert.deepEqual(errors, ["script failed"]);
  assert.ok(workers[0].terminated);
  assert.equal(workers.length, 2);
  workers[1].reply({ type: "ready" });
  assert.deepEqual(workers[1].bakes().map((b) => `${b.cx},${b.cy}`), ["3,3"]);
});

test("stats count the workers still alive", () => {
  const { pool, workers } = setup(2);
  assert.equal(pool.stats().workers, 2);
  workers[0].reply({ type: "error", message: "a" });
  assert.equal(pool.stats().workers, 2, "replaced");
  workers[2].reply({ type: "ready" });
  workers[2].reply({ type: "error", message: "b" });
  assert.equal(pool.stats().workers, 1, "a replacement is not replaced");
  workers[1].onerror?.({});
  workers[3].reply({ type: "error", message: "c" });
  assert.equal(pool.stats().workers, 0);
});
