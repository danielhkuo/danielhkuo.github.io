import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FG, packRow, Screen, Win } from "./screen.ts";

function text(screen: Screen, y: number): string {
  return screen
    .printedRow(y)
    .map(([ch]) => ch)
    .join("");
}

test("a fresh screen is blank and fully dirty", () => {
  const s = new Screen(3, 5);
  assert.deepEqual(s.takeDirty(), [0, 1, 2]);
  assert.equal(s.hasDirty, false);
  assert.equal(text(s, 1), "     ");
});

test("writes mark only their row dirty", () => {
  const s = new Screen(3, 5);
  s.takeDirty();
  s.put(1, 2, "x", 1, 3, true, false);
  assert.deepEqual(s.takeDirty(), [1]);
  assert.deepEqual(s.cell(1, 2), { ch: "x", fg: 3, bold: true });
});

test("out-of-range writes are dropped", () => {
  const s = new Screen(2, 2);
  s.takeDirty();
  s.put(-1, 0, "a", 1, 1, false, false);
  s.put(0, 2, "a", 1, 1, false, false);
  s.put(2, 0, "a", 1, 1, false, false);
  assert.equal(s.hasDirty, false);
});

test("wide glyphs take two cells and fold into one run", () => {
  const s = new Screen(1, 6);
  s.put(0, 1, "木", 2, 2, false, false);
  assert.equal(s.chars[1], "木");
  assert.equal(s.chars[2], "");
  assert.deepEqual(s.rowRuns(0), [
    { text: " ", fg: DEFAULT_FG, bold: false },
    { text: "木", fg: 2, bold: false },
    { text: "   ", fg: DEFAULT_FG, bold: false },
  ]);
  assert.equal(text(s, 0), " 木   ");
});

test("overwriting half a wide glyph blanks the other half", () => {
  const s = new Screen(1, 4);
  s.put(0, 0, "木", 2, 2, false, false);
  s.put(0, 1, "a", 1, 1, false, false);
  assert.equal(s.chars[0], " ");
  assert.equal(s.chars[1], "a");
  s.put(0, 2, "林", 2, 2, false, false);
  s.put(0, 2, "b", 1, 1, false, false);
  assert.equal(s.chars[3], " ");
});

test("mask blocks tree-layer writes but not top-layer writes", () => {
  const s = new Screen(3, 3);
  s.addMask(1, 1, 1, 1);
  s.put(1, 1, "t", 1, 1, false, false);
  assert.equal(s.cell(1, 1).ch, " ");
  s.put(1, 1, "m", 1, 1, false, true);
  assert.equal(s.cell(1, 1).ch, "m");
  s.put(0, 0, "o", 1, 1, false, false);
  assert.equal(s.cell(0, 0).ch, "o");
});

test("Win refuses negative origins and sizes; zero means to the edge", () => {
  const s = new Screen(5, 7);
  assert.equal(Win.open(s, 2, 2, -1, 0), null);
  assert.equal(Win.open(s, 2, 2, 0, -1), null);
  assert.equal(Win.open(s, -1, 2, 0, 0), null);
  assert.notEqual(Win.open(s, 2, 2, 0, 0), null);
  const w = Win.open(s, 0, 0, 2, 3) as Win;
  assert.equal(w.height, 3);
  assert.equal(w.width, 4);
});

test("raise() covers what is beneath and reserves the rectangle", () => {
  const s = new Screen(3, 5);
  const under = Win.open(s, 3, 5, 0, 0) as Win;
  under.mvaddstr(1, 0, "abcde");
  const over = Win.open(s, 1, 3, 1, 1, true) as Win;
  over.raise();
  assert.equal(text(s, 1), "a   e");
  under.mvaddstr(1, 0, "vwxyz");
  assert.equal(text(s, 1), "v   z");
  over.addstr("hi");
  assert.equal(text(s, 1), "vhi z");
});

test("Win wraps at its right edge and stops at its bottom-right corner", () => {
  const s = new Screen(2, 10);
  const w = Win.open(s, 2, 3, 0, 0) as Win;
  assert.equal(w.addstr("abcd"), true);
  assert.equal(text(s, 0), "abc       ");
  assert.equal(text(s, 1), "d         ");
  assert.equal(w.addstr("efgh"), false);
  // "ef" fill the row; "f" sits in the corner, the failed wrap refuses "gh".
  assert.equal(text(s, 1), "def       ");
  assert.equal(w.cy, 1);
  assert.equal(w.cx, 2);
});

test("Win overhanging the screen is clipped, not clamped", () => {
  const s = new Screen(3, 5);
  const w = Win.open(s, 5, 8, 1, 2) as Win;
  w.addstr("12345678");
  assert.equal(text(s, 1), "  123");
  assert.equal(text(s, 2), "     ");
  w.mvaddstr(1, 0, "ab");
  assert.equal(text(s, 2), "  ab ");
  w.mvaddstr(4, 0, "zz");
  assert.equal(w.cy, 4);
});

test("mvaddstr writes nothing when the move fails", () => {
  const s = new Screen(2, 4);
  const w = Win.open(s, 2, 4, 0, 0) as Win;
  assert.equal(w.mvaddstr(-1, 0, "no"), false);
  assert.equal(w.mvaddstr(0, 4, "no"), false);
  assert.equal(w.mvaddstr(0, 3, "yes"), true);
  assert.equal(text(s, 0), "   y");
  assert.equal(text(s, 1), "es  ");
});

test("newline clears to end of line and moves down", () => {
  const s = new Screen(2, 4);
  const w = Win.open(s, 2, 4, 0, 0) as Win;
  w.addstr("abcd");
  w.move(0, 1);
  w.addstr("\nx");
  assert.equal(text(s, 0), "a   ");
  assert.equal(text(s, 1), "x   ");
  assert.equal(w.addch("\n"), false);
});

test("wide glyph that does not fit pads and wraps", () => {
  const s = new Screen(2, 3);
  const w = Win.open(s, 2, 3, 0, 0) as Win;
  w.addstr("a木");
  assert.equal(text(s, 0), "a木");
  w.move(0, 0);
  w.addstr("ab木");
  assert.equal(text(s, 0), "ab ");
  assert.equal(text(s, 1), "木 ");
});

test("border draws the ncurses box", () => {
  const s = new Screen(3, 5);
  const w = Win.open(s, 3, 5, 0, 0) as Win;
  w.border("|", "|", "-", "-", "+", "+", "+", "+");
  assert.equal(text(s, 0), "+---+");
  assert.equal(text(s, 1), "|   |");
  assert.equal(text(s, 2), "+---+");
});

test("colour replaces the pair and keeps bold", () => {
  const s = new Screen(1, 4);
  const w = Win.open(s, 1, 4, 0, 0) as Win;
  w.bold = true;
  w.color(8);
  w.addstr("a");
  w.color(3);
  w.addstr("b");
  assert.deepEqual(s.cell(0, 0), { ch: "a", fg: 8, bold: true });
  assert.deepEqual(s.cell(0, 1), { ch: "b", fg: 3, bold: true });
});

test("packRow normalises spaces and trims the tail", () => {
  const packed = packRow([
    ["a", 2, true],
    [" ", 2, true],
    ["b", 2, true],
    ["c", 3, false],
    [" ", 9, true],
    [" ", 9, true],
  ]);
  assert.deepEqual(packed, {
    t: "a bc",
    a: [
      [1, 2, true],
      [1, DEFAULT_FG, false],
      [1, 2, true],
      [1, 3, false],
    ],
  });
});
