/**
 * A Claude Code lookalike for the shell: the welcome box, the `>` prompt in
 * its rounded box, the asterisk spinner with its verbs, `⏺` replies with
 * `⎿` tool results, slash commands with their menu, Esc to interrupt and
 * Ctrl-C twice to leave. It never does what it is asked. The transcript
 * stays in the scrollback on exit, as an inline TUI's would.
 */
import type { ProgramHost, ScreenProgram } from "../types";
import { DEFAULT_FG, Screen, Win, type CellRun } from "../tty/screen.ts";
import {
  COMPACT_TEXT,
  costText,
  DOCTOR_TEXT,
  HELP_TEXT,
  INIT_RESULT,
  LOGIN_TEXT,
  MEMORY_TEXT,
  MODEL_TEXT,
  MODES,
  PLACEHOLDERS,
  replyFor,
  SLASH_COMMANDS,
  SPINNER_FRAMES,
  SPINNER_VERBS,
  STATUS_TEXT,
  TIP_LINE,
  vimText,
  WELCOME_TIPS,
  type Reply,
  type ToolTheater,
} from "./content.ts";
import { textWidth, wrapRuns } from "./wrap.ts";

/** xterm 173 (#d7875f): the closest cube colour to Claude's orange. */
export const CLAUDE_ORANGE = 173;
const GRAY = 8;
const GREEN = 2;
const RED = 1;

const R = (text: string, fg: number = DEFAULT_FG, bold = false, inverse = false): CellRun =>
  inverse ? { text, fg, bold, inverse: true } : { text, fg, bold };

type Phase = "idle" | "busy" | "exited";

const CTRL_ARM_MS = 2000;
const SPINNER_FRAME_MS = 120;
const STREAM_TICK_MS = 28;
const MENU_MAX = 6;

export interface ClaudeProgramOptions {
  rand?: () => number;
  cwd?: string;
}

export function createClaudeProgram(opts: ClaudeProgramOptions = {}): ClaudeProgram {
  return new ClaudeProgram(opts);
}

export class ClaudeProgram implements ScreenProgram {
  readonly captureEscape = true;
  readonly textInput = true;

  private readonly rand: () => number;
  private readonly cwd: string;
  private screen: Screen | null = null;
  private win: Win | null = null;
  private host: ProgramHost | null = null;
  private phase: Phase = "idle";

  /** Committed, already wrapped transcript rows. */
  private transcript: CellRun[][] = [];
  /** The `⏺` paragraph currently streaming. */
  private live: CellRun[][] = [];
  private streamText = "";
  private streamPos = 0;

  private input = "";
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private draft = "";
  private scroll = 0;
  private menuIdx = 0;
  private modeIdx = 0;
  private placeholder = "";
  private vim = false;
  private turns = 0;
  private readonly startedAt = Date.now();

  private spinning = false;
  private spinFrame = 0;
  private spinVerb = "";
  private spinStarted = 0;
  private spinTokens = 0;

  private ctrlArmed = 0;
  private ctrlKey = "C";

  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private queue: (() => void)[] = [];

  constructor(opts: ClaudeProgramOptions = {}) {
    this.rand = opts.rand ?? Math.random;
    this.cwd = opts.cwd ?? "~/repos/danielhkuo.github.io";
  }

  get state(): Phase {
    return this.phase;
  }

  /** The transcript as text, for tests. */
  get transcriptText(): string {
    return [...this.transcript, ...this.live].map((r) => r.map((x) => x.text).join("").trimEnd()).join("\n");
  }

  get inputText(): string {
    return this.input;
  }

  // ---- lifecycle -----------------------------------------------------------

  /** May run again after `stop()` (React StrictMode mounts the view twice in dev), so it resets everything. */
  start(size: { rows: number; cols: number }, host: ProgramHost): Screen {
    this.clearTimers();
    this.phase = "idle";
    this.transcript = [];
    this.live = [];
    this.spinning = false;
    this.host = host;
    this.screen = new Screen(size.rows, size.cols);
    this.win = Win.open(this.screen, size.rows, size.cols, 0, 0);
    this.placeholder = PLACEHOLDERS[Math.floor(this.rand() * PLACEHOLDERS.length)];
    this.printWelcome();
    this.render();
    return this.screen;
  }

  stop(): void {
    this.clearTimers();
    this.phase = "exited";
  }

  private exit(): void {
    if (this.phase === "exited") return;
    this.clearTimers();
    this.commitLive();
    this.phase = "exited";
    const rows = [...this.transcript];
    while (rows.length && rows[rows.length - 1].every((r) => /^ *$/.test(r.text))) rows.pop();
    this.host?.exit(rows.length ? [{ kind: "screen", rows }] : undefined);
  }

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.phase !== "exited") fn();
    }, ms);
    this.timers.add(t);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.queue = [];
  }

  // ---- transcript ------------------------------------------------------------

  private get cols(): number {
    return this.screen?.cols ?? 80;
  }

  private say(runs: CellRun[], indent = 0): void {
    for (const row of wrapRuns(runs, this.cols, indent)) this.transcript.push(row);
    this.scroll = 0;
  }

  private blank(): void {
    this.transcript.push([]);
  }

  private text(lines: readonly string[], fg: number = DEFAULT_FG): void {
    for (const line of lines) {
      if (line === "") this.blank();
      else this.say([R(line, fg)]);
    }
  }

  private commitLive(): void {
    if (this.live.length) {
      this.transcript.push(...this.live);
      this.live = [];
    }
    this.streamText = "";
    this.streamPos = 0;
  }

  private printWelcome(): void {
    const lines: CellRun[][] = [
      [R("✻ ", CLAUDE_ORANGE, true), R("Welcome to Claude Code!", DEFAULT_FG, true)],
      [],
      [R("  /help for help, /status for your current setup", DEFAULT_FG)],
      [],
      [R(`  cwd: ${this.cwd}`, DEFAULT_FG)],
    ];
    const inner = Math.max(...lines.map((l) => textWidth(l.map((r) => r.text).join("")))) + 2;
    const width = Math.min(this.cols, inner + 2);
    const bar = "─".repeat(Math.max(0, width - 2));
    const border = (t: string) => R(t, CLAUDE_ORANGE);
    this.transcript.push([border(`╭${bar}╮`)]);
    for (const l of lines) {
      const w = textWidth(l.map((r) => r.text).join(""));
      const pad = Math.max(0, width - 4 - w);
      this.transcript.push([border("│ "), ...l, R(" ".repeat(pad)), border(" │")]);
    }
    this.transcript.push([border(`╰${bar}╯`)]);
    this.blank();
    this.say([R(" Tips for getting started:")]);
    this.blank();
    for (const tip of WELCOME_TIPS) this.say([R(`  ${tip}`)], 2);
    this.blank();
    this.say([R(" "), R("※ Tip: ", GRAY), R(TIP_LINE.replace(/^※ Tip: /, ""), GRAY)], 8);
    this.blank();
  }

  // ---- input handling ---------------------------------------------------------

  key(key: string, ctrl: boolean, shift = false): void {
    if (this.phase === "exited") return;
    const busy = this.phase === "busy";

    if (ctrl) {
      switch (key.toLowerCase()) {
        case "c":
          this.onQuitKey("C", busy);
          return;
        case "d":
          this.onQuitKey("D", busy);
          return;
        case "l":
          this.transcript = [];
          this.live = [];
          this.scroll = 0;
          this.render();
          return;
        case "u":
          this.input = this.input.slice(this.cursor);
          this.cursor = 0;
          break;
        case "k":
          this.input = this.input.slice(0, this.cursor);
          break;
        case "a":
          this.cursor = 0;
          break;
        case "e":
          this.cursor = this.input.length;
          break;
        case "w": {
          const before = this.input.slice(0, this.cursor).replace(/\S+\s*$/, "");
          this.input = before + this.input.slice(this.cursor);
          this.cursor = before.length;
          break;
        }
        default:
          return;
      }
      this.render();
      return;
    }

    switch (key) {
      case "Escape":
        if (busy) this.interrupt();
        else {
          this.input = "";
          this.cursor = 0;
          this.render();
        }
        return;
      case "Enter":
        if (busy) return;
        this.submit();
        return;
      case "Tab":
        if (shift) {
          this.modeIdx = (this.modeIdx + 1) % MODES.length;
        } else {
          const items = this.menuItems();
          if (items.length) {
            this.input = items[Math.min(this.menuIdx, items.length - 1)].name;
            this.cursor = this.input.length;
          }
        }
        this.render();
        return;
      case "Backspace":
        if (this.cursor > 0) {
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor--;
        }
        break;
      case "Delete":
        this.input = this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
        break;
      case "ArrowLeft":
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case "ArrowRight":
        this.cursor = Math.min(this.input.length, this.cursor + 1);
        break;
      case "Home":
        this.cursor = 0;
        break;
      case "End":
        this.cursor = this.input.length;
        break;
      case "ArrowUp":
        if (this.menuItems().length) this.menuIdx = Math.max(0, this.menuIdx - 1);
        else this.historyStep(-1);
        break;
      case "ArrowDown":
        if (this.menuItems().length) this.menuIdx = Math.min(this.menuItems().length - 1, this.menuIdx + 1);
        else this.historyStep(1);
        break;
      case "PageUp":
        this.wheel(-Math.max(1, (this.screen?.rows ?? 24) - 6));
        return;
      case "PageDown":
        this.wheel(Math.max(1, (this.screen?.rows ?? 24) - 6));
        return;
      case "tap":
        return;
      default:
        if ([...key].length !== 1) return;
        this.input = this.input.slice(0, this.cursor) + key + this.input.slice(this.cursor);
        this.cursor += key.length;
        this.menuIdx = 0;
    }
    this.render();
  }

  wheel(rows: number): void {
    const max = Math.max(0, this.allRows().length - this.transcriptArea());
    this.scroll = Math.max(0, Math.min(max, this.scroll - rows));
    this.render();
  }

  private historyStep(dir: -1 | 1): void {
    if (!this.history.length) return;
    if (this.histIdx === -1) {
      if (dir === 1) return;
      this.draft = this.input;
      this.histIdx = this.history.length - 1;
    } else {
      const next = this.histIdx + dir;
      if (next >= this.history.length) {
        this.histIdx = -1;
        this.input = this.draft;
        this.cursor = this.input.length;
        return;
      }
      this.histIdx = Math.max(0, next);
    }
    this.input = this.history[this.histIdx];
    this.cursor = this.input.length;
  }

  private onQuitKey(which: "C" | "D", busy: boolean): void {
    const now = Date.now();
    if (busy) this.interrupt();
    if (this.ctrlArmed && now - this.ctrlArmed < CTRL_ARM_MS && this.ctrlKey === which) {
      this.exit();
      return;
    }
    this.ctrlArmed = now;
    this.ctrlKey = which;
    this.after(CTRL_ARM_MS, () => {
      if (Date.now() - this.ctrlArmed >= CTRL_ARM_MS) {
        this.ctrlArmed = 0;
        this.render();
      }
    });
    this.render();
  }

  private menuItems() {
    if (this.phase !== "idle" || !this.input.startsWith("/") || /\s/.test(this.input)) return [];
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(this.input)).slice(0, MENU_MAX);
  }

  // ---- submit -------------------------------------------------------------------

  private submit(): void {
    const menu = this.menuItems();
    let line = this.input.trim();
    if (menu.length && !SLASH_COMMANDS.some((c) => c.name === line)) {
      line = menu[Math.min(this.menuIdx, menu.length - 1)].name;
    }
    this.input = "";
    this.cursor = 0;
    this.histIdx = -1;
    this.menuIdx = 0;
    if (!line) {
      this.render();
      return;
    }
    this.history.push(line);

    if (line === "exit" || line === "quit" || line === "/exit" || line === "/quit") {
      this.exit();
      return;
    }
    this.say([R("> ", GRAY), R(line)], 2);
    this.blank();
    if (line.startsWith("/")) {
      this.slash(line);
      this.render();
      return;
    }
    this.turns++;
    this.beginReply(replyFor(line, this.turns, this.rand));
  }

  private slash(line: string): void {
    const name = line.split(/\s+/)[0];
    switch (name) {
      case "/help":
        this.text(HELP_TEXT, GRAY);
        break;
      case "/status":
        this.text(STATUS_TEXT, GRAY);
        break;
      case "/cost":
        this.text(costText((Date.now() - this.startedAt) / 1000), GRAY);
        break;
      case "/clear":
        this.transcript = [];
        this.live = [];
        this.scroll = 0;
        return;
      case "/compact":
        this.text(COMPACT_TEXT, GRAY);
        break;
      case "/doctor":
        this.text(DOCTOR_TEXT, GRAY);
        break;
      case "/init":
        this.toolCall({ tool: "Write", arg: "CLAUDE.md", result: 'Wrote 1 line: "# Do not help."' });
        this.blank();
        this.say([R("⏺ "), R(INIT_RESULT)], 2);
        break;
      case "/login":
        this.text(LOGIN_TEXT, GRAY);
        break;
      case "/memory":
        this.text(MEMORY_TEXT, GRAY);
        break;
      case "/model":
        this.text(MODEL_TEXT, GRAY);
        break;
      case "/vim":
        this.vim = !this.vim;
        this.text(vimText(this.vim), GRAY);
        break;
      default:
        this.say([R(`Unknown slash command: ${name}`, RED)]);
    }
    this.blank();
  }

  private toolCall(t: ToolTheater): void {
    this.say([R("⏺ ", GREEN), R(t.tool, DEFAULT_FG, true), R(`(${t.arg})`)], 2);
    this.say([R("  ⎿  ", GRAY), R(t.result, GRAY)], 5);
  }

  // ---- the performance ------------------------------------------------------------

  private beginReply(reply: Reply): void {
    this.phase = "busy";
    this.spinTokens = 0;
    const steps: (() => void)[] = [];
    const spin = (ms: number) => steps.push(() => this.spin(ms));
    spin(1200 + this.rand() * 1600);
    for (const t of reply.tools) {
      steps.push(() => {
        this.stopSpinner();
        this.say([R("⏺ ", GREEN), R(t.tool, DEFAULT_FG, true), R(`(${t.arg})`)], 2);
        this.render();
        this.after(220 + this.rand() * 300, this.next);
      });
      steps.push(() => {
        this.say([R("  ⎿  ", GRAY), R(t.result, GRAY)], 5);
        this.blank();
        this.render();
        this.next();
      });
      spin(400 + this.rand() * 700);
    }
    steps.push(() => {
      this.stopSpinner();
      this.streamText = reply.text;
      this.streamPos = 0;
      this.streamTick();
    });
    this.queue = steps;
    this.next();
  }

  private next = (): void => {
    const step = this.queue.shift();
    if (step) step();
    else this.finishReply();
  };

  private spin(ms: number): void {
    this.spinning = true;
    this.spinFrame = 0;
    this.spinVerb = SPINNER_VERBS[Math.floor(this.rand() * SPINNER_VERBS.length)];
    this.spinStarted = Date.now();
    const end = Date.now() + ms;
    const frame = () => {
      if (!this.spinning) return;
      this.spinFrame = (this.spinFrame + 1) % SPINNER_FRAMES.length;
      this.spinTokens += Math.floor(this.rand() * 55) + 5;
      this.render();
      if (Date.now() >= end) this.next();
      else this.after(SPINNER_FRAME_MS, frame);
    };
    this.render();
    this.after(SPINNER_FRAME_MS, frame);
  }

  private stopSpinner(): void {
    this.spinning = false;
  }

  private streamTick = (): void => {
    if (this.phase !== "busy") return;
    this.streamPos = Math.min(this.streamText.length, this.streamPos + 2 + Math.floor(this.rand() * 4));
    const partial = this.streamText.slice(0, this.streamPos);
    this.live = wrapRuns([R("⏺ "), R(partial)], this.cols, 2);
    this.scroll = 0;
    this.render();
    if (this.streamPos < this.streamText.length) this.after(STREAM_TICK_MS, this.streamTick);
    else this.next();
  };

  private finishReply(): void {
    this.stopSpinner();
    this.commitLive();
    this.blank();
    this.phase = "idle";
    this.render();
  }

  private interrupt(): void {
    this.clearTimers();
    this.stopSpinner();
    this.commitLive();
    this.say([R("  ⎿  ", RED), R("Interrupted · What should Claude do instead?", RED)], 5);
    this.blank();
    this.phase = "idle";
    this.render();
  }

  // ---- drawing ------------------------------------------------------------------------

  private allRows(): CellRun[][] {
    const rows = [...this.transcript, ...this.live];
    if (this.spinning) {
      const secs = Math.floor((Date.now() - this.spinStarted) / 1000);
      const tokens = this.spinTokens >= 1000 ? `${(this.spinTokens / 1000).toFixed(1)}k` : String(this.spinTokens);
      rows.push([
        R(`${SPINNER_FRAMES[this.spinFrame]} `, CLAUDE_ORANGE),
        R(`${this.spinVerb}… `),
        R(`(esc to interrupt · ${secs}s · ↑ ${tokens} tokens)`, GRAY),
      ]);
    }
    return rows;
  }

  private inputLines(): { text: string; cursorAt: number | null }[] {
    const width = Math.max(1, this.cols - 6);
    const lines: { text: string; cursorAt: number | null }[] = [];
    let i = 0;
    do {
      const text = this.input.slice(i, i + width);
      const cursorAt = this.cursor >= i && this.cursor < i + width ? this.cursor - i : null;
      lines.push({ text, cursorAt });
      i += width;
    } while (i < this.input.length);
    const last = lines[lines.length - 1];
    if (this.cursor === this.input.length && last.cursorAt === null) {
      if (last.text.length < width) last.cursorAt = last.text.length;
      else lines.push({ text: "", cursorAt: 0 });
    }
    return lines;
  }

  private bottomHeight(): number {
    const menu = this.menuItems().length;
    return this.inputLines().length + 2 + 1 + menu;
  }

  private transcriptArea(): number {
    return Math.max(1, (this.screen?.rows ?? 24) - this.bottomHeight());
  }

  private drawRow(y: number, runs: readonly CellRun[], x0 = 0): void {
    const win = this.win as Win;
    let x = x0;
    for (const r of runs) {
      win.fg = r.fg;
      win.bold = r.bold;
      win.inverse = Boolean(r.inverse);
      win.mvaddstr(y, x, r.text);
      x += textWidth(r.text);
    }
    win.fg = DEFAULT_FG;
    win.bold = false;
    win.inverse = false;
  }

  private render(): void {
    const screen = this.screen;
    if (!screen || this.phase === "exited") return;
    screen.clear();
    const cols = screen.cols;

    // Transcript, following the bottom unless scrolled.
    const all = this.allRows();
    const area = this.transcriptArea();
    const end = Math.max(0, all.length - this.scroll);
    const start = Math.max(0, end - area);
    let y = 0;
    for (let i = start; i < end && y < area; i++, y++) this.drawRow(y, all[i]);

    // Input box.
    const boxTop = area;
    const bar = "─".repeat(Math.max(0, cols - 2));
    this.drawRow(boxTop, [R(`╭${bar}╮`, GRAY)]);
    const lines = this.inputLines();
    lines.forEach((line, i) => {
      const yy = boxTop + 1 + i;
      const runs: CellRun[] = [R("│ ", GRAY), R(i === 0 ? "> " : "  ")];
      if (this.input === "" && i === 0) {
        runs.push(R(" ", DEFAULT_FG, false, true), R(this.placeholder.slice(0, Math.max(0, cols - 7)), GRAY));
      } else if (line.cursorAt === null) {
        runs.push(R(line.text));
      } else {
        const before = line.text.slice(0, line.cursorAt);
        const at = line.text.charAt(line.cursorAt) || " ";
        const after = line.text.slice(line.cursorAt + 1);
        runs.push(R(before), R(at, DEFAULT_FG, false, true), R(after));
      }
      this.drawRow(yy, runs);
      this.drawRow(yy, [R("│", GRAY)], cols - 1);
    });
    const boxBottom = boxTop + 1 + lines.length;
    this.drawRow(boxBottom, [R(`╰${bar}╯`, GRAY)]);

    // Hint row, or the slash menu.
    const menu = this.menuItems();
    const hintY = boxBottom + 1;
    if (menu.length) {
      const nameW = Math.max(...menu.map((m) => m.name.length)) + 4;
      menu.forEach((m, i) => {
        const selected = i === Math.min(this.menuIdx, menu.length - 1);
        const desc = m.desc.slice(0, Math.max(0, cols - nameW - 2));
        this.drawRow(hintY + i, [
          R("  "),
          R(m.name.padEnd(nameW), selected ? CLAUDE_ORANGE : DEFAULT_FG, selected),
          R(desc, GRAY),
        ]);
      });
    } else if (this.ctrlArmed && Date.now() - this.ctrlArmed < CTRL_ARM_MS) {
      this.drawRow(hintY, [R(`  Press Ctrl-${this.ctrlKey} again to exit`, GRAY)]);
    } else {
      const left = this.vim ? "  -- INSERT --" : "  ? for shortcuts";
      const right = `⏵⏵ ${MODES[this.modeIdx]} (shift+tab to cycle)`;
      this.drawRow(hintY, [R(left, GRAY)]);
      if (left.length + right.length + 4 < cols) this.drawRow(hintY, [R(right, GRAY)], cols - right.length - 2);
    }
    this.host?.paint();
  }
}
