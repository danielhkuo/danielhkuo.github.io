import assert from "node:assert/strict";
import { test } from "node:test";
import { groundAt } from "../bake/cells.ts";
import type { FlightData } from "../pack/world.ts";
import { PAPER } from "../render/compose.ts";
import { hazeOf } from "../render/haze.ts";
import { buildPalette } from "../render/palette.ts";
import { fieldWorld, loadMask } from "../testing/bakefix.ts";
import type { BakePool, ChunkWant } from "./pool.ts";
import { createStreamView, STREAM_CACHE } from "./stream.ts";

const N = 1280, W = 400, H = 225;
const palette = buildPalette({ time: 0.5, season: 0.25, overcast: 0 });
const mask = loadMask();
const height = (x: number, y: number) => 30 + 25 * Math.sin(x / 90) * Math.cos(y / 70) - (x > 900 ? 60 : 0);
const world = fieldWorld(N, height);

function flight(occlusion = new Uint8Array(0), block = 0): FlightData {
  return { n: N, gN: world.gN, ground: world.ground, occlusion, block };
}

/** Flat sea-level ground in every chunk: depth is the world row of each bake row, in eighths. */
function flatChunk(): Uint32Array {
  const px = new Uint32Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) px[r * 256 + c] = (5 | (9 << 8) | (Math.round((r / 0.8) * 8) << 16)) >>> 0;
  return px;
}

/** A pool that records every wish list and, when `instant`, bakes everything wanted at once. */
class FakePool implements BakePool {
  lists: ChunkWant[][] = [];
  requested = new Map<string, number>();
  onBaked: ((cx: number, cy: number, px: Uint32Array) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  instant: boolean;
  constructor(instant: boolean) {
    this.instant = instant;
  }
  want(list: readonly ChunkWant[]): void {
    this.lists.push([...list]);
    if (!this.instant) return;
    for (const w of list) {
      const k = `${w.cx},${w.cy}`;
      this.requested.set(k, (this.requested.get(k) ?? 0) + 1);
      this.onBaked?.(w.cx, w.cy, flatChunk());
    }
  }
  stats() {
    return { inFlight: 0, queued: 0, baked: 0, bakeMs: 0, workers: 1 };
  }
  dispose(): void {}
  last(): ChunkWant[] {
    return this.lists.at(-1) ?? [];
  }
}

test("nothing under the view is drawn as bare paper: the haze stands in", () => {
  const pool = new FakePool(false);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H, paper: false });
  view.setCamera(600, 500);
  view.update(60, 0);
  const out = new Uint32Array(W * H);
  view.frame(out);
  const haze = hazeOf(flight(), palette), r = view.rect();
  for (let i = 0; i < out.length; i++) assert.notEqual(out[i], PAPER, `pixel ${i}`);
  for (const [c, y] of [[0, 0], [199, 112], [399, 224]]) assert.equal(out[y * W + c], haze(r.x + c, r.y + y));
  assert.equal(view.ready(), false);
});

test("chunks under the view are wanted first, then ahead, then behind", () => {
  const pool = new FakePool(false);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H });
  view.setCamera(640, 640);
  view.update(60, 0);
  const list = pool.last();
  const r = view.rect();
  const prio = (cx: number, cy: number) => list.find((w) => w.cx === (cx + 5) % 5 && w.cy === (cy + 4) % 4)?.priority;
  const ux0 = Math.floor(r.x / 256), ux1 = Math.floor((r.x + W - 1) / 256), uy = Math.floor((r.y + 112) / 256);
  const under = prio(ux0, uy), ahead = prio(ux1 + 1, uy), behind = prio(ux0 - 1, uy);
  assert.ok(under !== undefined && ahead !== undefined && behind !== undefined, JSON.stringify(list));
  assert.ok(under < 1, `under ${under}`);
  assert.ok(ahead >= 1 && ahead < behind, `ahead ${ahead}, behind ${behind}`);
  for (const w of list) {
    assert.ok(w.cx >= 0 && w.cx < 5 && w.cy >= 0 && w.cy < 4, "wrapped coordinates");
  }
  assert.equal(new Set(list.map((w) => `${w.cx},${w.cy}`)).size, list.length, "each chunk once");
});

test("baked chunks are drawn, the view is ready, and they are not wanted again", () => {
  const pool = new FakePool(true);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H, paper: false });
  view.setCamera(640, 640);
  view.update(0, 0);
  assert.ok(view.ready());
  const out = new Uint32Array(W * H);
  view.frame(out);
  assert.equal(out[112 * W + 200], palette[(5 << 8) | 9]);
  view.update(0, 0);
  assert.equal(pool.last().length, 0);
});

test("the cache never holds more than its size over a long flight", () => {
  const pool = new FakePool(true);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H });
  let x = 100, y = 100;
  for (let step = 0; step < 600; step++) {
    x = (x + 6) % N;
    y = (y + 2.5) % N;
    view.setCamera(x, y);
    view.update(60, 25);
    assert.ok(view.cached() <= STREAM_CACHE, `${view.cached()} cached at step ${step}`);
  }
  const small = createStreamView(flight(), new FakePool(true), palette, mask, { width: W, height: H, cacheChunks: 12 });
  for (let step = 0; step < 200; step++) {
    small.setCamera((step * 6) % N, 300);
    small.update(60, 0);
    assert.ok(small.cached() <= 12);
  }
});

test("flying across the wrap keeps depth continuous and bakes nothing twice", () => {
  const pool = new FakePool(true);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H });
  // East across x = 0.
  let prev: number | null = null;
  for (let k = 0; k <= 40; k++) {
    const x = (N - 20 + k) % N;
    view.setCamera(x, 300);
    view.update(60, 0);
    const d = view.depthAt(200, 112);
    if (prev !== null) assert.ok(Math.abs(d - prev) < 2, `depth ${prev} then ${d} at x ${x}`);
    prev = d;
  }
  // South across y = 0: depth stays in step with the camera's row.
  let prevRel: number | null = null;
  for (let k = 0; k <= 40; k++) {
    const y = (N - 20 + k) % N;
    view.setCamera(300, y);
    view.update(0, 60);
    const rel = view.depthAt(200, 112) - y;
    if (prevRel !== null) assert.ok(Math.abs(rel - prevRel) < 2, `relative depth ${prevRel} then ${rel} at y ${y}`);
    prevRel = rel;
  }
  for (const [k, count] of pool.requested) assert.equal(count, 1, `chunk ${k} baked ${count} times`);
  assert.ok(Math.abs(view.depthAt(200, 112) - (view.rect().y + 112) / 0.8) < 1, "flat ground: depth is the bake row over 0.8");
});

test("groundHeight follows the bake's ground, never below the sea", () => {
  const view = createStreamView(flight(), new FakePool(false), palette, mask, { width: W, height: H });
  for (let k = 0; k < 100; k++) {
    const x = (k * 97.3) % N, y = (k * 53.9) % N;
    const want = Math.max(0, groundAt(world, x, y));
    assert.ok(Math.abs(view.groundHeight(x, y) - want) < 1e-4, `${x}, ${y}`);
  }
});

test("occlusionFloor reads the shipped blocks, wrapping", () => {
  const bN = N / 16, occ = new Uint8Array(bN * bN);
  occ[3 * bN + 7] = 42;
  const view = createStreamView(flight(occ, 16), new FakePool(false), palette, mask, { width: W, height: H });
  assert.equal(view.occlusionFloor(7 * 16 + 3, 3 * 16 + 15), 42);
  assert.equal(view.occlusionFloor(7 * 16 + 3 + N, 3 * 16 + 15 - N), 42);
  assert.equal(view.occlusionFloor(0, 0), 0);
  const none = createStreamView(flight(), new FakePool(false), palette, mask, { width: W, height: H });
  assert.equal(none.occlusionFloor(500, 500), 0);
});

test("sites come from the manifest, with no project yet", () => {
  const view = createStreamView(flight(), new FakePool(false), palette, mask, {
    width: W, height: H, sites: [{ id: "abbey-1", type: "abbey", x: 10, y: 20 }],
  });
  assert.deepEqual(view.sites(), [{ x: 10, y: 20, type: "abbey", project: null }]);
});

test("a new light composes the whole view again in the new palette, as a view made in that light would", () => {
  const night = buildPalette({ time: 0.92, season: 0.25, overcast: 0 });
  const cream = 0xff302820;
  const pool = new FakePool(true);
  const view = createStreamView(flight(), pool, palette, mask, { width: W, height: H });
  view.setCamera(640, 640);
  view.update(0, 0);
  const out = new Uint32Array(W * H);
  view.frame(out);
  // A short slide keeps the land; the new light must not be kept out by it.
  view.setCamera(643, 641);
  view.setLight(night, cream);
  view.frame(out);
  const fresh = createStreamView(flight(), new FakePool(true), night, mask, { width: W, height: H });
  fresh.setLight(night, cream);
  fresh.setCamera(643, 641);
  fresh.update(0, 0);
  const want = new Uint32Array(W * H);
  fresh.frame(want);
  assert.deepEqual(out, want);
  // The same light again changes nothing.
  view.setLight(night, cream);
  const again = new Uint32Array(W * H);
  view.frame(again);
  assert.deepEqual(again, want);
});
