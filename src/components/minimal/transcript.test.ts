import assert from "node:assert/strict";
import { test } from "node:test";
import { LINKS, PROFILE } from "../terminal/content.ts";
import { parse, spans } from "../terminal/markdown.ts";
import type { SiteInfo, SlimProject, TerminalLine } from "../terminal/types";
import { FEATURED, LOGIN_TTY, OPENING, loginLine, opening, summarize } from "./transcript.ts";

const REPOS: SlimProject[] = [
  {
    name: "zeta-tool",
    description: "A sample project\nshowcasing modern web development",
    url: "https://github.com/danielhkuo/zeta-tool",
    homepageUrl: "example.com/app",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: [{ name: "TypeScript", percentage: 100 }],
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

const PAGES = [
  { title: "Title menu", path: "/", summary: "The front door." },
  { title: "Flight", path: "/world", summary: "Fly a dragon." },
];

const SITE: SiteInfo = { builtAt: "2026-10-06T09:14:02Z", resumeBytes: 145439, pages: PAGES };

/** The markdown a section printed. */
function source(id: string, repos: readonly SlimProject[] = REPOS): string {
  const printed = opening(repos, SITE).find((p) => p.id === id);
  assert.ok(printed, id);
  assert.equal(printed.output.length, 1, `${id} printed ${printed.output.length} lines`);
  const [line] = printed.output;
  assert.equal(line.kind, "doc");
  return line.kind === "doc" ? line.source : "";
}

/** Every link in a file, as [text, target]. */
function links(markdown: string): [string, string][] {
  return parse(markdown).flatMap((block) => {
    const texts = block.kind === "list" ? block.items : [block.text];
    return texts.flatMap((t) => spans(t).flatMap((s) => (s.kind === "link" ? [[s.text, s.href] as [string, string]] : [])));
  });
}

test("the page opens on neofetch, the projects, the contact card and the sitemap, in that order", () => {
  assert.deepEqual(
    opening(REPOS, SITE).map((p) => [p.id, p.line]),
    [
      ["about", "neofetch"],
      ["projects", "cat projects/README.md"],
      ["contact", "cat contact.md"],
      ["elsewhere", "cat sitemap.md"],
    ],
  );
});

test("every opening command is a real one that prints without an error", () => {
  for (const printed of opening(REPOS, SITE)) {
    assert.ok(printed.output.length > 0, printed.line);
    assert.ok(!printed.output.some((l) => l.kind === "err"), printed.line);
  }
});

test("neofetch is handed to the page to draw, not laid out in cells", () => {
  assert.deepEqual(opening(REPOS, SITE)[0].output, [{ kind: "neofetch" }]);
});

test("the projects section names every pinned repo as a link to it, in pinned order", () => {
  const md = source("projects");
  assert.match(md, /^# Projects$/m);
  assert.deepEqual(
    parse(md).flatMap((b) => (b.kind === "heading" && b.level === 2 ? [b.text] : [])),
    ["[zeta-tool](https://github.com/danielhkuo/zeta-tool)", "[Alpha](https://github.com/danielhkuo/Alpha)"],
  );
});

test("a project gives its description on one line, then its facts and its homepage as a list", () => {
  const md = source("projects");
  assert.match(md, /^A sample project showcasing modern web development$/m);
  const details = parse(md).find((b) => b.kind === "list");
  assert.deepEqual(details?.kind === "list" && details.items, [
    "TypeScript · 42 stars · 7 forks · updated 8 Sep 2026",
    "[example.com/app](https://example.com/app)",
  ]);
  assert.ok(links(md).some(([text, href]) => text === "example.com/app" && href === "https://example.com/app"));
});

test("a project with no description, language or homepage still has its name and its last update", () => {
  const md = source("projects");
  const alpha = md.slice(md.indexOf("## [Alpha]"));
  assert.match(alpha, /^- Updated 29 Aug 2026$/m);
  assert.deepEqual(links(alpha), [["Alpha", "https://github.com/danielhkuo/Alpha"]]);
});

test("with no projects to publish, the section points at GitHub instead", () => {
  const md = source("projects", []);
  assert.deepEqual(links(md), [["github.com/danielhkuo", LINKS.github]]);
});

test("the contact section links the mailbox, GitHub, LinkedIn and the résumé", () => {
  assert.deepEqual(
    links(source("contact")).map(([, href]) => href),
    [LINKS.email, LINKS.github, LINKS.linkedin, LINKS.resume],
  );
});

test("the contact section does not mention a form the page does not have", () => {
  assert.doesNotMatch(source("contact"), /form/i);
});

test("the sitemap links every other page, by its path on this site, with what it is", () => {
  const md = source("elsewhere");
  assert.deepEqual(links(md), [
    ["Title menu", "/"],
    ["Flight", "/world"],
  ]);
  assert.match(md, /The front door\.$/m);
});

test("every section but the first opens on its own heading", () => {
  for (const { id } of OPENING.slice(1)) assert.equal(parse(source(id))[0].kind, "heading", id);
});

test("the featured commands are few enough for two rows on a phone", () => {
  assert.ok(FEATURED.length <= 8);
  assert.equal(FEATURED[0], "help");
});

test("the login line is dated by the build, in UTC, the way Terminal writes it", () => {
  assert.equal(loginLine("2026-10-06T09:14:02Z") + LOGIN_TTY, "Last login: Tue Oct  6 09:14:02 on ttys000");
  assert.equal(loginLine("2026-11-19T23:05:09+09:00"), "Last login: Thu Nov 19 14:05:09");
});

test("a command that prints nothing is announced as done", () => {
  assert.equal(summarize("cd projects", []), "cd projects: done.");
});

test("an empty line is not announced", () => {
  assert.equal(summarize("  ", []), "");
});

test("an error is announced as it is written, without the backticks", () => {
  const output: TerminalLine[] = [{ kind: "err", text: "cat: resume.pdf: not a text file — try `open resume.pdf`" }];
  assert.equal(summarize("cat resume.pdf", output), "cat: resume.pdf: not a text file — try open resume.pdf");
});

test("one or two short lines are read out as they are", () => {
  assert.equal(summarize("pwd", [{ kind: "out", text: "/Users/daniel" }]), "/Users/daniel");
  assert.equal(summarize("theme dark", [{ kind: "ok", text: "theme set to dark" }]), "theme set to dark");
});

test("a file is announced by its title, not read out", () => {
  const output: TerminalLine[] = [{ kind: "doc", source: `# ${PROFILE.name}\n\nA long file.\n` }];
  assert.equal(summarize("cat about.md", output), `cat about.md: printed ${PROFILE.name} above the prompt.`);
});

test("a title that is a link is announced by its text", () => {
  const output: TerminalLine[] = [{ kind: "doc", source: "## [zeta-tool](https://example.com)\n" }];
  assert.equal(summarize("cat x", output), "cat x: printed zeta-tool above the prompt.");
});

test("a listing is announced by how many lines it has, blank rows aside", () => {
  const output: TerminalLine[] = [{ kind: "text", rows: [[{ text: "about.md" }], [], [{ text: "contact.md" }]] }];
  assert.equal(summarize("ls -1", output), "ls -1: printed 2 lines above the prompt.");
  assert.equal(summarize("ls", [{ kind: "text", rows: [[{ text: "a" }]] }]), "ls: printed 1 line above the prompt.");
});

test("help is announced by how many commands it lists", () => {
  const output: TerminalLine[] = [
    { kind: "out", text: "`tab` completes" },
    { kind: "rows", title: "files", rows: [{ k: "ls", v: "list" }, { k: "cd", v: "change" }] },
    { kind: "rows", title: "shell", rows: [{ k: "help", v: "list commands" }] },
  ];
  assert.equal(summarize("help", output), "help: printed 4 lines above the prompt.");
});
