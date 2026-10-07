import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME, absPath, completions, dir, file, lookup, tildePath, type DirNode, type Lookup } from "./fs.ts";

const T = "2026-09-08T12:00:00Z";

// /Users/daniel/{about.md, projects/{alpha/README.md, Beta/}}
const ROOT: DirNode = dir("", T, [
  dir("Users", T, [
    dir("daniel", T, [
      dir("projects", T, [dir("alpha", T, [file("README.md", T, { text: "a" })]), dir("Beta", T, [])]),
      file("about.md", T, { text: "# hi\n" }),
    ]),
  ]),
]);

const PROJECTS = [...HOME, "projects"];

/** Where a path lands, as "/a/b" — or the errno it fails with. */
function where(r: Lookup): string {
  return "errno" in r ? r.errno : absPath(r.path);
}

test("a relative path resolves from the working directory", () => {
  assert.equal(where(lookup(ROOT, HOME, "projects")), "/Users/daniel/projects");
  assert.equal(where(lookup(ROOT, PROJECTS, "alpha/README.md")), "/Users/daniel/projects/alpha/README.md");
  assert.equal(where(lookup(ROOT, PROJECTS, "about.md")), "ENOENT");
});

test("~ is home wherever the working directory is", () => {
  assert.equal(where(lookup(ROOT, [], "~")), "/Users/daniel");
  assert.equal(where(lookup(ROOT, ["Users"], "~/projects/alpha")), "/Users/daniel/projects/alpha");
});

test("an absolute path ignores the working directory", () => {
  assert.equal(where(lookup(ROOT, PROJECTS, "/Users")), "/Users");
  assert.equal(where(lookup(ROOT, PROJECTS, "/")), "/");
});

test(". stays, .. goes up, and extra slashes are ignored", () => {
  assert.equal(where(lookup(ROOT, HOME, "projects/./alpha/../Beta//")), "/Users/daniel/projects/Beta");
  assert.equal(where(lookup(ROOT, PROJECTS, "..")), "/Users/daniel");
  assert.equal(where(lookup(ROOT, HOME, ".")), "/Users/daniel");
});

test(".. at the root stays at the root", () => {
  assert.equal(where(lookup(ROOT, HOME, "../../../..")), "/");
});

test("names match in any case and resolve to their real spelling", () => {
  assert.equal(where(lookup(ROOT, HOME, "PROJECTS/beta")), "/Users/daniel/projects/Beta");
});

test("a lookup returns the node it found", () => {
  const r = lookup(ROOT, HOME, "about.md");
  assert.ok(!("errno" in r));
  assert.equal(r.node.kind, "file");
  assert.equal(r.node.name, "about.md");
});

test("a missing name is ENOENT", () => {
  assert.equal(where(lookup(ROOT, HOME, "nope")), "ENOENT");
  assert.equal(where(lookup(ROOT, HOME, "projects/nope/alpha")), "ENOENT");
});

test("a path through a file is ENOTDIR", () => {
  assert.equal(where(lookup(ROOT, HOME, "about.md/x")), "ENOTDIR");
  assert.equal(where(lookup(ROOT, HOME, "about.md/..")), "ENOTDIR");
});

test("tildePath abbreviates home, as zsh's %~ does", () => {
  assert.equal(tildePath(HOME), "~");
  assert.equal(tildePath(PROJECTS), "~/projects");
  assert.equal(tildePath(["Users"]), "/Users");
  assert.equal(tildePath([]), "/");
});

test("a directory lists its entries in name order, whatever order they were given", () => {
  const d = dir("d", T, [file("b", T, {}), dir("a", T, []), file("C", T, {})]);
  assert.deepEqual(d.children.map((c) => c.name), ["C", "a", "b"]);
});

test("a text file's size is its length in bytes", () => {
  assert.equal(file("a.md", T, { text: "héllo\n" }).size, 7);
  assert.equal(file("a.pdf", T, { size: 145439 }).size, 145439);
});

test("an empty word completes to every entry of the working directory", () => {
  assert.deepEqual(completions(ROOT, HOME, ""), ["about.md", "projects/"]);
});

test("a partial name completes to the entries that start with it, in any case", () => {
  assert.deepEqual(completions(ROOT, HOME, "pro"), ["projects/"]);
  assert.deepEqual(completions(ROOT, PROJECTS, "b"), ["Beta/"]);
  assert.deepEqual(completions(ROOT, HOME, "x"), []);
});

test("a word with a directory part completes inside it, spelled as typed", () => {
  assert.deepEqual(completions(ROOT, HOME, "projects/"), ["projects/Beta/", "projects/alpha/"]);
  assert.deepEqual(completions(ROOT, [], "~/proj"), ["~/projects/"]);
  assert.deepEqual(completions(ROOT, PROJECTS, "../ab"), ["../about.md"]);
  assert.deepEqual(completions(ROOT, PROJECTS, "/Users/daniel/a"), ["/Users/daniel/about.md"]);
});

test("nothing completes inside a file or a missing directory", () => {
  assert.deepEqual(completions(ROOT, HOME, "about.md/"), []);
  assert.deepEqual(completions(ROOT, HOME, "nope/"), []);
});

test("directory-only completion leaves files out", () => {
  assert.deepEqual(completions(ROOT, HOME, "", "dir"), ["projects/"]);
  assert.deepEqual(completions(ROOT, PROJECTS, "alpha/", "dir"), []);
});
