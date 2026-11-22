// The compositor's fast paths against plain ones on the same input: the paper grain's tables against its formula, and
// composing a frame in pieces against composing it whole.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHUNK, compose, composeArea, GRAIN_SETTLE, GRAIN_SHOW, grainTile, paperGrain, type ViewRect } from "./compose.ts";

const mask = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../public/world/bluenoise.bin", import.meta.url))));

/** The grain as a formula, pixel by pixel: where the tooth stands proud the cream shows through, in a hollow the pigment settles. */
function grainPlain(out: Uint32Array, view: ViewRect): void {
  const grain = grainTile(mask);
  const cream = [0xf0, 0xe8, 0xd2];
  for (let r = 0; r < view.h; r++) for (let c = 0; c < view.w; c++) {
    const g = grain[((view.y + r) & 255) * 256 + ((view.x + c) & 255)];
    if (g === 0) continue;
    const v = out[r * view.w + c];
    let R = v & 255, G = (v >>> 8) & 255, B = (v >>> 16) & 255;
    if (g > 0) {
      const k = (g * GRAIN_SHOW) >> 7;
      R += ((cream[0] - R) * k) >> 8;
      G += ((cream[1] - G) * k) >> 8;
      B += ((cream[2] - B) * k) >> 8;
    } else {
      const k = 256 + ((g * GRAIN_SETTLE) >> 7);
      R = (R * (k + 2)) >> 8;
      G = (G * k) >> 8;
      B = (B * (k - 2)) >> 8;
    }
    out[r * view.w + c] = ((v & 0xff000000) | (B << 16) | (G << 8) | R) >>> 0;
  }
}

/** A small seeded generator (xorshift), so the inputs are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

test("the paper grain's tables draw exactly what its formula draws, for every colour and grain", () => {
  const next = rng(11);
  // Every value of every channel, under every grain value the tile holds, in frames placed all over the sheet.
  for (const view of [{ x: 0, y: 0, w: 256, h: 256 }, { x: -1000, y: -37, w: 400, h: 225 }, { x: 99, y: 70001, w: 133, h: 61 }]) {
    const a = new Uint32Array(view.w * view.h);
    for (let i = 0; i < a.length; i++) {
      const c = i & 255;
      a[i] = (Math.floor(next() * 256) << 24 | ((c + 85) & 255) << 16 | ((c * 7) & 255) << 8 | c) >>> 0;
    }
    const b = a.slice();
    paperGrain(a, view, mask);
    grainPlain(b, view);
    assert.deepEqual(a, b, `view at ${view.x},${view.y}`);
  }
});

const palette = new Uint32Array(65536);
for (let i = 0; i < palette.length; i++) palette[i] = (0xff000000 | (i * 2654435761)) >>> 0;
/** Chunk (cx, cy) as hashed bake pixels; null for chunks listed as missing. */
function chunks(missing: Set<string>) {
  const made = new Map<string, Uint32Array>();
  return (cx: number, cy: number): Uint32Array | null => {
    const key = `${cx},${cy}`;
    if (missing.has(key)) return null;
    let px = made.get(key);
    if (!px) {
      const next = rng(cx * 7919 + cy * 104729 + 3);
      px = new Uint32Array(CHUNK * CHUNK);
      for (let i = 0; i < px.length; i++) px[i] = Math.floor(next() * 4294967296) >>> 0;
      made.set(key, px);
    }
    return px;
  };
}

test("composing a frame in pieces draws what composing it whole draws, haze and bake pixels too", () => {
  const view: ViewRect = { x: 250, y: -130, w: 400, h: 225 };
  const source = chunks(new Set(["1,-1", "2,0"]));
  const haze = (bx: number, by: number) => (0xff000000 | ((bx * 31 + by * 17) & 0xffffff)) >>> 0;
  const whole = new Uint32Array(view.w * view.h), wholeBake = new Uint32Array(view.w * view.h);
  compose(source, palette, view, whole, undefined, haze, wholeBake);
  const parts = new Uint32Array(view.w * view.h), partsBake = new Uint32Array(view.w * view.h);
  // Strips that cover the frame once, cut across chunk edges.
  const pieces: [number, number, number, number][] = [[0, 0, 400, 3], [0, 3, 7, 225], [7, 3, 400, 100], [7, 100, 393, 225], [393, 100, 400, 225]];
  let whole2 = true;
  for (const [x0, y0, x1, y1] of pieces) whole2 = composeArea(source, palette, view, parts, x0, y0, x1, y1, haze, partsBake) && whole2;
  assert.deepEqual(parts, whole);
  assert.deepEqual(partsBake, wholeBake);
  assert.equal(whole2, false, "a chunk was missing");
  assert.equal(composeArea(chunks(new Set()), palette, view, parts, 0, 0, 400, 225), true, "every chunk there");
});

test("an area asks for each chunk under it once, rows of chunks top to bottom", () => {
  const asked: string[] = [];
  const source = chunks(new Set());
  composeArea((cx, cy) => { asked.push(`${cx},${cy}`); return source(cx, cy); }, palette, { x: 500, y: 200, w: 400, h: 225 }, new Uint32Array(400 * 225), 0, 0, 400, 225);
  assert.deepEqual(asked, ["1,0", "2,0", "3,0", "1,1", "2,1", "3,1"]);
});
