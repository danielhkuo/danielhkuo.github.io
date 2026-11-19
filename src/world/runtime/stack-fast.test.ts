// drawStack against the plain slice-by-slice draw on the same input: random stacks, headings, places and land.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ViewRect } from "../render/compose.ts";
import { drawStack, drawStackSlices, type Stack } from "./stack.ts";

const W = 400, H = 225;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A stack of random size, a solid core and a ragged, holed rim, as models are. */
function randomStack(next: () => number): Stack {
  const w = 1 + Math.floor(next() * 17), h = 1 + Math.floor(next() * 17), layers = 1 + Math.floor(next() * 12);
  const rgba = new Uint32Array(w * h * layers), alpha = new Uint8Array(w * h * layers);
  for (let k = 0; k < layers; k++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = k * w * h + y * w + x;
    const dx = (x - (w - 1) / 2) / (w / 2), dy = (y - (h - 1) / 2) / (h / 2), dz = (k - (layers - 1) / 2) / (layers / 2 + 0.5);
    const inside = dx * dx + dy * dy + dz * dz < 0.6 + 0.6 * next();
    if (!inside) continue;
    alpha[i] = 255;
    rgba[i] = (0xff000000 | Math.floor(next() * 0xffffff)) >>> 0;
  }
  return { w, h, layers, rgba, alpha };
}

test("drawStack draws exactly what the slice-by-slice draw does", () => {
  const next = rng(5);
  let drawn = 0, hidden = 0;
  for (let trial = 0; trial < 400; trial++) {
    const s = randomStack(next);
    // Quarter turns, near them, and anywhere.
    const pick = next();
    const heading = pick < 0.2 ? (Math.floor(next() * 8) * Math.PI) / 2 : pick < 0.35 ? (Math.floor(next() * 4) * Math.PI) / 2 + (next() - 0.5) * 1e-7 : (next() - 0.5) * 20;
    const n = [1280, 6400, 10240][Math.floor(next() * 3)];
    const rect: ViewRect = { x: Math.floor((next() - 0.5) * 3 * n), y: Math.floor((next() - 0.5) * 3 * n), w: W, h: H };
    // Centred anywhere in the frame or just off it, on any image of the torus.
    const x = rect.x + (next() * 1.2 - 0.1) * W + Math.floor((next() - 0.5) * 4) * n;
    const alt = next() * 60;
    const y = (rect.y + (next() * 1.2 - 0.1) * H + alt) / 0.8 + Math.floor((next() - 0.5) * 4) * n;
    // Land whose depth varies across the frame, so some of the stack hides behind it.
    const lean = next() * 2 - 1, base = rect.y / 0.8 + (next() - 0.7) * 300;
    const view = { depthAt: (px: number, py: number) => base + py * 1.25 + lean * px + ((px * 7 + py * 13) % 5) };
    const a = new Uint32Array(W * H).fill(0xff808080), b = a.slice();
    drawStack(a, rect, view, s, x, y, alt, heading, n);
    drawStackSlices(b, rect, view, s, x, y, alt, heading, n);
    assert.deepEqual(a, b, `trial ${trial}: ${s.w}×${s.h}×${s.layers} at ${x.toFixed(2)},${y.toFixed(2)} heading ${heading}`);
    if (a.some((v) => v !== 0xff808080)) drawn++;
    else hidden++;
  }
  // Most trials draw something, and some are hidden or off the frame: both paths are exercised.
  assert.ok(drawn > 150 && hidden > 10, `drawn ${drawn}, hidden or off the frame ${hidden}`);
});

test("on a world whose rows do not wrap on a whole pixel, drawStack still draws what the slices draw", () => {
  const next = rng(9);
  // n · 0.8 is not whole, so the stack's screen row is not either.
  const n = 1001;
  let drawn = 0;
  for (let trial = 0; trial < 60; trial++) {
    const s = randomStack(next);
    const rect: ViewRect = { x: 0, y: 700, w: W, h: H };
    // A full period of rows below the view: the image found for it lands 100.2 rows down the frame.
    const x = 200 + (next() - 0.5) * 300, alt = next() * 30, y = (rect.y + 100 + alt) / 0.8 + n;
    const heading = next() * 7;
    const view = { depthAt: (px: number, py: number) => (rect.y + py) / 0.8 + ((px * 3) % 7) - 3 };
    const a = new Uint32Array(W * H), b = new Uint32Array(W * H);
    drawStack(a, rect, view, s, x, y, alt, heading, n);
    drawStackSlices(b, rect, view, s, x, y, alt, heading, n);
    assert.deepEqual(a, b, `trial ${trial}`);
    if (a.some((v) => v !== 0)) drawn++;
  }
  assert.ok(drawn > 30, `stacks drawn: ${drawn}`);
});
