// The minimal version's start. The page opens as a terminal session that has
// already run a few commands: what they printed is the whole site, in the
// static HTML. This runs those commands on the real shell while the site is
// built, so the page shows exactly what typing them prints. Pure, with no
// React, so `node --test` runs it as it is.

import { buildCommands, type Session } from "../terminal/commands.ts";
import { HOME } from "../terminal/fs.ts";
import { parse } from "../terminal/markdown.ts";
import { execute } from "../terminal/shell.ts";
import { siteTree } from "../terminal/site.ts";
import type { CommandContext, SiteInfo, SlimProject, TerminalApi, TerminalLine } from "../terminal/types";

/** The commands the page opens on, in order, each with the anchor its output carries. */
export const OPENING = [
  { id: "about", line: "neofetch" },
  { id: "projects", line: "cat projects/README.md" },
  { id: "contact", line: "cat contact.md" },
  { id: "elsewhere", line: "cat sitemap.md" },
] as const;

/** The commands the row above the prompt offers on an empty line: the ones worth a first tap. */
export const FEATURED: readonly string[] = ["help", "ls", "cat", "open", "work", "cbonsai", "claude", "theme"];

/** A command the page has already run, and what it printed. */
export interface Printed {
  id: string;
  line: string;
  output: TerminalLine[];
}

/**
 * Run the opening commands at home, on the shell the prompt uses, and keep
 * what each printed. `site.pages` must be set: these are the files of the
 * tree where the shell is the whole page.
 */
export function opening(projects: readonly SlimProject[], site: SiteInfo): Printed[] {
  const api: TerminalApi = {
    openUrl: () => undefined,
    getProjects: () => [...projects],
    getTheme: () => "dark",
    setTheme: () => "dark",
    close: () => undefined,
    site,
  };
  const session: Session = {
    root: siteTree(projects, site),
    cwd: () => HOME,
    oldCwd: () => HOME,
    chdir: () => undefined,
  };
  const commands = buildCommands(api, session);

  return OPENING.map(({ id, line }) => {
    const output: TerminalLine[] = [];
    const ctx: CommandContext = {
      out: (text) => output.push({ kind: "out", text }),
      ok: (text) => output.push({ kind: "ok", text }),
      err: (text) => output.push({ kind: "err", text }),
      rows: (rows, title) => output.push({ kind: "rows", rows: [...rows], title }),
      text: (rows) => output.push({ kind: "text", rows }),
      doc: (source) => output.push({ kind: "doc", source }),
      neofetch: () => output.push({ kind: "neofetch" }),
      cols: 80,
      clear: () => undefined,
      close: () => undefined,
      program: () => undefined,
    };
    execute(line, commands, ctx);
    return { id, line, output };
  });
}

/** The tail of the login line. A phone leaves it off: with it the line is two characters too long. */
export const LOGIN_TTY = " on ttys000";

/**
 * "Last login: Tue Oct  6 09:14:02": the line a new Terminal window opens
 * on, less `LOGIN_TTY`, dated by when the site was built. UTC, so the same
 * string wherever it is built.
 */
export function loginLine(builtAt: string): string {
  const d = new Date(builtAt);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const two = (n: number) => String(n).padStart(2, "0");
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
  return `Last login: ${weekday} ${month} ${String(d.getUTCDate()).padStart(2)} ${time}`;
}

/** Text as it is read aloud: without the backticks that mark a command. */
function spoken(text: string): string {
  return text.replace(/`/g, "");
}

/** A markdown file's title: its first heading, without the link it may be wrapped in. */
function title(source: string): string | null {
  const first = parse(source).find((b) => b.kind === "heading");
  return first?.kind === "heading" ? first.text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") : null;
}

/**
 * What a screen reader is told once a command has run: one sentence, never
 * the output itself. Something short is read as it is; anything longer is
 * named or counted, and stays above the prompt to be read at the reader's
 * own pace. Real terminals cap what they read aloud for the same reason.
 */
export function summarize(line: string, output: readonly TerminalLine[]): string {
  const command = line.trim();
  // An empty line gives a fresh prompt and nothing to say.
  if (!command) return "";
  if (!output.length) return `${command}: done.`;

  const errors = output.flatMap((l) => (l.kind === "err" ? [spoken(l.text)] : []));
  if (errors.length) return errors.join(" ");

  const short = output.every((l) => l.kind === "out" || l.kind === "ok");
  if (short && output.length <= 2) {
    return output.map((l) => (l.kind === "out" || l.kind === "ok" ? spoken(l.text) : "")).join(". ");
  }

  const docs = output.flatMap((l) => (l.kind === "doc" ? [title(l.source) ?? "a file"] : []));
  if (docs.length) return `${command}: printed ${docs.join(", ")} above the prompt.`;

  let lines = 0;
  for (const l of output) {
    if (l.kind === "text" || l.kind === "screen") lines += l.rows.filter((row) => row.length).length;
    else if (l.kind === "rows") lines += l.rows.length;
    else lines += 1;
  }
  return `${command}: printed ${lines} ${lines === 1 ? "line" : "lines"} above the prompt.`;
}
