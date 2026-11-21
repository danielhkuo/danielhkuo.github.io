// The grow brings the window's text to the minimal version's size; these hold that size to the page's own stylesheet,
// so a change to one cannot leave the other behind.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NANO_FINE_QUERY, NANO_TEXT_FINE_PX, NANO_TEXT_PX, nanoTextPx } from "./nanoText.ts";

const css = readFileSync(new URL("../../app/minimal/minimal.css", import.meta.url), "utf8");

/** The declarations inside the first rule for `selector` at the stylesheet's top level, or inside `@media <query>`. */
function rule(selector: RegExp, name: string, media?: string): string {
  const scope = media ? css.slice(css.indexOf(`@media ${media}`)) : css;
  const at = scope.search(new RegExp(`(^|\\n)\\s*${selector.source}\\s*\\{`));
  assert.ok(at >= 0, `a ${name} rule${media ? ` in @media ${media}` : ""}`);
  return scope.slice(at, scope.indexOf("}", at));
}

/** The page sets its one size as `--nano-size` on the root, and the text takes it. */
const nanoRoot = (media?: string) => rule(/:root:has\(\.nano\)/, ":root:has(.nano)", media);
const nanoRule = () => rule(/\.nano/, ".nano");

test("the page's own size is the grow's: 16px, and 15px on a desktop with a mouse", () => {
  assert.match(nanoRule(), /font-size:\s*var\(--nano-size\)/);
  assert.match(nanoRoot(), new RegExp(`--nano-size:\\s*${NANO_TEXT_PX}px`));
  assert.ok(css.includes(`@media ${NANO_FINE_QUERY}`), `minimal.css has @media ${NANO_FINE_QUERY}`);
  assert.match(nanoRoot(NANO_FINE_QUERY), new RegExp(`--nano-size:\\s*${NANO_TEXT_FINE_PX}px`));
});

test("the size follows the screen the way the page's does", () => {
  assert.equal(nanoTextPx(() => true), 15);
  assert.equal(nanoTextPx(() => false), 16);
});
