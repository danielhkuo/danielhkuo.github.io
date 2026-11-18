import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import { agentsMd, llmsTxt } from "./agent-docs.ts";
import { SITE_PAGES, type Project } from "./site-content.ts";

const ZETA: Project = {
  name: "zeta-tool",
  description: "A sample project showcasing modern web development",
  url: "https://github.com/danielhkuo/zeta-tool",
  homepageUrl: "https://www.example.com/",
  primaryLanguage: { name: "TypeScript" },
  languages: [
    { name: "TypeScript", percentage: 65.44 },
    { name: "JavaScript", percentage: 34.52 },
    { name: "Makefile", percentage: 0.04 },
  ],
  stargazerCount: 42,
  forkCount: 7,
  updatedAt: "2026-09-08T12:00:00Z",
};

const ALPHA: Project = {
  name: "Alpha",
  description: "",
  url: "https://github.com/danielhkuo/Alpha",
  homepageUrl: null,
  primaryLanguage: null,
  languages: [],
  stargazerCount: 0,
  forkCount: 0,
  updatedAt: "2026-08-29T12:00:00Z",
};

const PROJECTS = [ZETA, ALPHA];

/** Every markdown link target in a document. */
function targets(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** The lines under an H2, up to the next H2. */
function section(md: string, title: string): string[] {
  const lines = md.split("\n");
  const start = lines.indexOf(`## ${title}`);
  assert.ok(start >= 0, `no "## ${title}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The lines under a project's H3, up to the next heading. */
function projectBlock(md: string, name: string): string[] {
  const lines = md.split("\n");
  const start = lines.indexOf(`### ${name}`);
  assert.ok(start >= 0, `no "### ${name}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("#"));
  return end < 0 ? rest : rest.slice(0, end);
}

for (const [file, render] of [
  ["llms.txt", llmsTxt],
  ["agents.md", agentsMd],
] as const) {
  test(`${file} opens with the name as its only H1, then a one-line summary as a quote`, () => {
    const lines = render(PROJECTS).split("\n");
    assert.equal(lines[0], `# ${PROFILE.name}`);
    assert.equal(lines[1], "");
    assert.match(lines[2], /^> \S/);
    assert.ok(lines[2].includes(PROFILE.title));
    assert.equal(lines.filter((l) => /^# /.test(l)).length, 1);
  });

  test(`every link in ${file} is absolute, so it works out of context`, () => {
    const all = targets(render(PROJECTS));
    assert.ok(all.length > 0);
    for (const url of all) assert.match(url, /^(https:\/\/|mailto:)/, url);
  });

  test(`${file} links every contact`, () => {
    const all = targets(render(PROJECTS));
    for (const href of [LINKS.email, LINKS.github, LINKS.linkedin]) assert.ok(all.includes(href), href);
    assert.ok(all.includes("https://danielhkuo.github.io/Daniel-Kuo-Resume.pdf"));
  });

  test(`${file} links every pinned project's repository`, () => {
    const all = targets(render(PROJECTS));
    assert.ok(all.includes(ZETA.url));
    assert.ok(all.includes(ALPHA.url));
  });

  test(`with no projects, ${file} sends readers to the GitHub profile instead`, () => {
    const md = render([]);
    assert.ok(!targets(md).includes(ZETA.url));
    assert.ok(section(md, "Projects").some((l) => l.includes(`](${LINKS.github})`)));
  });
}

test("in llms.txt, every H2 section is a list of links, as the format asks", () => {
  const lines = llmsTxt(PROJECTS).split("\n");
  const firstH2 = lines.findIndex((l) => l.startsWith("## "));
  assert.ok(firstH2 > 0);
  for (const line of lines.slice(firstH2)) {
    if (line === "" || line.startsWith("## ")) continue;
    assert.match(line, /^- \[[^\]]+\]\((https:\/\/|mailto:)[^)\s]+\)(: \S.*)?$/, line);
  }
});

test("llms.txt lists a project by name, linked to its repository, with its description", () => {
  assert.ok(
    section(llmsTxt(PROJECTS), "Projects").includes(
      "- [zeta-tool](https://github.com/danielhkuo/zeta-tool): A sample project showcasing modern web development",
    ),
  );
});

test("llms.txt lists a project without a description by its name alone", () => {
  assert.ok(section(llmsTxt(PROJECTS), "Projects").includes("- [Alpha](https://github.com/danielhkuo/Alpha)"));
});

test("llms.txt folds a description that spans lines onto its project's line", () => {
  const md = llmsTxt([{ ...ZETA, description: "Line one.\r\n\nLine two." }]);
  assert.ok(section(md, "Projects").includes(`- [zeta-tool](${ZETA.url}): Line one. Line two.`));
});

test("llms.txt points to the text page and to agents.md", () => {
  const all = targets(llmsTxt(PROJECTS));
  assert.ok(all.includes("https://danielhkuo.github.io/recruiter"));
  assert.ok(all.includes("https://danielhkuo.github.io/agents.md"));
});

test("agents.md gives the whole profile from content.ts", () => {
  const md = agentsMd(PROJECTS);
  for (const value of Object.values(PROFILE)) assert.ok(md.includes(value), value);
  assert.ok(md.includes(EMAIL));
});

test("agents.md gives each project its description, links, language mix, counts and last update", () => {
  const block = projectBlock(agentsMd(PROJECTS), "zeta-tool").join("\n");
  assert.match(block, /^A sample project showcasing modern web development$/m);
  assert.match(
    block,
    /^- Repository: \[github\.com\/danielhkuo\/zeta-tool\]\(https:\/\/github\.com\/danielhkuo\/zeta-tool\)$/m,
  );
  assert.match(block, /^- Homepage: \[example\.com\]\(https:\/\/www\.example\.com\/\)$/m);
  assert.match(block, /^- Languages: TypeScript 65%, JavaScript 35%$/m);
  assert.match(block, /^- Stars: 42 · Forks: 7$/m);
  assert.match(block, /^- Updated: 8 Sep 2026$/m);
});

test("agents.md leaves out a language too small to round above zero", () => {
  assert.doesNotMatch(projectBlock(agentsMd(PROJECTS), "zeta-tool").join("\n"), /Makefile/);
});

test("agents.md leaves out what a project does not have", () => {
  const block = projectBlock(agentsMd(PROJECTS), "Alpha").join("\n");
  assert.doesNotMatch(block, /Homepage|Languages/);
  assert.match(block, /^- Repository: \[github\.com\/danielhkuo\/Alpha\]\(https:\/\/github\.com\/danielhkuo\/Alpha\)$/m);
});

test("agents.md lists the projects in pinned order", () => {
  const md = agentsMd([ALPHA, ZETA]);
  assert.ok(md.indexOf("### Alpha") < md.indexOf("### zeta-tool"));
});

test("agents.md gives the address of every page on the site", () => {
  const md = agentsMd(PROJECTS);
  for (const page of SITE_PAGES) {
    assert.ok(md.includes(`https://danielhkuo.github.io${page.path}`), page.path);
  }
});
