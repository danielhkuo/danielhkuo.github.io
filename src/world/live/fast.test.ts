// The water's and the wind's fast paths against their plain ones, on the same frames: a generated world baked with the
// real look and flown over (slides, still frames, jumps, land the view vouches for and land it does not), and frames
// of random bake pixels that reach every branch.

import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeChunk, tileCache } from "../bake/chunk.ts";
import { worldLook } from "../bake/look.ts";
import { isCanopy, isGrass, MATERIAL as M } from "../look/materials.ts";
import { compose, type ViewRect } from "../render/compose.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { generatedWorld, loadMask } from "../testing/bakefix.ts";
import type { LiveFrame, LiveLayer } from "./live.ts";
import { waterLayer } from "./water.ts";
import { windLayer } from "./wind.ts";

const W = 400, H = 225;
const palette = buildPalette(MIDDAY);
const mask = loadMask();

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

let baked: ((cx: number, cy: number) => Uint32Array) | null = null;
/** Chunks of the generated world (1280 cells), baked with the real look, wrapped round the torus. */
function worldChunks(): (cx: number, cy: number) => Uint32Array {
  if (baked) return baked;
  const world = generatedWorld();
  const look = worldLook(world.n, palette);
  const tiles = tileCache(world, look, mask, 24);
  const px = world.n / 256, py = world.n / 320;
  const memo = new Map<string, Uint32Array>();
  baked = (cx, cy) => {
    const wx = ((cx % px) + px) % px, wy = ((cy % py) + py) % py, key = `${wx},${wy}`;
    let chunk = memo.get(key);
    if (!chunk) memo.set(key, (chunk = bakeChunk(world, look, mask, tiles, wx, wy)));
    return chunk;
  };
  return baked;
}

/** The world's land at `rect`, composed, as a layer is handed it. */
function worldFrame(rect: ViewRect, t: number, bakeVersion: number | undefined): LiveFrame {
  const out = new Uint32Array(W * H), bake = new Uint32Array(W * H);
  compose(worldChunks(), palette, rect, out, undefined, undefined, bake);
  return { out, bake, rect, t, palette, n: 1280, bakeVersion };
}

/** Runs both layers on copies of the same frame; their pictures must match. Returns the pixels they changed. */
function same(fast: LiveLayer, plain: LiveLayer, f: LiveFrame, label: string): number {
  const a = { ...f, out: f.out.slice() }, b = { ...f, out: f.out.slice() };
  fast.draw(a);
  plain.draw(b);
  assert.deepEqual(a.out, b.out, label);
  let changed = 0;
  for (let i = 0; i < a.out.length; i++) if (a.out[i] !== f.out[i]) changed++;
  return changed;
}

/** A flight over the generated world: rects and times, mostly short slides. */
function flight(seed: number, frames: number): { rect: ViewRect; t: number; version: number | undefined }[] {
  const next = rng(seed);
  const out: { rect: ViewRect; t: number; version: number | undefined }[] = [];
  let x = 300, y = 200, t = 3, version = 1;
  for (let k = 0; k < frames; k++) {
    const r = next();
    if (r < 0.03) { x += Math.floor((next() - 0.5) * 900); y += Math.floor((next() - 0.5) * 700); }
    else if (r > 0.25) { x += Math.floor((next() - 0.5) * 7); y += Math.floor((next() - 0.5) * 7); }
    if (next() < 0.05) version++;
    t += next() < 0.1 ? next() * 3 : 1 / 60;
    // Sometimes the view does not vouch for its land, and the layer must compare it.
    out.push({ rect: { x, y, w: W, h: H }, t, version: next() < 0.15 ? undefined : version });
  }
  return out;
}

test("the water's fast path draws exactly what its plain path draws over a flown world", () => {
  const fast = waterLayer(7), plain = waterLayer(7, { plain: true });
  let changed = 0, sea = 0, river = 0;
  for (const [k, s] of flight(41, 260).entries()) {
    const f = worldFrame(s.rect, s.t, s.version);
    for (let i = 0; i < f.bake.length; i++) {
      const m = f.bake[i] & 255;
      if (m === M.sea || m === M.seaClear) sea++;
      else if (m === M.river) river++;
    }
    changed += same(fast, plain, f, `frame ${k} at ${s.rect.x},${s.rect.y} t ${s.t.toFixed(3)}`);
  }
  assert.ok(sea > 1e5 && river > 1e3 && changed > 1e4, `sea ${sea}, river ${river}, pixels drawn ${changed}`);
});

test("the wind's fast path draws exactly what its plain path draws over a flown world", () => {
  const fast = windLayer(7), plain = windLayer(7, { plain: true });
  let changed = 0;
  for (const [k, s] of flight(43, 160).entries()) changed += same(fast, plain, worldFrame(s.rect, s.t, s.version), `frame ${k}`);
  assert.ok(changed > 1e4, `pixels drawn ${changed}`);
});

/** Random bake pixels: water, falls, grass and crowns among other land, any light, any depth. */
function randomFrame(next: () => number, rect: ViewRect, t: number): LiveFrame {
  const grass: number[] = [], crowns: number[] = [];
  for (let m = 0; m < 256; m++) {
    if (isGrass[m] === 1) grass.push(m);
    if (isCanopy[m] === 1) crowns.push(m);
  }
  const kinds = [M.sea, M.seaClear, M.lake, M.river, M.river, M.sand, M.shingle, M.rockHard, M.none, grass[0], grass[grass.length - 1], crowns[0]];
  const bake = new Uint32Array(W * H), out = new Uint32Array(W * H);
  // Runs of one material, so shores and falls form, with depths that climb down the frame.
  let m = kinds[0];
  for (let i = 0; i < bake.length; i++) {
    if (next() < 0.15) m = kinds[Math.floor(next() * kinds.length)];
    const light = next() < 0.3 ? 12 + Math.floor(next() * 4) : Math.floor(next() * 256);
    const depth = Math.floor(i / W) * 10 + Math.floor(next() * 12);
    bake[i] = (m | (light << 8) | (depth << 16)) >>> 0;
    out[i] = palette[(m << 8) | light];
  }
  return { out, bake, rect, t, palette, n: 1280 };
}

test("on random land both layers' fast paths draw what their plain paths draw", () => {
  const next = rng(29);
  const water = waterLayer(3), waterPlain = waterLayer(3, { plain: true });
  const wind = windLayer(3), windPlain = windLayer(3, { plain: true });
  for (let k = 0; k < 40; k++) {
    const rect = { x: Math.floor((next() - 0.5) * 5000), y: Math.floor((next() - 0.5) * 5000), w: W, h: H };
    const f = randomFrame(next, rect, next() * 100);
    same(water, waterPlain, f, `water ${k}`);
    same(wind, windPlain, f, `wind ${k}`);
  }
});
