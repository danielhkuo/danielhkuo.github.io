import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL, LINKS, PROFILE } from "../terminal/content.ts";
import type { Project } from "../../lib/projects.ts";
import { contactLinks, otherPages } from "../../lib/site-content.ts";
import { COLUMNS, danielTxt, labelWidth, lineNumbers, nameWidth, plainText, type Link } from "./daniel.ts";

const repo = (over: Partial<Project>): Project => ({
  slug: "zeta-tool",
  name: "zeta-tool",
  summary: "A sample project\nshowcasing modern web development",
  body: "",
  order: 1,
  repo: "danielhkuo/zeta-tool",
  repoUrl: "https://github.com/danielhkuo/zeta-tool",
  link: null,
  image: null,
  github: {
    stars: 42,
    forks: 7,
    language: { name: "TypeScript", color: "#3178c6" },
    languages: [],
    updatedAt: "2026-09-08T12:00:00Z",
  },
  ...over,
});

const REPOS = [
  repo({ link: "https://example.com/app", body: "What it is.\n\nWhat I did,\nin two lines." }),
  repo({
    slug: "Alpha",
    name: "Alpha",
    summary: "The first letter",
    repo: "danielhkuo/Alpha",
    repoUrl: "https://github.com/danielhkuo/Alpha",
    github: { stars: 0, forks: 0, language: null, languages: [], updatedAt: "2026-08-29T12:00:00Z" },
  }),
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

test("a project is its name, linked to its repository, with its language beside it and under it its summary, description and link", () => {
  const [zeta, alpha] = danielTxt(REPOS, PAGES).sections[0].entries ?? [];
  assert.equal(zeta.key, "zeta-tool");
  assert.deepEqual(zeta.name, { text: "zeta-tool", href: "https://github.com/danielhkuo/zeta-tool" });
  assert.equal(zeta.note, "TypeScript");
  assert.deepEqual(zeta.lines, [
    "A sample project showcasing modern web development",
    "What it is.",
    "What I did, in two lines.",
    { text: "example.com/app", href: "https://example.com/app" },
  ]);
  // No language, no description, no link: the name and the summary alone.
  assert.equal(alpha.note, undefined);
  assert.deepEqual(alpha.lines, ["The first letter"]);
});

test("a project with no repository is named by a link to its link; one with neither is named in plain text", () => {
  const [site, novel] =
    danielTxt(
      [
        repo({ slug: "site", name: "Site", repo: null, repoUrl: null, link: "https://example.com/site", github: null }),
        repo({ slug: "novel", name: "Novel", summary: "In drafts", repo: null, repoUrl: null, github: null }),
      ],
      PAGES,
    ).sections[0].entries ?? [];
  assert.deepEqual(site.name, { text: "Site", href: "https://example.com/site" });
  // The name is the link, so no line under it repeats it.
  assert.ok(!site.lines.some((l) => typeof l !== "string"));
  assert.equal(novel.name, "Novel");
  assert.deepEqual(novel.lines, ["In drafts"]);
  // Built without GitHub's stats: no language beside the name.
  assert.equal(site.note, undefined);
});

test("in the file a project's name is padded to its column, and what is under it indented four", () => {
  const lines = plainText(danielTxt(REPOS, PAGES));
  assert.ok(lines.includes(`${"zeta-tool".padEnd(20)}TypeScript`));
  assert.ok(lines.includes("    A sample project showcasing modern web development"));
  assert.ok(lines.includes("    What I did, in two lines."));
  assert.ok(lines.includes("    example.com/app"));
  assert.ok(lines.includes("Alpha"));
});

test("every project is listed, in the order given, however many there are", () => {
  const nine = Array.from({ length: 9 }, (_, i) => repo({ slug: `p${i}`, name: `Project ${i}`, order: i }));
  const entries = danielTxt(nine, PAGES).sections[0].entries ?? [];
  assert.deepEqual(
    entries.map((e) => e.key),
    nine.map((p) => p.slug),
  );
});

test("a name column fits its longest name and four spaces, and is 20 at the least", () => {
  const short = danielTxt(REPOS, PAGES).sections[0];
  assert.equal(nameWidth(short), 20);
  const long = danielTxt([repo({ name: "a-very-long-repository-name" })], PAGES).sections[0];
  assert.equal(nameWidth(long), "a-very-long-repository-name".length + 4);
});

test("a long summary wraps at 80 columns, under its indent", () => {
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = plainText(danielTxt([repo({ summary: words })], PAGES));
  const under = lines.filter((l) => l.startsWith("    word"));
  assert.ok(under.length > 1, "it wraps");
  for (const line of under) assert.ok(line.length <= COLUMNS, line);
  assert.equal(under.join(" ").replace(/\s+/g, " ").trim(), words);
});

test("without projects, PROJECTS points at GitHub instead", () => {
  const projects = danielTxt([], PAGES).sections[0];
  assert.equal(projects.entries, undefined);
  const link = projects.note?.find((piece): piece is Link => typeof piece !== "string");
  assert.deepEqual(link, { text: "github.com/danielhkuo", href: LINKS.github });
  assert.ok(plainText(danielTxt([], PAGES)).includes("The code is on github.com/danielhkuo."));
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
    PAGES.map((p) => ({ key: p.path, name: { text: p.title, href: p.path }, lines: [p.summary] })),
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
