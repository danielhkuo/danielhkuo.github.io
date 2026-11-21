import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../../lib/projects.ts";
import { LINKS } from "./content.ts";
import { HOME, lookup, type DirNode, type FsNode } from "./fs.ts";
import { renderMarkdown } from "./markdown.ts";
import { siteTree } from "./site.ts";
import type { SiteInfo } from "./types";

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

/** A live site with no repository, built without GitHub's stats, and named apart from its file. */
const SITE_ONLY: Project = {
  ...ALPHA,
  slug: "the-site",
  name: "The Site",
  summary: "A site with no source to show",
  order: 3,
  repo: null,
  repoUrl: null,
  link: "https://example.com/site",
  github: null,
};

/** Neither a repository nor a link. */
const NOVEL: Project = { ...SITE_ONLY, slug: "novel", name: "Novel", summary: "In drafts", order: 4, link: null };

const REPOS: Project[] = [ZETA, ALPHA, SITE_ONLY, NOVEL];

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

function source(path: string, tree: DirNode = TREE): string {
  const node = at(path, tree);
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

test("every project is a directory named by its file, holding a README", () => {
  assert.deepEqual(names("projects"), ["Alpha", "novel", "the-site", "zeta-tool"]);
  assert.deepEqual(names("projects/zeta-tool"), ["README.md"]);
});

test("with no projects, projects is an empty directory", () => {
  assert.deepEqual(names("projects", siteTree([], SITE)), []);
});

test("however many projects there are, each has its directory", () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ ...ALPHA, slug: `p${i + 1}`, name: `Project ${i + 1}` }));
  assert.equal(names("projects", siteTree(nine, SITE)).length, 9);
});

test("a README gives the project's summary, counts, last update, language mix and description", () => {
  const readme = source("projects/zeta-tool/README.md");
  assert.match(readme, /^# zeta-tool$/m);
  assert.match(readme, /^A sample project showcasing modern web development$/m);
  assert.match(readme, /Stars\*\* 42$/m);
  assert.match(readme, /Forks\*\* 7$/m);
  assert.match(readme, /Updated\*\* 8 Sep 2026$/m);
  assert.match(readme, /^- TypeScript 65\.4%$/m);
  assert.match(readme, /^- JavaScript 34\.5%$/m);
  assert.match(readme, /^It does a great deal\.$/m);
  // The description's headings sit under the README's own title.
  assert.match(readme, /^## How it works$/m);
  assert.doesNotMatch(readme, /^# How it works$/m);
});

test("a language too small to round above zero is left out of the mix", () => {
  assert.doesNotMatch(source("projects/zeta-tool/README.md"), /Makefile/);
});

test("a README links the repository and the project's link, labelled by address", () => {
  assert.deepEqual(hrefs("projects/zeta-tool/README.md"), [
    "https://github.com/danielhkuo/zeta-tool",
    "https://www.example.com/",
  ]);
  const readme = source("projects/zeta-tool/README.md");
  assert.match(readme, /\[github\.com\/danielhkuo\/zeta-tool\]/);
  assert.match(readme, /\[example\.com\]/);
});

test("a project with no languages, link or description has a README without those parts", () => {
  const readme = source("projects/Alpha/README.md");
  assert.match(readme, /^# Alpha$/m);
  assert.match(readme, /^The first letter$/m);
  assert.doesNotMatch(readme, /Languages/);
  assert.deepEqual(hrefs("projects/Alpha/README.md"), ["https://github.com/danielhkuo/Alpha"]);
});

test("a project built without GitHub's stats has a README without counts, dates or languages", () => {
  const readme = source("projects/the-site/README.md");
  assert.match(readme, /^# The Site$/m);
  assert.match(readme, /^A site with no source to show$/m);
  assert.doesNotMatch(readme, /Stars|Forks|Updated|Languages|Repository/);
  assert.deepEqual(hrefs("projects/the-site/README.md"), ["https://example.com/site"]);
  // Nothing to link: no Links section at all.
  assert.doesNotMatch(source("projects/novel/README.md"), /Links/);
});

test("a project's directory and its README open its repository, or its link when it has none", () => {
  assert.equal(at("projects/zeta-tool").url, "https://github.com/danielhkuo/zeta-tool");
  assert.equal(at("projects/zeta-tool/README.md").url, "https://github.com/danielhkuo/zeta-tool");
  assert.equal(at("projects/the-site").url, "https://example.com/site");
  assert.equal(at("projects/the-site/README.md").url, "https://example.com/site");
  assert.equal(at("projects/novel").url, undefined);
  assert.equal(at("projects/novel/README.md").url, undefined);
});

test("resume.pdf opens the PDF and is as big as the PDF", () => {
  const resume = at("resume.pdf");
  assert.equal(resume.url, LINKS.resume);
  assert.equal(resume.kind === "file" && resume.size, 145439);
  assert.equal(resume.kind === "file" && resume.text, undefined);
});

test("a project is dated by its repository's last update; one without stats, and the site's own files, by the build", () => {
  assert.equal(at("projects/zeta-tool").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("projects/zeta-tool/README.md").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("projects/the-site").mtime, SITE.builtAt);
  assert.equal(at("projects/the-site/README.md").mtime, SITE.builtAt);
  assert.equal(at("about.md").mtime, SITE.builtAt);
  assert.equal(at("resume.pdf").mtime, SITE.builtAt);
});

test("the projects directory is dated by its most recently updated repository", () => {
  assert.equal(at("projects").mtime, "2026-09-08T12:00:00Z");
  assert.equal(at("projects", siteTree([], SITE)).mtime, SITE.builtAt);
  assert.equal(at("projects", siteTree([NOVEL], SITE)).mtime, SITE.builtAt);
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

// ---- where the shell is the whole page ------------------------------------------

const PAGES = [
  { title: "Title menu", path: "/", summary: "The front door." },
  { title: "Flight", path: "/world", summary: "Fly a dragon." },
];

const WHOLE = siteTree(REPOS, { ...SITE, pages: PAGES });

function wholeSource(path: string): string {
  return source(path, WHOLE);
}

test("where the shell is the whole page, home also holds the sitemap", () => {
  assert.deepEqual(names("~", WHOLE), ["about.md", "contact.md", "projects", "resume.pdf", "sitemap.md"]);
});

test("there, projects holds an index of the projects beside their directories", () => {
  assert.deepEqual(names("projects", WHOLE), ["Alpha", "README.md", "novel", "the-site", "zeta-tool"]);
  const index = wholeSource("projects/README.md");
  assert.match(index, /^## \[zeta-tool\]\(https:\/\/github\.com\/danielhkuo\/zeta-tool\)$/m);
  assert.match(index, /^- TypeScript · 42 stars · 7 forks · updated 8 Sep 2026$/m);
  assert.match(index, /^- \[example\.com\]\(https:\/\/www\.example\.com\/\)$/m);
  assert.match(index, /^## \[The Site\]\(https:\/\/example\.com\/site\)$/m);
  assert.match(index, /^## Novel$/m);
  // In the order given.
  assert.ok(index.indexOf("## [zeta-tool]") < index.indexOf("## [Alpha]"));
  assert.ok(index.indexOf("## [Alpha]") < index.indexOf("## [The Site]"));
  assert.ok(index.indexOf("## [The Site]") < index.indexOf("## Novel"));
});

test("with no projects, the index points at GitHub", () => {
  const empty = siteTree([], { ...SITE, pages: PAGES });
  assert.match(
    source("projects/README.md", empty),
    /The code is on \[github\.com\/danielhkuo\]\(https:\/\/github\.com\/danielhkuo\)\./,
  );
});

test("the index opens the repositories on GitHub and is dated by the newest of them", () => {
  const index = at("projects/README.md", WHOLE);
  assert.equal(index.url, `${LINKS.github}?tab=repositories`);
  assert.equal(index.mtime, "2026-09-08T12:00:00Z");
});

test("there, the contact card lists the résumé and says nothing of a form", () => {
  const card = wholeSource("contact.md");
  assert.match(card, /\*\*Résumé\*\* \[Daniel-Kuo-Resume\.pdf\]\(\/Daniel-Kuo-Resume\.pdf\)/);
  assert.doesNotMatch(card, /form/);
});

test("the old home page's contact card still points at its form", () => {
  assert.match(source("contact.md"), /form at the foot of the page/);
});

test("the sitemap lists each page with its path and what it is", () => {
  assert.equal(
    wholeSource("sitemap.md"),
    "# Elsewhere on this site\n\n- [Title menu](/): The front door.\n- [Flight](/world): Fly a dragon.\n",
  );
});

test("every file of the whole-page tree still renders in cells, for a host that has only those", () => {
  for (const path of ["projects/README.md", "contact.md", "sitemap.md"]) {
    assert.ok(renderMarkdown(wholeSource(path), 40).length > 2, path);
  }
});
