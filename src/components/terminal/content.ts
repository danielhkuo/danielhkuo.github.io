// Single source of truth for the terminal's content. No React.

import type { TerminalRow } from "./types";

export const LINKS = {
  github: "https://github.com/danielhkuo",
  // TODO(daniel): confirm the real LinkedIn URL — this is a placeholder guess.
  linkedin: "https://www.linkedin.com/in/danielhkuo/",
  email: "mailto:danielhkuo@rice.edu",
  resume: "/Daniel-Kuo-Resume.pdf",
} as const;

/** Lines printed by `whoami`. */
export const WHOAMI_LINES: readonly string[] = [
  "`Daniel Kuo` — full-stack product builder & team architect",
  "Rice University · CS · Houston, TX",
  "incoming engineering summer analyst @ Goldman Sachs AWM",
  "building: AI products · self-hosted systems · developer tools",
];

/** Rows printed by `contact`. */
export const CONTACT_ROWS: readonly TerminalRow[] = [
  { k: "email", v: "danielhkuo@rice.edu" },
  { k: "github", v: "github.com/danielhkuo" },
  { k: "linkedin", v: "linkedin.com/in/danielhkuo" },
];

export interface Section {
  /** Directory name used by `cd`/`ls`, and the DOM id to scroll to. */
  dir: string;
  id: string;
  label: string;
}

/** Navigable "filesystem" — maps directories to real section ids on the page. */
export const SECTIONS: readonly Section[] = [
  { dir: "about", id: "about", label: "whoami · bio" },
  { dir: "currently", id: "currently", label: "location & local time" },
  { dir: "work", id: "work", label: "pinned github repos" },
  { dir: "contact", id: "contact", label: "send a note" },
];
