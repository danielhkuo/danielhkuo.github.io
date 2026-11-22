// Landforms by climate (design 6.6): what they leave alone, and that each climate's landform is there.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ergAt } from "../biome.ts";
import { BANK_NEAR, BENCH_STEP, type LandformInput, LOWER_SHARE, ridgeAt, shapeByClimate, SHORE_NEAR } from "./landforms.ts";

const N = 1024, GN = 256, CN = 128;

/** A world of one climate: a hill range along y, 5 to 65 units, all of it far from water and the shore. */
function world(temp: number | undefined, arid: number, moisture: number, over: Partial<LandformInput> = {}): LandformInput {
  const ground = new Float64Array(GN * GN), hand = new Float64Array(GN * GN).fill(30);
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) ground[gy * GN + gx] = 5 + 60 * (1 - Math.abs(1 - (2 * gy) / GN));
  return {
    n: N, gN: GN, ground, hand, isSea: new Uint8Array(GN * GN), lakeId: new Int32Array(GN * GN).fill(-1), shoreDist: new Float32Array(GN * GN).fill(100),
    temp: temp === undefined ? undefined : new Float32Array(CN * CN).fill(temp), arid: new Float32Array(CN * CN).fill(arid), moisture: new Float32Array(CN * CN).fill(moisture),
    ...over,
  };
}

function moved(a: Float64Array, b: Float64Array): number {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) k++;
  return k;
}

test("a temperate world, and a world with no temperature, keep the land as grown", () => {
  // The plateau's temperature moves nothing, on either side of the world.
  for (const w of [world(0.5, 0, 0.5), world(0.5, 1, 0.1)]) {
    const f = shapeByClimate(w);
    assert.equal(moved(f.ground, w.ground), 0);
    assert.equal(moved(f.hand, w.hand), 0);
    assert.deepEqual(f.moved, { bench: 0, ridge: 0, ice: 0, tower: 0, dome: 0 });
  }
  // With no temperature the arrays that come back are the ones that went in.
  const none = world(undefined, 1, 0.1), f = shapeByClimate(none);
  assert.equal(f.ground, none.ground);
  assert.equal(f.hand, none.hand);
});

test("a river keeps its bed, a lake its shore and the coast its line; no node is lowered to its drainage or the sea", () => {
  const w = world(0.9, 1, 0.08);
  // A channel down the column gx = 100, its valley sides rising 0.5 a node; a lake; a strip of sea with its shore.
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
    const i = gy * GN + gx;
    w.hand[i] = Math.min(30, 0.5 * Math.abs(gx - 100));
    if (gx >= 200 && gx < 210 && gy >= 40 && gy < 60) w.lakeId[i] = 0;
    if (gx < 10) { w.isSea[i] = 1; w.ground[i] = -3; }
    w.shoreDist[i] = gx < 10 ? -4 * (10 - gx) : Math.min(100, 4 * (gx - 10) + 2);
  }
  const f = shapeByClimate(w);
  let changed = 0;
  for (let i = 0; i < w.ground.length; i++) {
    const d = f.ground[i] - w.ground[i];
    if (d !== 0) changed++;
    if (w.isSea[i] || w.lakeId[i] >= 0 || w.hand[i] <= BANK_NEAR || w.shoreDist[i] <= SHORE_NEAR) assert.equal(d, 0, `node ${i % GN},${Math.floor(i / GN)} moved by ${d}`);
    else {
      assert.ok(d >= -LOWER_SHARE * (w.hand[i] - BANK_NEAR) - 1e-9, `node ${i} lowered ${d} with ${w.hand[i]} above its drainage`);
      assert.ok(f.ground[i] >= 0.5, `node ${i} at ${f.ground[i]}`);
    }
    assert.ok(Math.abs(f.hand[i] - (w.hand[i] + d)) < 1e-9, "the height above drainage follows the ground");
    assert.ok(f.hand[i] >= 0);
  }
  assert.ok(changed > 10000, `${changed} nodes moved`);
});

test("desert ground is stepped: most of a slope is tread, and the risers are several times as steep as the slope was", () => {
  const w = world(0.9, 1, 0.08), f = shapeByClimate(w);
  assert.ok(f.moved.bench > 30000, `benched nodes ${f.moved.bench}`);
  // Down one column of the hill's flank, away from any sand sea's ridges.
  let col = -1;
  for (let gx = 0; gx < GN && col < 0; gx++) {
    let sand = false;
    for (let gy = 20; gy < 110; gy++) if (ergAt(4 * gx + 2, 4 * gy + 2, N) > 0) { sand = true; break; }
    if (!sand) col = gx;
  }
  assert.ok(col >= 0, "a column clear of sand");
  const was = (w.ground[60 * GN + col] - w.ground[59 * GN + col]);
  let tread = 0, riser = 0, count = 0;
  for (let gy = 20; gy < 110; gy++) {
    const s = Math.abs(f.ground[(gy + 1) * GN + col] - f.ground[gy * GN + col]);
    count++;
    // A tread keeps a share of the slope: more where the benches are faint.
    if (s < 0.75 * was) tread++;
    if (s > 3 * was) riser++;
  }
  assert.ok(tread / count > 0.55, `tread share ${tread / count}`);
  assert.ok(riser >= 3, `risers ${riser} in ${count} nodes of a ${Math.round(90 * was)}-unit climb with steps of ${BENCH_STEP}`);
});

test("a sand sea has dune ridges; they wrap on the world", () => {
  const w = world(0.9, 1, 0.08);
  w.ground.fill(12);
  const f = shapeByClimate(w);
  assert.ok(f.moved.ridge > 500, `ridge nodes ${f.moved.ridge}`);
  let lo = Infinity, hi = -Infinity;
  for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
    if (ergAt(4 * gx + 2, 4 * gy + 2, N) < 1) continue;
    const v = f.ground[gy * GN + gx];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  assert.ok(hi - lo > 4, `sand sea heights ${lo} to ${hi}`);
  for (const [x, y] of [[3, 700], [511.5, 0.5], [1000, 1023]]) {
    assert.ok(Math.abs(ridgeAt(x + N, y, N) - ridgeAt(x, y, N)) < 1e-9);
    assert.ok(Math.abs(ridgeAt(x, y - N, N) - ridgeAt(x, y, N)) < 1e-9);
    const v = ridgeAt(x, y, N);
    assert.ok(v >= 0 && v <= 1);
  }
});

test("the jungle has towers in patches, the savanna a few domes, the pole an ice sheet that fills hollows", () => {
  // Jungle: level low ground, hot and wet.
  const jungle = world(0.97, 0, 0.95);
  jungle.ground.fill(10);
  const j = shapeByClimate(jungle);
  let tall = 0, still = 0;
  for (let i = 0; i < j.ground.length; i++) {
    const d = j.ground[i] - 10;
    assert.ok(d >= 0, "a tower only raises");
    if (d > 8) tall++;
    if (d === 0) still++;
  }
  assert.ok(tall > 200, `tower nodes ${tall}`);
  assert.ok(still / j.ground.length > 0.5, `level ground left between and beyond the towers: ${still / j.ground.length}`);
  assert.equal(j.moved.bench + j.moved.ridge + j.moved.dome + j.moved.ice, 0);

  // Savanna: level ground, hot, the dry side, some rain. On a world this small, at most a few domes; on one eight times as wide, some.
  const savanna = world(0.92, 1, 0.5);
  savanna.ground.fill(10);
  const s = shapeByClimate(savanna);
  assert.equal(s.moved.bench + s.moved.ridge + s.moved.tower + s.moved.ice, 0);
  for (let i = 0; i < s.ground.length; i++) assert.ok(s.ground[i] >= 10);

  // The pole: a hollow in a plateau fills most of the way; the plateau does not sink.
  const pole = world(0.02, 0, 0.5);
  pole.ground.fill(40);
  for (let gy = 100; gy < 110; gy++) for (let gx = 100; gx < 110; gx++) pole.ground[gy * GN + gx] = 20;
  const p = shapeByClimate(pole);
  assert.ok(p.ground[105 * GN + 105] > 26, `the hollow's floor ${p.ground[105 * GN + 105]}`);
  for (let i = 0; i < p.ground.length; i++) assert.ok(p.ground[i] >= pole.ground[i], "ice only fills");
  assert.equal(p.ground[10 * GN + 10], 40);
});

test("the landforms are deterministic, and whole across the world's seam", () => {
  const w = world(0.9, 1, 0.08);
  w.ground.fill(15);
  const a = shapeByClimate(w), b = shapeByClimate(w);
  assert.deepEqual(a.ground, b.ground);
  // Level ground everywhere: what is left is the landforms' own shape. Its steps across the seam are no larger than its steps elsewhere.
  let seam = 0, rest = 0;
  for (let k = 0; k < GN; k++) {
    seam = Math.max(seam, Math.abs(a.ground[k * GN] - a.ground[k * GN + GN - 1]), Math.abs(a.ground[k] - a.ground[(GN - 1) * GN + k]));
    for (let q = 1; q < GN; q += 7) rest = Math.max(rest, Math.abs(a.ground[k * GN + q] - a.ground[k * GN + q - 1]));
  }
  assert.ok(rest > 0, "something moved");
  assert.ok(seam <= rest * 1.2 + 1e-9, `step ${seam} across the seam, ${rest} elsewhere`);
});
