#!/usr/bin/env node
/**
 * Throughput and memory of the cbonsai engine, outside the browser.
 *
 *   npm run bench:cbonsai
 *
 * Grows whole trees on an in-memory Screen and reports trees/s and steps/s
 * for the default settings, a large terminal, and the heaviest documented
 * settings (-L 200 -M 20), then checks the heap stays flat across thousands
 * of trees the way infinite mode would grow them.
 */
import { parseArgs } from "../src/components/terminal/cbonsai/args.ts";
import { Bonsai, STEP_DONE } from "../src/components/terminal/cbonsai/bonsai.ts";
import { GlibcRandom } from "../src/components/terminal/cbonsai/rand.ts";
import { Screen } from "../src/components/terminal/cbonsai/screen.ts";

function growOne(conf, screen, seed) {
  const bonsai = new Bonsai(conf, new GlibcRandom(seed), screen);
  bonsai.init();
  bonsai.beginTree();
  let steps = 0;
  while (bonsai.step() !== STEP_DONE) steps++;
  return steps;
}

function bench(label, rows, cols, args, seconds = 2) {
  const conf = parseArgs(args).config;
  const screen = new Screen(rows, cols);
  // Warm up the JIT.
  for (let i = 0; i < 50; i++) growOne(conf, screen, i + 1);
  const end = performance.now() + seconds * 1000;
  let trees = 0;
  let steps = 0;
  const start = performance.now();
  while (performance.now() < end) {
    steps += growOne(conf, screen, trees + 1);
    trees++;
  }
  const secs = (performance.now() - start) / 1000;
  const perTree = (secs * 1000) / trees;
  console.log(
    `${label.padEnd(34)} ${String(trees).padStart(6)} trees  ${(trees / secs).toFixed(0).padStart(6)} trees/s  ` +
      `${(steps / trees).toFixed(0).padStart(7)} steps/tree  ${(steps / secs / 1e6).toFixed(2).padStart(6)} M steps/s  ${perTree.toFixed(3)} ms/tree`,
  );
  return { trees, steps, secs };
}

function benchRender(label, rows, cols, args, seconds = 2) {
  // Cost of turning dirty rows into runs — what the DOM renderer pays per frame.
  const conf = parseArgs(args).config;
  const screen = new Screen(rows, cols);
  const bonsai = new Bonsai(conf, new GlibcRandom(42), screen);
  bonsai.init();
  bonsai.beginTree();
  let frames = 0;
  let rowsRendered = 0;
  let done = false;
  const end = performance.now() + seconds * 1000;
  const start = performance.now();
  while (performance.now() < end) {
    // Two growth steps per frame, as `-t 0.03` at 60 Hz does.
    for (let i = 0; i < 2 && !done; i++) done = bonsai.step() === STEP_DONE;
    for (const y of screen.takeDirty()) {
      screen.rowRuns(y);
      rowsRendered++;
    }
    frames++;
    if (done) {
      bonsai.init();
      bonsai.beginTree();
      done = false;
    }
  }
  const secs = (performance.now() - start) / 1000;
  console.log(
    `${label.padEnd(34)} ${String(frames).padStart(6)} frames ${((secs * 1e6) / frames).toFixed(1).padStart(7)} µs/frame  ` +
      `${(rowsRendered / frames).toFixed(1)} rows/frame`,
  );
}

function benchRandom() {
  const rng = new GlibcRandom(1);
  const n = 20_000_000;
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < n; i++) acc ^= rng.next();
  const secs = (performance.now() - start) / 1000;
  console.log(`${"glibc rand()".padEnd(34)} ${(n / secs / 1e6).toFixed(0).padStart(6)} M calls/s (${acc & 1})`);
}

function memoryCheck() {
  const conf = parseArgs(["-l", "-i"]).config;
  const screen = new Screen(40, 120);
  const mb = () => process.memoryUsage().heapUsed / 1048576;
  globalThis.gc?.();
  const before = mb();
  for (let i = 0; i < 2000; i++) growOne(conf, screen, i + 1);
  globalThis.gc?.();
  const after = mb();
  console.log(
    `${"heap after 2000 trees (40x120)".padEnd(34)} ${before.toFixed(1)} MB -> ${after.toFixed(1)} MB` +
      (globalThis.gc ? "" : "  (run with --expose-gc for a settled number)"),
  );
}

console.log(`node ${process.version}\n`);
benchRandom();
bench("default 80x24", 24, 80, ["-s", "1"]);
bench("default 200x60", 60, 200, ["-s", "1"]);
bench("-M 20 -L 100 120x40", 40, 120, ["-M", "20", "-L", "100"]);
bench("-L 200 -M 20 200x60 (worst)", 60, 200, ["-L", "200", "-M", "20"]);
bench("message + verbose 80x24", 24, 80, ["-m", "a message that wraps across lines", "-v"]);
console.log();
benchRender("render 80x24, 2 steps/frame", 24, 80, ["-l"]);
benchRender("render 200x60, 2 steps/frame", 60, 200, ["-l"]);
console.log();
memoryCheck();
