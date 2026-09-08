import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FG } from "../tty/screen.ts";
import { textWidth, wrapRuns } from "./wrap.ts";

const plain = (text: string) => ({ text, fg: DEFAULT_FG, bold: false });
const lines = (rows: ReturnType<typeof wrapRuns>) => rows.map((r) => r.map((x) => x.text).join(""));

test("fits on one row when it fits", () => {
  assert.deepEqual(lines(wrapRuns([plain("hello world")], 20)), ["hello world"]);
});

test("breaks at spaces and drops the space at the break", () => {
  assert.deepEqual(lines(wrapRuns([plain("the quick brown fox jumps")], 10)), ["the quick", "brown fox", "jumps"]);
});

test("continuation rows are indented", () => {
  assert.deepEqual(lines(wrapRuns([plain("⏺ one two three four")], 10, 2)), ["⏺ one two", "  three", "  four"]);
});

test("a word wider than the row is hard-broken", () => {
  assert.deepEqual(lines(wrapRuns([plain("abcdefghijkl xy")], 5)), ["abcde", "fghij", "kl xy"]);
});

test("newlines force a break and an empty input gives one empty row", () => {
  assert.deepEqual(lines(wrapRuns([plain("a\nb")], 10)), ["a", "b"]);
  assert.deepEqual(wrapRuns([], 10), [[]]);
});

test("attributes survive wrapping and merge into runs", () => {
  const rows = wrapRuns([{ text: "⏺ ", fg: 2, bold: false }, { text: "Read", fg: DEFAULT_FG, bold: true }, plain("(x)")], 40);
  assert.deepEqual(rows, [[{ text: "⏺ ", fg: 2, bold: false }, { text: "Read", fg: DEFAULT_FG, bold: true }, plain("(x)")]]);
});

test("wide glyphs count two cells", () => {
  assert.equal(textWidth("木a"), 3);
  assert.deepEqual(lines(wrapRuns([plain("木木 木")], 4)), ["木木", "木"]);
});
