// The shell's pure parts — no React, no DOM: the prompt, word splitting,
// completion and history. useShell.ts wires them to state.

import type { CommandMap } from "./types";

/** zsh's default prompt, `%n@%m %1~ %# `: the cwd's last component, `~` at home. */
export function promptFor(cwd: string): string {
  const dir = cwd.replace(/\/$/, "").split("/").pop() || "~";
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
 * Complete a command name, or a command's argument from its `args`.
 * Case-insensitive; an exact match leaves nothing to suggest. Accepting a
 * command that takes arguments leaves a space for them.
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
  const typed = /\s$/.test(input) ? "" : words[1];
  const needle = typed.toLowerCase();
  const option = (typeof args === "function" ? args() : args).find((o) => {
    const lower = o.toLowerCase();
    return lower.startsWith(needle) && lower !== needle;
  });
  if (!option) return null;
  return { suffix: option.slice(typed.length), line: `${words[0]} ${option}` };
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
