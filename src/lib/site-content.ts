// What every text view of the site shares: the text version (TEXT_PAGE) and
// the agent files at /agents.md and /llms.txt. Everything here is derived from the
// two content sources, the profile in terminal/content.ts and the project
// files in `projects/`; nothing is copied out of them. Pure, with no React, so
// `node --test` runs it as it is.

import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";
import type { Project } from "./projects.ts";

/** Where the site is published. The agent files give whole addresses, so a link still works out of context. */
export const SITE_URL = "https://danielhkuo.github.io";

/**
 * Where the text version lives: the one page that holds the whole site as
 * text, dressed as one plain file open in nano. The address is this one
 * constant; a page at the old address forwards here.
 */
export const TEXT_PAGE = "/minimal";

/** A page of the site, for the lists that tell people and agents where to go. */
export interface SitePage {
  path: string;
  title: string;
  summary: string;
  /** A page an agent can read as text, rather than a canvas or a program to play. */
  isText: boolean;
}

/**
 * Every way into the site. Plain titles on purpose: the title menu's own
 * names for these are not settled, and nothing here should need to change
 * when they are.
 */
export const SITE_PAGES: readonly SitePage[] = [
  {
    path: TEXT_PAGE,
    title: "Text version",
    summary: "The entire site on one plain-text page, styled like nano.",
    isText: true,
  },
  {
    path: "/",
    title: "Title menu",
    summary: "The home page, with an interactive terminal and links across the site.",
    isText: false,
  },
  {
    path: "/world",
    title: "Flight",
    summary: "Dragon-flight canvas for browsing projects and landmarks (requires JS).",
    isText: false,
  },
  {
    path: "/agents.md",
    title: "Agent guide",
    summary: "Full plain-Markdown reference of the site for AI agents.",
    isText: true,
  },
  {
    path: "/llms.txt",
    title: "llms.txt",
    summary: "Short link index of the site in llms.txt format.",
    isText: true,
  },
];

/**
 * The site's pages other than the one at `from`, as a terminal on that page lists them in ~/sitemap.md: a page does
 * not list itself among the places to go.
 */
export function otherPages(from: string): Pick<SitePage, "title" | "path" | "summary">[] {
  return SITE_PAGES.filter((page) => page.path !== from).map(({ title, path, summary }) => ({ title, path, summary }));
}

/** A site path as a whole address on the live site. Whole addresses (https:, mailto:) pass through. */
export function absoluteUrl(href: string): string {
  return new URL(href, SITE_URL).href;
}

/** "github.com/danielhkuo": an address as its link's label. */
export function bareUrl(url: string): string {
  return url.replace(/^[a-z][a-z\d+.-]*:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** "8 Sep 2026". UTC, so the same string wherever it is built. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

export interface ContactLink {
  label: string;
  href: string;
  /** What the link shows: the address itself, or the file's name. */
  text: string;
}

/** The ways to reach Daniel, in the order every view lists them. */
export function contactLinks(): ContactLink[] {
  return [
    { label: "Email", href: LINKS.email, text: EMAIL },
    { label: "GitHub", href: LINKS.github, text: bareUrl(LINKS.github) },
    { label: "LinkedIn", href: LINKS.linkedin, text: bareUrl(LINKS.linkedin) },
    { label: "Résumé", href: LINKS.resume, text: LINKS.resume.slice(LINKS.resume.lastIndexOf("/") + 1) },
  ];
}

/**
 * The profile as schema.org `Person` data, for the text version's JSON-LD:
 * the name, the title, where this site is, the mailbox and the profiles
 * elsewhere. Only GitHub is listed under `sameAs`: it is the one address
 * content.ts does not mark as a guess.
 */
export function personJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: PROFILE.name,
    jobTitle: PROFILE.title,
    description: profileSummary(),
    url: absoluteUrl(TEXT_PAGE),
    email: LINKS.email,
    sameAs: [LINKS.github],
  };
}

/** "Full-stack product builder & team architect based in Houston, TX (Rice University · CS), building …." */
export function profileSummary(): string {
  return `${PROFILE.title} based in ${PROFILE.location} (${PROFILE.school}), building ${PROFILE.building}.`;
}

/** The profile below the name and title, each field labelled by its name: "Previously", "School" and so on. */
export function profileFacts(): { label: string; value: string }[] {
  return Object.entries(PROFILE)
    .filter(([key]) => key !== "name" && key !== "title")
    .map(([key, value]) => ({ label: key[0].toUpperCase() + key.slice(1), value }));
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * "TypeScript · 42 stars · 7 forks · updated 8 Sep 2026". Zero counts and a missing language are left out; with no
 * stats from GitHub (a build without a token), there are no facts at all.
 */
export function projectFacts(p: Project): string {
  if (!p.github) return "";
  const facts: string[] = [];
  if (p.github.language) facts.push(p.github.language.name);
  if (p.github.stars > 0) facts.push(count(p.github.stars, "star"));
  if (p.github.forks > 0) facts.push(count(p.github.forks, "fork"));
  const updated = formatDay(p.github.updatedAt);
  return facts.length ? [...facts, `updated ${updated}`].join(" · ") : `Updated ${updated}`;
}

/**
 * Move every ATX heading down by `levels` (six at most), so it sits under the page's own.
 * A line inside a fence (a line of three or more backticks or tildes, opened and closed) is left as written.
 * `#hashtag` is not a heading.
 */
export function nestMarkdown(markdown: string, levels: number): string {
  let fence: "`" | "~" | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const mark = /^(```+|~~~+)/.exec(line);
      if (fence === null) {
        if (mark) {
          fence = mark[1][0] === "`" ? "`" : "~";
          return line;
        }
      } else if (line.startsWith(fence === "`" ? "```" : "~~~")) {
        fence = null;
        return line;
      } else {
        return line;
      }
      const heading = /^(#{1,6})([ \t].*)$/.exec(line);
      if (!heading) return line;
      return `${"#".repeat(Math.min(6, heading[1].length + levels))}${heading[2]}`;
    })
    .join("\n");
}
