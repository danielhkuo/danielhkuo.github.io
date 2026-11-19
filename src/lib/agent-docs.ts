// The files at /llms.txt and /agents.md: the site described for AI agents.
// Both follow the llms.txt format (llmstxt.org): the name as the one H1, a
// one-line summary as a quote, a little context, then H2 sections. llms.txt
// is the short index, every section a list of links; agents.md says
// everything, project by project. Pure, with no React, so `node --test` runs
// it as it is.

import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import {
  SITE_PAGES,
  TEXT_PAGE,
  absoluteUrl,
  bareUrl,
  contactLinks,
  formatDay,
  profileFacts,
  profileSummary,
  withScheme,
  type Project,
  type SitePage,
} from "./site-content.ts";

const LLMS_TXT = "/llms.txt";

/** A repo description is one line on GitHub, but nothing enforces it; a break would split a list item. */
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

/** What stands in for the project list when there are no projects to publish. */
const GITHUB_PROFILE = linkItem("GitHub profile", LINKS.github, "the projects are pinned there");

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
      ? projects.map((p) => linkItem(p.name, p.url, oneLine(p.description)))
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
  return p.languages
    .map((l) => ({ name: l.name, share: Math.round(l.percentage) }))
    .filter((l) => l.share > 0)
    .map((l) => `${l.name} ${l.share}%`)
    .join(", ");
}

function projectSection(p: Project): string[] {
  const lines = [`### ${p.name}`, ""];
  const description = oneLine(p.description);
  if (description) lines.push(description, "");
  lines.push(`- Repository: [${bareUrl(p.url)}](${p.url})`);
  if (p.homepageUrl) lines.push(`- Homepage: [${bareUrl(p.homepageUrl)}](${withScheme(p.homepageUrl)})`);
  const mix = languageMix(p);
  if (mix) lines.push(`- Languages: ${mix}`);
  lines.push(`- Stars: ${p.stargazerCount} · Forks: ${p.forkCount}`, `- Updated: ${formatDay(p.updatedAt)}`, "");
  return lines;
}

/** Everything: the profile, the contacts, each project in full, every page, and how to read the site. */
export function agentsMd(projects: readonly Project[]): string {
  const lines = [
    ...lead(),
    `This is ${PROFILE.name}'s personal site, described for AI agents. The site is a world explored on dragonback, entered through a title menu; everything on it is also in the plain text version. This file is generated each time the site is built, from the same profile and pinned GitHub repositories the site shows. For a short index, read [llms.txt](${absoluteUrl(LLMS_TXT)}).`,
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
      ? ["The repositories pinned on GitHub, in the order they are pinned.", "", ...projects.flatMap(projectSection)]
      : [GITHUB_PROFILE, ""]),
    "## Pages",
    "",
    ...SITE_PAGES.map(pageItem),
    "",
    "## Notes for agents",
    "",
    `- Read the [text version](${absoluteUrl(TEXT_PAGE)}) or this file. The title menu and the flight are interactive ways through the same content and add no facts of their own. So is the command prompt at the foot of the text version: everything its commands print is already on that page.`,
    "- Every page is static: a plain HTTP GET returns all of it, with no sign-in. Only the flight and that command prompt need JavaScript.",
    "- GitHub is the source of truth for the projects. This file is as current as the site's last build.",
    `- To reach ${PROFILE.name}, email [${EMAIL}](${LINKS.email}).`,
  ];
  return `${lines.join("\n")}\n`;
}
