import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import { drawStack, drawStackShadow, STACK_SHADOW_SLOPE, type Stack } from "./stack.ts";

const W = 400, H = 225, N = 1280, GREY = 0xff808080, RED = 0xff0000ff, BLUE = 0xffff0000, WHITE = 0xffffffff;
const rect = (x = 0, y = 0): ViewRect => ({ x, y, w: W, h: H });
const frame = () => new Uint32Array(W * H).fill(GREY);
/** Flat sea-level land: the land drawn at a pixel lies at its bake row over 0.8. */
const flat = (r: ViewRect) => ({ depthAt: (_px: number, py: number) => (r.y + py) / 0.8, groundHeight: () => 0 });

/** A 9×9 stack of `layers` slices: slice 0 all RED, and a BLUE nose pixel at the east edge of the middle row in every slice. */
function arrow(layers = 1): Stack {
  const w = 9, h = 9, rgba = new Uint32Array(layers * w * h), alpha = new Uint8Array(layers * w * h);
  for (let k = 0; k < layers; k++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = k * w * h + y * w + x;
    const body = k === 0 || (x === 4 && y === 4);
    if (body) { rgba[i] = RED; alpha[i] = 255; }
    if (y === 4 && x === 8) { rgba[i] = BLUE; alpha[i] = 255; }
  }
  return { w, h, layers, rgba, alpha };
}

test("a stack heading east is drawn as authored, centred on its point", () => {
  const out = frame(), r = rect();
  drawStack(out, r, flat(r), arrow(), 200, 150, 10, 0, N);
  // Centre at screen (200, 0.8·150 − 10) = (200, 110); the nose is 4 pixels east.
  assert.equal(out[110 * W + 200], RED);
  assert.equal(out[110 * W + 204], BLUE);
  assert.equal(out[106 * W + 196], RED, "top-left of the slice");
  assert.equal(out[105 * W + 200], GREY);
});

test("heading turns the slices: south puts the nose below, west to the left", () => {
  for (const [heading, dx, dy] of [[Math.PI / 2, 0, 4], [Math.PI, -4, 0], [-Math.PI / 2, 0, -4]] as const) {
    const out = frame(), r = rect();
    drawStack(out, r, flat(r), arrow(), 200, 150, 10, heading, N);
    assert.equal(out[(110 + dy) * W + 200 + dx], BLUE, `heading ${heading}`);
  }
});

test("each slice sits one pixel above the one below, and covers it", () => {
  const out = frame(), r = rect();
  drawStack(out, r, flat(r), arrow(5), 200, 150, 10, 0, N);
  // The middle column of slices 1–4 rises above slice 0's centre.
  for (let k = 1; k < 5; k++) assert.equal(out[(110 - k) * W + 200], RED, `slice ${k}`);
  // The top slice's nose is 4 pixels up from slice 0's.
  assert.equal(out[106 * W + 204], BLUE);
});

test("land nearer the viewer hides the stack", () => {
  const out = frame(), r = rect();
  drawStack(out, r, { depthAt: () => 400 }, arrow(3), 200, 150, 10, 0, N);
  assert.ok(out.every((v) => v === GREY));
});

test("stacks wrap with the world and clip at the frame's edge", () => {
  const out = frame(), r = rect(-20, 0);
  drawStack(out, r, flat(r), arrow(), N - 4, 150, 10, 0, N);
  assert.equal(out[110 * W + 16], RED, "x = n − 4 shows at screen 16 when the view starts at −20");
  const edge = frame(), e = rect();
  drawStack(edge, e, flat(e), arrow(), 398, 150, 10, 0, N);
  assert.equal(edge[110 * W + 399], RED);
  assert.equal(edge[111 * W + 0], GREY, "not wrapped onto the next row");
});

test("the shadow falls south-east by the slope, and only on the ground there", () => {
  const out = frame(), r = rect();
  drawStackShadow(out, r, flat(r), arrow(3), 200, 150, 40, 0, N);
  const sx = Math.round(200 + STACK_SHADOW_SLOPE * 40), sy = Math.round(0.8 * (150 + STACK_SHADOW_SLOPE * 40));
  const v = out[sy * W + sx];
  assert.notEqual(v, GREY);
  assert.ok((v & 255) < 0x80, "darker");
  assert.equal(out[Math.round(0.8 * 150) * W + 200], GREY, "not under the stack itself");
  const hidden = frame();
  drawStackShadow(hidden, r, { depthAt: () => 900, groundHeight: () => 0 }, arrow(3), 200, 150, 40, 0, N);
  assert.ok(hidden.every((p) => p === GREY));
});
