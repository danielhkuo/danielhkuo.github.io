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
/** sha256 of `out` after the water layer, per view and time, from the version before the speed pass. */
const GOLDEN: Record<string, string> = {
  "start@0.7": "2d17be0a45a04d25aa71b5236e5a84d167cdf577543a9a8dcea8ab8ff9d08b12",
  "start@2.3": "c644ed0c9b355cf564e839f3d0d2867d456c0f858196d525f54579e6bd78531e",
  "start@5.1": "1afa5a6c0a4a35bff53cfe6c94cd91e6f936b8fb275a42a5a0533839975bc25f",
  "sea@0.7": "aa6d48d8c8bdc0c7c137d131f2eade59b418efad4c4891a1781ef40285aa9f1e",
  "sea@2.3": "ebe4d0e8b0ca11e62386c02154a9e8532da5dbfaed2967dfc326ad35fe194812",
  "sea@5.1": "d26ec54b5aa003e5749c0e3a6979f50c7a72fb05ba0ef3a42148936fdb2466b5",
  "falls@0.7": "7a1daf56897e9f8158a297f81a2f6746f71e0e51f7fa7a4ab51fcf5c165ec213",
  "falls@2.3": "13fa783234ef6c6c092c8340737ad0fa2c96ffa694f4d79fff59a4ce92141b27",
  "falls@5.1": "ce6ac4014498b749fb81c1df7e2298453f40ebed72309ca75b682fd539765055",
  "peak@0.7": "22c79315b7c2ae30ba34f4831739c4daab3305a33ec6f50cd0d940b47da9b511",
  "peak@2.3": "9e402bd72860bcd89161f39efe2d78adf24552d5c5105bc994925ed15ea19ea1",
  "peak@5.1": "0905a34a3ca5afa10fb5227b8e610164d06e869df8a234ea354e4631b3794519"
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
  assert.ok(times[60] <= 0.08, `median ${times[60].toFixed(3)} ms`);
});
