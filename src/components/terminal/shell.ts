// The shell's pure parts — no React, no DOM: the prompt, word splitting,
// completion and history. useShell.ts wires them to state.

import type { CommandContext, CommandMap } from "./types";

/**
 * zsh's default prompt, `%n@%m %1~ %# `, for a cwd written the way `%~`
 * writes it ("~/projects"): its last component — `~` at home, `/` at the root.
 */
export function promptFor(cwd: string): string {
  const dir = cwd.split("/").pop() || "/";
  return `daniel@portfolio ${dir} % `;
}

/** A completion of the line at the prompt, zsh-autosuggestions style. */
export interface Completion {
  /** What it adds after the typed text: the ghost text. */
  suffix: string;
  /** The whole line once accepted. */
  line: string;
}

/**
 * Complete a command name, or the argument being typed from the command's
 * `args`. Case-insensitive; an exact match leaves nothing to suggest.
 * Accepting a command that takes arguments leaves a space for them.
 */
export function complete(input: string, commands: CommandMap): Completion | null {
  const lead = input.replace(/^\s+/, "");
  if (!lead) return null;
  const words = lead.split(/\s+/);

  if (words.length === 1) {
    const typed = words[0].toLowerCase();
    const name = Object.keys(commands).find(
      (n) => !commands[n].hidden && n.startsWith(typed) && n !== typed,
    );
    if (!name) return null;
    return { suffix: name.slice(typed.length), line: commands[name].args ? `${name} ` : name };
  }

  const args = commands[words[0].toLowerCase()]?.args;
  if (!args) return null;
  // The last word — empty when the line ends in a space, ready for a new one.
  const typed = words[words.length - 1];
  const needle = typed.toLowerCase();
  const option = (typeof args === "function" ? args(typed) : args).find((o) => {
    const lower = o.toLowerCase();
    return lower.startsWith(needle) && lower !== needle;
  });
  if (!option) return null;
  return { suffix: option.slice(typed.length), line: input.slice(0, input.length - typed.length) + option };
}

/** Earlier command lines, recalled with ↑ and ↓ the way a line editor does. */
export class CommandHistory {
  private readonly lines: string[] = [];
  /** The line being recalled; -1 while editing a fresh one. */
  private at = -1;

  /** A line was run: remember it and go back to a fresh line. */
  add(line: string): void {
    this.lines.push(line);
    this.at = -1;
  }

  /** ↑: the previous line, stopping at the oldest; null with nothing to recall. */
  prev(): string | null {
    if (!this.lines.length) return null;
    this.at = this.at === -1 ? this.lines.length - 1 : Math.max(0, this.at - 1);
    return this.lines[this.at];
  }

  /** ↓: the next line, "" past the newest; null when not recalling. */
  next(): string | null {
    if (this.at === -1) return null;
    this.at += 1;
    if (this.at < this.lines.length) return this.lines[this.at];
    this.at = -1;
    return "";
  }
}

/**
 * Split a command line into words the way a POSIX shell does, so
 * `cbonsai -m "grow, little tree"` arrives as one argument. Whitespace
 * separates words; '…' is literal; "…" keeps spaces and honours \" \\ \$ \`;
 * a bare backslash escapes the next character. An unterminated quote runs
 * to the end of the line.
 */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'") {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== "'") cur += line[i++];
      i++;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
          cur += line[i + 1];
          i += 2;
        } else {
          cur += line[i++];
        }
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      inWord = true;
      if (i + 1 < line.length) {
        cur += line[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) {
        out.push(cur);
        cur = "";
        inWord = false;
      }
      i++;
      continue;
    }
    cur += ch;
    inWord = true;
    i++;
  }
  if (inWord) out.push(cur);
  return out;
}

/**
 * Run a command line: its first word names the command — in any case, since
 * a phone keyboard capitalises it — and the rest are its arguments. A
 * command that throws is reported, not propagated.
 */
export function execute(line: string, commands: CommandMap, ctx: CommandContext): void {
  const [word, ...args] = tokenize(line);
  if (word === undefined) return;
  const name = word.toLowerCase();
  if (!Object.hasOwn(commands, name)) {
    ctx.err(`zsh: command not found: ${word}`);
    return;
  }
  try {
    commands[name].run(args, ctx);
  } catch (e) {
    ctx.err(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
