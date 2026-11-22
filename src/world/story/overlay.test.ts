import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowAt } from "./arrow.ts";
import { drawQuest } from "./overlay.ts";
import type { QuestState } from "./quest.ts";

// A phone's frame held sideways: 437 × 169 frame px at 2 CSS px each, with the iPhone's landscape safe areas (62 CSS px
// each side, 20 at the foot) in frame px.
const FW = 437, FH = 169;
const INSET = { top: 0, right: 31, bottom: 10, left: 31 };
const ON: QuestState = { mode: "on", found: [] };

/** The columns and rows of `out` that anything was drawn into. */
function inked(out: Uint32Array): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    if (out[y * FW + x] === 0) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

test("the count stands in the top-left of the safe frame, not under the island or in the rounded corner", () => {
  const out = new Uint32Array(FW * FH);
  drawQuest(out, FW, FH, ON, null, 0, true, null, INSET);
  const box = inked(out);
  assert.ok(box.x0 >= INSET.left, `the count starts at x ${box.x0}, inside the left inset of ${INSET.left}`);
  assert.ok(box.x0 <= INSET.left + 5, `the count keeps to the corner: x ${box.x0}`);
  assert.ok(box.y0 >= INSET.top);
});

test("with no inset the count is where it always was, 3 px from the corner", () => {
  const out = new Uint32Array(FW * FH);
  drawQuest(out, FW, FH, ON, null, 0, true);
  assert.equal(inked(out).x0, 3);
  assert.equal(inked(out).y0, 3);
});

test("an arrow at the right edge is drawn wholly inside the right inset", () => {
  const out = new Uint32Array(FW * FH);
  const arrow = arrowAt({ x: 5000, y: FH / 2 }, FW, FH, 12, INSET);
  drawQuest(out, FW, FH, { mode: "on", found: ["pine"] }, arrow, 0, true, null, INSET);
  const right = inked(out).x1;
  assert.ok(right < FW - INSET.right, `the arrow reaches x ${right}, past ${FW - INSET.right - 1}`);
});

test("an arrow at the foot is drawn wholly above the bottom inset", () => {
  const out = new Uint32Array(FW * FH);
  const arrow = arrowAt({ x: FW / 2, y: 5000 }, FW, FH, 12, INSET);
  drawQuest(out, FW, FH, ON, arrow, 0, true, null, INSET);
  assert.ok(inked(out).y1 < FH - INSET.bottom, `the arrow reaches y ${inked(out).y1}`);
});
