// The title's keys, now that its window is the one live terminal on a desktop: a printable key or ⌘K/backtick makes the
// prompt under `./world` live, ⏎ goes into the world, and the live prompt itself takes ⏎ and Esc as the terminal says.

import assert from "node:assert/strict";
import { test } from "node:test";
import { promptKey, titleKey, type KeyLike, type TitleKeyState } from "./titleKeys.ts";

const TITLE: TitleKeyState = { mode: "title", opening: false, ready: true, dialogOpen: false, promptFocused: false, target: "other" };
const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, ...mods,
});

test("a printable key makes the prompt live and is typed into it", () => {
  assert.deepEqual(titleKey(TITLE, key("l")), { kind: "focus", insert: "l" });
  assert.deepEqual(titleKey(TITLE, key("L")), { kind: "focus", insert: "L" });
  assert.deepEqual(titleKey(TITLE, key(".")), { kind: "focus", insert: "." });
  assert.deepEqual(titleKey(TITLE, key(" ")), { kind: "focus", insert: " " });
});

test("⌘K, Ctrl+K and backtick focus the prompt and type nothing: there is no second window", () => {
  assert.deepEqual(titleKey(TITLE, key("k", { metaKey: true })), { kind: "focus", insert: "" });
  assert.deepEqual(titleKey(TITLE, key("K", { ctrlKey: true })), { kind: "focus", insert: "" });
  assert.deepEqual(titleKey(TITLE, key("`")), { kind: "focus", insert: "" });
});

test("⏎ goes into the world once the ways in are up (or the world is arriving), as Enter world does", () => {
  assert.deepEqual(titleKey(TITLE, key("Enter")), { kind: "enter" });
  assert.deepEqual(titleKey({ ...TITLE, ready: false }, key("Enter")), { kind: "none" });
});

test("during the opening a key only skips it", () => {
  const opening = { ...TITLE, opening: true, ready: false };
  for (const k of ["l", "Enter", "Escape", "ArrowDown"]) assert.deepEqual(titleKey(opening, key(k)), { kind: "skip" }, k);
});

test("a control keeps its own keys, and nothing reaches the title while it is not up", () => {
  const control = { ...TITLE, target: "control" as const };
  assert.deepEqual(titleKey(control, key("Enter")), { kind: "none" }, "⏎ presses the focused button or link");
  assert.deepEqual(titleKey(control, key(" ")), { kind: "none" }, "Space presses it too");
  assert.deepEqual(titleKey(control, key("l")), { kind: "focus", insert: "l" }, "a letter still goes to the prompt");
  for (const mode of ["leaving", "flying", "returning"] as const) {
    assert.deepEqual(titleKey({ ...TITLE, mode }, key("l")), { kind: "none" }, mode);
  }
  assert.deepEqual(titleKey({ ...TITLE, dialogOpen: true }, key("l")), { kind: "none" }, "the options own their keys");
  assert.deepEqual(titleKey({ ...TITLE, target: "field" }, key("l")), { kind: "none" }, "a field owns its keys");
  assert.deepEqual(titleKey({ ...TITLE, promptFocused: true }, key("l")), { kind: "none" }, "the live prompt takes its own");
  assert.deepEqual(titleKey(TITLE, key("l", { defaultPrevented: true })), { kind: "none" });
  assert.deepEqual(titleKey(TITLE, key("c", { metaKey: true })), { kind: "none" }, "the browser's own shortcuts are left alone");
  assert.deepEqual(titleKey(TITLE, key("l", { altKey: true })), { kind: "none" });
  assert.deepEqual(titleKey(TITLE, key("Escape")), { kind: "none" }, "Esc on the title does what it did: nothing");
  assert.deepEqual(titleKey(TITLE, key("Tab")), { kind: "none" }, "Tab moves focus as ever");
});

test("in the live prompt: ⏎ on an empty line goes into the world, Esc clears a typed line, the rest is the shell's", () => {
  assert.equal(promptKey("", "Enter"), "enter");
  assert.equal(promptKey("   ", "Enter"), "enter", "spaces alone are an empty line");
  assert.equal(promptKey("ls", "Enter"), null, "a typed line is run by the shell");
  assert.equal(promptKey("ls -la", "Escape"), "clear");
  assert.equal(promptKey("", "Escape"), null, "on an empty line Esc does what it did");
  assert.equal(promptKey("l", "Tab"), null);
  assert.equal(promptKey("", "ArrowUp"), null, "history is the shell's");
});
