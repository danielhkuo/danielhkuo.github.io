import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandHistory, complete, promptFor, tokenize } from "./shell.ts";
import type { CommandMap } from "./types";

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

test("the prompt shows the cwd's last component, ~ at home", () => {
  assert.equal(promptFor("~/"), "daniel@portfolio ~ % ");
  assert.equal(promptFor("~/work"), "daniel@portfolio work % ");
});

const run = () => undefined;
const COMMANDS: CommandMap = {
  help: { desc: "", run },
  cd: { desc: "", args: ["about", "work", "contact"], run },
  cbonsai: { desc: "", args: () => ["--live", "--infinite"], run },
  secret: { desc: "", hidden: true, run },
};

test("a command name completes, case-insensitively", () => {
  assert.deepEqual(complete("he", COMMANDS), { suffix: "lp", line: "help" });
  assert.deepEqual(complete("HE", COMMANDS), { suffix: "lp", line: "help" });
  assert.deepEqual(complete("  he", COMMANDS), { suffix: "lp", line: "help" });
});

test("a completed command that takes arguments leaves a space for them", () => {
  assert.deepEqual(complete("c", COMMANDS), { suffix: "d", line: "cd " });
});

test("nothing completes on an exact name, a hidden command, or an empty line", () => {
  assert.equal(complete("help", COMMANDS), null);
  assert.equal(complete("se", COMMANDS), null);
  assert.equal(complete("", COMMANDS), null);
  assert.equal(complete("   ", COMMANDS), null);
});

test("an argument completes from the command's list or getter", () => {
  assert.deepEqual(complete("cd wo", COMMANDS), { suffix: "rk", line: "cd work" });
  assert.deepEqual(complete("cd WO", COMMANDS), { suffix: "rk", line: "cd work" });
  assert.deepEqual(complete("cd ", COMMANDS), { suffix: "about", line: "cd about" });
  assert.deepEqual(complete("cbonsai --i", COMMANDS), { suffix: "nfinite", line: "cbonsai --infinite" });
  assert.equal(complete("cd work", COMMANDS), null);
  assert.equal(complete("help me", COMMANDS), null);
});

test("history walks back to the oldest line and stops there", () => {
  const h = new CommandHistory();
  assert.equal(h.prev(), null);
  h.add("one");
  h.add("two");
  assert.equal(h.prev(), "two");
  assert.equal(h.prev(), "one");
  assert.equal(h.prev(), "one");
});

test("history walks forward to a fresh, empty line", () => {
  const h = new CommandHistory();
  assert.equal(h.next(), null);
  h.add("one");
  h.add("two");
  h.prev();
  h.prev();
  assert.equal(h.next(), "two");
  assert.equal(h.next(), "");
  assert.equal(h.next(), null);
});

test("running a line ends the recall", () => {
  const h = new CommandHistory();
  h.add("one");
  h.prev();
  h.add("two");
  assert.equal(h.next(), null);
  assert.equal(h.prev(), "two");
});
