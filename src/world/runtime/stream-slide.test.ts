// The stream view's kept land against composing the whole view every frame, on the same flight: the camera slides,
// jumps and wraps, chunks arrive late and are dropped, and a live layer blends over what it is handed.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveFrame, LiveLayer } from "../live/live.ts";
import type { FlightData } from "../pack/world.ts";
import { buildPalette } from "../render/palette.ts";
import { fieldWorld, loadMask } from "../testing/bakefix.ts";
import type { BakePool, ChunkWant } from "./pool.ts";
import { createStreamView, type StreamView } from "./stream.ts";

const N = 1280, W = 400, H = 225;
const palette = buildPalette({ time: 0.5, season: 0.25, overcast: 0 });
const mask = loadMask();
const world = fieldWorld(N, (x, y) => 10 + 8 * Math.sin(x / 90) + 6 * Math.cos(y / 70));
const data: FlightData = { n: N, gN: world.gN, ground: world.ground, occlusion: new Uint8Array(0), block: 0 };

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Chunk (cx, cy) of a made-up land: every pixel a material, a light byte and a depth, the same each time it is baked. */
function chunkPixels(cx: number, cy: number): Uint32Array {
  const next = rng(cx * 92821 + cy * 68917 + 5);
  const px = new Uint32Array(256 * 256);
  for (let i = 0; i < px.length; i++) px[i] = ((Math.floor(next() * 64) + 1) | (Math.floor(next() * 256) << 8) | ((i >> 8) << 16)) >>> 0;
  return px;
}

/** Bakes what it is asked for, a few chunks at a time when told to, lowest priority first. */
class SlowPool implements BakePool {
  onBaked: ((cx: number, cy: number, px: Uint32Array) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  wanted: ChunkWant[] = [];
  want(list: readonly ChunkWant[]): void {
    this.wanted = [...list].sort((a, b) => a.priority - b.priority || a.cy - b.cy || a.cx - b.cx);
  }
  deliver(count: number): void {
    for (const w of this.wanted.splice(0, count)) this.onBaked?.(w.cx, w.cy, chunkPixels(w.cx, w.cy));
  }
  stats() {
    return { inFlight: 0, queued: this.wanted.length, baked: 0, bakeMs: 0, workers: 1 };
  }
  dispose(): void {}
}

/** A layer that reads what it is handed and blends a moving band over it, so it sees any difference in the land. */
function blendLayer(): LiveLayer {
  return {
    name: "blend",
    draw(f: LiveFrame) {
      const band = Math.floor(f.t * 37) % f.rect.h;
      for (let x = 0; x < f.rect.w; x++) {
        const i = band * f.rect.w + x, v = f.out[i];
        f.out[i] = ((v & 0xff000000) | ((v >>> 1) & 0x7f7f7f) | (f.bake[i] & 0x808080)) >>> 0;
      }
    },
  };
}

function view(pool: SlowPool, slideLand: boolean): StreamView {
  return createStreamView(data, pool, palette, mask, { width: W, height: H, cacheChunks: 9, layers: [blendLayer()], slideLand });
}

test("the kept land draws exactly what composing the whole view draws, frame after frame", () => {
  const next = rng(3);
  const poolA = new SlowPool(), poolB = new SlowPool();
  const kept = view(poolA, true), whole = view(poolB, false);
  const outA = new Uint32Array(W * H), outB = new Uint32Array(W * H);
  let x = 600, y = 500, slid = 0, haze = 0;
  for (let k = 0; k < 900; k++) {
    // Mostly short slides of the flight's pace, now and then a jump, and a long run across the torus's seam.
    const r = next();
    if (r < 0.03) { x += (next() - 0.5) * 2000; y += (next() - 0.5) * 2000; }
    else if (r < 0.2) { x += 0; y += 0; }
    else { x += (next() - 0.4) * 5; y += (next() - 0.45) * 5; }
    x = ((x % N) + N) % N;
    y = ((y % N) + N) % N;
    for (const v of [kept, whole]) {
      v.setCamera(x, y);
      v.update(0, 0);
    }
    // The pools bake the same chunks at the same moments, sometimes none for a while.
    const count = next() < 0.6 ? 0 : Math.floor(next() * 4);
    poolA.deliver(count);
    poolB.deliver(count);
    kept.frame(outA, k / 60);
    whole.frame(outB, k / 60);
    assert.deepEqual(outA, outB, `frame ${k}`);
    assert.deepEqual(kept.bakeFrame(), whole.bakeFrame(), `frame ${k}: bake pixels`);
    assert.equal(kept.cached(), whole.cached(), `frame ${k}: chunks held`);
    if (!kept.ready()) haze++;
    else slid++;
  }
  assert.ok(haze > 50 && slid > 300, `frames with haze ${haze}, without ${slid}`);
});

test("a view resized mid-flight draws what a view made at the new size draws, and keeps its chunks", () => {
  const sizes: [number, number][] = [[400, 225], [384, 216], [427, 240], [200, 300], [400, 225]];
  const pool = new SlowPool();
  const resized = createStreamView(data, pool, palette, mask, { width: W, height: H, layers: [blendLayer()] });
  let x = 600, y = 500;
  for (let k = 0; k < sizes.length * 12; k++) {
    const [w, h] = sizes[Math.floor(k / 12)];
    resized.resize(w, h);
    x += 3;
    y += 2;
    resized.setCamera(x, y);
    resized.update(0, 0);
    pool.deliver(100);
    const got = new Uint32Array(w * h);
    resized.frame(got, k / 30);
    // A view made at this size, fed the same chunks.
    const freshPool = new SlowPool();
    const fresh = createStreamView(data, freshPool, palette, mask, { width: w, height: h, layers: [blendLayer()] });
    fresh.setCamera(x, y);
    fresh.update(0, 0);
    freshPool.deliver(100);
    const want = new Uint32Array(w * h);
    fresh.frame(want, k / 30);
    assert.deepEqual(resized.rect(), fresh.rect(), `frame ${k}: the same rect at ${w}x${h}`);
    assert.ok(Buffer.from(got.buffer).equals(Buffer.from(want.buffer)), `frame ${k}: the same pixels at ${w}x${h}`);
    assert.equal(resized.bakeFrame().length, w * h);
  }
  assert.ok(resized.cached() > 0 && resized.ready(), "its chunks were kept");
});
