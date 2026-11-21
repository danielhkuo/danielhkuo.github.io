import assert from "node:assert/strict";
import { test } from "node:test";
import { CAP, characters, eachDot, glyph, ROWS, textWidth, TRACK, X_HEIGHT } from "./font.ts";

const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

test("the font draws every printable ASCII character, the arrows, dot and pilcrow the guides use, and the title's return key", () => {
  const have = new Set(characters());
  for (const ch of [...PRINTABLE, "←", "→", "↑", "↓", "·", "¶", "…", "⏎"]) assert.ok(have.has(ch), `missing ${JSON.stringify(ch)}`);
});

test("every glyph but the space has ink, and none is wider than five columns", () => {
  for (const ch of characters()) {
    const g = glyph(ch);
    assert.ok(g.w >= 1 && g.w <= 5, `${ch} is ${g.w} wide`);
    assert.equal(g.ink.length, g.w * ROWS);
    if (ch !== " ") assert.ok(g.ink.some((v) => v === 1), `${ch} has no ink`);
  }
});

/** Rows of `ch` that hold ink. */
function rows(ch: string): number[] {
  const g = glyph(ch);
  const out: number[] = [];
  for (let y = 0; y < ROWS; y++) if (g.ink.subarray(y * g.w, (y + 1) * g.w).some((v) => v === 1)) out.push(y);
  return out;
}

test("capitals and digits stand on the baseline at cap height; the lower case sits on the x-height", () => {
  for (const ch of "ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789") assert.deepEqual([rows(ch)[0], rows(ch).at(-1)], [0, CAP - 1], ch);
  for (const ch of "acemnorsuvwxz") assert.deepEqual([rows(ch)[0], rows(ch).at(-1)], [CAP - X_HEIGHT, CAP - 1], ch);
  for (const ch of "bdhkl") assert.deepEqual([rows(ch)[0], rows(ch).at(-1)], [0, CAP - 1], ch);
  for (const ch of "gpqy") assert.equal(rows(ch).at(-1), ROWS - 1, `${ch} descends`);
});

test("a character the font lacks is drawn as a question mark", () => {
  assert.deepEqual(glyph("☃"), glyph("?"));
});

test("text is as wide as its glyphs and the tracking between them, and dots fall inside that box", () => {
  assert.equal(textWidth(""), 0);
  assert.equal(textWidth("a"), glyph("a").w);
  assert.equal(textWidth("land"), glyph("l").w + glyph("a").w + glyph("n").w + glyph("d").w + 3 * TRACK);
  let n = 0;
  eachDot("take off", (x, y) => {
    assert.ok(x >= 0 && x < textWidth("take off") && y >= 0 && y < ROWS);
    n++;
  });
  assert.ok(n > 20);
});
