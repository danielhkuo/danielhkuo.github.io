import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.ts";
import type { TextRun } from "./types";

/** The rows as plain text. */
function text(rows: TextRun[][]): string[] {
  return rows.map((runs) => runs.map((r) => r.text).join(""));
}

/** The run whose text is exactly `s`. */
function run(rows: TextRun[][], s: string): TextRun {
  const found = rows.flat().find((r) => r.text === s);
  assert.ok(found, `no run ${JSON.stringify(s)} in ${JSON.stringify(text(rows))}`);
  return found;
}

test("a paragraph wraps at the width, inside a two-cell margin on each side", () => {
  assert.deepEqual(text(renderMarkdown("one two three four five", 14)), [
    "",
    "  one two",
    "  three four",
    "  five",
    "",
  ]);
});

test("lines of a paragraph join; a blank line starts the next one", () => {
  assert.deepEqual(text(renderMarkdown("a\nb\n\n\nc\n", 40)), ["", "  a b", "", "  c", ""]);
});

test("runs of spaces inside a line collapse to one", () => {
  assert.deepEqual(text(renderMarkdown("- **School**   Rice    CS", 40)), ["", "  • School Rice CS", ""]);
});

test("an empty document renders nothing", () => {
  assert.deepEqual(renderMarkdown("", 40), []);
  assert.deepEqual(renderMarkdown("\n\n", 40), []);
});

test("a top-level heading is a bold bar, padded a cell each side", () => {
  const rows = renderMarkdown("# Daniel Kuo", 40);
  assert.deepEqual(text(rows), ["", "   Daniel Kuo ", ""]);
  const bar = run(rows, " Daniel Kuo ");
  assert.equal(bar.bold, true);
  assert.equal(typeof bar.bg, "number");
});

test("lower headings keep their marker and have no bar", () => {
  const rows = renderMarkdown("## Links\n\n### More", 40);
  assert.deepEqual(text(rows), ["", "  ## Links", "", "  ### More", ""]);
  const heading = run(rows, "## Links");
  assert.equal(heading.bold, true);
  assert.equal(heading.bg, undefined);
});

test("list items get a bullet, with no blank row between them", () => {
  assert.deepEqual(text(renderMarkdown("intro\n\n- one\n- two\n\noutro", 40)), [
    "",
    "  intro",
    "",
    "  • one",
    "  • two",
    "",
    "  outro",
    "",
  ]);
});

test("a wrapped list item hangs under its own text, not under the bullet", () => {
  assert.deepEqual(text(renderMarkdown("- alpha beta gamma", 14)), ["", "  • alpha", "    beta", "    gamma", ""]);
});

test("**strong** text is bold and loses its markers", () => {
  const rows = renderMarkdown("a **b c** d", 40);
  assert.deepEqual(text(rows), ["", "  a b c d", ""]);
  assert.equal(run(rows, "b c").bold, true);
  assert.equal(run(rows, "a ").bold, undefined);
});

test("`code` is padded a cell each side on its own ground", () => {
  const rows = renderMarkdown("run `ls` now", 40);
  assert.deepEqual(text(rows), ["", "  run  ls  now", ""]);
  assert.equal(typeof run(rows, " ls ").bg, "number");
});

test("a code span moves to the next row whole rather than break at its spaces", () => {
  assert.deepEqual(text(renderMarkdown("aaaa `b c`", 12)), ["", "  aaaa", "   b c ", ""]);
});

test("a link shows its label, underlined, and carries its target", () => {
  const rows = renderMarkdown("see [the site](https://example.com) today", 40);
  assert.deepEqual(text(rows), ["", "  see the site today", ""]);
  const link = run(rows, "the site");
  assert.equal(link.href, "https://example.com");
  assert.equal(link.underline, true);
});

test("a link that wraps is a link on every row it lands on", () => {
  const rows = renderMarkdown("[one two](mailto:a@b.co)", 9);
  assert.deepEqual(text(rows), ["", "  one", "  two", ""]);
  assert.equal(run(rows, "one").href, "mailto:a@b.co");
  assert.equal(run(rows, "two").href, "mailto:a@b.co");
});

test("a link to anything but the web or a mailbox is left as plain text", () => {
  const rows = renderMarkdown("[click](javascript:void) [mail](mailto:a@b.co) [web](HTTPS://b.co)", 60);
  assert.equal(run(rows, "click").href, undefined);
  assert.equal(run(rows, "click").underline, undefined);
  assert.equal(run(rows, "mail").href, "mailto:a@b.co");
  assert.equal(run(rows, "web").href, "HTTPS://b.co");
});

test("inline markup works inside list items and headings", () => {
  const rows = renderMarkdown("- **School** Rice\n\n## See `ls`", 40);
  assert.deepEqual(text(rows), ["", "  • School Rice", "", "  ## See  ls ", ""]);
  assert.equal(run(rows, "School").bold, true);
});

test("a word wider than the row is broken across rows", () => {
  assert.deepEqual(text(renderMarkdown("abcdefghij", 10)), ["", "  abcdef", "  ghij", ""]);
});

test("wide glyphs count as two cells when wrapping", () => {
  assert.deepEqual(text(renderMarkdown("日本語 abc", 11)), ["", "  日本語", "  abc", ""]);
});

test("the document stops at 80 columns however wide the window is", () => {
  const rows = text(renderMarkdown("word ".repeat(60), 200));
  const widest = Math.max(...rows.map((r) => r.length));
  // 15 words and the 14 spaces between them are 74 cells; a 16th would pass
  // the 76 between the margins.
  assert.equal(widest, 2 + 74);
});
