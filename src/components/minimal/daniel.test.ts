import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL, LINKS, PROFILE } from "../terminal/content.ts";
import { contactLinks, otherPages, type Project } from "../../lib/site-content.ts";
import { COLUMNS, danielTxt, labelWidth, lineNumbers, nameWidth, plainText, type Link } from "./daniel.ts";

const repo = (over: Partial<Project>): Project => ({
  name: "zeta-tool",
  description: "A sample project\nshowcasing modern web development",
  url: "https://github.com/danielhkuo/zeta-tool",
  homepageUrl: null,
  primaryLanguage: { name: "TypeScript" },
  languages: [],
  stargazerCount: 42,
  forkCount: 7,
  updatedAt: "2026-09-08T12:00:00Z",
  ...over,
});

const REPOS = [
  repo({ homepageUrl: "example.com/app" }),
  repo({ name: "Alpha", url: "https://github.com/danielhkuo/Alpha", description: "", primaryLanguage: null }),
];
const PAGES = otherPages("/minimal");

test("the file opens on the name and the title, from content.ts", () => {
  const doc = danielTxt(REPOS, PAGES);
  assert.equal(doc.name, PROFILE.name);
  assert.deepEqual(plainText(doc).slice(0, 3), [PROFILE.name, `${PROFILE.title}.`, ""]);
});

test("every profile fact is a labelled row, every label padded to one column", () => {
  const doc = danielTxt(REPOS, PAGES);
  assert.equal(labelWidth(doc), "Previously".length + 3);
  const lines = plainText(doc);
  assert.ok(lines.includes(`Previously   ${PROFILE.previously}`));
  assert.ok(lines.includes(`School       ${PROFILE.school}`));
  assert.ok(lines.includes(`Building     ${PROFILE.building}`));
});

test("a repo is its name, linked to it, with its language beside it and its description and homepage under it", () => {
  const [zeta, alpha] = danielTxt(REPOS, PAGES).sections[0].entries ?? [];
  assert.deepEqual(zeta.link, { text: "zeta-tool", href: "https://github.com/danielhkuo/zeta-tool" });
  assert.equal(zeta.note, "TypeScript");
  assert.deepEqual(zeta.lines, [
    "A sample project showcasing modern web development",
    { text: "example.com/app", href: "https://example.com/app" },
  ]);
  // No language, no description, no homepage: the name alone.
  assert.equal(alpha.note, undefined);
  assert.deepEqual(alpha.lines, []);
});

test("in the file a repo's name is padded to its column, and what is under it indented four", () => {
  const lines = plainText(danielTxt(REPOS, PAGES));
  assert.ok(lines.includes(`${"zeta-tool".padEnd(20)}TypeScript`));
  assert.ok(lines.includes("    A sample project showcasing modern web development"));
  assert.ok(lines.includes("    example.com/app"));
  assert.ok(lines.includes("Alpha"));
});

test("a name column fits its longest name and four spaces, and is 20 at the least", () => {
  const short = danielTxt(REPOS, PAGES).sections[0];
  assert.equal(nameWidth(short), 20);
  const long = danielTxt([repo({ name: "a-very-long-repository-name" })], PAGES).sections[0];
  assert.equal(nameWidth(long), "a-very-long-repository-name".length + 4);
});

test("a long description wraps at 80 columns, under its indent", () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = plainText(danielTxt([repo({ description: words })], PAGES));
  const under = lines.filter((l) => l.startsWith("    word"));
  assert.ok(under.length > 1, "it wraps");
  for (const line of under) assert.ok(line.length <= COLUMNS, line);
  assert.equal(under.join(" ").replace(/\s+/g, " ").trim(), words);
});

test("without repos, PROJECTS points at GitHub instead", () => {
  const projects = danielTxt([], PAGES).sections[0];
  assert.equal(projects.entries, undefined);
  const link = projects.note?.find((piece): piece is Link => typeof piece !== "string");
  assert.deepEqual(link, { text: "github.com/danielhkuo", href: LINKS.github });
  assert.ok(plainText(danielTxt([], PAGES)).includes("The projects are pinned on github.com/danielhkuo."));
});

test("CONTACT is every way to get in touch, labelled, each a link", () => {
  const contact = danielTxt(REPOS, PAGES).sections.find((s) => s.id === "contact");
  assert.deepEqual(
    contact?.facts,
    contactLinks().map((c) => ({ label: c.label, value: { text: c.text, href: c.href } })),
  );
  assert.ok(plainText(danielTxt(REPOS, PAGES)).includes(`Email        ${EMAIL}`));
});

test("ELSEWHERE is every other page of the site, each a link with its summary under it", () => {
  const elsewhere = danielTxt(REPOS, PAGES).sections.find((s) => s.id === "elsewhere");
  assert.deepEqual(
    elsewhere?.entries,
    PAGES.map((p) => ({ link: { text: p.title, href: p.path }, lines: [p.summary] })),
  );
  assert.ok(!PAGES.some((p) => p.path === "/minimal"), "the page does not list itself");
});

test("the sections are PROJECTS, CONTACT and ELSEWHERE, in that order", () => {
  assert.deepEqual(
    danielTxt(REPOS, PAGES).sections.map((s) => [s.id, s.heading]),
    [
      ["projects", "PROJECTS"],
      ["contact", "CONTACT"],
      ["elsewhere", "ELSEWHERE"],
    ],
  );
});

test("Go To Line's numbers point at the name and at each heading in the file", () => {
  for (const projects of [REPOS, []]) {
    const doc = danielTxt(projects, PAGES);
    const lines = plainText(doc);
    const marks = lineNumbers(doc);
    assert.deepEqual(
      marks.map((m) => m.id),
      ["top", "projects", "contact", "elsewhere"],
    );
    for (const mark of marks) assert.equal(lines[mark.line - 1], mark.label, mark.id);
  }
});

test("two blank lines come before each heading and one after it, as in the mock", () => {
  const lines = plainText(danielTxt(REPOS, PAGES));
  for (const heading of ["PROJECTS", "CONTACT", "ELSEWHERE"]) {
    const at = lines.indexOf(heading);
    assert.deepEqual(lines.slice(at - 2, at + 2), ["", "", heading, ""], heading);
  }
});
