import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ProgramHost, TerminalLine } from "../types";
import { GlibcRandom } from "../cbonsai/rand.ts";
import type { Screen } from "../tty/screen.ts";
import { ClaudeProgram } from "./program.ts";

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

/** A seeded, deterministic Math.random stand-in. */
function seeded(seed: number): () => number {
  const rng = new GlibcRandom(seed);
  return () => rng.next() / 2147483648;
}

function screenText(screen: Screen): string[] {
  const out: string[] = [];
  for (let y = 0; y < screen.rows; y++) out.push(screen.rowRuns(y).map((r) => r.text).join("").trimEnd());
  return out;
}

function type(p: ClaudeProgram, s: string): void {
  for (const ch of s) p.key(ch, false);
}

/** Node's mock timers do not fire timers scheduled inside a tick, so chained delays need small steps. */
function advance(ms: number): void {
  for (let t = 0; t < ms; t += 40) mock.timers.tick(40);
}

function boot(seed = 1) {
  const p = new ClaudeProgram({ rand: seeded(seed) });
  const h = host();
  const screen = p.start({ rows: 30, cols: 90 }, h.h);
  return { p, h, screen };
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_700_000_000_000 });
});
afterEach(() => {
  mock.timers.reset();
});

test("the welcome box, tips and prompt are on screen", () => {
  const { p, screen } = boot();
  const rows = screenText(screen);
  assert.ok(rows[0].startsWith("╭─"));
  assert.match(rows[1], /✻ Welcome to Claude Code!/);
  assert.match(rows[3], /\/help for help, \/status for your current setup/);
  assert.match(rows[5], /cwd: ~\/repos\/danielhkuo.github.io/);
  assert.ok(rows.some((r) => r.includes("Tips for getting started")));
  assert.ok(rows.some((r) => r.startsWith("╭─") && r.endsWith("╮")));
  assert.ok(rows.some((r) => /^│ > .*Try "/.test(r)), "placeholder in the input box");
  assert.ok(rows.some((r) => r.includes("? for shortcuts")));
  assert.ok(rows.some((r) => r.includes("⏵⏵ decline everything on (shift+tab to cycle)")));
  assert.equal(p.captureEscape, true);
  assert.equal(p.textInput, true);
});

test("typing edits the line with a block cursor and Enter echoes the prompt", () => {
  const { p, screen } = boot();
  type(p, "helo");
  p.key("ArrowLeft", false);
  p.key("ArrowLeft", false);
  type(p, "l");
  assert.equal(p.inputText, "hello");
  const inputRow = screen
    .snapshot()
    .find((r) => r.some((x) => x.text.includes("> ")) && r.some((x) => x.inverse));
  assert.ok(inputRow, "cursor is drawn inverse");
  p.key("Enter", false);
  assert.equal(p.inputText, "");
  assert.match(p.transcriptText, /> hello/);
  assert.equal(p.state, "busy");
});

test("a reply spins, maybe fakes a tool, then streams a refusal that quotes the prompt", () => {
  const { p, screen } = boot(7);
  type(p, "fix the terminal bug");
  p.key("Enter", false);
  advance(500);
  const mid = screenText(screen).join("\n");
  assert.match(mid, /[·✢✳✶✻✽] \w+… \(esc to interrupt · \ds · ↑ \d+(\.\dk)? tokens\)/);
  advance(15_000);
  assert.equal(p.state, "idle");
  const t = p.transcriptText;
  assert.match(t, /⏺ /);
  assert.ok(!/esc to interrupt/.test(screenText(screen).join("\n")), "spinner gone");
  assert.ok(/fix|bug|broken|turning it off|machine/i.test(t), t);
});

test("many prompts in a row all get answered with something and never with help", () => {
  const { p } = boot(3);
  const prompts = ["hello", "please write a component", "why", "git push", "DELETE EVERYTHING NOW", "x".repeat(200), "const a = 1;"];
  for (const q of prompts) {
    type(p, q);
    p.key("Enter", false);
    advance(20_000);
    assert.equal(p.state, "idle");
  }
  const t = p.transcriptText;
  assert.equal((t.match(/⏺ /g) ?? []).length >= prompts.length, true);
  assert.match(t, /message 3|message 6|attempts in|messages to a decorative/);
});

test("Escape interrupts and asks what to do instead", () => {
  const { p } = boot();
  type(p, "explain everything");
  p.key("Enter", false);
  mock.timers.tick(300);
  p.key("Escape", false);
  assert.equal(p.state, "idle");
  assert.match(p.transcriptText, /⎿ {2}Interrupted · What should Claude do instead\?/);
});

test("Ctrl-C twice exits and leaves the transcript in the scrollback", () => {
  const { p, h, screen } = boot();
  p.key("c", true);
  assert.equal(p.state, "idle");
  assert.ok(screenText(screen).some((r) => r.includes("Press Ctrl-C again to exit")));
  mock.timers.tick(500);
  p.key("c", true);
  assert.equal(p.state, "exited");
  const out = h.exits[0] as TerminalLine[];
  assert.equal(out[0].kind, "screen");
  if (out[0].kind === "screen") {
    const text = out[0].rows.map((r) => r.map((x) => x.text).join("")).join("\n");
    assert.match(text, /Welcome to Claude Code!/);
  }
});

test("a single Ctrl-C disarms after two seconds", () => {
  const { p, screen } = boot();
  p.key("c", true);
  mock.timers.tick(2100);
  assert.ok(!screenText(screen).some((r) => r.includes("again to exit")));
  p.key("c", true);
  assert.equal(p.state, "idle");
});

test("/exit, quit and Ctrl-D leave", () => {
  for (const how of ["/exit", "quit", "/quit", "exit"]) {
    const { p, h } = boot();
    type(p, how);
    p.key("Enter", false);
    assert.equal(p.state, "exited", how);
    assert.equal(h.exits.length, 1);
  }
  const { p } = boot();
  p.key("d", true);
  p.key("d", true);
  assert.equal(p.state, "exited");
});

test("slash commands answer at once; unknown ones are called out", () => {
  const { p } = boot();
  type(p, "/help");
  p.key("Enter", false);
  assert.equal(p.state, "idle");
  assert.match(p.transcriptText, /Claude Code v2\.1\.0/);
  assert.match(p.transcriptText, /\/status - Show Claude Code status/);
  type(p, "/cost");
  p.key("Enter", false);
  assert.match(p.transcriptText, /Total cost: {12}\$0\.00/);
  type(p, "/nonsense");
  p.key("Enter", false);
  assert.match(p.transcriptText, /Unknown slash command: \/nonsense/);
  type(p, "/vim");
  p.key("Enter", false);
  assert.match(p.transcriptText, /Vim mode enabled/);
  type(p, "/init");
  p.key("Enter", false);
  assert.match(p.transcriptText, /⏺ Write\(CLAUDE\.md\)\n {2}⎿ {2}Wrote 1 line/);
});

test("the slash menu lists matches, Tab completes and Enter runs the selection", () => {
  const { p, screen } = boot();
  type(p, "/");
  let rows = screenText(screen);
  assert.ok(rows.some((r) => /^ {2}\/clear\s+Clear conversation history/.test(r)));
  assert.ok(!rows.some((r) => r.includes("? for shortcuts")), "menu replaces the hint");
  type(p, "st");
  rows = screenText(screen);
  assert.ok(rows.some((r) => r.startsWith("  /status")));
  assert.ok(!rows.some((r) => r.startsWith("  /clear")));
  p.key("Tab", false);
  assert.equal(p.inputText, "/status");
  p.key("Backspace", false);
  p.key("Backspace", false);
  p.key("Enter", false);
  assert.match(p.transcriptText, /> \/status\n\nClaude Code Status/);
});

test("/clear empties the transcript", () => {
  const { p } = boot();
  type(p, "/clear");
  p.key("Enter", false);
  assert.equal(p.transcriptText, "");
});

test("history walks back with the arrow keys", () => {
  const { p } = boot();
  type(p, "first thing");
  p.key("Enter", false);
  p.key("Escape", false);
  type(p, "second thing");
  p.key("Enter", false);
  p.key("Escape", false);
  type(p, "dra");
  p.key("ArrowUp", false);
  assert.equal(p.inputText, "second thing");
  p.key("ArrowUp", false);
  assert.equal(p.inputText, "first thing");
  p.key("ArrowDown", false);
  p.key("ArrowDown", false);
  assert.equal(p.inputText, "dra");
});

test("long input wraps inside the box and the transcript scrolls with the wheel", () => {
  const { p, screen } = boot();
  type(p, "a".repeat(200));
  const rows = screenText(screen);
  const boxRows = rows.filter((r) => r.startsWith("│ "));
  assert.ok(boxRows.length >= 3, `input rows: ${boxRows.length}`);
  p.key("Escape", false);
  for (let i = 0; i < 6; i++) {
    type(p, "/help");
    p.key("Enter", false);
  }
  const top = () => screenText(screen).slice(0, 8).join("\n");
  const bottom = top();
  p.wheel(-10);
  assert.notEqual(top(), bottom);
  p.wheel(100);
  assert.equal(top(), bottom);
});

test("Shift-Tab cycles the mode label", () => {
  const { p, screen } = boot();
  p.key("Tab", false, true);
  assert.ok(screenText(screen).some((r) => r.includes("decline politely on")));
});

test("stop() cancels the performance", () => {
  const { p, h } = boot();
  type(p, "hello");
  p.key("Enter", false);
  p.stop();
  const paints = h.paints;
  mock.timers.tick(30_000);
  assert.equal(h.paints, paints);
  assert.equal(p.state, "exited");
});

test("start() after stop() gives a fresh session (StrictMode double mount)", () => {
  const p = new ClaudeProgram({ rand: seeded(1) });
  const h = host();
  p.start({ rows: 30, cols: 90 }, h.h);
  p.stop();
  const screen = p.start({ rows: 30, cols: 90 }, h.h);
  assert.equal(p.state, "idle");
  assert.match(screenText(screen).join("\n"), /Welcome to Claude Code!/);
  type(p, "hi");
  p.key("Enter", false);
  assert.equal(p.state, "busy");
});
