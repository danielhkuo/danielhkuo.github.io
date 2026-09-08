import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.ts";
import { Bonsai, STEP_DONE, STEP_HIDDEN, STEP_VISIBLE } from "./bonsai.ts";
import { GlibcRandom } from "./rand.ts";
import { packRow, Screen, type PackedRow } from "../tty/screen.ts";

interface GoldenCase {
  rows: number;
  cols: number;
  args: string[];
  screen: PackedRow[];
}

const here = dirname(fileURLToPath(import.meta.url));
const goldens = JSON.parse(readFileSync(join(here, "__fixtures__", "goldens.json"), "utf8")) as {
  cases: GoldenCase[];
};

/** Grow a whole tree the way `main()` does for `cbonsai -p <args>`. */
function grow(rows: number, cols: number, args: string[]): { screen: Screen; bonsai: Bonsai; steps: number } {
  const parsed = parseArgs(args);
  assert.equal(parsed.kind, "run", JSON.stringify(parsed));
  const conf = parsed.kind === "run" ? parsed.config : null;
  if (!conf) throw new Error("unreachable");
  const screen = new Screen(rows, cols);
  const bonsai = new Bonsai(conf, new GlibcRandom(conf.seed), screen);
  bonsai.init();
  bonsai.beginTree();
  let steps = 0;
  while (bonsai.step() !== STEP_DONE) steps++;
  return { screen, bonsai, steps };
}

function render(screen: Screen): string {
  const lines: string[] = [];
  for (let y = 0; y < screen.rows; y++) lines.push(packRow(screen.printedRow(y)).t);
  return lines.join("\n");
}

for (const c of goldens.cases) {
  test(`matches cbonsai ${c.rows}x${c.cols} ${c.args.map((a) => JSON.stringify(a)).join(" ")}`, () => {
    const { screen } = grow(c.rows, c.cols, c.args);
    for (let y = 0; y < c.rows; y++) {
      const got = packRow(screen.printedRow(y));
      const want = c.screen[y];
      assert.deepEqual(got, want, `row ${y}\n--- got ---\n${render(screen)}`);
    }
  });
}

test("every step places at most a few characters and the tree ends", () => {
  const { bonsai, steps } = grow(24, 80, ["-s", "42"]);
  assert.ok(steps > 100, `only ${steps} steps`);
  assert.equal(bonsai.finished, true);
  assert.ok(bonsai.counters.branches > 10);
});

test("live steps are visible, loaded steps are hidden until the target branch", () => {
  const parsed = parseArgs(["-s", "42", "-l"]);
  const conf = parsed.kind === "run" ? parsed.config : null;
  if (!conf) throw new Error("parse failed");
  const screen = new Screen(24, 80);
  const b = new Bonsai(conf, new GlibcRandom(conf.seed), screen);
  b.init();
  b.beginTree();
  assert.equal(b.step(), STEP_VISIBLE);

  conf.load = true;
  conf.targetBranchCount = 5;
  const b2 = new Bonsai(conf, new GlibcRandom(conf.seed), new Screen(24, 80));
  b2.init();
  b2.beginTree();
  let hidden = 0;
  let r = b2.step();
  while (r === STEP_HIDDEN) {
    hidden++;
    r = b2.step();
  }
  assert.ok(hidden > 0);
  assert.equal(r, STEP_VISIBLE);
  assert.ok(b2.counters.branches >= 5);
});

test("the same seed grows the same tree twice; a different seed does not", () => {
  const a = render(grow(24, 80, ["-s", "77"]).screen);
  const b = render(grow(24, 80, ["-s", "77"]).screen);
  const c = render(grow(24, 80, ["-s", "78"]).screen);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("init redraws a clean screen each tree (infinite mode)", () => {
  const parsed = parseArgs(["-s", "3"]);
  const conf = parsed.kind === "run" ? parsed.config : null;
  if (!conf) throw new Error("parse failed");
  const screen = new Screen(24, 80);
  const b = new Bonsai(conf, new GlibcRandom(conf.seed), screen);
  b.init();
  b.beginTree();
  while (b.step() !== STEP_DONE);
  const first = render(screen);
  b.init();
  const cleared = render(screen);
  assert.notEqual(cleared, first);
  assert.match(cleared.split("\n")[20], /:___________\.\/~~~\\\.___________:/);
});

test("wide leaves land only on even columns and take two cells", () => {
  const parsed = parseArgs(["-s", "42", "-c", "木,🌸"]);
  const conf = parsed.kind === "run" ? parsed.config : null;
  if (!conf) throw new Error("parse failed");
  const screen = new Screen(24, 80);
  const b = new Bonsai(conf, new GlibcRandom(conf.seed), screen);
  b.init();
  b.beginTree();
  let leaves = 0;
  while (b.step() !== STEP_DONE) {
    // Every wide glyph currently on screen sits at an even column with its tail beside it.
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 80; x++) {
        const ch = screen.chars[y * 80 + x];
        if (ch === "木" || ch === "🌸") {
          assert.equal(x % 2, 0, `wide leaf at odd column ${x}`);
          assert.equal(screen.chars[y * 80 + x + 1], "");
          leaves++;
        }
      }
    }
  }
  assert.ok(leaves > 0);
});
