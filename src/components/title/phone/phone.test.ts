import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PHONE_QUERY } from "./phone.ts";
import { MINIMAL_PAGE, PHONE_DEFAULT, phoneEntries, TERMINAL_PAGE } from "./copy.ts";

test("the switch's CSS uses the phone query, and hides the other side with display: none", () => {
  const css = readFileSync(new URL("./PhoneSwitch.module.css", import.meta.url), "utf8");
  assert.ok(css.includes(`@media ${PHONE_QUERY} {`), "the media query matches PHONE_QUERY");
  // Outside the query the phone side is display: none; inside it the desktop side is.
  assert.match(css, /\.phone \{\s*display: none;/);
  assert.match(css, /@media[^{]+\{[\s\S]*\.desk \{\s*display: none;/);
  // The desktop side is display: contents, so the page lays out exactly as it did without the switch.
  assert.match(css, /\.desk \{\s*display: contents;/);
});

test("the minimal version leads the phone's ways in and opens preselected; flying comes second, sideways", () => {
  const e = phoneEntries(1.5);
  assert.deepEqual(e.map((x) => x.label), ["Minimal version", "Enter world", "agents.md"]);
  assert.equal(e[0].href, MINIMAL_PAGE);
  assert.equal(e[0].lead, true);
  assert.equal(PHONE_DEFAULT, e[0].id);
  assert.equal(e[1].href, "/world");
  assert.equal(e[1].sideways, true);
  assert.match(e[1].meta ?? "", /about 1\.5 MB/);
  assert.equal(phoneEntries(0)[1].meta, "turn sideways");
  assert.equal(e[2].href, "/agents.md");
  // The terminal is folded into the minimal version: no way in of its own.
  assert.ok(e.every((x) => x.href !== TERMINAL_PAGE));
});
