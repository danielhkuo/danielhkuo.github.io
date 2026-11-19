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
  "start@0.7": "829b3edc0dc092f78a65bc4533128524b8e2d2e66f842303fa245b6b470a188d",
  "start@2.3": "a72a1a5d0cf11ca649e682b85dc651cfb2a74f475bfc69c0341104873a3b1bc2",
  "start@5.1": "8af21f0340cb4c8266dfbad54bb24db5acb64cad65fc9c56d3d660cc798366c8",
  "sea@0.7": "45d6adcf155afd19fda8960411b3664af9d0ea706f40c568bda4d2cc81e2a381",
  "sea@2.3": "1406d71960e5c6dc0c644e91e3e828e04f6953a2ae0462e5c97104012e9a9880",
  "sea@5.1": "a81cb884aaa7a2cbe206a26a4d9963991922c9c1fc8d7c4cb7720e27af1e6c51",
  "falls@0.7": "d61684ad0ba8f980274ecbdd4ef67024752b68fe57c19a6b9a0863c983e458bd",
  "falls@2.3": "3febdb3a40bc66b6a892d19ef3ddcf99bc0eee439a1353d762aee9c592b3f781",
  "falls@5.1": "2334585af2c06d2561034fc9a7d9885676a63ed2d1f089f6bad8161a64e4fe0d",
  "peak@0.7": "5e22d6245940ba27fd70bbde29fccd32867394394d39410fcf7607fe94026975",
  "peak@2.3": "8d8508004d5625fa684a002c107fe40fbd0502395fa9cc1c0d8cabc416029485",
  "peak@5.1": "b44086e8ff0a081c53f301b9cec7e031fe5c45f93815a667495674ba28917967"
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
