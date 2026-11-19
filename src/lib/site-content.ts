// What every text view of the site shares: the text version (TEXT_PAGE) and
// the agent files at /agents.md and /llms.txt. Everything here is derived from the
// two content sources, the profile in terminal/content.ts and the pinned
// GitHub repos; nothing is copied out of them. Pure, with no React, so
// `node --test` runs it as it is.

import { EMAIL, LINKS, PROFILE } from "../components/terminal/content.ts";

/** Where the site is published. The agent files give whole addresses, so a link still works out of context. */
export const SITE_URL = "https://danielhkuo.github.io";

/** What the text views need of a pinned repo. `PinnedRepo` and the terminal's `SlimProject` both fit. */
export interface Project {
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
  primaryLanguage: { name: string } | null;
  /** Largest first, as GitHub reports them. */
  languages: readonly { name: string; percentage: number }[];
  stargazerCount: number;
  forkCount: number;
  /** ISO 8601. */
  updatedAt: string;
}

/**
 * Where the text version lives: the one page that holds the whole site as
 * text. It is set as a terminal session and can be typed into, so the
 * terminal has no page of its own. The address is this one constant; a page
 * at the old address forwards here.
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
    summary:
      "The whole site as one page of plain text: profile, projects and contact, set as a terminal session that can also be typed into. The quickest read on any device, and the one for screen readers.",
    isText: true,
  },
  {
    path: "/",
    title: "Title menu",
    summary: "The front door, offering every way into the site.",
    isText: false,
  },
  {
    path: "/world",
    title: "Flight",
    summary:
      "Fly a dragon over an inked, procedurally generated realm. A canvas game that needs JavaScript; it has nothing to read that the text version lacks.",
    isText: false,
  },
  {
    path: "/agents.md",
    title: "Agent guide",
    summary: "The person, the projects and the way around the site, written for AI agents.",
    isText: true,
  },
  {
    path: "/llms.txt",
    title: "llms.txt",
    summary: "A short index of the site, in the llms.txt format.",
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

/** A homepage as GitHub gives it may lack its scheme ("example.com"); as a link that would be a path on this site. */
export function withScheme(url: string): string {
  return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
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

/** "Full-stack product builder & team architect. Rice University · CS, Houston, TX. Building …." */
export function profileSummary(): string {
  return `${PROFILE.title}. ${PROFILE.school}, ${PROFILE.location}. Building ${PROFILE.building}.`;
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

/** "TypeScript · 42 stars · 7 forks · updated 8 Sep 2026". Zero counts and a missing language are left out. */
export function projectFacts(p: Project): string {
  const facts: string[] = [];
  if (p.primaryLanguage) facts.push(p.primaryLanguage.name);
  if (p.stargazerCount > 0) facts.push(count(p.stargazerCount, "star"));
  if (p.forkCount > 0) facts.push(count(p.forkCount, "fork"));
  const updated = formatDay(p.updatedAt);
  return facts.length ? [...facts, `updated ${updated}`].join(" · ") : `Updated ${updated}`;
}

/**
 * The projects a page may publish. The mock repos that stand in when the
 * build cannot reach GitHub keep a tokenless build working, but they are not
 * Daniel's work, so they are never shown as if they were.
 */
export function publishedProjects<T extends Project>(loaded: { repos: T[]; source: "github" | "sample" }): T[] {
  return loaded.source === "github" ? loaded.repos : [];
}
