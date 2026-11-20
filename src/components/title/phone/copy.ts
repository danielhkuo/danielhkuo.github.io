// Every word on the phone's title screen, in one place (mobile spec 2). The desktop title (the parked title-menu work)
// has its own copy file; when the two are mounted together they should read one list (see the mobile design,
// "As built"). Where each way goes is the site's: the minimal version, the world and the agent file.

import { TEXT_PAGE } from "../../../lib/site-content.ts";
import type { PhoneEntry } from "./PhoneTitle";

/**
 * The minimal version: the whole site as one plain text file, open in nano. Its address is the site's `TEXT_PAGE`
 * (lib/site-content.ts), the one place it is set: the phone title, the world's "short version" link and the abbey's
 * button on a phone follow it, as the page list and the agent files do.
 */
export const MINIMAL_PAGE = TEXT_PAGE;

export const PHONE_TAGLINE = "a portfolio you can fly through";

/** The entry preselected as the page opens: a phone defaults to the minimal version. */
export const PHONE_DEFAULT = "minimal";

/** The ways in, in order. `startMb` is the world's download before the first view, from the build. */
export function phoneEntries(startMb: number): PhoneEntry[] {
  const size = startMb > 0 ? ` · about ${startMb.toFixed(1)} MB` : "";
  return [
    { id: "minimal", label: "Minimal version", hint: "everything as plain text", href: MINIMAL_PAGE, meta: "the whole site on one page", lead: true },
    { id: "world", label: "Enter world", hint: "fly out and find them", href: "/world", meta: `turn sideways${size}`, lead: true, sideways: true },
    { id: "agents", label: "agents.md", hint: "a note for machines", href: "/agents.md" },
  ];
}
