// The sky's cull against placing every cloud, on the same input: the shipped-size sky and made-up skies whose clouds
// sit just inside, just outside and across the frame's edges and the torus's seam.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import { ALT, type Cloud, type CloudLayer, type SkyField } from "./field.ts";
import type { CloudShape } from "./shapes.ts";
import { createSky, drawClouds, drawShadows } from "./sky.ts";
import type { Sprite } from "./sprite.ts";
import { STYLES } from "./styles.ts";

const W = 400, H = 225;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A frame of noise, so a blend or a shadow anywhere shows. */
function noise(next: () => number): Uint32Array {
  const out = new Uint32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = (0xff000000 | Math.floor(next() * 0xffffff)) >>> 0;
  return out;
}

/** Every pass of the sky, culled and not, from the same frame: they must agree. Returns how many pixels changed. */
function samePasses(field: SkyField, shapes: readonly CloudShape[], sprites: readonly Sprite[], rect: ViewRect, t: number, next: () => number, label: string): number {
  const before = noise(next);
  let changed = 0;
  for (const layer of ["low", "bank"] as CloudLayer[]) {
    for (const alpha of [255, 140]) {
      const a = before.slice(), b = before.slice();
      drawClouds(a, rect, field, sprites, t, layer, alpha);
      drawClouds(b, rect, field, sprites, t, layer, alpha, false);
      assert.deepEqual(a, b, `${label}: ${layer} clouds at ${alpha}`);
      for (let i = 0; i < a.length; i++) if (a[i] !== before[i]) changed++;
    }
    const a = before.slice(), b = before.slice();
    drawShadows(a, rect, field, shapes, t, layer, [170, 175, 190]);
    drawShadows(b, rect, field, shapes, t, layer, [170, 175, 190], false);
    assert.deepEqual(a, b, `${label}: ${layer} shadows`);
    for (let i = 0; i < a.length; i++) if (a[i] !== before[i]) changed++;
  }
  return changed;
}

test("on a sky the size of the shipped world's, the cull draws exactly what placing every cloud draws", () => {
  const next = rng(17);
  const n = 10240;
  const sky = createSky(4, n, STYLES.cumulus, { x: 5000, y: 5000, dx: 1, dy: 0 });
  const sprites = sky.shapes.map((s) => STYLES.cumulus.paint(s));
  let changed = 0;
  for (let k = 0; k < 120; k++) {
    // Views anywhere, past the seam on either side, at times early and late.
    const rect = { x: Math.floor((next() - 0.25) * 1.5 * n), y: Math.floor((next() - 0.25) * 1.5 * n * 0.8), w: W, h: H };
    const t = next() < 0.5 ? next() * 30 : next() * 1e5;
    changed += samePasses(sky.field, sky.shapes, sprites, rect, t, next, `view ${k}`);
  }
  // The view of the start, where clouds are set for the first frame.
  changed += samePasses(sky.field, sky.shapes, sprites, { x: 4800, y: 4000 - 18 - 112, w: W, h: H }, 0, next, "start");
  assert.ok(changed > 1000, `pixels the clouds changed: ${changed}`);
});

test("clouds at the frame's edges and across the seam are culled exactly", () => {
  const next = rng(23);
  const n = 1280;
  // Plain boxes of a few sizes, with shadows thrown off to one side.
  const shapes: CloudShape[] = [];
  const sprites: Sprite[] = [];
  for (const [w, h] of [[1, 1], [7, 3], [40, 25], [130, 60]]) {
    const mask = new Uint8Array(w * h).fill(1);
    shapes.push({ kind: "puff", w, h, shadow: { dx: 3 - w, dy: 2, w, h, mask } } as unknown as CloudShape);
    sprites.push({ w, h, rgba: new Uint32Array(w * h).fill(0xfff0f0f0), alpha: new Uint8Array(w * h).fill(200) });
  }
  for (let k = 0; k < 400; k++) {
    const rect = { x: Math.floor((next() - 0.5) * 3 * n), y: Math.floor((next() - 0.5) * 3 * n), w: W, h: H };
    const clouds: Cloud[] = [];
    for (let c = 0; c < 30; c++) {
      const shape = Math.floor(next() * shapes.length), layer: CloudLayer = next() < 0.5 ? "low" : "bank";
      const s = shapes[shape];
      // A box whose edge lands within a pixel or two of the frame's, on some image of the torus.
      const edgeX = [rect.x - s.w, rect.x + W, rect.x][Math.floor(next() * 3)] + Math.floor((next() - 0.5) * 6) + Math.floor((next() - 0.5) * 4) * n;
      const edgeY = [rect.y - s.h, rect.y + H, rect.y][Math.floor(next() * 3)] + Math.floor((next() - 0.5) * 6) + ALT[layer];
      clouds.push({ shape, x: ((edgeX % n) + n) % n, y: (((edgeY / 0.8) % n) + n) % n, layer });
    }
    const field: SkyField = { n, clouds, wind: { x: (next() - 0.5) * 8, y: (next() - 0.5) * 8 } };
    samePasses(field, shapes, sprites, rect, next() * 50, next, `edges ${k}`);
  }
});

test("the sky's two passes draw what plain passes over the whole field draw", () => {
  const next = rng(31);
  const n = 10240, style = STYLES.cumulus;
  const sky = createSky(4, n, style, { x: 5000, y: 5000, dx: 0.6, dy: 0.8 });
  const sprites = sky.shapes.map((s) => style.paint(s));
  for (let k = 0; k < 60; k++) {
    const rect = k === 0 ? { x: 4800, y: 4000 - 18 - 112, w: W, h: H } : { x: Math.floor(next() * n), y: Math.floor(next() * n * 0.8), w: W, h: H };
    const t = next() * 400;
    const before = noise(next);
    const a = before.slice(), b = before.slice();
    sky.draw(a, rect, t, "below");
    sky.draw(a, rect, t, "above");
    drawShadows(b, rect, sky.field, sky.shapes, t, "bank", style.shadowKeep, false);
    drawShadows(b, rect, sky.field, sky.shapes, t, "low", style.shadowKeep, false);
    drawClouds(b, rect, sky.field, sprites, t, "low", 255, false);
    drawClouds(b, rect, sky.field, sprites, t, "bank", 255, false);
    drawClouds(b, rect, sky.field, sprites, t, "bank", style.veil, false);
    assert.deepEqual(a, b, `view ${k}`);
  }
});
