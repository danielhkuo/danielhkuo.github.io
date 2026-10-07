// The site's content as files: the tree the shell starts in. Markdown, so
// `cat` can lay it out (see markdown.ts for the subset it reads).

import { EMAIL, LINKS, PROFILE } from "./content.ts";
import { HOME, dir, file, type DirNode } from "./fs.ts";
import type { SiteInfo, SlimProject } from "./types";

/** "github.com/danielhkuo": an address as its link's label. */
function bare(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** "8 Sep 2026". UTC, so the same string everywhere. */
function day(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

const ABOUT = `# ${PROFILE.name}

${PROFILE.title}.

- **Previously** ${PROFILE.previously}
- **School** ${PROFILE.school}
- **Location** ${PROFILE.location}
- **Building** ${PROFILE.building}

The work is in \`projects/\`. To get in touch, \`cat contact.md\` or \`open resume.pdf\`.
`;

const CONTACT = `# Contact

- **Email** [${EMAIL}](${LINKS.email})
- **GitHub** [${bare(LINKS.github)}](${LINKS.github})
- **LinkedIn** [${bare(LINKS.linkedin)}](${LINKS.linkedin})

Or send a note with the form at the foot of the page.
`;

/** A pinned repo's README: what its card on the page shows, and the full language mix. */
function readme(p: SlimProject): string {
  const lines = [`# ${p.name}`, ""];
  if (p.description) lines.push(p.description, "");
  lines.push(
    `- **Stars** ${p.stargazerCount}`,
    `- **Forks** ${p.forkCount}`,
    `- **Updated** ${day(p.updatedAt)}`,
    "",
  );
  // Anything that would print as 0.0% is noise.
  const mix = p.languages.filter((l) => l.percentage >= 0.05);
  if (mix.length) {
    lines.push("## Languages", "", ...mix.map((l) => `- ${l.name} ${l.percentage.toFixed(1)}%`), "");
  }
  lines.push("## Links", "", `- **Repository** [${bare(p.url)}](${p.url})`);
  if (p.homepageUrl) lines.push(`- **Homepage** [${bare(p.homepageUrl)}](${p.homepageUrl})`);
  return `${lines.join("\n")}\n`;
}

/**
 * The filesystem: /Users/daniel holding the bio, the contact card, the
 * résumé, and a directory per pinned repo. A repo's directory opens the
 * repository and carries its last update as its date; everything else is
 * dated by the build.
 */
export function siteTree(projects: readonly SlimProject[], site: SiteInfo): DirNode {
  const built = site.builtAt;
  const repos = projects.map((p) =>
    dir(p.name, p.updatedAt, [file("README.md", p.updatedAt, { text: readme(p), url: p.url })], p.url),
  );
  let latest = "";
  for (const p of projects) {
    if (!latest || Date.parse(p.updatedAt) > Date.parse(latest)) latest = p.updatedAt;
  }

  const home = dir(HOME[1], built, [
    file("about.md", built, { text: ABOUT }),
    file("contact.md", built, { text: CONTACT }),
    dir("projects", latest || built, repos, `${LINKS.github}?tab=repositories`),
    file("resume.pdf", built, { size: site.resumeBytes, url: LINKS.resume }),
  ]);
  return dir("", built, [dir(HOME[0], built, [home])]);
}
