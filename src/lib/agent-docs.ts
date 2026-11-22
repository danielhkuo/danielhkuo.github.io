// The files at /llms.txt and /agents.md: the site described for AI agents.
// Both follow the llms.txt format (llmstxt.org): the name as the one H1, a
// one-line summary as a quote, a little context, then H2 sections. llms.txt
// is the short index, every section a list of links; agents.md says
// everything, project by project. Pure, with no React, so `node --test` runs
// it as it is.

import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import type { Project } from "./projects.ts";
import {
  SITE_PAGES,
  TEXT_PAGE,
  absoluteUrl,
  bareUrl,
  contactLinks,
  formatDay,
  nestMarkdown,
  profileFacts,
  profileSummary,
  type SitePage,
} from "./site-content.ts";

const LLMS_TXT = "/llms.txt";

/** A summary is one line, but nothing enforces it; a break would split a list item. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** `- [text](address): note`, the llms.txt list item. */
function linkItem(text: string, href: string, note?: string): string {
  return `- [${text}](${absoluteUrl(href)})${note ? `: ${note}` : ""}`;
}

function pageItem(page: SitePage): string {
  return linkItem(page.title, page.path, page.summary);
}

/** What stands in for the project list when there are no projects. */
const GITHUB_PROFILE = linkItem("GitHub profile", LINKS.github, "the code is there");

function lead(): string[] {
  return [`# ${PROFILE.name}`, "", `> ${profileSummary()}`, ""];
}

/** The short index: what the site is, where the text is, the projects and the ways to get in touch. */
export function llmsTxt(projects: readonly Project[]): string {
  const textPages = SITE_PAGES.filter((p) => p.isText && p.path !== LLMS_TXT);
  const otherPages = SITE_PAGES.filter((p) => !p.isText);
  const lines = [
    ...lead(),
    `${PROFILE.name}'s personal site is a world explored on dragonback, entered through a title menu. Everything on it is also in the plain text version, and agents.md describes it in more detail.`,
    "",
    "## Site",
    "",
    ...textPages.map(pageItem),
    "",
    "## Projects",
    "",
    ...(projects.length
      ? projects.map((p) => linkItem(p.name, p.repoUrl ?? p.link ?? `${TEXT_PAGE}#projects`, oneLine(p.summary)))
      : [GITHUB_PROFILE]),
    "",
    "## Contact",
    "",
    ...contactLinks().map((c) => linkItem(c.label, c.href, c.text)),
    "",
    "## Optional",
    "",
    ...otherPages.map(pageItem),
  ];
  return `${lines.join("\n")}\n`;
}

/** "TypeScript 65%, JavaScript 35%". A language that rounds to nothing is left out. */
function languageMix(p: Project): string {
  return (p.github?.languages ?? [])
    .map((l) => ({ name: l.name, share: Math.round(l.percentage) }))
    .filter((l) => l.share > 0)
    .map((l) => `${l.name} ${l.share}%`)
    .join(", ");
}

/** One project: its summary, then the facts it has, then its description. A blank line between each, and after. */
function projectSection(p: Project): string[] {
  const blocks = [`### ${p.name}`];
  const summary = oneLine(p.summary);
  if (summary) blocks.push(summary);

  const facts: string[] = [];
  if (p.repoUrl) facts.push(`- Repository: [${bareUrl(p.repoUrl)}](${p.repoUrl})`);
  if (p.link) facts.push(`- Link: [${bareUrl(p.link)}](${p.link})`);
  const mix = languageMix(p);
  if (mix) facts.push(`- Languages: ${mix}`);
  if (p.github) {
    facts.push(`- Stars: ${p.github.stars} · Forks: ${p.github.forks}`);
    facts.push(`- Updated: ${formatDay(p.github.updatedAt)}`);
  }
  if (facts.length) blocks.push(facts.join("\n"));

  const body = p.body.trim();
  if (body) blocks.push(nestMarkdown(body, 3));

  return [...blocks.join("\n\n").split("\n"), ""];
}

/** Everything: the profile, the contacts, each project in full, every page, and how to read the site. */
export function agentsMd(projects: readonly Project[]): string {
  const lines = [
    ...lead(),
    `This is ${PROFILE.name}'s personal site, described for AI agents. The site is a world explored on dragonback, entered through a title menu; everything on it is also in the plain text version. This file is generated each time the site is built, from the same profile and project list the site shows. For a short index, read [llms.txt](${absoluteUrl(LLMS_TXT)}).`,
    "",
    "## Profile",
    "",
    `- Name: ${PROFILE.name}`,
    `- Title: ${PROFILE.title}`,
    ...profileFacts().map((f) => `- ${f.label}: ${f.value}`),
    "",
    "## Contact",
    "",
    ...contactLinks().map((c) => `- ${c.label}: [${c.text}](${absoluteUrl(c.href)})`),
    "",
    "## Projects",
    "",
    ...(projects.length
      ? ["The projects, in the order the site lists them.", "", ...projects.flatMap(projectSection)]
      : [GITHUB_PROFILE, ""]),
    "## Pages",
    "",
    ...SITE_PAGES.map(pageItem),
    "",
    "## Notes for agents",
    "",
    `- Read the [text version](${absoluteUrl(TEXT_PAGE)}) or this file. The title menu and the flight are interactive ways through the same content and add no facts of their own. The text version is dressed as a file open in nano; its shortcuts only search and move around that page.`,
    "- Every page is static: a plain HTTP GET returns all of it, with no sign-in. Only the flight needs JavaScript.",
    "- The project list is kept by hand in the site's repository; the stars, forks and languages come from GitHub when the site is built. This file is as current as the site's last build.",
    `- To reach ${PROFILE.name}, email [${EMAIL}](${LINKS.email}).`,
  ];
  return `${lines.join("\n")}\n`;
}
