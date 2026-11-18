import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import type { FlightState } from "./flight.ts";
import { drawFlier, FLIER_FILL, FLIER_INK, SHADOW_SLOPE } from "./standin.ts";

const W = 400, H = 225, GREY = 0xff808080;

function scene(s: FlightState, depth: (px: number, py: number, rect: ViewRect) => number, ground = 0) {
  const rect: ViewRect = { x: Math.floor(s.x) - 200, y: Math.floor(0.8 * s.y - s.alt) - 112, w: W, h: H };
  const out = new Uint32Array(W * H).fill(GREY);
  drawFlier(out, rect, s, { depthAt: (px, py) => depth(px, py, rect), groundHeight: () => ground });
  return { out, rect };
}

/** Flat ground at sea level: the land drawn at a pixel lies at its bake row over 0.8. */
const flatDepth = (_px: number, py: number, rect: ViewRect) => (rect.y + py) / 0.8;
const flier = (heading = 0, alt = 30): FlightState => ({ x: 500, y: 500, heading, speed: 60, alt, bank: 0 });
const count = (out: Uint32Array, c: number) => out.reduce((k, v) => k + (v === c ? 1 : 0), 0);

test("the flier is drawn where nothing stands in front of it", () => {
  const { out } = scene(flier(), flatDepth);
  assert.equal(out[112 * W + 200], FLIER_FILL, "the middle of the kite is filled");
  assert.ok(count(out, FLIER_FILL) >= 12, "a kite, not a dot");
  assert.ok(count(out, FLIER_INK) >= 12, "with an inked outline");
  // Nothing beyond the sprite's box but the shadow.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = out[y * W + x];
    if (v === FLIER_FILL || v === FLIER_INK) assert.ok(Math.abs(x - 200) <= 5 && Math.abs(y - 112) <= 5, `${x},${y}`);
  }
});

test("a hill to its south hides it", () => {
  const { out } = scene(flier(), () => 600);
  assert.equal(count(out, FLIER_FILL) + count(out, FLIER_INK), 0);
  assert.ok(out.every((v) => v === GREY), "and its shadow, which falls behind the hill");
});

test("the shadow falls south-east, 0.354 cells per unit of height", () => {
  const s = flier(0, 40);
  const { out, rect } = scene(s, flatDepth);
  const sx = s.x + SHADOW_SLOPE * 40, sy = s.y + SHADOW_SLOPE * 40;
  const px = Math.floor(sx - rect.x), py = Math.floor(0.8 * sy - rect.y);
  const v = out[py * W + px];
  assert.notEqual(v, GREY);
  assert.ok((v & 255) < 0x80, `the shadow darkens: ${v.toString(16)}`);
  // The ground right under the flier is not shaded.
  const ux = Math.floor(s.x - rect.x), uy = Math.floor(0.8 * s.y - rect.y);
  assert.equal(out[uy * W + ux], GREY);
});

test("the kite turns with its heading in sixteen steps", () => {
  const east = scene(flier(0), flatDepth).out, south = scene(flier(Math.PI / 2), flatDepth).out;
  const around = scene(flier(2 * Math.PI), flatDepth).out, nudge = scene(flier(0.05), flatDepth).out;
  assert.notDeepEqual(east, south);
  assert.deepEqual(east, around);
  assert.deepEqual(east, nudge, "a heading rounds to the nearest of 16");
});

test("a flier at the screen's edge is clipped, not wrapped", () => {
  const s = flier();
  const rect: ViewRect = { x: Math.floor(s.x) - 2, y: Math.floor(0.8 * s.y - s.alt) - 2, w: W, h: H };
  const out = new Uint32Array(W * H).fill(GREY);
  drawFlier(out, rect, s, { depthAt: (_px, py) => (rect.y + py) / 0.8, groundHeight: () => 0 });
  for (let y = 0; y < H; y++) for (let x = W - 10; x < W; x++) assert.equal(out[y * W + x], GREY, `${x},${y}`);
});
