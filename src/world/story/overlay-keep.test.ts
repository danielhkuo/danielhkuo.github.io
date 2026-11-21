import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowAt } from "./arrow.ts";
import { drawQuest } from "./overlay.ts";
import type { QuestState } from "./quest.ts";

// The quest's arrow and the page's own controls over the frame's top-right corner (the options plate over the sound
// toggle): an arrow that would stand under them is drawn along the edge, clear of them. A phone's frame held sideways,
// 437 × 169 frame px, with the iPhone's landscape safe areas in frame px.
const FW = 437, FH = 169;
const INSET = { top: 0, right: 31, bottom: 10, left: 31 };
const ON: QuestState = { mode: "on", found: [] };

/** The corner's controls in the top right (the options plate over the sound toggle), frame px. */
const KEEP = [{ x0: FW - INSET.right - 22, y0: 3, x1: FW - INSET.right, y1: 50 }];

/** True when anything was drawn inside `r`. */
function drawnIn(out: Uint32Array, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) if (out[y * FW + x] !== 0) return true;
  return false;
}

test("an arrow that would stand under the corner's controls moves down the edge, clear of them", () => {
  // A stop east and well north: on the right edge the arrow would sit at the sound toggle's height.
  const arrow = arrowAt({ x: 5218, y: -1212 }, FW, FH, 12, INSET);
  assert.equal(arrow.mode, "edge");
  assert.ok(arrow.y > KEEP[0].y0 && arrow.y < KEEP[0].y1, `the test's arrow is at y ${arrow.y}, beside the controls`);
  const out = new Uint32Array(FW * FH);
  drawQuest(out, FW, FH, { mode: "on", found: [] }, arrow, 0, true, null, INSET, KEEP);
  assert.equal(drawnIn(out, KEEP[0]), false, "nothing is drawn under the controls");
  // The arrow is still drawn, at the right edge, just below them.
  const right = { x0: FW / 2, y0: KEEP[0].y1, x1: FW, y1: KEEP[0].y1 + 24 };
  assert.equal(drawnIn(out, right), true, "the arrow stands just below the controls");
});

test("an arrow on the top edge under the corner's controls moves left along it, clear of them", () => {
  // A stop north and a little east: on the top edge the arrow would sit under the options plate.
  const arrow = arrowAt({ x: 218 + 1100, y: -5000 }, FW, FH, 12, INSET);
  assert.equal(arrow.mode, "edge");
  const out = new Uint32Array(FW * FH);
  drawQuest(out, FW, FH, { mode: "on", found: [] }, arrow, 0, true, null, INSET, [{ x0: arrow.x - 30, y0: 0, x1: FW - INSET.right, y1: 20 }]);
  assert.equal(drawnIn(out, { x0: arrow.x - 30, y0: 0, x1: FW - INSET.right, y1: 20 }), false, "nothing is drawn under the controls");
  assert.equal(drawnIn(out, { x0: FW / 2 - 80, y0: 0, x1: arrow.x - 30, y1: 40 }), true, "the arrow stands just left of them");
});

test("an arrow clear of the corner's controls is where it was", () => {
  const arrow = arrowAt({ x: 5000, y: FH / 2 }, FW, FH, 12, INSET);
  const a = new Uint32Array(FW * FH);
  const b = new Uint32Array(FW * FH);
  drawQuest(a, FW, FH, ON, arrow, 0, true, null, INSET);
  drawQuest(b, FW, FH, ON, arrow, 0, true, null, INSET, KEEP);
  assert.deepEqual(b, a);
});

test("an arrow moved out of one control's way is moved again out of the next one's, whatever their order", () => {
  // The sound toggle under the options plate, listed first as the page lists them.
  const sound = { x0: FW - INSET.right - 22, y0: 23, x1: FW - INSET.right, y1: 45 };
  const plateRect = { x0: FW - INSET.right - 40, y0: 1, x1: FW - INSET.right, y1: 14 };
  // Into the top-right corner: under the plate, just above the toggle, until it steps down out of the plate's way.
  const arrow = arrowAt({ x: 5218, y: -1961 }, FW, FH, 12, INSET);
  assert.equal(arrow.mode, "edge");
  assert.equal(arrow.x, FW - INSET.right - 12);
  assert.ok(arrow.y - 9 + 19 <= sound.y0, `the arrow (y ${arrow.y}) starts clear of the toggle`);
  const out = new Uint32Array(FW * FH);
  drawQuest(out, FW, FH, ON, arrow, 0, true, null, INSET, [sound, plateRect]);
  assert.equal(drawnIn(out, sound), false, "nothing under the sound toggle");
  assert.equal(drawnIn(out, plateRect), false, "nothing under the options plate");
});
