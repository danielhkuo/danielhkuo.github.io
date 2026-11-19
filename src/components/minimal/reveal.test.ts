import assert from "node:assert/strict";
import { test } from "node:test";
import { revealBy, visibleArea } from "./reveal.ts";

// Readings from the iOS 26.5 Simulator (iPhone 17e) with the keyboard open:
// the visual viewport is 389 px tall and has panned 310 px down the layout
// viewport, yet client rects are measured from the visual viewport's own top.
const IPHONE_KEYBOARD = { height: 389, offsetTop: 310 };

test("on an iPhone with the keyboard up, the visible area starts at 0 and is the visual viewport's height", () => {
  assert.deepEqual(visibleArea(IPHONE_KEYBOARD, 487, true), { top: 0, bottom: 389 });
});

test("a stale offsetTop on an iPhone changes nothing: only the height is read", () => {
  for (const offsetTop of [0, 7.69, 287.66, 310]) {
    assert.deepEqual(visibleArea({ height: 389, offsetTop }, 389, true), { top: 0, bottom: 389 });
  }
});

test("innerHeight is never used while there is a visual viewport, whatever it reads", () => {
  for (const innerHeight of [389, 411, 487, 607, 699]) {
    assert.deepEqual(visibleArea(IPHONE_KEYBOARD, innerHeight, true), { top: 0, bottom: 389 });
  }
});

test("where rects are measured from the layout viewport, the visible area starts at the pan", () => {
  assert.deepEqual(visibleArea({ height: 400, offsetTop: 310 }, 800, false), { top: 310, bottom: 710 });
  assert.deepEqual(visibleArea({ height: 800, offsetTop: 0 }, 800, false), { top: 0, bottom: 800 });
});

test("without a visual viewport the window is the visible area", () => {
  assert.deepEqual(visibleArea(undefined, 800, false), { top: 0, bottom: 800 });
  assert.deepEqual(visibleArea(null, 800, true), { top: 0, bottom: 800 });
});

test("printing eight 21 px lines with the keyboard up scrolls by exactly their height", () => {
  // Before: the prompt's bottom sat on the visible bottom, 389. The new lines pushed it to 557.
  const view = visibleArea(IPHONE_KEYBOARD, 389, true);
  assert.equal(revealBy(389 - 44, 557, view), 168);
});

test("what is already in view does not move", () => {
  assert.equal(revealBy(100, 380, { top: 0, bottom: 389 }), 0);
  assert.equal(revealBy(0, 389, { top: 0, bottom: 389 }), 0);
  assert.equal(revealBy(0, 389, { top: 0, bottom: 389 }, true), 0);
});

test("an entry that fits is shown whole, with the prompt on the bottom edge", () => {
  assert.equal(revealBy(600, 900, { top: 32, bottom: 700 }), 200);
});

test("an entry taller than the view starts at the top, under whatever covers it, for someone reading", () => {
  assert.equal(revealBy(600, 2000, { top: 32, bottom: 700 }), 568);
});

test("for someone typing, the prompt stays on the bottom edge however much was printed", () => {
  assert.equal(revealBy(600, 2000, { top: 32, bottom: 700 }, true), 1300);
  assert.equal(revealBy(-900, 900, { top: 0, bottom: 389 }, true), 511);
});

test("a prompt left above the bottom edge is brought back down to it", () => {
  // After `clear` the page is shorter: the prompt is above the bottom edge, and its entry starts above the view.
  assert.equal(revealBy(-50, 300, { top: 0, bottom: 700 }), -400);
});
