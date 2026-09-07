import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenize } from "./shell.ts";

test("plain words split on runs of whitespace", () => {
  assert.deepEqual(tokenize("  cbonsai   -l  -i "), ["cbonsai", "-l", "-i"]);
  assert.deepEqual(tokenize(""), []);
});

test("double quotes keep spaces and drop the quotes", () => {
  assert.deepEqual(tokenize('cbonsai -m "hello world"'), ["cbonsai", "-m", "hello world"]);
  assert.deepEqual(tokenize('echo "a  b"c'), ["echo", "a  bc"]);
  assert.deepEqual(tokenize('-m ""'), ["-m", ""]);
});

test("single quotes are literal", () => {
  assert.deepEqual(tokenize("-c '&,\"@\"'"), ["-c", '&,"@"']);
  assert.deepEqual(tokenize("'a\\nb'"), ["a\\nb"]);
});

test("backslashes escape", () => {
  assert.deepEqual(tokenize("a\\ b c"), ["a b", "c"]);
  assert.deepEqual(tokenize('"say \\"hi\\""'), ['say "hi"']);
  assert.deepEqual(tokenize("trailing\\"), ["trailing"]);
});

test("an unterminated quote runs to the end", () => {
  assert.deepEqual(tokenize('-m "open ended'), ["-m", "open ended"]);
});
