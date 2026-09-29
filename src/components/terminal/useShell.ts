import { useMemo, useRef, useState } from "react";
import { buildCommands, welcomeLines } from "./commands";
import { CommandHistory, complete, tokenize } from "./shell";
import type { CommandContext, ScreenProgram, TerminalApi, TerminalLine } from "./types";

/** A scrollback line. `id` keys it for React and never repeats, even across `clear`. */
export interface LogEntry {
  id: number;
  line: TerminalLine;
}

/** The live terminal's zsh session, as its views need it. */
export interface Shell {
  /** The scrollback, oldest first. */
  entries: readonly LogEntry[];
  /** The working directory, e.g. "~/work". */
  cwd: string;
  /** The line being edited at the prompt. */
  input: string;
  setInput(line: string): void;
  /** What completion would add to `input`, drawn as ghost text; "" when nothing completes. */
  suggestion: string;
  /**
   * A line-editing key at the prompt: Tab, or → at the end of the line,
   * accepts the suggestion; Enter runs the line; ↑ and ↓ walk the history.
   * Returns whether the key was handled, so the caller can cancel its default.
   */
  key(key: string, atEnd: boolean): boolean;
  /** A full-screen program that has taken over the body, if any. */
  program: ScreenProgram | null;
  /** The program exited: the prompt returns, with whatever it printed. */
  endProgram(output?: TerminalLine[]): void;
}

interface Log {
  entries: readonly LogEntry[];
  nextId: number;
}

const append = (log: Log, lines: readonly TerminalLine[]): Log => ({
  entries: [...log.entries, ...lines.map((line, i) => ({ id: log.nextId + i, line }))],
  nextId: log.nextId + lines.length,
});

const cleared = (log: Log): Log => ({ entries: [], nextId: log.nextId });

/**
 * The shell behind the live terminal: scrollback, prompt line, cwd, history,
 * and the command registry it dispatches to. Commands drive the page through
 * `api`; `exit` closes the window through `onClose`.
 */
export function useShell(api: TerminalApi, onClose: () => void): Shell {
  const [log, setLog] = useState(() => append({ entries: [], nextId: 0 }, welcomeLines()));
  const [input, setInput] = useState("");
  const [navPath, setNavPath] = useState<string[]>([]);
  const [program, setProgram] = useState<ScreenProgram | null>(null);
  // Only handlers touch the history, so it is created on first use there.
  const historyRef = useRef<CommandHistory>(null);
  const history = () => {
    if (!historyRef.current) historyRef.current = new CommandHistory();
    return historyRef.current;
  };

  // Rebuilt when the cwd changes (cheap; `cd` is rare), so command closures
  // always read the current path.
  const commands = useMemo(() => buildCommands(api, () => navPath, setNavPath), [api, navPath]);
  const completion = useMemo(() => complete(input, commands), [input, commands]);
  const cwd = navPath.length ? `~/${navPath.join("/")}` : "~/";

  // Functional updates throughout: a command may print after an await.
  const print = (...lines: TerminalLine[]) => setLog((l) => append(l, lines));

  const ctx: CommandContext = {
    out: (text) => print({ kind: "out", text }),
    ok: (text) => print({ kind: "ok", text }),
    err: (text) => print({ kind: "err", text }),
    rows: (rows, title) => print({ kind: "rows", rows: [...rows], title }),
    clear: () => setLog(cleared),
    close: () => window.setTimeout(onClose, 120),
    program: (p) => setProgram(p),
  };

  const run = (line: string) => {
    print({ kind: "cmd", text: line, path: cwd });
    setInput("");
    const raw = line.trim();
    if (!raw) return;
    history().add(raw);
    const [word = "", ...args] = tokenize(raw);
    const name = word.toLowerCase();
    const command = commands[name];
    if (!command) {
      ctx.err(`command not found: ${name} — type \`help\``);
      return;
    }
    try {
      command.run(args, ctx);
    } catch (e) {
      ctx.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const recall = (line: string | null) => {
    if (line !== null) setInput(line);
  };

  const key = (name: string, atEnd: boolean): boolean => {
    switch (name) {
      case "ArrowRight":
        if (!atEnd || !completion) return false;
        setInput(completion.line);
        return true;
      case "Tab":
        if (completion) setInput(completion.line);
        return true;
      case "Enter":
        run(input);
        return true;
      case "ArrowUp":
        recall(history().prev());
        return true;
      case "ArrowDown":
        recall(history().next());
        return true;
      default:
        return false;
    }
  };

  const endProgram = (output?: TerminalLine[]) => {
    setProgram(null);
    if (output?.length) print(...output);
  };

  return {
    entries: log.entries,
    cwd,
    input,
    setInput,
    suggestion: completion?.suffix ?? "",
    key,
    program,
    endProgram,
  };
}
