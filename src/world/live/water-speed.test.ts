// The water layer's speed pass: the output must stay byte-identical to what Fable's version drew (golden hashes taken
// before the pass), while the cost drops.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { namedViews, renderStrip } from "../cli/live.ts";
import type { LiveFrame } from "./live.ts";
import { waterLayer } from "./water.ts";

const VIEWS = ["start", "sea", "falls", "peak"] as const;
const TIMES = [0.7, 2.3, 5.1] as const;
/**
 * sha256 of `out` after the water layer, per view and time. Taken before the speed pass; retaken on the 2026-11-18
 * terrain polish, which repaints the land under the water (snow light, rock beds, upland colours) but not the water.
 */
const GOLDEN: Record<string, string> = {
  "start@0.7": "fc89a5d6f40a349a763e0ecc76d8788a8dd93b994bae4bcbb08ef7f497d63894",
  "start@2.3": "9cfcbb73843ba4294b43e31f7b1d7e97fb955acbc9b04b8db0b0a439665f328a",
  "start@5.1": "48473802dd5ded90e9d32e04cf5960decc50d2c0fa6e16b12d2f3142d5327008",
  "sea@0.7": "4b76683e3c189cbdd9b5ac501740a4f2ca4d4115e81f0265c0f734696ebafce8",
  "sea@2.3": "45ecac0f7c1991888e343d8c49bad90874c62b5a426e031a6bb839d36463e864",
  "sea@5.1": "f7c82395b377b63e2f1c2eba144e3a71ce5c580e9bead25b210061d07f304c4a",
  "falls@0.7": "93a1b315c198999be52beb2cb7f01fca54ee8a6526172cf0379cde86158fdfd2",
  "falls@2.3": "b57fe9fa43cf867d653986264316422f984b8b913cf75019808305859bf3b705",
  "falls@5.1": "3f0e270b6ea75edfe491daf8f09d91bec18ada14cc37e1bef767f2e8c800651d",
  "peak@0.7": "73d55e13e00fd751323e15cbf22cba34bb91742750ce0c2aa93a168a5f05e3cb",
  "peak@2.3": "c1859466c3649dcbd7014bd5d7e30d8a0e80add4ea53865b5eb039143e3069eb",
  "peak@5.1": "9e099afd8a580736c377c08251296299533cb8609964ac2954a7978eb0176f26"
};

interface Fixture { frames: Record<string, LiveFrame>; seed: number }
let memo: Promise<Fixture> | null = null;
function fixture(): Promise<Fixture> {
  memo ??= (async () => {
    const root = process.cwd();
    const { worldId } = JSON.parse(readFileSync(join(root, "public/world/current.json"), "utf8")) as { worldId: string };
    const bin = new Uint8Array(readFileSync(join(root, "public/world", worldId, "world.bin")));
    const manifest = JSON.parse(readFileSync(join(root, "public/world", worldId, "manifest.json"), "utf8"));
    const mask = new Uint8Array(readFileSync(join(root, "public/world/bluenoise.bin")));
    const views = await namedViews(bin, manifest);
    const frames: Record<string, LiveFrame> = {};
    for (const name of VIEWS) {
      const grab = { name: "grab", draw: (f: LiveFrame) => { frames[name] = { ...f, out: f.out.slice(), bake: f.bake.slice(), rect: { ...f.rect } }; } };
      await renderStrip({ bin, manifest, mask, x: views[name].x, y: views[name].y, times: [0], layers: [grab], clouds: null });
    }
    return { frames, seed: manifest.seed as number };
  })();
  return memo;
}

const hash = (a: Uint32Array) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

test("the water layer draws exactly what it drew before the speed pass", async () => {
  const { frames, seed } = await fixture();
  const water = waterLayer(seed);
  for (const name of VIEWS) for (const t of TIMES) {
    const f = { ...frames[name], out: frames[name].out.slice(), t };
    water.draw(f);
    assert.equal(hash(f.out), GOLDEN[`${name}@${t}`], `${name} at t ${t}`);
  }
});

test("the water layer is no slower than before on real views", async () => {
  const { frames, seed } = await fixture();
  const water = waterLayer(seed);
  for (const name of VIEWS) {
    const times: number[] = [];
    for (let k = 0; k < 120; k++) {
      const f = { ...frames[name], out: frames[name].out.slice(), t: 0.7 + k / 60 };
      const t0 = performance.now();
      water.draw(f);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[60];
    // Measured before the dry-land exit: about 0.65 ms on coasts and 1.05 ms on open sea. A faster wet path would change
    // the look (see the roadmap backlog), so these limits only guard against getting slower.
    const limit = name === "sea" ? 1.4 : 1.0;
    assert.ok(median <= limit, `${name}: median ${median.toFixed(3)} ms, limit ${limit}`);
  }
});

test("over dry land the water layer returns at once", async () => {
  const { frames, seed } = await fixture();
  const water = waterLayer(seed);
  const f0 = frames.peak;
  // Every pixel meadow (material 48): no water anywhere.
  const dry = { ...f0, out: f0.out.slice(), bake: new Uint32Array(f0.bake.length).fill((48 | (9 << 8)) >>> 0) };
  const before = dry.out.slice();
  const times: number[] = [];
  for (let k = 0; k < 120; k++) {
    const t0 = performance.now();
    water.draw({ ...dry, t: k / 60 });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.deepEqual(dry.out, before, "nothing drawn");
  assert.ok(times[60] <= 0.15, `median ${times[60].toFixed(3)} ms`);
});
