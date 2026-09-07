import assert from "node:assert/strict";
import { test } from "node:test";
import { wcwidth } from "./wcwidth.ts";

test("widths agree with libc for the glyphs people put in leaves", () => {
  // Values checked against macOS libc wcwidth (same as glibc for these).
  assert.equal(wcwidth(0x1f338), 2); // 🌸
  assert.equal(wcwidth(0x1f340), 2); // 🍀
  assert.equal(wcwidth(0x6728), 2); // 木
  assert.equal(wcwidth(0x1f600), 2); // 😀
  assert.equal(wcwidth(0xe9), 1); // é
  assert.equal(wcwidth(0x2603), 1); // ☃
  assert.equal(wcwidth(0x26), 1); // &
  assert.equal(wcwidth(0xac00), 2); // 가
  assert.equal(wcwidth(0xff21), 2); // Ａ
});
