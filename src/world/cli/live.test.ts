import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { LiveLayer } from "../live/live.ts";
import { matOf } from "../live/pixel.ts";
import { makeLayers } from "../live/registry.ts";
import type { Manifest } from "../pack/manifest.ts";
import { namedViews, renderStrip } from "./live.ts";

const root = process.cwd();
function shipped(): { bin: Uint8Array; manifest: Manifest; mask: Uint8Array } {
  const { worldId } = JSON.parse(readFileSync(join(root, "public/world/current.json"), "utf8")) as { worldId: string };
  return {
    bin: new Uint8Array(readFileSync(join(root, "public/world", worldId, "world.bin"))),
    manifest: JSON.parse(readFileSync(join(root, "public/world", worldId, "manifest.json"), "utf8")) as Manifest,
    mask: new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin"))),
  };
}

test("the registry gives a list of layers, each with a name", () => {
  const { manifest } = shipped();
  const layers = makeLayers({ seed: manifest.seed, n: manifest.n, sites: manifest.sites });
  assert.ok(Array.isArray(layers));
  for (const l of layers) assert.equal(typeof l.name, "string");
});

test("named views lie on the world and include the waterfall", async () => {
  const { bin, manifest } = shipped();
  const views = await namedViews(bin, manifest);
  for (const name of ["start", "town", "abbey", "falls", "river", "peak", "sea"]) {
    const v = views[name];
    assert.ok(v, name);
    assert.ok(v.x >= 0 && v.x < manifest.n && v.y >= 0 && v.y < manifest.n, `${name} at ${v.x}, ${v.y}`);
  }
  assert.deepEqual([views.start.x, views.start.y], [manifest.start.x, manifest.start.y]);
});

test("a strip is fully baked land, one frame per time, and layers move it", async () => {
  const { bin, manifest, mask } = shipped();
  // A layer that marks the first water pixel with a colour that depends on t.
  let sawWater = false;
  const tick: LiveLayer = {
    name: "tick",
    draw: (f) => {
      for (let i = 0; i < f.bake.length; i++) {
        const m = matOf(f.bake[i]);
        if (m >= 1 && m <= 4) { sawWater = true; f.out[i] = (0xff000000 | Math.round(f.t * 100)) >>> 0; break; }
      }
    },
  };
  const frames = await renderStrip({ bin, manifest, mask, x: manifest.start.x, y: manifest.start.y, times: [0, 0.5], layers: [tick], clouds: null });
  assert.equal(frames.length, 2);
  for (const f of frames) assert.equal(f.length, 400 * 225);
  assert.ok(sawWater, "the start view has water");
  assert.notDeepEqual(frames[0], frames[1]);
});
