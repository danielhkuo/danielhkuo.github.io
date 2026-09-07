/**
 * cbonsai's `main()` loop as a terminal program: parse, load, seed, then
 * grow trees on the screen the host gives us, pacing live growth with
 * timers, waiting for keys the way the C waits on `wgetch`, and saving
 * progress on exit. No DOM here — the host paints and forwards keys.
 */
import type { CommandContext, ProgramHost, ScreenProgram, TerminalLine } from "../types";
import { HELP_LINES, parseArgs, strtolExact, type Config } from "./args.ts";
import { Bonsai, STEP_DONE, STEP_VISIBLE } from "./bonsai.ts";
import { GlibcRandom } from "./rand.ts";
import { DEFAULT_FG, Screen, type CellRun } from "./screen.ts";

/** The "file system" behind -W/-C: a key per path. */
export type SaveStore = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "cbonsai:";

function defaultStore(): SaveStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** `time(NULL)`. */
export function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

/** C `loadFromFile`: "<seed> <branches>" parsed as `%i %i`. Returns an error line, or null. */
export function loadFromFile(conf: Config, store: SaveStore | null): string | null {
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(STORAGE_PREFIX + conf.loadFile) : null;
  } catch {
    raw = null;
  }
  if (raw === null) return `error: file was not opened properly for reading: ${conf.loadFile}`;
  const parts = raw.trim().split(/\s+/);
  const seed = parts[0] !== undefined ? strtolExact(parts[0]) : null;
  const target = parts[1] !== undefined ? strtolExact(parts[1]) : null;
  if (seed === null || target === null) return "error: save file could not be read";
  conf.seed = seed;
  conf.targetBranchCount = target;
  return null;
}

/** C `saveToFile`. */
export function saveToFile(path: string, seed: number, branches: number, store: SaveStore | null): void {
  try {
    store?.setItem(STORAGE_PREFIX + path, `${seed} ${branches}`);
  } catch {
    /* storage full or disabled: the C would print an error; nothing to see here */
  }
}

/** Drop leading and trailing rows that hold nothing but blanks. */
export function trimBlankRows(rows: CellRun[][]): CellRun[][] {
  const blank = (runs: CellRun[]) => runs.every((r) => r.fg === DEFAULT_FG && !r.bold && /^ *$/.test(r.text));
  let start = 0;
  let end = rows.length;
  while (start < end && blank(rows[start])) start++;
  while (end > start && blank(rows[end - 1])) end--;
  return rows.slice(start, end);
}

/** Entry point for the `cbonsai` shell command: everything before `initscr()`. */
export function runCbonsai(args: string[], ctx: CommandContext, store: SaveStore | null = defaultStore()): void {
  const parsed = parseArgs(args);
  if (parsed.kind === "help") {
    for (const line of HELP_LINES) ctx.out(line);
    return;
  }
  if (parsed.kind === "error") {
    ctx.err(parsed.message);
    if (parsed.help) for (const line of HELP_LINES) ctx.out(line);
    return;
  }
  const conf = parsed.config;
  if (conf.load) {
    const err = loadFromFile(conf, store);
    if (err) ctx.err(err);
  }
  if (conf.seed === 0) conf.seed = unixTime();
  ctx.program(new CbonsaiProgram(conf, store));
}

type Phase = "idle" | "growing" | "waitKey" | "waitTree" | "exited";

/** Longest stretch of growth work per timer tick before yielding to the browser. */
const TICK_BUDGET_MS = 8;

export class CbonsaiProgram implements ScreenProgram {
  readonly conf: Config;
  private readonly store: SaveStore | null;
  private readonly rng: GlibcRandom;
  private screen: Screen | null = null;
  private bonsai: Bonsai | null = null;
  private host: ProgramHost | null = null;
  private phase: Phase = "idle";
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock time the next visible step is allowed to run. */
  private due = 0;

  constructor(conf: Config, store: SaveStore | null = defaultStore()) {
    this.conf = conf;
    this.store = store;
    this.rng = new GlibcRandom(conf.seed);
  }

  get state(): Phase {
    return this.phase;
  }

  start(size: { rows: number; cols: number }, host: ProgramHost): Screen {
    this.host = host;
    this.screen = new Screen(size.rows, size.cols);
    this.bonsai = new Bonsai(this.conf, this.rng, this.screen);
    this.startTree();
    return this.screen;
  }

  /** `init()` + `growTree()` for one tree. */
  private startTree(): void {
    const bonsai = this.bonsai as Bonsai;
    bonsai.init();
    bonsai.beginTree();
    this.phase = "growing";
    this.due = Date.now();
    this.tick();
  }

  /**
   * Run growth steps. A visible step (live mode) is followed by a `timeStep`
   * sleep, as `updateScreen()` does; hidden steps — non-live growth and the
   * fast-forward of a loaded tree — run back to back, but never for more
   * than a few milliseconds per tick, so a huge tree cannot stall the page.
   * An ordinary tree finishes inside the first, synchronous call.
   */
  private tick = (): void => {
    this.timer = null;
    if (this.phase !== "growing") return;
    const bonsai = this.bonsai as Bonsai;
    const stepMs = this.conf.timeStep * 1000;
    const started = Date.now();
    let n = 0;
    for (;;) {
      const r = bonsai.step();
      if (r === STEP_DONE) {
        this.host?.paint();
        this.onTreeGrown();
        return;
      }
      if (r === STEP_VISIBLE) {
        this.due += stepMs;
        if (this.due > Date.now()) break;
      }
      if ((++n & 31) === 0 && Date.now() - started > TICK_BUDGET_MS) break;
    }
    // Non-live mode shows nothing until the whole tree is there.
    if (this.conf.live) this.host?.paint();
    this.timer = setTimeout(this.tick, Math.max(0, this.due - Date.now()));
  };

  private onTreeGrown(): void {
    const conf = this.conf;
    if (conf.load) conf.targetBranchCount = 0;
    if (conf.infinite) {
      // timeout(timeWait * 1000); checkKeyPress()
      this.phase = "waitTree";
      this.timer = setTimeout(this.nextTree, conf.timeWait * 1000);
      return;
    }
    if (conf.printTree) {
      // finish(); printstdscr()
      this.exit(true);
      return;
    }
    // wgetch(treeWin): block until any key.
    this.phase = "waitKey";
  }

  private nextTree = (): void => {
    this.timer = null;
    if (this.phase !== "waitTree") return;
    this.rng.seed(unixTime()); // srand(time(NULL))
    this.startTree();
  };

  /**
   * A key press. During growth `q` quits (any key in screensaver mode);
   * after growth any key quits; between infinite-mode trees `q` quits and
   * any other key ends the wait early. Ctrl-C always quits. A touch counts
   * as `q`, since there is no keyboard to press it on.
   */
  key(key: string, ctrl: boolean): void {
    if (this.phase === "exited" || this.phase === "idle") return;
    if (ctrl && key.toLowerCase() === "c") {
      this.exit(false);
      return;
    }
    const quitKey = this.conf.screensaver || key === "q" || key === "tap";
    switch (this.phase) {
      case "growing":
        if (quitKey) this.exit(false);
        break;
      case "waitKey":
        this.exit(false);
        break;
      case "waitTree":
        if (quitKey) this.exit(false);
        else {
          this.clearTimer();
          this.nextTree();
        }
        break;
    }
  }

  stop(): void {
    if (this.phase === "exited") return;
    this.clearTimer();
    this.phase = "exited";
    this.save();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private save(): void {
    if (this.conf.save && this.bonsai) {
      saveToFile(this.conf.saveFile, this.conf.seed, this.bonsai.counters.branches, this.store);
    }
  }

  /** C `finish()` + `quit()`, printing the tree first when asked. */
  private exit(print: boolean): void {
    if (this.phase === "exited") return;
    this.clearTimer();
    this.phase = "exited";
    this.save();
    let output: TerminalLine[] | undefined;
    if (print && this.screen) {
      const rows = trimBlankRows(this.screen.snapshot());
      if (rows.length) output = [{ kind: "screen", rows }];
    }
    this.host?.exit(output);
  }
}
