import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME, dir, file, type DirNode } from "./fs.ts";
import { ls, type LsEnv } from "./ls.ts";
import type { TextRun } from "./types";

const RECENT = "2026-09-08T12:00:00Z";
const OLD = "2025-01-15T08:30:00Z";

// /Users/daniel/{about.md, projects/{alpha/, Beta/}, resume.pdf}
const ROOT: DirNode = dir("", RECENT, [
  dir("Users", RECENT, [
    dir("daniel", RECENT, [
      file("about.md", RECENT, { size: 412 }),
      dir("projects", RECENT, [dir("alpha", RECENT, []), dir("Beta", OLD, [])]),
      file("resume.pdf", OLD, { size: 145439 }),
    ]),
  ]),
]);

function env(over: Partial<LsEnv> = {}): LsEnv {
  return { root: ROOT, cwd: HOME, cols: 80, now: new Date("2026-10-06T09:00:00Z"), ...over };
}

function text(rows: TextRun[][]): string[] {
  return rows.map((runs) => runs.map((r) => r.text).join(""));
}

/** What `ls` prints: its rows as text. Fails if it also reported errors. */
function out(args: string[], over: Partial<LsEnv> = {}): string[] {
  const result = ls(args, env(over));
  assert.deepEqual(result.errors, []);
  return text(result.rows);
}

test("the working directory lists in name order, in columns a tab stop past the longest name", () => {
  assert.deepEqual(out([]), ["about.md        projects/       resume.pdf"]);
});

test("columns fill downwards before they fill across", () => {
  assert.deepEqual(out([], { cols: 40 }), ["about.md        resume.pdf", "projects/"]);
});

test("names go one per line when two columns do not fit", () => {
  assert.deepEqual(out([], { cols: 31 }), ["about.md", "projects/", "resume.pdf"]);
  assert.deepEqual(out([], { cols: 32 }), ["about.md        resume.pdf", "projects/"]);
});

test("-1 lists one name per line however wide the window is", () => {
  assert.deepEqual(out(["-1"]), ["about.md", "projects/", "resume.pdf"]);
});

test("a directory operand lists that directory", () => {
  assert.deepEqual(out(["projects"]), ["Beta/   alpha/"]);
  assert.deepEqual(out(["~/projects/"], { cwd: [] }), ["Beta/   alpha/"]);
});

test("an empty directory lists nothing", () => {
  assert.deepEqual(out(["projects/alpha"]), []);
});

test("a file operand lists just that file, as it was named", () => {
  assert.deepEqual(out(["about.md"]), ["about.md"]);
  assert.deepEqual(out(["../about.md"], { cwd: [...HOME, "projects"] }), ["../about.md"]);
});

test("directories are coloured and files are not", () => {
  const runs = ls([], env()).rows.flat();
  assert.equal(typeof runs.find((r) => r.text === "projects/")?.fg, "number");
  const plain = runs.find((r) => r.text === "about.md");
  assert.ok(plain);
  assert.equal(plain.fg, undefined);
});

test("-a adds . and ..", () => {
  assert.deepEqual(out(["-a"]), ["./              ../             about.md        projects/       resume.pdf"]);
});

test("-l gives mode, links, owner, group, size and date, under a block total", () => {
  assert.deepEqual(out(["-l"]), [
    "total 296",
    "-rw-r--r--  1 daniel  staff     412 Sep  8 12:00 about.md",
    "drwxr-xr-x  4 daniel  staff     128 Sep  8 12:00 projects/",
    "-rw-r--r--  1 daniel  staff  145439 Jan 15  2025 resume.pdf",
  ]);
});

test("-la counts . and .. as the directory and its parent", () => {
  assert.deepEqual(out(["-la"]).slice(0, 3), [
    "total 296",
    "drwxr-xr-x  5 daniel  staff     160 Sep  8 12:00 ./",
    "drwxr-xr-x  3 daniel  staff      96 Sep  8 12:00 ../",
  ]);
  assert.deepEqual(out(["-l", "-a"]), out(["-la"]));
});

test("the root is its own parent", () => {
  assert.deepEqual(out(["-la", "/"]), [
    "total 0",
    "drwxr-xr-x  3 daniel  staff  96 Sep  8 12:00 ./",
    "drwxr-xr-x  3 daniel  staff  96 Sep  8 12:00 ../",
    "drwxr-xr-x  3 daniel  staff  96 Sep  8 12:00 Users/",
  ]);
});

test("-h prints long sizes in units", () => {
  assert.deepEqual(out(["-lh"]), [
    "total 296",
    "-rw-r--r--  1 daniel  staff  412B Sep  8 12:00 about.md",
    "drwxr-xr-x  4 daniel  staff  128B Sep  8 12:00 projects/",
    "-rw-r--r--  1 daniel  staff  142K Jan 15  2025 resume.pdf",
  ]);
});

test("a long listing of a file has no total", () => {
  assert.deepEqual(out(["-l", "about.md"]), ["-rw-r--r--  1 daniel  staff  412 Sep  8 12:00 about.md"]);
});

test("a date more than six months from now shows its year instead of its time", () => {
  const then = new Date("2027-06-01T00:00:00Z");
  assert.deepEqual(out(["-l", "about.md"], { now: then }), ["-rw-r--r--  1 daniel  staff  412 Sep  8  2026 about.md"]);
});

test("several operands list files first, then each directory under its name", () => {
  assert.deepEqual(out(["projects", "about.md", "."]), [
    "about.md",
    "",
    ".:",
    "about.md        projects/       resume.pdf",
    "",
    "projects:",
    "Beta/   alpha/",
  ]);
});

test("a missing operand is reported and the others still list", () => {
  const result = ls(["nope", "projects"], env());
  assert.deepEqual(result.errors, ["ls: nope: No such file or directory"]);
  assert.deepEqual(text(result.rows), ["projects:", "Beta/   alpha/"]);
});

test("an operand through a file is not a directory", () => {
  const result = ls(["about.md/x"], env());
  assert.deepEqual(result.errors, ["ls: about.md/x: Not a directory"]);
  assert.deepEqual(result.rows, []);
});

test("an unknown option is an error that names it, and nothing lists", () => {
  const result = ls(["-lz"], env());
  assert.equal(result.errors[0], "ls: illegal option -- z");
  assert.deepEqual(result.rows, []);
});

test("-- ends the options", () => {
  const result = ls(["--", "-l"], env());
  assert.deepEqual(result.errors, ["ls: -l: No such file or directory"]);
});
