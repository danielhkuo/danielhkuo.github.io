// Shared types for the interactive terminal. No React, no `any`.

import type { CellRun, Screen } from "./tty/screen";

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
  | { kind: "rows"; title?: string; rows: TerminalRow[] }
  /** A finished character grid, as a full-screen program prints on exit. */
  | { kind: "screen"; rows: CellRun[][] };

/** What a full-screen program can ask of the terminal that hosts it. */
export interface ProgramHost {
  /** The screen changed; repaint its dirty rows on the next frame. */
  paint(): void;
  /** The program has ended. Any output is appended to the scrollback. */
  exit(output?: TerminalLine[]): void;
}

/**
 * A program that takes over the terminal body the way an ncurses program
 * takes over a real terminal: it draws on a fixed character grid and reads
 * keys until it exits, then the scrollback and prompt return.
 */
export interface ScreenProgram {
  /** Called once the grid has been measured. Returns the screen to render. */
  start(size: { rows: number; cols: number }, host: ProgramHost): Screen;
  /** A key press: `KeyboardEvent.key`, or "tap" for a touch on the screen. */
  key(key: string, ctrl: boolean, shift?: boolean): void;
  /** The terminal is going away; release timers. May run after `exit`. */
  stop(): void;
  /** Take Escape for itself instead of letting it close the terminal. */
  readonly captureEscape?: boolean;
  /** Reads typed text, so the host keeps a focused input for on-screen keyboards. */
  readonly textInput?: boolean;
  /** Mouse wheel over the screen, in rows (positive = content moves up). */
  wheel?(rows: number): void;
}

/** Sink a command writes its output to. */
export interface CommandContext {
  out(text: string): void;
  ok(text: string): void;
  err(text: string): void;
  rows(rows: readonly TerminalRow[], title?: string): void;
  clear(): void;
  close(): void;
  /** Hand the terminal body to a full-screen program until it exits. */
  program(program: ScreenProgram): void;
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
