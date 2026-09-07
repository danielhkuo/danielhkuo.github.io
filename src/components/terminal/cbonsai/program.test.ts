import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { CommandContext, ProgramHost, ScreenProgram, TerminalLine, TerminalRow } from "../types";
import { CbonsaiProgram, loadFromFile, runCbonsai, saveToFile, trimBlankRows, type SaveStore } from "./program.ts";
import { parseArgs } from "./args.ts";
import { DEFAULT_FG, type Screen } from "./screen.ts";

class MemoryStore implements SaveStore {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function ctx() {
  const lines: string[] = [];
  const errs: string[] = [];
  const programs: ScreenProgram[] = [];
  const c: CommandContext = {
    out: (t) => lines.push(t),
    ok: (t) => lines.push(t),
    err: (t) => errs.push(t),
    rows: (rows: readonly TerminalRow[]) => lines.push(rows.map((r) => r.k).join(",")),
    clear: () => undefined,
    close: () => undefined,
    program: (p) => programs.push(p),
  };
  return { c, lines, errs, programs };
}

function host() {
  let paints = 0;
  const exits: (TerminalLine[] | undefined)[] = [];
  const h: ProgramHost = {
    paint: () => {
      paints++;
    },
    exit: (out) => exits.push(out),
  };
  return { h, get paints() { return paints; }, exits };
}

function config(args: string[]) {
  const parsed = parseArgs(args);
  if (parsed.kind !== "run") throw new Error(JSON.stringify(parsed));
  return parsed.config;
}

function text(screen: Screen): string {
  return screen
    .snapshot()
    .map((runs) => runs.map((r) => r.text).join("").trimEnd())
    .join("\n");
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_700_000_000_000 });
});
afterEach(() => {
  mock.timers.reset();
});

test("help and errors go to the shell without taking the screen", () => {
  const a = ctx();
  runCbonsai(["-h"], a.c, null);
  assert.equal(a.lines[0], "Usage: cbonsai [OPTION]...");
  assert.equal(a.programs.length, 0);

  const b = ctx();
  runCbonsai(["-t", "0"], b.c, null);
  assert.deepEqual(b.errs, ["error: invalid step time: '0'"]);
  assert.equal(b.lines.length, 0);
  assert.equal(b.programs.length, 0);

  const c = ctx();
  runCbonsai(["-x"], c.c, null);
  assert.deepEqual(c.errs, ["error: invalid option -- 'x'"]);
  assert.equal(c.lines[0], "Usage: cbonsai [OPTION]...");
});

test("an unseeded run uses the clock, like time(NULL)", () => {
  const a = ctx();
  runCbonsai([], a.c, null);
  const p = a.programs[0] as CbonsaiProgram;
  assert.equal(p.conf.seed, 1_700_000_000);
});

test("non-live: the whole tree appears at once and waits for any key", () => {
  const p = new CbonsaiProgram(config(["-s", "42"]), null);
  const h = host();
  const screen = p.start({ rows: 24, cols: 80 }, h.h);
  assert.equal(p.state, "waitKey");
  assert.equal(h.paints, 1);
  assert.match(text(screen), /:___________\.\/~~~\\\.___________:/);
  assert.match(text(screen), /&/);
  p.key("x", false);
  assert.equal(p.state, "exited");
  assert.deepEqual(h.exits, [undefined]);
});

test("-p prints the trimmed tree and returns immediately", () => {
  const p = new CbonsaiProgram(config(["-s", "42", "-p"]), null);
  const h = host();
  p.start({ rows: 24, cols: 80 }, h.h);
  assert.equal(p.state, "exited");
  assert.equal(h.exits.length, 1);
  const out = h.exits[0] as TerminalLine[];
  assert.equal(out[0].kind, "screen");
  if (out[0].kind !== "screen") return;
  // Two blank rows above the canopy are gone; the base is the last row.
  assert.ok(out[0].rows.length < 24);
  const last = out[0].rows[out[0].rows.length - 1].map((r) => r.text).join("");
  assert.match(last, /\(_\)/);
});

test("live mode paces visible steps by timeStep and q quits early", () => {
  const p = new CbonsaiProgram(config(["-s", "42", "-l", "-t", "0.05"]), null);
  const h = host();
  const screen = p.start({ rows: 24, cols: 80 }, h.h);
  assert.equal(p.state, "growing");
  assert.equal(h.paints, 1, "the first step is drawn at once");
  mock.timers.tick(49);
  assert.equal(h.paints, 1, "nothing grows before the step time");
  mock.timers.tick(1);
  assert.equal(h.paints, 2);
  for (let i = 0; i < 10; i++) mock.timers.tick(50);
  assert.equal(h.paints, 12, "one visible step per timeStep");
  const glyphs = text(screen).replace(/\s/g, "").length;
  // A stalled clock (background tab) catches up in one tick: many steps, one paint.
  mock.timers.tick(500);
  assert.equal(h.paints, 13);
  assert.ok(text(screen).replace(/\s/g, "").length > glyphs + 5, "overdue steps ran back to back");
  assert.equal(p.state, "growing");
  p.key("a", false);
  assert.equal(p.state, "growing", "only q quits mid-growth");
  p.key("q", false);
  assert.equal(p.state, "exited");
  assert.deepEqual(h.exits, [undefined]);
});

test("live mode runs to completion and then any key exits", () => {
  const p = new CbonsaiProgram(config(["-s", "42", "-l", "-t", "0.001"]), null);
  const h = host();
  p.start({ rows: 24, cols: 80 }, h.h);
  mock.timers.tick(20_000);
  assert.equal(p.state, "waitKey");
  p.key("Enter", false);
  assert.equal(p.state, "exited");
});

test("-lp animates, then prints", () => {
  const p = new CbonsaiProgram(config(["-s", "42", "-l", "-t", "0.001", "-p"]), null);
  const h = host();
  p.start({ rows: 24, cols: 80 }, h.h);
  assert.equal(h.exits.length, 0);
  mock.timers.tick(20_000);
  assert.equal(p.state, "exited");
  assert.equal(h.exits[0]?.[0].kind, "screen");
});

test("screensaver quits on any key", () => {
  const p = new CbonsaiProgram(config(["-S", "-s", "42"]), null);
  const h = host();
  p.start({ rows: 24, cols: 80 }, h.h);
  p.key("a", false);
  assert.equal(p.state, "exited");
});

test("infinite mode waits, reseeds from the clock, and a key cuts the wait short", () => {
  const p = new CbonsaiProgram(config(["-s", "42", "-i", "-w", "2"]), null);
  const h = host();
  const screen = p.start({ rows: 24, cols: 80 }, h.h);
  assert.equal(p.state, "waitTree");
  const first = text(screen);
  mock.timers.tick(1999);
  assert.equal(text(screen), first);
  mock.timers.tick(1);
  assert.equal(p.state, "waitTree", "second tree grew instantly and is waiting again");
  const second = text(screen);
  assert.notEqual(second, first, "reseeded from the clock");
  mock.timers.tick(1000); // srand(time(NULL)) needs a new second for a new tree
  p.key("a", false);
  assert.equal(p.state, "waitTree");
  assert.notEqual(text(screen), second, "a key skips the wait");
  p.key("q", false);
  assert.equal(p.state, "exited");
  assert.deepEqual(h.exits, [undefined]);
});

test("ctrl-c quits in every phase", () => {
  for (const args of [["-s", "42"], ["-s", "42", "-l"], ["-s", "42", "-i"]]) {
    const p = new CbonsaiProgram(config(args), null);
    p.start({ rows: 24, cols: 80 }, host().h);
    p.key("c", true);
    assert.equal(p.state, "exited");
  }
});

test("stop() from the host cancels timers and saves", () => {
  const store = new MemoryStore();
  const p = new CbonsaiProgram(config(["-s", "42", "-l", "-W"]), store);
  const h = host();
  p.start({ rows: 24, cols: 80 }, h.h);
  p.stop();
  assert.equal(p.state, "exited");
  const paints = h.paints;
  mock.timers.tick(10_000);
  assert.equal(h.paints, paints);
  assert.match(store.getItem("cbonsai:~/.cache/cbonsai") ?? "", /^42 \d+$/);
});

test("save and load round-trip; loaded growth is hidden until the saved branch count", () => {
  const store = new MemoryStore();
  const a = new CbonsaiProgram(config(["-s", "42", "-W"]), store);
  a.start({ rows: 24, cols: 80 }, host().h);
  a.key("x", false);
  const saved = store.getItem("cbonsai:~/.cache/cbonsai") as string;
  const branches = Number(saved.split(" ")[1]);
  assert.ok(branches > 10);

  const c = ctx();
  runCbonsai(["-C", "-l", "-t", "0.01"], c.c, store);
  assert.deepEqual(c.errs, []);
  const b = c.programs[0] as CbonsaiProgram;
  assert.equal(b.conf.seed, 42);
  assert.equal(b.conf.targetBranchCount, branches);
  const h = host();
  const screen = b.start({ rows: 24, cols: 80 }, h.h);
  // Everything up to the final branch is drawn in the first tick, before any step delay.
  const drawn = text(screen).replace(/\s/g, "").length;
  assert.ok(drawn > 100, `only ${drawn} glyphs after the first tick`);
  mock.timers.tick(10_000);
  assert.equal(b.state, "waitKey");
  const store2 = new MemoryStore();
  assert.equal(loadFromFile(config(["-C"]), store2), "error: file was not opened properly for reading: ~/.cache/cbonsai");
  saveToFile("x", 1, 2, store2);
  assert.equal(store2.getItem("cbonsai:x"), "1 2");
  store2.setItem("cbonsai:bad", "nope");
  assert.equal(loadFromFile(config(["-C", "bad"]), store2), "error: save file could not be read");
});

test("trimBlankRows drops empty rows at both ends only", () => {
  const blank = [{ text: "   ", fg: DEFAULT_FG, bold: false }];
  const tree = [{ text: "&", fg: 2, bold: false }];
  assert.deepEqual(trimBlankRows([blank, blank, tree, blank, tree, blank]), [tree, blank, tree]);
  assert.deepEqual(trimBlankRows([blank]), []);
});

test("a huge non-live tree grows in slices and paints only when complete", () => {
  // The slice budget is measured on the real clock; keep only setTimeout mocked.
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const p = new CbonsaiProgram(config(["-s", "3", "-L", "200", "-M", "20"]), null);
  const h = host();
  p.start({ rows: 60, cols: 200 }, h.h);
  assert.equal(p.state, "growing", "did not finish in one synchronous slice");
  assert.equal(h.paints, 0, "nothing painted mid-way");
  mock.timers.tick(60_000);
  assert.equal(p.state, "waitKey");
  assert.equal(h.paints, 1);
});
