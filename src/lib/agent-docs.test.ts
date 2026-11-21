import assert from "node:assert/strict";
import { test } from "node:test";
import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import { agentsMd, llmsTxt } from "./agent-docs.ts";
import type { Project } from "./projects.ts";
import { SITE_PAGES } from "./site-content.ts";

const ZETA: Project = {
  slug: "zeta-tool",
  name: "zeta-tool",
  summary: "A sample project showcasing modern web development",
  body: "It does a great deal.\n\n# How it works\n\nWell.",
  order: 1,
  repo: "danielhkuo/zeta-tool",
  repoUrl: "https://github.com/danielhkuo/zeta-tool",
  link: "https://www.example.com/",
  image: null,
  github: {
    stars: 42,
    forks: 7,
    language: { name: "TypeScript", color: "#3178c6" },
    languages: [
      { name: "TypeScript", color: "#3178c6", percentage: 65.44 },
      { name: "JavaScript", color: "#f1e05a", percentage: 34.52 },
      { name: "Makefile", color: "#427819", percentage: 0.04 },
    ],
    updatedAt: "2026-09-08T12:00:00Z",
  },
};

/** A repository with nothing to show on GitHub: no languages, no stars, no forks. */
const ALPHA: Project = {
  slug: "Alpha",
  name: "Alpha",
  summary: "The first letter",
  body: "",
  order: 2,
  repo: "danielhkuo/Alpha",
  repoUrl: "https://github.com/danielhkuo/Alpha",
  link: null,
  image: null,
  github: { stars: 0, forks: 0, language: null, languages: [], updatedAt: "2026-08-29T12:00:00Z" },
};

/** A live site with no repository. */
const SITE: Project = {
  ...ALPHA,
  slug: "site",
  name: "Site",
  summary: "A site with no source to show",
  order: 3,
  repo: null,
  repoUrl: null,
  link: "https://example.com/site",
  github: null,
};

/** Neither a repository nor a link, and no stats: a build without a token. */
const NOVEL: Project = { ...SITE, slug: "novel", name: "Novel", summary: "A novel, in drafts", order: 4, link: null };

const PROJECTS = [ZETA, ALPHA, SITE, NOVEL];

/** Nine projects, to show nothing counts on six. */
const NINE: Project[] = Array.from({ length: 9 }, (_, i) => ({
  ...ALPHA,
  slug: `p${i + 1}`,
  name: `Project ${i + 1}`,
  order: i + 1,
  repo: `danielhkuo/p${i + 1}`,
  repoUrl: `https://github.com/danielhkuo/p${i + 1}`,
}));

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

  test(`${file} links every project's repository, and a project with none its link`, () => {
    const all = targets(render(PROJECTS));
    for (const url of [ZETA.repoUrl, ALPHA.repoUrl, SITE.link]) assert.ok(all.includes(url!), url!);
  });

  test(`with no projects, ${file} sends readers to the GitHub profile instead`, () => {
    const md = render([]);
    assert.ok(!targets(md).includes(ZETA.repoUrl!));
    assert.ok(section(md, "Projects").some((l) => l.includes(`](${LINKS.github})`)));
  });

  test(`${file} lists every project, however many there are`, () => {
    const md = render(NINE);
    for (const p of NINE) assert.ok(md.includes(p.repoUrl!), p.name);
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

test("llms.txt lists a project by name, linked to its repository, with its summary", () => {
  assert.ok(
    section(llmsTxt(PROJECTS), "Projects").includes(
      "- [zeta-tool](https://github.com/danielhkuo/zeta-tool): A sample project showcasing modern web development",
    ),
  );
});

test("llms.txt links a project with no repository to its link, and one with neither to the text version's list", () => {
  const projects = section(llmsTxt(PROJECTS), "Projects");
  assert.ok(projects.includes("- [Site](https://example.com/site): A site with no source to show"));
  assert.ok(projects.includes("- [Novel](https://danielhkuo.github.io/minimal#projects): A novel, in drafts"));
});

test("llms.txt lists the projects in the order given", () => {
  const projects = section(llmsTxt(PROJECTS), "Projects").filter((l) => l.startsWith("- "));
  assert.deepEqual(
    projects.map((l) => /^- \[([^\]]+)\]/.exec(l)?.[1]),
    ["zeta-tool", "Alpha", "Site", "Novel"],
  );
});

test("llms.txt folds a summary that spans lines onto its project's line", () => {
  const md = llmsTxt([{ ...ZETA, summary: "Line one.\r\n\nLine two." }]);
  assert.ok(section(md, "Projects").includes(`- [zeta-tool](${ZETA.repoUrl}): Line one. Line two.`));
});

test("llms.txt points to the text page and to agents.md", () => {
  const all = targets(llmsTxt(PROJECTS));
  assert.ok(all.includes("https://danielhkuo.github.io/minimal"));
  assert.ok(all.includes("https://danielhkuo.github.io/agents.md"));
});

test("agents.md gives the whole profile from content.ts", () => {
  const md = agentsMd(PROJECTS);
  for (const value of Object.values(PROFILE)) assert.ok(md.includes(value), value);
  assert.ok(md.includes(EMAIL));
});

test("agents.md gives each project its summary, links, language mix, counts and last update, then its description", () => {
  const md = agentsMd(PROJECTS);
  const block = projectBlock(md, "zeta-tool").join("\n");
  assert.match(block, /^A sample project showcasing modern web development$/m);
  assert.match(
    block,
    /^- Repository: \[github\.com\/danielhkuo\/zeta-tool\]\(https:\/\/github\.com\/danielhkuo\/zeta-tool\)$/m,
  );
  assert.match(block, /^- Link: \[example\.com\]\(https:\/\/www\.example\.com\/\)$/m);
  assert.match(block, /^- Languages: TypeScript 65%, JavaScript 35%$/m);
  assert.match(block, /^- Stars: 42 · Forks: 7$/m);
  assert.match(block, /^- Updated: 8 Sep 2026$/m);
  // The description comes after the facts, which are the project's, and its headings sit below the project's.
  assert.ok(block.indexOf("- Updated") < block.indexOf("It does a great deal."));
  assert.ok(md.includes("#### How it works\n\nWell.\n"));
});

test("agents.md moves a description's headings below the project's, so the name stays the only H1", () => {
  const lines = agentsMd(PROJECTS).split("\n");
  assert.ok(lines.includes("#### How it works"));
  assert.ok(!lines.includes("# How it works"));
});

test("agents.md leaves out a language too small to round above zero", () => {
  assert.doesNotMatch(agentsMd(PROJECTS), /Makefile/);
});

test("agents.md leaves out what a project does not have", () => {
  const block = projectBlock(agentsMd(PROJECTS), "Alpha").join("\n");
  assert.doesNotMatch(block, /Link|Languages/);
  assert.match(block, /^- Repository: \[github\.com\/danielhkuo\/Alpha\]\(https:\/\/github\.com\/danielhkuo\/Alpha\)$/m);
  assert.match(block, /^- Stars: 0 · Forks: 0$/m);
});

test("agents.md gives a project built without GitHub's stats no counts, languages or date", () => {
  const block = projectBlock(agentsMd(PROJECTS), "Site").join("\n");
  assert.match(block, /^A site with no source to show$/m);
  assert.match(block, /^- Link: \[example\.com\/site\]\(https:\/\/example\.com\/site\)$/m);
  assert.doesNotMatch(block, /Repository|Languages|Stars|Updated/);
  const novel = projectBlock(agentsMd(PROJECTS), "Novel").join("\n");
  assert.match(novel, /^A novel, in drafts$/m);
  assert.doesNotMatch(novel, /^- /m);
});

test("agents.md lists the projects in the order given", () => {
  const md = agentsMd([ALPHA, ZETA]);
  assert.ok(md.indexOf("### Alpha") < md.indexOf("### zeta-tool"));
});

test("agents.md gives every project a section of its own, however many there are", () => {
  assert.equal(agentsMd(NINE).split("\n").filter((l) => l.startsWith("### ")).length, 9);
});

test("agents.md gives the address of every page on the site", () => {
  const md = agentsMd(PROJECTS);
  for (const page of SITE_PAGES) {
    assert.ok(md.includes(`https://danielhkuo.github.io${page.path}`), page.path);
  }
});
