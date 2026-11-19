import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL as M } from "../look/materials.ts";
import { buildPalette, MIDDAY } from "../render/palette.ts";
import { airOf, NOON_AIR } from "../sky/air.ts";
import { parseWeather } from "../sky/weather.ts";
import { MIST_DRIFT, mistField, mistLayer } from "./mist.ts";

const W = 400, H = 225;
const BASE = 0xff406080;
const palette = buildPalette(MIDDAY);
const air = (q: string) => airOf(0.5, 0.25, parseWeather(q) ?? undefined);

/** A frame of one material, or of `left` and `right` halves. */
function frame(left: number, right = left, t = 0, x = 0) {
  const bake = new Uint32Array(W * H);
  for (let i = 0; i < bake.length; i++) bake[i] = ((i % W) < W / 2 ? left : right) | (9 << 8);
  return { out: new Uint32Array(W * H).fill(BASE), bake, rect: { x, y: 0, w: W, h: H }, t, palette, n: 10240 };
}

function touched(out: Uint32Array, from = 0, to = W): number {
  let n = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== BASE && i % W >= from && i % W < to) n++;
  return n;
}

test("the field is level: each of its 256 levels covers the same area", () => {
  const field = mistField(3);
  const counts = new Uint32Array(256);
  for (const v of field) counts[v]++;
  for (const c of counts) assert.equal(c, field.length / 256);
});

test("no mist draws nothing; full mist lays banks over a modest share of open ground", () => {
  const layer = mistLayer(3);
  const fair = frame(M.meadowMid);
  layer.draw(fair);
  layer.draw({ ...fair, air: NOON_AIR });
  assert.equal(touched(fair.out), 0);
  const misty = frame(M.meadowMid);
  layer.draw({ ...misty, air: air("mist") });
  const share = touched(misty.out) / (W * H);
  assert.ok(share > 0.08 && share < 0.22, `banks on ${share} of the frame`);
  // The same moment draws the same mist.
  const again = frame(M.meadowMid);
  mistLayer(3).draw({ ...again, air: air("mist") });
  assert.deepEqual(again.out, misty.out);
});

test("thin mist has smaller, fainter banks", () => {
  const layer = mistLayer(3);
  const full = frame(M.sea), half = frame(M.sea);
  layer.draw({ ...full, air: air("mist") });
  layer.draw({ ...half, air: air("mist:0.5") });
  assert.ok(touched(half.out) > 0 && touched(half.out) < touched(full.out) * 0.8);
  const lift = (out: Uint32Array) => {
    let most = 0;
    for (const v of out) most = Math.max(most, (v & 255) - (BASE & 255));
    return most;
  };
  assert.ok(lift(half.out) < lift(full.out));
});

test("crowns, roofs and the heights stand clear of the mist, and it lies thicker on water", () => {
  const layer = mistLayer(3);
  for (const m of [M.broadleafMid, M.coniferCool, M.roofTile, M.whitewash, M.cliffHard, M.snow, M.none]) {
    const f = frame(m);
    layer.draw({ ...f, air: air("mist") });
    assert.equal(touched(f.out), 0, `material ${m}`);
  }
  const land = frame(M.meadowMid), sea = frame(M.sea);
  layer.draw({ ...land, air: air("mist") });
  layer.draw({ ...sea, air: air("mist") });
  const sum = (out: Uint32Array) => out.reduce((s, v) => s + (v & 255), 0);
  assert.equal(touched(sea.out), touched(land.out));
  assert.ok(sum(sea.out) > sum(land.out));
});

test("the banks drift over the land in whole pixels, and stay with the land as the camera moves", () => {
  const layer = mistLayer(3);
  const a = frame(M.sea, M.sea, 0), b = frame(M.sea, M.sea, 40);
  layer.draw({ ...a, air: air("mist") });
  layer.draw({ ...b, air: air("mist") });
  assert.notDeepEqual(a.out, b.out);
  // A camera that has moved on by the drift of two seconds sees the banks of two seconds before or after.
  const step = Math.floor(2 * MIST_DRIFT);
  const east = frame(M.sea, M.sea, 0, step), west = frame(M.sea, M.sea, 0, -step), later = frame(M.sea, M.sea, 2);
  for (const f of [east, west, later]) layer.draw({ ...f, air: air("mist") });
  const heartRows = (out: Uint32Array) => Array.from({ length: H }, (_, y) => {
    let n = 0;
    for (let x = 0; x < W; x++) if (out[y * W + x] !== BASE) n++;
    return n;
  });
  // The checker of the fringe is fixed to the land, so compare where the banks are by their rows' counts.
  const same = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) <= 2 * step + 2);
  assert.ok(same(heartRows(later.out), heartRows(east.out)) || same(heartRows(later.out), heartRows(west.out)));
});
