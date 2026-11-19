// Every word on the phone's title screen, in one place (mobile spec 2). The desktop title (the parked title-menu work)
// has its own copy file with the same four ways in; when it lands, the two should read one list (see the mobile design,
// "As built"). Where each way goes is the site's: the plain page, the world, the terminal and the agent file.

import type { PhoneEntry } from "./PhoneTitle";

/** On a phone the terminal has its own page, upright, where a keyboard leaves room to read. */
export const TERMINAL_PAGE = "/artificer#terminal";

export const PHONE_TAGLINE = "a portfolio you can fly through";

/** The ways in, in order. `startMb` is the world's download before the first view, from the build. */
export function phoneEntries(startMb: number): PhoneEntry[] {
  const size = startMb > 0 ? ` · about ${startMb.toFixed(1)} MB` : "";
  return [
    { id: "recruiter", label: "The Recruiter", hint: "the short version", href: "/recruiter", meta: "the whole site on one page", lead: true },
    { id: "wayfarer", label: "The Wayfarer", hint: "fly out and find them", href: "/world", meta: `turn sideways${size}`, lead: true, sideways: true },
    { id: "artificer", label: "The Artificer", hint: "the workshop", href: TERMINAL_PAGE },
    { id: "herald", label: "The Herald", hint: "a note for machines", href: "/agents.md" },
  ];
}
