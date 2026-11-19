import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAME_PIXELS, fitFrame, refits } from "./fit.ts";

/** The frame covers the viewport edge to edge, overhanging it by less than one frame pixel each way. */
function covers(vw: number, vh: number, dpr: number): void {
  const f = fitFrame(vw, vh, dpr);
  const dw = Math.round(vw * dpr), dh = Math.round(vh * dpr);
  assert.ok(Number.isInteger(f.scale) && f.scale >= 1, `${vw}x${vh}@${dpr}: whole device pixels per frame pixel`);
  assert.ok(f.w * f.scale >= dw && (f.w - 1) * f.scale < dw, `${vw}x${vh}@${dpr}: ${f.w} columns cover ${dw} device pixels`);
  assert.ok(f.h * f.scale >= dh && (f.h - 1) * f.scale < dh, `${vw}x${vh}@${dpr}: ${f.h} rows cover ${dh} device pixels`);
  assert.ok(f.w * f.h <= FRAME_PIXELS, `${vw}x${vh}@${dpr}: ${f.w * f.h} frame pixels`);
  // The finest scale within the budget: a step finer would need more pixels than it allows.
  if (f.scale > 1) assert.ok(Math.ceil(dw / (f.scale - 1)) * Math.ceil(dh / (f.scale - 1)) > FRAME_PIXELS);
}

test("the frame fills the window at any size and aspect, at the finest whole scale the budget allows", () => {
  for (const [vw, vh, dpr] of [
    [1600, 900, 1], [1920, 1080, 1], [2560, 1440, 1], [1280, 1024, 1], [2560, 1080, 1], [800, 1200, 1], [3440, 1440, 1],
    [1512, 982, 2], [1920, 1080, 2], [390, 844, 3], [844, 390, 3], [874, 338, 3], [874, 292, 3], [360, 640, 2], [1366, 768, 1],
    [300, 200, 1], [1, 1, 1], [1024, 768, 1.25], [1536, 864, 1.25],
  ]) covers(vw, vh, dpr);
});

test("the flight page's window keeps today's frame; 1080p and 1440p draw no more pixels than it", () => {
  assert.deepEqual(fitFrame(1600, 900, 1), { w: 400, h: 225, scale: 4 });
  assert.deepEqual(fitFrame(1920, 1080, 1), { w: 384, h: 216, scale: 5 });
  assert.deepEqual(fitFrame(2560, 1440, 1), { w: 366, h: 206, scale: 7 });
  // Other shapes show more of the world across or up and down, at the same kind of scale.
  assert.deepEqual(fitFrame(2560, 1080, 1), { w: 427, h: 180, scale: 6 });
  assert.deepEqual(fitFrame(800, 1200, 1), { w: 200, h: 300, scale: 4 });
});

test("phones: whole device pixels, at most the budget, from the visual viewport", () => {
  for (const [vw, vh] of [[390, 844], [844, 390], [874, 338], [874, 292], [430, 932], [932, 430]]) {
    const f = fitFrame(vw, vh, 3);
    assert.ok(f.w * f.h <= 110_000, `${vw}x${vh}: ${f.w * f.h} frame pixels`);
    assert.ok(Number.isInteger(f.scale));
  }
});

test("the frame keeps its size through a toolbar's coming and going, and fits again when the window really changes", () => {
  const fitted = { w: 874, h: 338 };
  assert.equal(refits(fitted, { w: 874, h: 292 }), false, "the tab bar shows: the frame stays, overhanging under it");
  assert.equal(refits(fitted, { w: 874, h: 338 }), false, "and goes again");
  assert.equal(refits(fitted, { w: 874, h: 340 }), true, "taller than fitted: fit again, or paper would show");
  assert.equal(refits(fitted, { w: 390, h: 760 }), true, "turned");
  assert.equal(refits({ w: 1600, h: 900 }, { w: 1600, h: 600 }), true, "a window made much shorter");
  assert.equal(refits({ w: 1600, h: 900 }, { w: 1500, h: 900 }), true, "a window made narrower");
  assert.equal(refits({ w: 1600, h: 900 }, { w: 1600, h: 900 }), false);
});
