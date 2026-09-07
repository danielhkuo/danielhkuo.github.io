#!/usr/bin/env node
/**
 * Regenerate the cbonsai golden fixtures from the real program.
 *
 * Downloads cbonsai.c (GPL-3.0, https://gitlab.com/jallbrit/cbonsai), builds
 * it with a glibc `random()` shim in place of the platform `rand()` so the
 * trees match the Linux binary, runs it under a pty at fixed sizes with `-p`,
 * and parses the ANSI it prints into the same packed-row form the port's
 * Screen produces. Needs cc, ncurses headers and the `script` utility.
 *
 *   npm run goldens:cbonsai
 *   CBONSAI_SRC=/path/to/cbonsai.c npm run goldens:cbonsai
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packRow } from "../src/components/terminal/cbonsai/screen.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "components", "terminal", "cbonsai", "__fixtures__", "goldens.json");
const work = join(tmpdir(), "cbonsai-goldens");
mkdirSync(work, { recursive: true });

const SOURCE_URL = "https://gitlab.com/jallbrit/cbonsai/-/raw/master/cbonsai.c";

const SHIM = `
#include <stdint.h>
static int32_t r[34];
static int idx;
void glibc_srand(unsigned int seed) {
  if (seed == 0) seed = 1;
  r[0] = (int32_t)seed;
  for (int i = 1; i < 31; i++) {
    int64_t hi = r[i - 1] / 127773;
    int64_t lo = r[i - 1] % 127773;
    int64_t word = 16807 * lo - 2836 * hi;
    if (word < 0) word += 2147483647;
    r[i] = (int32_t)word;
  }
  for (int i = 31; i < 34; i++) r[i] = r[i - 31];
  for (int k = 34; k < 344; k++)
    r[k % 34] = (int32_t)((uint32_t)r[(k - 31) % 34] + (uint32_t)r[(k - 3) % 34]);
  idx = 344 % 34;
}
int glibc_rand(void) {
  int32_t v = (int32_t)((uint32_t)r[(idx + 3) % 34] + (uint32_t)r[(idx + 31) % 34]);
  r[idx] = v;
  idx = (idx + 1) % 34;
  return (int)((uint32_t)v >> 1);
}
`;

const LONG =
  "this is a rather long message that should need more than four lines to wrap inside the message box on this terminal";
const MEDIUM = "the quick brown fox jumps over the lazy dog and keeps on running";

/** [rows, cols, args...] */
const CASES = [
  [24, 80, "-s", "1"],
  [24, 80, "-s", "42"],
  [24, 80, "-s", "7"],
  [24, 80, "-s", "12345"],
  [24, 80, "-s", "99999"],
  [24, 80, "-s", "2026"],
  [25, 81, "-s", "42"],
  [40, 120, "-s", "42"],
  [15, 40, "-s", "3"],
  [10, 30, "-s", "42"],
  [8, 20, "-s", "42"],
  [10, 32, "-s", "42"],
  [24, 80, "-s", "42", "-b", "2"],
  [24, 80, "-s", "42", "-b", "0"],
  [24, 80, "-s", "42", "-b", "5"],
  [24, 80, "-s", "42", "-M", "1"],
  [24, 80, "-s", "42", "-M", "2"],
  [40, 120, "-s", "42", "-M", "20", "-L", "100"],
  [24, 80, "-s", "42", "-L", "5"],
  [60, 200, "-s", "42", "-L", "200", "-M", "20"],
  [24, 80, "-s", "5", "-L", "1"],
  [24, 80, "-s", "5", "-L", "3"],
  [24, 80, "-s", "42", "-c", "&,@,*"],
  // Wide leaves are covered by a unit test instead: macOS's older ncurses
  // echoes the stale half of an overwritten wide glyph through `-p`, and no
  // seed grows a leafy tree without overwriting one.
  [24, 80, "-s", "42", "-c", "ab,cd,e"],
  [24, 80, "-s", "42", "-m", "hello world"],
  [24, 80, "-s", "42", "-m", LONG],
  [24, 80, "-s", "42", "-m", MEDIUM],
  [24, 80, "-s", "42", "-m", ""],
  [24, 80, "-s", "42", "-m", "supercalifragilisticexpialidociouslylongwordthatcannotfit and more"],
  [24, 80, "-s", "42", "-m", "line one\nline two"],
  [24, 60, "-s", "42", "-m", MEDIUM],
  [24, 40, "-s", "42", "-m", LONG],
  [30, 100, "-s", "9", "-m", "tabs\tand  double  spaces"],
  [24, 80, "-s", "42", "-k", "1,4,9,12"],
  [24, 80, "-s", "42", "-k", "0x10,200,255,16"],
  [24, 80, "-s", "42", "-v"],
  [24, 80, "-s", "42", "-v", "-m", "hi"],
  [24, 80, "-s", "42", "-vv", "-m", "a verbose message"],
];

function build() {
  const src = join(work, "cbonsai.c");
  if (process.env.CBONSAI_SRC) {
    writeFileSync(src, readFileSync(process.env.CBONSAI_SRC));
  } else if (!existsSync(src)) {
    console.log(`downloading ${SOURCE_URL}`);
    execFileSync("curl", ["-sSL", SOURCE_URL, "-o", src], { stdio: "inherit" });
  }
  writeFileSync(join(work, "glibc_rand.c"), SHIM);
  const bin = join(work, "cbonsai-ref");
  execFileSync(
    "cc",
    ["-O2", "-w", "-Drand=glibc_rand", "-Dsrand=glibc_srand", src, join(work, "glibc_rand.c"), "-lncurses", "-lpanel", "-o", bin],
    { stdio: "inherit" },
  );
  return bin;
}

function runRef(bin, rows, cols, args) {
  const log = join(work, "run.out");
  const res = spawnSync("script", ["-q", log, bin, "-p", ...args], {
    env: { ...process.env, LINES: String(rows), COLUMNS: String(cols), TERM: "xterm-256color", LANG: "en_US.UTF-8" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (res.status !== 0) throw new Error(`reference exited ${res.status} for ${args.join(" ")}`);
  return readFileSync(log, "utf8");
}

/** Parse what printstdscr wrote into rows of [ch, fg, bold]. */
function parsePrinted(raw, rows) {
  const marker = "\x1b[?1049l";
  const start = raw.lastIndexOf(marker);
  if (start < 0) throw new Error("no rmcup marker in output");
  const text = raw.slice(start + marker.length);
  const out = [];
  let row = [];
  let bold = false;
  let fg = -1;
  let i = 0;
  while (i < text.length && out.length < rows) {
    const ch = text[i];
    if (ch === "\x1b") {
      if (text[i + 1] === "[") {
        let j = i + 2;
        while (j < text.length && !/[A-Za-z]/.test(text[j])) j++;
        const params = text.slice(i + 2, j);
        const final = text[j];
        if (final === "m") {
          if (params === "1") bold = true;
          else if (params === "0" || params === "") {
            bold = false;
            fg = -1;
          } else if (/^3-1$/.test(params)) fg = -1;
          else if (/^3[0-7]$/.test(params)) fg = Number(params[1]);
          else if (/^9[0-7]$/.test(params)) fg = 8 + Number(params[1]);
          else if (/^38;5;\d+$/.test(params)) fg = Number(params.split(";")[2]);
        }
        i = j + 1;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      out.push(row);
      row = [];
      i++;
      continue;
    }
    const cp = text.codePointAt(i);
    const glyph = String.fromCodePoint(cp);
    row.push([glyph, fg, bold]);
    i += glyph.length;
  }
  if (out.length !== rows) throw new Error(`expected ${rows} rows, parsed ${out.length}`);
  return out;
}

const bin = build();
const cases = [];
for (const [rows, cols, ...args] of CASES) {
  const raw = runRef(bin, rows, cols, args);
  const printed = parsePrinted(raw, rows);
  cases.push({ rows, cols, args, screen: printed.map((cells) => packRow(cells)) });
  console.log(`ok ${rows}x${cols} ${args.map((a) => JSON.stringify(a)).join(" ")}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: SOURCE_URL, cases }, null, 0) + "\n");
console.log(`wrote ${cases.length} cases to ${out}`);
