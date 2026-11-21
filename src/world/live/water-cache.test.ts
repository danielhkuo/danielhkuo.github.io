// Reusing the water layer's work between frames: as the camera moves a pixel or two a frame, the layer must draw what a
// fresh layer would (all but a sliver of pixels), for much less time.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { namedViews, renderStrip } from "../cli/live.ts";
import type { Manifest } from "../pack/manifest.ts";
import { readShipped } from "../pack/shipped.ts";
import { FIXTURE_WORLD } from "../testing/fixtureWorld.ts";
import type { LiveFrame } from "./live.ts";
import { waterLayer } from "./water.ts";

/** Frames of the start bay with the camera moved 0, 1, 2, … cells east and 0, 1, … south, at times a frame apart. */
interface Fixture { frames: LiveFrame[]; seed: number }
let memo: Promise<Fixture> | null = null;
function fixture(): Promise<Fixture> {
  memo ??= (async () => {
    const root = process.cwd();
    const { world, flight, manifest: shippedManifest } = await readShipped(FIXTURE_WORLD);
    const manifest = shippedManifest as unknown as Manifest;
    const mask = new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin")));
    const { start } = await namedViews(world, manifest);
    const frames: LiveFrame[] = [];
    const steps: [number, number][] = [[0, 0], [1, 0], [2, 1], [3, 1], [5, 2], [6, 4], [6, 4], [8, 5]];
    for (const [k, [dx, dy]] of steps.entries()) {
      let grabbed: LiveFrame | null = null;
      const grab = { name: "grab", draw: (f: LiveFrame) => { grabbed = { ...f, out: f.out.slice(), bake: f.bake.slice(), rect: { ...f.rect } }; } };
      await renderStrip({ world, flight, manifest, mask, x: start.x + dx, y: start.y + dy, times: [k / 60], layers: [grab], clouds: null });
      frames.push(grabbed!);
    }
    return { frames, seed: manifest.seed as number };
  })();
  return memo;
}

const differing = (a: Uint32Array, b: Uint32Array) => {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) k++;
  return k / a.length;
};

test("a layer kept across moving frames draws what a fresh layer draws, but for a sliver", async () => {
  const { frames, seed } = await fixture();
  const kept = waterLayer(seed);
  for (const [k, f] of frames.entries()) {
    const a = { ...f, out: f.out.slice() }, b = { ...f, out: f.out.slice() };
    kept.draw(a);
    waterLayer(seed).draw(b);
    const share = differing(a.out, b.out);
    assert.ok(share <= 0.003, `frame ${k}: ${(100 * share).toFixed(2)} % of pixels differ`);
  }
});

test("a still camera draws exactly what a fresh layer draws", async () => {
  const { frames, seed } = await fixture();
  const kept = waterLayer(seed);
  const f = frames[5];
  kept.draw({ ...f, out: f.out.slice() });
  const a = { ...frames[6], out: frames[6].out.slice() }, b = { ...frames[6], out: frames[6].out.slice() };
  kept.draw(a);
  waterLayer(seed).draw(b);
  assert.deepEqual(a.out, b.out);
});

test("kept across a moving flight, the layer costs under 0.4 ms a frame", async () => {
  const { frames, seed } = await fixture();
  const kept = waterLayer(seed);
  const times: number[] = [];
  for (let lap = 0; lap < 25; lap++) for (const f of frames) {
    const g = { ...f, out: f.out.slice() };
    const t0 = performance.now();
    kept.draw(g);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const median = times[times.length >> 1];
  assert.ok(median <= 0.4, `median ${median.toFixed(3)} ms`);
});
