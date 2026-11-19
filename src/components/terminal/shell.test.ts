import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandHistory, complete, execute, promptFor, suggest, tokenize } from "./shell.ts";
import type { CommandContext, CommandMap } from "./types";

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

test("the prompt shows the cwd's last component: ~ at home, / at the root", () => {
  assert.equal(promptFor("~"), "daniel@portfolio ~ % ");
  assert.equal(promptFor("~/projects"), "daniel@portfolio projects % ");
  assert.equal(promptFor("~/projects/leaf"), "daniel@portfolio leaf % ");
  assert.equal(promptFor("/Users"), "daniel@portfolio Users % ");
  assert.equal(promptFor("/"), "daniel@portfolio / % ");
});

const run = () => undefined;
const COMMANDS: CommandMap = {
  help: { desc: "", run },
  cd: { desc: "", args: ["about", "work", "contact"], run },
  cbonsai: { desc: "", args: () => ["--live", "--infinite"], run },
  secret: { desc: "", hidden: true, run },
  // Like a path: what it offers depends on the directory part already typed.
  cat: {
    desc: "",
    args: (typed) => (typed.startsWith("docs/") ? ["docs/a.md", "docs/b.md"] : ["docs/", "notes.md"]),
    run,
  },
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

test("the word being typed completes, wherever it is in the line", () => {
  assert.deepEqual(complete("cbonsai --live --i", COMMANDS), {
    suffix: "nfinite",
    line: "cbonsai --live --infinite",
  });
  assert.deepEqual(complete("cat notes.md ", COMMANDS), { suffix: "docs/", line: "cat notes.md docs/" });
  assert.equal(complete("cbonsai --live --infinite", COMMANDS), null);
});

test("a getter is asked about the word being typed", () => {
  assert.deepEqual(complete("cat no", COMMANDS), { suffix: "tes.md", line: "cat notes.md" });
  assert.deepEqual(complete("cat docs/", COMMANDS), { suffix: "a.md", line: "cat docs/a.md" });
  assert.deepEqual(complete("cat docs/b", COMMANDS), { suffix: ".md", line: "cat docs/b.md" });
});

test("accepting an argument keeps the rest of the line as it was typed", () => {
  assert.deepEqual(complete("  cd   wo", COMMANDS), { suffix: "rk", line: "  cd   work" });
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

/** A context that records what a command wrote, and where. */
function sink() {
  const out: string[] = [];
  const errs: string[] = [];
  const ctx: CommandContext = {
    out: (t) => out.push(t),
    ok: (t) => out.push(t),
    err: (t) => errs.push(t),
    rows: (rows) => out.push(...rows.map((r) => `${r.k} ${r.v}`)),
    text: (rows) => out.push(...rows.map((runs) => runs.map((r) => r.text).join(""))),
    clear: () => undefined,
    close: () => undefined,
    program: () => undefined,
    cols: 80,
  };
  return { ctx, out, errs };
}

/** `args` prints each argument it was given on its own line. */
const RUNNABLE: CommandMap = {
  args: { desc: "", run: (args, ctx) => args.forEach((a) => ctx.out(a)) },
  boom: {
    desc: "",
    run: () => {
      throw new Error("kaput");
    },
  },
};

test("a line runs its command with the rest of its words as arguments, split as a shell would", () => {
  const s = sink();
  execute('args one "two  words" three\\ more', RUNNABLE, s.ctx);
  assert.deepEqual(s.out, ["one", "two  words", "three more"]);
  assert.deepEqual(s.errs, []);
});

test("the command word matches in any case, as a phone keyboard capitalises it", () => {
  const s = sink();
  execute("Args x", RUNNABLE, s.ctx);
  assert.deepEqual(s.out, ["x"]);
});

test("an unknown command is reported the way zsh reports it", () => {
  const s = sink();
  execute("Nope --flag", RUNNABLE, s.ctx);
  assert.deepEqual(s.errs, ["zsh: command not found: Nope"]);
  assert.deepEqual(s.out, []);
});

test("a name every object has is still not a command", () => {
  const s = sink();
  execute("constructor", RUNNABLE, s.ctx);
  execute("toString", RUNNABLE, s.ctx);
  assert.deepEqual(s.errs, ["zsh: command not found: constructor", "zsh: command not found: toString"]);
});

test("a blank line runs nothing and says nothing", () => {
  const s = sink();
  execute("   ", RUNNABLE, s.ctx);
  assert.deepEqual([s.out, s.errs], [[], []]);
});

test("a command that throws is reported instead of taking the shell down", () => {
  const s = sink();
  execute("boom", RUNNABLE, s.ctx);
  assert.equal(s.errs.length, 1);
  assert.match(s.errs[0], /kaput/);
});

// ---- suggest: the row of buttons that stands in for Tab ------------------------

/** A small registry: commands with no arguments, a required file, optional words, and one that is hidden. */
function registry(): CommandMap {
  const run = () => undefined;
  const files = (typed: string) =>
    ["about.md", "contact.md", "projects/", "projects/Alpha/", "projects/README.md"].filter((f) => {
      const cut = typed.lastIndexOf("/") + 1;
      return f.startsWith(typed) && !f.slice(cut).slice(0, -1).includes("/") && f !== typed.slice(0, cut);
    });
  return {
    help: { desc: "list commands", run },
    cat: { desc: "read a file", usage: "<file>", args: files, run },
    cd: { desc: "change directory", usage: "[dir]", args: files, run },
    clear: { desc: "clear the screen", run },
    echo: { desc: "print text", usage: "<text>", run },
    theme: { desc: "switch theme", usage: "[dark|light]", args: ["dark", "light"], run },
    glow: { desc: "read a file", usage: "<file>", args: files, hidden: true, run },
  };
}

test("on an empty line the row offers the featured commands, in their order", () => {
  assert.deepEqual(
    suggest("", registry(), ["help", "cat", "theme"]).map((s) => s.label),
    ["help", "cat", "theme"],
  );
});

test("a featured name that is not a command is left out", () => {
  assert.deepEqual(suggest("", registry(), ["help", "nope"]).map((s) => s.label), ["help"]);
});

test("with nothing featured an empty line offers nothing", () => {
  assert.deepEqual(suggest("", registry()), []);
  assert.deepEqual(suggest("   ", registry()), []);
});

test("a command that needs nothing more runs as it is", () => {
  assert.deepEqual(suggest("", registry(), ["help"]), [{ label: "help", line: "help", run: true }]);
});

test("a command with optional words runs as it is too", () => {
  assert.deepEqual(suggest("th", registry()), [{ label: "theme", line: "theme", run: true }]);
});

test("a command that needs a file goes on the prompt, with a space for it", () => {
  assert.deepEqual(suggest("", registry(), ["cat"]), [{ label: "cat", line: "cat ", run: false }]);
});

test("while a command is typed the row narrows to those that still match, in any case", () => {
  assert.deepEqual(suggest("c", registry()).map((s) => s.label), ["cat", "cd", "clear"]);
  assert.deepEqual(suggest("CL", registry()).map((s) => s.label), ["clear"]);
  assert.deepEqual(suggest("zz", registry()), []);
});

test("a hidden command is never offered", () => {
  assert.deepEqual(suggest("g", registry()), []);
});

test("a whole command name is still offered, so it can be run by a tap", () => {
  assert.deepEqual(suggest("clear", registry()), [{ label: "clear", line: "clear", run: true }]);
});

test("after a command the row is its arguments: a file runs, a directory is gone into", () => {
  assert.deepEqual(suggest("cat ", registry()), [
    { label: "about.md", line: "cat about.md", run: true },
    { label: "contact.md", line: "cat contact.md", run: true },
    { label: "projects/", line: "cat projects/", run: false },
  ]);
});

test("inside a directory the buttons show only the new part of the path", () => {
  assert.deepEqual(suggest("cat projects/", registry()), [
    { label: "Alpha/", line: "cat projects/Alpha/", run: false },
    { label: "README.md", line: "cat projects/README.md", run: true },
  ]);
});

test("a half-typed argument narrows the row", () => {
  assert.deepEqual(suggest("cat ab", registry()), [{ label: "about.md", line: "cat about.md", run: true }]);
  assert.deepEqual(suggest("theme L", registry()), [{ label: "light", line: "theme light", run: true }]);
});

test("a command with no arguments to offer, or one that does not exist, offers nothing more", () => {
  assert.deepEqual(suggest("echo ", registry()), []);
  assert.deepEqual(suggest("nope ", registry()), []);
});

test("earlier words of the line are kept as typed", () => {
  assert.deepEqual(suggest("  cd  -P pro", registry()), [{ label: "projects/", line: "  cd  -P projects/", run: false }]);
});
