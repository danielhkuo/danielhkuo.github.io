// daniel.txt: the minimal version as the one plain text file it is dressed as, open in nano.
//
// Built from content.ts and the pinned repos, never copied. The page sets this model as HTML (one h1, a heading per
// section, real links); plainText() lays the same model out as the file itself, which is what nano's counts count:
// "[ Read N lines ]" and the line numbers in Go To Line.

import { PROFILE } from "../terminal/content.ts";
import { bareUrl, contactLinks, profileFacts, withScheme, type Project, type SitePage } from "../../lib/site-content.ts";

/** The file nano has open. */
export const FILE_NAME = "daniel.txt";

/** The width the file is laid out to, as a terminal's. */
export const COLUMNS = 80;

/** How far a line under an entry is indented. */
export const INDENT = 4;

export interface Link {
  text: string;
  href: string;
}

/** A labelled row: "Previously   Summer Analyst @ …", or a contact and its link. */
export interface Fact {
  label: string;
  value: string | Link;
}

/** A named entry: its name (a link), a note beside the name, and lines indented under it. */
export interface Entry {
  link: Link;
  /** Beside the name: a repo's language. */
  note?: string;
  /** Under the name: a description, a homepage. */
  lines: (string | Link)[];
}

export interface Section {
  /** The section's anchor, and its heading's id. */
  id: string;
  /** Plain caps, as a text file sets them. */
  heading: string;
  facts?: Fact[];
  entries?: Entry[];
  /** What the section says when it has nothing else to list: text, a link, text. */
  note?: (string | Link)[];
}

export interface Daniel {
  name: string;
  title: string;
  facts: Fact[];
  sections: Section[];
}

/** The pages listed under ELSEWHERE: the site's other pages. */
export type PageLink = Pick<SitePage, "title" | "path" | "summary">;

/** Text on one line: GitHub allows line breaks in a description, and a text file's entry keeps to its lines. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The file's content: the profile from content.ts, the pinned repos, the ways to get in touch and the site's other
 * pages. `projects` are the published ones; with none (a build without a token), PROJECTS points at GitHub.
 */
export function danielTxt(projects: readonly Project[], pages: readonly PageLink[]): Daniel {
  const github = contactLinks().find((c) => c.label === "GitHub");
  const repos: Section = { id: "projects", heading: "PROJECTS" };
  if (projects.length) {
    repos.entries = projects.map((p) => {
      const lines: (string | Link)[] = [];
      const description = oneLine(p.description);
      if (description) lines.push(description);
      if (p.homepageUrl) lines.push({ text: bareUrl(withScheme(p.homepageUrl)), href: withScheme(p.homepageUrl) });
      return { link: { text: p.name, href: p.url }, note: p.primaryLanguage?.name, lines };
    });
  } else if (github) {
    repos.note = ["The projects are pinned on ", { text: github.text, href: github.href }, "."];
  }
  return {
    name: PROFILE.name,
    title: `${PROFILE.title}.`,
    facts: profileFacts(),
    sections: [
      repos,
      {
        id: "contact",
        heading: "CONTACT",
        facts: contactLinks().map((c) => ({ label: c.label, value: { text: c.text, href: c.href } })),
      },
      {
        id: "elsewhere",
        heading: "ELSEWHERE",
        entries: pages.map((p) => ({ link: { text: p.title, href: p.path }, lines: [p.summary] })),
      },
    ],
  };
}

/** The label column: the longest label in the file, and three spaces. One width, so every labelled row lines up. */
export function labelWidth(doc: Daniel): number {
  const labels = [...doc.facts, ...doc.sections.flatMap((s) => s.facts ?? [])].map((f) => f.label.length);
  return Math.max(0, ...labels) + 3;
}

/** The name column of a section's entries: wide enough for its longest name and four spaces, and 20 at the least. */
export function nameWidth(section: Section): number {
  return Math.max(20, ...(section.entries ?? []).map((e) => e.link.text.length + INDENT));
}

const text = (piece: string | Link): string => (typeof piece === "string" ? piece : piece.text);

/** `words` wrapped to `width` columns, each line after the first indented as the first is. */
function wrap(words: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words.split(" ")) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/** Where a part of the file starts, as Go To Line lists it. */
export interface Mark {
  /** The anchor on the page. */
  id: string;
  label: string;
  /** 1-based, as nano counts. */
  line: number;
}

/** The file laid out: its lines, and where the name and each section's heading fall in them. */
function layout(doc: Daniel): { lines: string[]; marks: Mark[] } {
  const label = labelWidth(doc);
  const facts = (list: readonly Fact[]) =>
    list.flatMap((f) => wrap(text(f.value), COLUMNS, " ".repeat(label)).map((l, i) => (i ? l : f.label.padEnd(label) + l.trimStart())));
  const lines = [doc.name, doc.title, "", ...facts(doc.facts)];
  const marks: Mark[] = [{ id: "top", label: doc.name, line: 1 }];
  for (const section of doc.sections) {
    lines.push("", "");
    marks.push({ id: section.id, label: section.heading, line: lines.length + 1 });
    lines.push(section.heading, "");
    if (section.note) lines.push(...wrap(section.note.map(text).join(""), COLUMNS, ""));
    if (section.facts) lines.push(...facts(section.facts));
    const width = nameWidth(section);
    (section.entries ?? []).forEach((entry, i) => {
      if (i) lines.push("");
      lines.push(entry.note ? entry.link.text.padEnd(width) + entry.note : entry.link.text);
      for (const line of entry.lines) lines.push(...wrap(text(line), COLUMNS, " ".repeat(INDENT)));
    });
  }
  return { lines, marks };
}

/** The file as nano reads it: its lines, without their line breaks. */
export function plainText(doc: Daniel): string[] {
  return layout(doc).lines;
}

/** Where each part of the file starts: the name, then each section's heading. */
export function lineNumbers(doc: Daniel): Mark[] {
  return layout(doc).marks;
}
