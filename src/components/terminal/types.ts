// Shared types for the interactive terminal. No React, no `any`.

/** A serializable slice of a pinned GitHub repo, passed from the server page. */
export interface SlimProject {
  name: string;
  description: string;
  url: string;
  homepageUrl: string | null;
}

/** A key/value pair rendered as a two-column row (help, contact, ls). */
export interface TerminalRow {
  k: string;
  v: string;
}

/**
 * One line of terminal output. Pure data — the component renders it.
 * `out`/`ok`/`err` text may contain `backtick` spans, highlighted on render.
 */
export type TerminalLine =
  | { kind: "cmd"; text: string; path: string }
  | { kind: "out"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string }
  | { kind: "rows"; title?: string; rows: TerminalRow[] };

/** Sink a command writes its output to. */
export interface CommandContext {
  out(text: string): void;
  ok(text: string): void;
  err(text: string): void;
  rows(rows: readonly TerminalRow[], title?: string): void;
  clear(): void;
  close(): void;
}

/** Argument options for autocomplete: a fixed list or a lazy getter. */
export type CommandArgs = readonly string[] | (() => readonly string[]);

export interface Command {
  desc: string;
  usage?: string;
  args?: CommandArgs;
  hidden?: boolean;
  run(args: string[], ctx: CommandContext): void;
}

export type CommandMap = Record<string, Command>;

export type ThemeMode = "dark" | "light";

/** The bridge the terminal uses to drive the surrounding page. */
export interface TerminalApi {
  scrollToSection(id: string): void;
  openUrl(url: string): void;
  getProjects(): SlimProject[];
  getTheme(): ThemeMode;
  setTheme(mode: ThemeMode | "toggle"): ThemeMode;
  close(): void;
}
