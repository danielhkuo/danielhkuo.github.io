// The grow brings the window's text to the minimal version's size; these hold that size to the page's own stylesheet,
// so a change to one cannot leave the other behind.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NANO_FINE_QUERY, NANO_TEXT_FINE_PX, NANO_TEXT_PX, nanoTextPx } from "./nanoText.ts";

const css = readFileSync(new URL("../../app/minimal/minimal.css", import.meta.url), "utf8");

/** The declarations inside the first rule for `.nano` at the stylesheet's top level, or inside `@media <query>`. */
function nanoRule(media?: string): string {
  const scope = media ? css.slice(css.indexOf(`@media ${media}`)) : css;
  const at = scope.search(/(^|\n)\s*\.nano\s*\{/);
  assert.ok(at >= 0, `a .nano rule${media ? ` in @media ${media}` : ""}`);
  return scope.slice(at, scope.indexOf("}", at));
}

test("the page's own size is the grow's: 16px, and 15px on a desktop with a mouse", () => {
  assert.match(nanoRule(), new RegExp(`font-size:\\s*${NANO_TEXT_PX}px`));
  assert.ok(css.includes(`@media ${NANO_FINE_QUERY}`), `minimal.css has @media ${NANO_FINE_QUERY}`);
  assert.match(nanoRule(NANO_FINE_QUERY), new RegExp(`font-size:\\s*${NANO_TEXT_FINE_PX}px`));
});

test("the size follows the screen the way the page's does", () => {
  assert.equal(nanoTextPx(() => true), 15);
  assert.equal(nanoTextPx(() => false), 16);
});
