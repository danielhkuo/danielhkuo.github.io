// The site's content as files: the tree the shell starts in. Markdown, so
// `cat` can lay it out (see markdown.ts for the subset it reads).

import type { Project } from "../../lib/projects.ts";
import { bareUrl, contactLinks, formatDay, nestMarkdown, projectFacts } from "../../lib/site-content.ts";
import { EMAIL, LINKS, PROFILE } from "./content.ts";
import { HOME, dir, file, type DirNode } from "./fs.ts";
import type { PageLink, SiteInfo } from "./types";

/** A summary is one line, but nothing enforces it. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const ABOUT = `# ${PROFILE.name}

${PROFILE.title}.

- **Previously** ${PROFILE.previously}
- **School** ${PROFILE.school}
- **Location** ${PROFILE.location}
- **Building** ${PROFILE.building}

Explore projects in \`projects/\` (or run \`work\`), check \`cat contact.md\` to get in touch, or \`open resume.pdf\`.
`;

const CONTACT = `# Contact

- **Email** [${EMAIL}](${LINKS.email})
- **GitHub** [${bareUrl(LINKS.github)}](${LINKS.github})
- **LinkedIn** [${bareUrl(LINKS.linkedin)}](${LINKS.linkedin})

Or send a note with the form at the foot of the page.
`;

/** A project's README: summary, counts, description, languages and links, each only when the project has it. */
function readme(p: Project): string {
  const blocks = [`# ${p.name}`];
  const summary = oneLine(p.summary);
  if (summary) blocks.push(summary);
  const github = p.github;
  if (github) {
    blocks.push(`- **Stars** ${github.stars}\n- **Forks** ${github.forks}\n- **Updated** ${formatDay(github.updatedAt)}`);
  }
  const body = p.body.trim();
  if (body) blocks.push(nestMarkdown(body, 1));
  // Anything that would print as 0.0% is noise.
  const mix = (github?.languages ?? []).filter((l) => l.percentage >= 0.05);
  if (mix.length) blocks.push(["## Languages", "", ...mix.map((l) => `- ${l.name} ${l.percentage.toFixed(1)}%`)].join("\n"));
  const links: string[] = [];
  if (p.repoUrl) links.push(`- **Repository** [${bareUrl(p.repoUrl)}](${p.repoUrl})`);
  if (p.link) links.push(`- **Link** [${bareUrl(p.link)}](${p.link})`);
  if (links.length) blocks.push(["## Links", "", ...links].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

/** Where the projects are on GitHub: what `open projects` shows. */
const REPOSITORIES = `${LINKS.github}?tab=repositories`;

/**
 * projects/README.md: every project under its name. The name links to the
 * repository, or to the link when there is no repository. Then the summary,
 * the facts, and the link again when the name already goes to the repository.
 */
function projectsIndex(projects: readonly Project[]): string {
  const lines = ["# Projects", ""];
  if (!projects.length) lines.push(`The code is on [${bareUrl(LINKS.github)}](${LINKS.github}).`, "");
  for (const p of projects) {
    const href = p.repoUrl ?? p.link;
    const block = [href ? `## [${p.name}](${href})` : `## ${p.name}`];
    const summary = oneLine(p.summary);
    if (summary) block.push("", summary);
    const facts = projectFacts(p);
    const extra = p.repoUrl && p.link ? `- [${bareUrl(p.link)}](${p.link})` : "";
    if (facts || extra) {
      block.push("");
      if (facts) block.push(`- ${facts}`);
      if (extra) block.push(extra);
    }
    lines.push(block.join("\n"), "");
  }
  return lines.join("\n");
}

/** contact.md where the page has no contact form: every way to get in touch, the résumé among them. */
function contactCard(): string {
  const links = contactLinks().map((c) => `- **${c.label}** [${c.text}](${c.href})`);
  return ["# Contact", "", ...links, "", "Best reached by email, or open the résumé directly.", ""].join("\n");
}

/** sitemap.md: the site's other pages, each with what it is. */
function sitemap(pages: readonly PageLink[]): string {
  const links = pages.map((p) => `- [${p.title}](${p.path}): ${p.summary}`);
  return ["# Elsewhere on this site", "", ...links, ""].join("\n");
}

/**
 * The filesystem: /Users/daniel holding the bio, the contact card, the
 * résumé, and a directory per project, named by its slug. A project's
 * directory opens its repository, or its link when it has none, and is dated
 * by that repository's last update when GitHub gave one; everything else is
 * dated by the build.
 *
 * Given the site's other pages (`site.pages`: the minimal version, and the
 * abbey's terminal in /world), the tree also holds what the minimal version
 * prints as its sections: projects/README.md, the contact card with the
 * résumé on it, and ~/sitemap.md. The contact card of the old home page
 * points at the form at its foot instead.
 */
export function siteTree(projects: readonly Project[], site: SiteInfo): DirNode {
  const built = site.builtAt;
  const dated = (p: Project) => p.github?.updatedAt ?? built;
  const opens = (p: Project) => p.repoUrl ?? p.link ?? undefined;
  const repos = projects.map((p) =>
    dir(p.slug, dated(p), [file("README.md", dated(p), { text: readme(p), url: opens(p) })], opens(p)),
  );
  let latest = "";
  for (const p of projects) {
    const at = p.github?.updatedAt;
    if (at && (!latest || Date.parse(at) > Date.parse(latest))) latest = at;
  }
  const updated = latest || built;

  if (!site.pages) {
    const home = dir(HOME[1], built, [
      file("about.md", built, { text: ABOUT }),
      file("contact.md", built, { text: CONTACT }),
      dir("projects", updated, repos, REPOSITORIES),
      file("resume.pdf", built, { size: site.resumeBytes, url: LINKS.resume }),
    ]);
    return dir("", built, [dir(HOME[0], built, [home])]);
  }

  const index = file("README.md", updated, { text: projectsIndex(projects), url: REPOSITORIES });
  const home = dir(HOME[1], built, [
    file("about.md", built, { text: ABOUT }),
    file("contact.md", built, { text: contactCard() }),
    dir("projects", updated, [index, ...repos], REPOSITORIES),
    file("resume.pdf", built, { size: site.resumeBytes, url: LINKS.resume }),
    file("sitemap.md", built, { text: sitemap(site.pages) }),
  ]);
  return dir("", built, [dir(HOME[0], built, [home])]);
}
