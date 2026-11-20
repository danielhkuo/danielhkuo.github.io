import assert from "node:assert/strict";
import { test } from "node:test";
import { nextMatch, said, spoken } from "./find.ts";

const TEXT = "Rust here\nPython there\nrust again\nTypeScript";

test("a search is case-insensitive and finds the first match from the start", () => {
  assert.deepEqual(nextMatch(TEXT, "RUST", 0), { start: 0, end: 4, index: 1, count: 2, wrapped: false });
});

test("the next search starts after the last match, and past the last one wraps to the first", () => {
  const first = nextMatch(TEXT, "rust", 0);
  const second = nextMatch(TEXT, "rust", first?.end ?? 0);
  assert.equal(second?.start, TEXT.indexOf("rust again"));
  assert.equal(second?.index, 2);
  assert.equal(second?.wrapped, false);
  const third = nextMatch(TEXT, "rust", second?.end ?? 0);
  assert.deepEqual(third, { start: 0, end: 4, index: 1, count: 2, wrapped: true });
});

test("a query is matched as text, not as a pattern", () => {
  assert.equal(nextMatch("a.b axb", ".", 0)?.start, 1);
  assert.equal(nextMatch("cost (USD)", "(USD)", 0)?.start, 5);
  assert.equal(nextMatch("abc", "[", 0), null);
});

test("nothing is found for an empty query or a missing word", () => {
  assert.equal(nextMatch(TEXT, "", 0), null);
  assert.equal(nextMatch(TEXT, "Haskell", 0), null);
});

test("the status line says what nano says", () => {
  assert.equal(said("x", null), '[ "x" not found ]');
  assert.equal(said("Python", nextMatch(TEXT, "Python", 0)), "[ This is the only occurrence ]");
  assert.equal(said("rust", nextMatch(TEXT, "rust", 0)), "");
  assert.equal(said("rust", nextMatch(TEXT, "rust", TEXT.length)), "[ Search Wrapped ]");
});

test("a screen reader hears where the match is, and when the search went back to the top", () => {
  assert.equal(spoken("rust", nextMatch(TEXT, "rust", 0)), "Found “rust”, 1 of 2.");
  assert.equal(spoken("rust", nextMatch(TEXT, "rust", TEXT.length)), "Found “rust”, 1 of 2. The search went back to the top.");
  assert.equal(spoken("x", null), "“x” not found.");
});
