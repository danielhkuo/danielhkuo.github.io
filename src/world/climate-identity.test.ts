// Temperate is the identity. With no temperature field, or on the temperate plateau (temp 0.5), the cover and the
// scatter are bit for bit what they were before climates (2026-11-18): the hashes below were taken from that code
// over a seeded sweep of 300 000 inputs that reaches every rule.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { cover } from "./cover.ts";
import type { CoverInput } from "./look/contract.ts";
import { scatterAt } from "./scatter.ts";
import { loadMask } from "./testing/bakefix.ts";
import { sweep } from "./testing/sweep.ts";

const MASK = loadMask();
const COUNT = 300000;

const GOLDEN: Record<number, { cover: string; scatter: string }> = {
  6400: { cover: "9f4c1d507eedf72dc704b42219fbb8bf5c8f61aeae8a82f0a997420fccebd09a", scatter: "f7e891129a13278b81ee9087d5497a9d5caa84dbce948ad33abab158ad3d60fd" },
  10240: { cover: "a5f7bd928f7d752df0e5aea9b232fb8fde9d677eb9990c8b7ffcc3c13e09b47b", scatter: "201213d40f4650dc83e118d289e8c2c8537dfda0a767e424d01798357d1e6cbf" },
  1024: { cover: "70acd515d408ecc160791d52a36c7f49b0eef669961b6f87827c0a0fb53e2c15", scatter: "afe59d9f110d1b1638d5ed896eb4a661ceca310796fdb4dff98ddf086c93d318" },
};

function hex(v: ArrayBufferView): string {
  return createHash("sha256").update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).digest("hex");
}

/** The cover and scatter of the sweep on a world of n cells, each input passed through `dress` first. */
function run(n: number, dress: (c: CoverInput) => CoverInput): { cover: string; scatter: string } {
  const inputs = sweep(20261118, COUNT, n);
  const mats = new Uint8Array(inputs.length);
  const stamps = new Float32Array(inputs.length * 6);
  for (let k = 0; k < inputs.length; k++) {
    const c = dress(inputs[k]);
    const m = cover(c, MASK, n);
    mats[k] = m;
    const sight = (k & 3) === 0 ? { north: (k >> 2) % 14, south: (k >> 5) % 14 } : undefined;
    const st = scatterAt(c, m, MASK, sight, n);
    if (st) stamps.set([st.x, st.y, st.r, st.h, st.mat, st.shape], k * 6);
  }
  return { cover: hex(mats), scatter: hex(stamps) };
}

for (const n of [6400, 10240, 1024]) {
  test(`with no temperature the cover and scatter are what they were before climates (n = ${n})`, () => {
    assert.deepEqual(run(n, (c) => c), GOLDEN[n]);
  });

  test(`on the temperate plateau the cover and scatter are what they were before climates (n = ${n})`, () => {
    assert.deepEqual(run(n, (c) => ({ ...c, temp: 0.5 })), GOLDEN[n]);
  });
}
