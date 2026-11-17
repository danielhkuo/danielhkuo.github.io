import assert from "node:assert/strict";
import { test } from "node:test";
import { NB8_DIST, NB8_DX, NB8_DY } from "../core/torus.ts";
import { bumpy } from "../testing/fixtures.ts";
import { seamRatio } from "../testing/seam.ts";
import { priorityFlood } from "./flood.ts";
import { scree, type ScreeParams } from "./talus.ts";
import { talus } from "./talus.ts";

const REPOSE = [1.8, 1.0, 0.6] as const;

/** A tower of height 40 on flat ground at 0, n × n, one rock class. */
function tower(n: number, rockClass: number) {
  const h = new Float64Array(n * n), rock = new Uint8Array(n * n).fill(rockClass);
  for (let y = n / 2 - 3; y < n / 2 + 3; y++) for (let x = n / 2 - 3; x < n / 2 + 3; x++) h[y * n + x] = 40;
  return { h, rock };
}

function maxExcess(h: Float64Array, n: number, rock: Uint8Array, cellsPerNode: number): number {
  let worst = -Infinity;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    for (let k = 0; k < 8; k++) {
      const j = (((y + NB8_DY[k]) % n) + n) % n * n + ((((x + NB8_DX[k]) % n) + n) % n);
      const slope = (h[i] - h[j]) / (NB8_DIST[k] * cellsPerNode);
      worst = Math.max(worst, slope / REPOSE[rock[i]] - 1);
    }
  }
  return worst;
}

const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);

test("mass is conserved", () => {
  const { h, rock } = tower(48, 1), before = sum(h);
  const r = talus(h, 48, rock, REPOSE, 4, 30);
  assert.ok(Math.abs(sum(r.h) - before) <= 1e-3 * before);
});

test("does not modify its input", () => {
  const { h, rock } = tower(32, 1), copy = h.slice();
  talus(h, 32, rock, REPOSE, 4, 30);
  assert.deepEqual(h, copy);
});

test("converges: no slope above repose, per rock class", () => {
  for (const rc of [0, 1, 2]) {
    const { h, rock } = tower(64, rc);
    const r = talus(h, 64, rock, REPOSE, 4, 400);
    assert.ok(maxExcess(r.h, 64, rock, 4) <= 0.01, `rock ${rc}: ${maxExcess(r.h, 64, rock, 4)}`);
  }
});

test("the design's 30 sweeps get most of the way", () => {
  const { h, rock } = tower(64, 1), start = maxExcess(h, 64, rock, 4);
  const r = talus(h, 64, rock, REPOSE, 4, 30);
  assert.ok(maxExcess(r.h, 64, rock, 4) < 0.25 * start);
});

test("softer rock spreads wider", () => {
  const spread = (rc: number) => {
    const { h, rock } = tower(64, rc), r = talus(h, 64, rock, REPOSE, 4, 400);
    let wet = 0;
    for (const v of r.h) if (v > 0.5) wet++;
    return wet;
  };
  assert.ok(spread(2) > spread(1) && spread(1) > spread(0));
});

test("a slope already under repose is untouched", () => {
  const n = 32, h = new Float64Array(n * n), rock = new Uint8Array(n * n).fill(0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = 2 * Math.min(x, n - x);
  const r = talus(h, n, rock, REPOSE, 4, 30);
  assert.deepEqual(r.h, h);
  assert.ok(r.debris.every((d) => d === 0));
});

test("debris collects at the foot, not the top", () => {
  const n = 64, { h, rock } = tower(n, 1), r = talus(h, n, rock, REPOSE, 4, 30);
  for (let i = 0; i < n * n; i++) {
    assert.ok(r.debris[i] >= 0);
    assert.ok(r.debris[i] >= r.h[i] - h[i] - 1e-9);
  }
  const top = r.debris[(n / 2) * n + n / 2];
  let foot = 0;
  for (let x = n / 2 + 3; x < n / 2 + 8; x++) foot = Math.max(foot, r.debris[(n / 2) * n + x]);
  assert.ok(foot > 1 && foot > top);
});

test("wraps across the seam", () => {
  const n = 32, h = new Float64Array(n * n), rock = new Uint8Array(n * n).fill(2);
  for (let y = 0; y < n; y++) h[y * n] = 30;
  const r = talus(h, n, rock, REPOSE, 4, 400);
  assert.ok(r.h[5 * n + (n - 1)] > 0 && r.h[5 * n + 1] > 0);
  const a = r.h[5 * n + (n - 1)], b = r.h[5 * n + 1];
  assert.ok(Math.abs(a - b) <= 0.2 * Math.max(a, b), `${a} vs ${b}`);
});

const SCREE: ScreeParams = { shed: 0.7, rate: 4, repose: 0.5, wash: 1e9, passes: 4, sweeps: 24 };

/** A ridge 30 high along the middle row, falling at 1.2 per cell to a flat at 2 that drains to a sea column. */
function ridge(n: number) {
  const h = new Float64Array(n * n), isSea = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (x === 0) { isSea[i] = 1; h[i] = -1; continue; }
    // A slight tilt to the sea, and a notch every eighth column so the fall lines gather.
    const face = 30 - 1.2 * 4 * Math.abs(y - n / 2) - (x % 8 === 0 ? 3 : 0);
    h[i] = Math.max(face, 2 + 0.01 * x + 0.02 * Math.abs(y - n / 2));
  }
  return { h: priorityFlood(h, n, isSea, 1e-6).filled, isSea };
}

test("scree: steep ground sheds, and the debris lies at the foot, never steeper than repose", () => {
  const n = 48, { h, isSea } = ridge(n), r = scree(h, n, isSea, 4, SCREE, 1e-6);
  let shed = 0, laid = 0, onFace = 0, atFoot = 0;
  for (let i = 0; i < n * n; i++) {
    assert.ok(r.debris[i] >= 0);
    if (isSea[i]) { assert.equal(r.h[i], h[i]); assert.equal(r.debris[i], 0); continue; }
    if (r.h[i] < h[i]) shed += h[i] - r.h[i]; else laid += r.h[i] - h[i];
    const y = (i - (i % n)) / n, far = Math.abs(y - n / 2);
    if (r.debris[i] > 0.25) { if (far < 3) onFace++; else atFoot++; }
  }
  assert.ok(shed > 10, `shed ${shed}`);
  assert.ok(laid > 0.25 * shed && laid <= shed + 1e-6, `laid ${laid} of ${shed}`);
  assert.ok(atFoot > 20 && onFace === 0, `${atFoot} at the foot, ${onFace} on the crest`);
  // A pile stands no steeper than repose on its downhill side.
  for (let y = 0; y < n; y++) for (let x = 1; x < n; x++) {
    const i = y * n + x;
    if (r.debris[i] <= 0.25) continue;
    for (let k = 0; k < 8; k++) {
      const j = (((y + NB8_DY[k]) % n) + n) % n * n + ((((x + NB8_DX[k]) % n) + n) % n);
      if (isSea[j] || h[j] > h[i]) continue;
      const before = (h[i] - h[j]) / (NB8_DIST[k] * 4), after = (r.h[i] - r.h[j]) / (NB8_DIST[k] * 4);
      assert.ok(after <= Math.max(before, SCREE.repose) + 0.3, `debris at ${x},${y} stands at ${after}`);
    }
  }
});

test("scree: no pits, lakes and sea untouched, input unmodified, deterministic", () => {
  const n = 48, { h, isSea } = ridge(n);
  // A hollow on the flat that will hold a lake.
  const lake: number[] = [];
  for (let y = 4; y < 8; y++) for (let x = 20; x < 24; x++) { h[y * n + x] = 0.5; lake.push(y * n + x); }
  const copy = h.slice(), r = scree(h, n, isSea, 4, SCREE, 1e-6);
  assert.deepEqual(h, copy);
  for (const i of lake) { assert.equal(r.h[i], h[i]); assert.equal(r.debris[i], 0); }
  const before = priorityFlood(h, n, isSea, 1e-6).filled, after = priorityFlood(r.h, n, isSea, 1e-6).filled;
  for (let i = 0; i < n * n; i++) {
    if (isSea[i] || before[i] > h[i] + 1e-3) continue;
    assert.ok(after[i] - r.h[i] <= 1e-3, `new pit at ${i}: ${after[i] - r.h[i]}`);
  }
  assert.deepEqual(scree(h, n, isSea, 4, SCREE, 1e-6), r);
});

test("scree: no seam at the wrap, and a stream carries off what reaches it", () => {
  const f = bumpy(64, 21), h = priorityFlood(f.h.map((v) => v * 3), 64, f.isSea, 1e-6).filled;
  const r = scree(h, 64, f.isSea, 1, SCREE, 1e-6);
  assert.ok(seamRatio(r.h, 64) <= 1.5);
  let laid = 0, washed = 0;
  for (let i = 0; i < h.length; i++) laid += r.debris[i];
  const w = scree(h, 64, f.isSea, 1, { ...SCREE, wash: 0 }, 1e-6);
  for (let i = 0; i < h.length; i++) washed += w.debris[i];
  assert.ok(laid > 1);
  assert.ok(washed < 0.2 * laid, `washed ${washed} of ${laid}`);
});
