import assert from "node:assert/strict";
import { test } from "node:test";
import { LINKS } from "./content.ts";
import { HOME, lookup, type DirNode, type FsNode } from "./fs.ts";
import { renderMarkdown } from "./markdown.ts";
import { siteTree } from "./site.ts";
import type { SiteInfo, SlimProject } from "./types";

const REPOS: SlimProject[] = [
  {
    name: "zeta-tool",
    description: "A sample project showcasing modern web development",
    url: "https://github.com/danielhkuo/zeta-tool",
    homepageUrl: "https://www.example.com/",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", percentage: 65.44 },
      { name: "JavaScript", percentage: 34.52 },
      { name: "Makefile", percentage: 0.04 },
    ],
    stargazerCount: 42,
    forkCount: 7,
    updatedAt: "2026-09-08T12:00:00Z",
  },
  {
    name: "Alpha",
    description: "",
    url: "https://github.com/danielhkuo/Alpha",
    homepageUrl: null,
    primaryLanguage: null,
    languages: [],
    stargazerCount: 0,
    forkCount: 0,
    updatedAt: "2026-08-29T12:00:00Z",
  },
];

const SITE: SiteInfo = { builtAt: "2026-10-06T09:14:02Z", resumeBytes: 145439 };

const TREE = siteTree(REPOS, SITE);

function at(path: string, tree: DirNode = TREE): FsNode {
  const found = lookup(tree, HOME, path);
  assert.ok(!("errno" in found), `${path}: ${"errno" in found ? found.errno : ""}`);
  return found.node;
}

function names(path: string, tree: DirNode = TREE): string[] {
  const node = at(path, tree);
  assert.equal(node.kind, "dir");
  return node.kind === "dir" ? node.children.map((c) => c.name) : [];
}

function source(path: string): string {
  const node = at(path);
  assert.equal(node.kind, "file");
  return (node.kind === "file" && node.text) || "";
}

/** Every link target in a rendered file. */
function hrefs(path: string): string[] {
  return renderMarkdown(source(path), 80)
    .flat()
    .flatMap((r) => (r.href ? [r.href] : []));
}

test("home holds the bio, the contact card, the projects and the résumé", () => {
  assert.deepEqual(names("~"), ["about.md", "contact.md", "projects", "resume.pdf"]);
});

test("home is /Users/daniel, and nothing else is above it", () => {
  assert.deepEqual(names("/"), ["Users"]);
  assert.deepEqual(names("/Users"), ["daniel"]);
});

test("every pinned repo is a directory under its own name, holding a README", () => {
  assert.deepEqual(names("projects"), ["Alpha", "zeta-tool"]);
  assert.deepEqual(names("projects/zeta-tool"), ["README.md"]);
});

test("with no pinned repos, projects is an empty directory", () => {
  assert.deepEqual(names("projects", siteTree([], SITE)), []);
});

test("a README gives the repo's description, counts, last update and language mix", () => {
  const readme = source("projects/zeta-tool/README.md");
  assert.match(readme, /^# zeta-tool$/m);
  assert.match(readme, /^A sample project showcasing modern web development$/m);
  assert.match(readme, /Stars\*\* 42$/m);
  assert.match(readme, /Forks\*\* 7$/m);
  assert.match(readme, /Updated\*\* 8 Sep 2026$/m);
  assert.match(readme, /^- TypeScript 65\.4%$/m);
  assert.match(readme, /^- JavaScript 34\.5%$/m);
});

test("a language too small to round above zero is left out of the mix", () => {
  assert.doesNotMatch(source("projects/zeta-tool/README.md"), /Makefile/);
});

test("a README links the repository and its homepage, labelled by address", () => {
  assert.deepEqual(hrefs("projects/zeta-tool/README.md"), [
    "https://github.com/danielhkuo/zeta-tool",
    "https://www.example.com/",
  ]);
  const readme = source("projects/zeta-tool/README.md");
  assert.match(readme, /\[github\.com\/danielhkuo\/zeta-tool\]/);
  assert.match(readme, /\[example\.com\]/);
});

test("a repo with no description, languages or homepage has a README without those parts", () => {
  const readme = source("projects/Alpha/README.md");
  assert.match(readme, /^# Alpha$/m);
  assert.doesNotMatch(readme, /Languages/);
  assert.deepEqual(hrefs("projects/Alpha/README.md"), ["https://github.com/danielhkuo/Alpha"]);
});

test("a repo's directory and its README open the repository", () => {
  assert.equal(at("projects/zeta-tool").url, "https://github.com/danielhkuo/zeta-tool");
  assert.equal(at("projects/zeta-tool/README.md").url, "https://github.com/danielhkuo/zeta-tool");
});

test("resume.pdf opens the PDF and is as big as the PDF", () => {
  const resume = at("resume.pdf");
  assert.equal(resume.url, LINKS.resume);
  assert.equal(resume.kind === "file" && resume.size, 145439);
  assert.equal(resume.kind === "file" && resume.text, undefined);
});

test("a repo is dated by its last update; the site's own files by the build", () => {
  assert.equal(at("projects/zeta-tool").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("projects/zeta-tool/README.md").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("about.md").mtime, SITE.builtAt);
  assert.equal(at("resume.pdf").mtime, SITE.builtAt);
});

test("the projects directory is dated by its most recently updated repo", () => {
  assert.equal(at("projects").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("projects", siteTree([], SITE)).mtime, SITE.builtAt);
});

test("the contact card links the mailbox, GitHub and LinkedIn", () => {
  assert.deepEqual(hrefs("contact.md"), [LINKS.email, LINKS.github, LINKS.linkedin]);
});

test("about.md is readable: it renders to text under a title bar", () => {
  const rows = renderMarkdown(source("about.md"), 80);
  const title = rows.flat().find((r) => r.bg !== undefined && r.bold);
  assert.ok(title, "no title bar");
  assert.ok(rows.length > 4);
});
