/**
 * `work` — the pinned repositories as a TUI, the way lazygit or gh-dash would
 * show them: a list pane, a detail pane, a header bar and a keybar. It runs
 * through the same full-screen program path as cbonsai, so it owns the
 * character grid and the ANSI palette until `q`.
 *
 * Under 72 columns the split does not fit, so the panes become two screens —
 * a list that drills down into the detail — and the keybar stops being a
 * legend and becomes the controls, since a phone has no keys to press.
 */
import { DEFAULT_FG, Screen, Win, type CellRun } from "../tty/screen.ts";
import { textWidth, wrapRuns } from "../claude/wrap.ts";
import type { ProgramHost, ScreenProgram, SlimProject } from "../types";

/** Where the program can send the visitor. */
export interface WorkApi {
  openUrl(url: string): void;
}

/** The split layout needs at least this many columns; below it, screens drill down. */
export const NARROW_BELOW = 72;

// ANSI slots (see --ansi-N in globals.css). The names read as the intent.
const BLUE = 4;
const YELLOW = 3;
const GREEN = 2;
const GRAY = 8;
/** Language bars, in the order GitHub lists the languages. What a real TUI has to hand. */
const LANG_SLOTS = [4, 3, 5, 6, 2, 1, 12, 11, 13, 14];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Screen2 = "list" | "detail";

interface Hit {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  act: () => void;
}

const R = (text: string, fg: number = DEFAULT_FG, bold = false, inverse = false): CellRun =>
  inverse ? { text, fg, bold, inverse: true } : { text, fg, bold };

/** "8 Sep 2026". UTC, so the same string everywhere. */
export function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "example.com" for a homepage link. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function createWorkProgram(projects: readonly SlimProject[], api: WorkApi): WorkProgram {
  return new WorkProgram(projects, api);
}

export class WorkProgram implements ScreenProgram {
  readonly captureEscape = true;
  readonly title = "work";

  private readonly all: readonly SlimProject[];
  private readonly api: WorkApi;
  private screen: Screen | null = null;
  private win: Win | null = null;
  private host: ProgramHost | null = null;
  private exited = false;

  private sel = 0;
  private listScroll = 0;
  private view: Screen2 = "list";
  private filterOpen = false;
  private filter = "";
  private hits: Hit[] = [];

  constructor(projects: readonly SlimProject[], api: WorkApi) {
    this.all = projects;
    this.api = api;
  }

  /** Only while the filter prompt is open: that is the one place a phone keyboard is wanted. */
  get textInput(): boolean {
    return this.filterOpen;
  }

  // ---- state for tests ---------------------------------------------------------

  get selected(): SlimProject | null {
    return this.shown()[this.sel] ?? null;
  }

  get screenName(): Screen2 {
    return this.view;
  }

  get filterText(): string {
    return this.filter;
  }

  get isNarrow(): boolean {
    return (this.screen?.cols ?? 80) < NARROW_BELOW;
  }

  // ---- lifecycle -----------------------------------------------------------------

  start(size: { rows: number; cols: number }, host: ProgramHost): Screen {
    this.host = host;
    this.exited = false;
    this.screen = new Screen(size.rows, size.cols);
    this.win = Win.open(this.screen, size.rows, size.cols, 0, 0);
    this.render();
    return this.screen;
  }

  resize(size: { rows: number; cols: number }): Screen {
    this.screen = new Screen(size.rows, size.cols);
    this.win = Win.open(this.screen, size.rows, size.cols, 0, 0);
    // Coming back to a split from the phone layout, the detail is always beside the list.
    if (!this.isNarrow) this.view = "list";
    this.render();
    return this.screen;
  }

  stop(): void {
    this.exited = true;
  }

  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.host?.exit();
  }

  // ---- input ------------------------------------------------------------------------

  key(key: string, ctrl: boolean): boolean | void {
    if (this.exited) return;
    if (ctrl) {
      if (key.toLowerCase() === "c") this.exit();
      return;
    }
    if (this.filterOpen) return this.filterKey(key);

    switch (key) {
      case "Escape":
        if (this.view === "detail") {
          this.view = "list";
          this.render();
          return;
        }
        if (this.filter) {
          this.filter = "";
          this.sel = 0;
          this.render();
          return;
        }
        // Nothing to back out of: let the terminal close on it.
        return false;
      case "q":
        this.exit();
        return;
      case "ArrowUp":
      case "k":
        this.move(-1);
        return;
      case "ArrowDown":
      case "j":
        this.move(1);
        return;
      case "Home":
        this.select(0);
        return;
      case "End":
        this.select(this.shown().length - 1);
        return;
      case "PageUp":
        this.move(-this.listCapacity());
        return;
      case "PageDown":
        this.move(this.listCapacity());
        return;
      case "Enter":
        this.primary();
        return;
      case "o":
        this.homepage();
        return;
      case "/":
        this.filterOpen = true;
        this.view = "list";
        this.render();
        return;
      default:
        return;
    }
  }

  private filterKey(key: string): void {
    switch (key) {
      case "Escape":
        this.filterOpen = false;
        this.filter = "";
        this.sel = 0;
        this.render();
        return;
      case "Enter":
        this.filterOpen = false;
        this.render();
        return;
      case "Backspace":
        this.filter = this.filter.slice(0, -1);
        this.sel = Math.min(this.sel, Math.max(0, this.shown().length - 1));
        this.render();
        return;
      case "ArrowUp":
        this.move(-1);
        return;
      case "ArrowDown":
        this.move(1);
        return;
      default:
        if (key.length === 1) {
          this.filter += key;
          this.sel = 0;
          this.render();
        }
    }
  }

  wheel(rows: number): void {
    if (this.view === "detail") return;
    this.move(rows > 0 ? 1 : -1);
  }

  tap(y: number, x: number): void {
    if (this.exited) return;
    const hit = this.hits.find((h) => y >= h.y0 && y < h.y1 && x >= h.x0 && x < h.x1);
    hit?.act();
  }

  /** Enter: the repository on a split; on a phone, the list drills into the detail first. */
  private primary(): void {
    const p = this.selected;
    if (!p) return;
    if (this.isNarrow && this.view === "list") {
      this.view = "detail";
      this.render();
      return;
    }
    this.api.openUrl(p.url);
  }

  private homepage(): void {
    const p = this.selected;
    if (p?.homepageUrl) this.api.openUrl(p.homepageUrl);
  }

  private move(by: number): void {
    this.select(this.sel + by);
  }

  private select(i: number): void {
    const n = this.shown().length;
    this.sel = n === 0 ? 0 : Math.max(0, Math.min(n - 1, i));
    this.render();
  }

  // ---- data ---------------------------------------------------------------------------

  /** The repos the list shows: all of them, or those matching the filter. */
  private shown(): SlimProject[] {
    const q = this.filter.toLowerCase();
    if (!q) return [...this.all];
    return this.all.filter((p) => p.name.toLowerCase().includes(q));
  }

  private meta(p: SlimProject): string {
    const lang = p.primaryLanguage?.name ?? "no language data";
    return `${lang} · ★ ${p.stargazerCount} · ⑂ ${p.forkCount}`;
  }

  /** List rows the layout has room for. */
  private listCapacity(): number {
    const rows = this.screen?.rows ?? 24;
    return this.isNarrow ? Math.max(1, Math.floor((rows - 2 - 3) / 3)) : Math.max(1, rows - 1 - 2 - 4);
  }

  private keepSelectionVisible(): void {
    const cap = this.listCapacity();
    if (this.sel < this.listScroll) this.listScroll = this.sel;
    else if (this.sel >= this.listScroll + cap) this.listScroll = this.sel - cap + 1;
    this.listScroll = Math.max(0, Math.min(this.listScroll, Math.max(0, this.shown().length - cap)));
  }

  // ---- drawing ----------------------------------------------------------------------------

  private put(y: number, x: number, runs: readonly CellRun[]): void {
    const win = this.win as Win;
    let cx = x;
    for (const r of runs) {
      win.fg = r.fg;
      win.bold = r.bold;
      win.inverse = Boolean(r.inverse);
      win.mvaddstr(y, cx, r.text);
      cx += textWidth(r.text);
    }
    win.fg = DEFAULT_FG;
    win.bold = false;
    win.inverse = false;
  }

  /** A full-width row in one style: the header bar, a selected list row. */
  private fill(y: number, x0: number, x1: number, fg: number, inverse: boolean): void {
    this.put(y, x0, [R(" ".repeat(Math.max(0, x1 - x0)), fg, false, inverse)]);
  }

  /** `left` at the start and `right` against the end of [x0, x1). */
  private bar(y: number, x0: number, x1: number, left: CellRun[], right: CellRun[], fg: number, inverse: boolean): void {
    this.fill(y, x0, x1, fg, inverse);
    this.put(y, x0 + 1, left);
    const w = right.reduce((n, r) => n + textWidth(r.text), 0);
    if (x0 + 1 + left.reduce((n, r) => n + textWidth(r.text), 0) + 2 + w < x1) this.put(y, x1 - 1 - w, right);
  }

  private render(): void {
    const screen = this.screen;
    if (!screen || this.exited) return;
    screen.clear();
    this.hits = [];
    this.keepSelectionVisible();
    if (this.isNarrow) {
      if (this.view === "detail" && this.selected) this.drawNarrowDetail();
      else this.drawNarrowList();
    } else {
      this.drawSplit();
    }
    this.host?.paint();
  }

  // -- split (desktop) --

  private drawSplit(): void {
    const { rows, cols } = this.screen as Screen;
    const listW = Math.min(34, Math.floor(cols * 0.38));
    const list = this.shown();

    this.bar(0, 0, cols, [R("work — pinned repositories", BLUE, true, true)], [R("github.com/danielhkuo", BLUE, true, true)], BLUE, true);

    // List pane.
    this.put(2, 1, [R(`[1] repos ─ ${list.length}`, GRAY)]);
    const cap = this.listCapacity();
    const y0 = 3;
    for (let i = 0; i < cap && this.listScroll + i < list.length; i++) {
      const idx = this.listScroll + i;
      const p = list[idx];
      const y = y0 + i;
      const on = idx === this.sel;
      if (on) this.fill(y, 0, listW, DEFAULT_FG, true);
      const stars = `★${String(p.stargazerCount).padStart(2)}`;
      const nameW = listW - 2 - 1 - stars.length - 2;
      this.put(y, 1, [R(on ? "› " : "  ", DEFAULT_FG, false, on), ...this.nameRuns(p.name, nameW, on)]);
      this.put(y, listW - 1 - stars.length, [R(stars, DEFAULT_FG, false, on)]);
      this.hits.push({ y0: y, y1: y + 1, x0: 0, x1: listW, act: () => this.select(idx) });
    }
    const hintY = y0 + Math.min(cap, list.length) + 1;
    if (hintY < rows - 2) {
      if (this.filterOpen) {
        /* the prompt is on the bottom row */
      } else if (this.filter) {
        this.put(hintY, 1, [R(`${this.all.length - list.length} hidden by filter`, GRAY)]);
      } else {
        this.put(hintY, 1, [R("/ to filter", GRAY)]);
      }
    }

    // Divider.
    for (let y = 1; y < rows - 2; y++) this.put(y, listW, [R("│", GRAY)]);

    // Detail pane.
    const x = listW + 2;
    const w = cols - x - 1;
    this.put(2, x, [R("[2] detail", GRAY)]);
    const p = this.selected;
    if (p) this.drawDetail(p, 3, x, w, rows - 3, false);
    else this.put(4, x, [R("no repo matches", GRAY)]);

    // Keybar, or the filter prompt in its place.
    if (this.filterOpen) {
      this.put(rows - 2, 0, [R("─".repeat(cols), GRAY)]);
      this.drawFilterPrompt(rows - 1, cols);
    } else
      this.drawKeys(rows - 2, rows, cols, [
        ["↑↓", "move", () => this.move(1)],
        ["⏎", "repository", () => this.primary()],
        ["o", "homepage", () => this.homepage()],
        ["/", "filter", () => this.key("/", false)],
        ["q", "quit", () => this.exit()],
      ]);
  }

  // -- narrow (phone) --

  private drawNarrowList(): void {
    const { rows, cols } = this.screen as Screen;
    const list = this.shown();
    const filtering = this.filterOpen || this.filter !== "";
    this.bar(
      0,
      0,
      cols,
      [R(filtering ? `work — ${list.length} of ${this.all.length}` : `work — ${this.all.length} pinned`, BLUE, true, true)],
      [R(filtering ? "filtering" : "github.com/danielhkuo", BLUE, true, true)],
      BLUE,
      true,
    );

    // 52pt rows: name, meta line, a blank — all three tappable.
    const cap = this.listCapacity();
    let y = 2;
    for (let i = 0; i < cap && this.listScroll + i < list.length; i++) {
      const idx = this.listScroll + i;
      const p = list[idx];
      const on = idx === this.sel;
      if (on) {
        this.fill(y, 0, cols, DEFAULT_FG, true);
        this.fill(y + 1, 0, cols, DEFAULT_FG, true);
      }
      this.put(y, 1, [R(on ? "› " : "  ", DEFAULT_FG, on, on), ...this.nameRuns(p.name, cols - 4, on, on)]);
      const dot = p.primaryLanguage ? [R("■ ", on ? DEFAULT_FG : LANG_SLOTS[0], false, on)] : [];
      this.put(y + 1, 3, [...dot, R(this.meta(p).slice(0, cols - 6), DEFAULT_FG, false, on)]);
      const at = idx;
      this.hits.push({
        y0: y,
        y1: y + 3,
        x0: 0,
        x1: cols,
        act: () => {
          if (this.sel === at) this.primary();
          else this.select(at);
        },
      });
      y += 3;
    }
    if (this.filter && y < rows - 3) this.put(y, 1, [R(`${this.all.length - list.length} hidden by filter`, GRAY)]);
    if (!list.length && !this.filter) this.put(2, 1, [R("no pinned repositories", GRAY)]);

    if (this.filterOpen) {
      this.put(rows - 3, 0, [R("─".repeat(cols), GRAY)]);
      this.drawFilterPrompt(rows - 2, cols);
    } else {
      this.drawKeys(rows - 3, rows, cols, [
        ["⏎", "open", () => this.primary()],
        ["o", "site", () => this.homepage()],
        ["/", "filter", () => this.key("/", false)],
        ["q", "quit", () => this.exit()],
      ]);
    }
  }

  private drawNarrowDetail(): void {
    const { rows, cols } = this.screen as Screen;
    const p = this.selected as SlimProject;
    const list = this.shown();
    this.bar(0, 0, cols, [R(`‹ work / ${p.name}`, BLUE, true, true)], [R(`${this.sel + 1}/${list.length}`, BLUE, true, true)], BLUE, true);
    this.hits.push({ y0: 0, y1: 1, x0: 0, x1: cols, act: () => this.key("Escape", false) });
    this.drawDetail(p, 2, 2, cols - 4, rows - 3, true);
    this.drawKeys(rows - 3, rows, cols, [
      ["esc", "back", () => this.key("Escape", false)],
      ["⏎", "repository", () => this.api.openUrl(p.url)],
      ["o", "homepage", () => this.homepage()],
    ]);
  }

  // -- shared pieces --

  /** The repo name, clipped to `w`; while filtering, the match is picked out in yellow. */
  private nameRuns(name: string, w: number, inverse: boolean, bold = false): CellRun[] {
    const text = name.length > w ? name.slice(0, Math.max(0, w - 1)) + "…" : name;
    const q = this.filter.toLowerCase();
    const at = q ? text.toLowerCase().indexOf(q) : -1;
    if (at < 0) return [R(text, DEFAULT_FG, bold, inverse)];
    return [
      R(text.slice(0, at), DEFAULT_FG, bold, inverse),
      // Non-inverse yellow inside an inverse row: the match sits on the page colour.
      R(text.slice(at, at + q.length), YELLOW, true, false),
      R(text.slice(at + q.length), DEFAULT_FG, bold, inverse),
    ];
  }

  /** Name, description, facts and the language mix, from row `y` in a column `w` wide. */
  private drawDetail(p: SlimProject, y: number, x: number, w: number, yMax: number, stacked: boolean): void {
    this.put(y++, x, [R(p.name.slice(0, w), YELLOW, true)]);
    for (const row of wrapRuns([R(p.description || "no description")], w)) {
      if (y >= yMax) return;
      this.put(y++, x, row);
    }
    y++;
    const facts: [string, CellRun][] = [
      ["stars", R(String(p.stargazerCount), GREEN)],
      ["forks", R(String(p.forkCount), GREEN)],
      ["updated", R(longDate(p.updatedAt))],
    ];
    if (p.homepageUrl) facts.push(["homepage", R(hostOf(p.homepageUrl), BLUE)]);
    for (const [k, v] of facts) {
      if (y >= yMax) return;
      this.put(y++, x, [R(k.padEnd(10), GRAY), v]);
    }
    y++;
    if (y >= yMax) return;
    this.put(y++, x, [R("language mix", GRAY)]);
    const langs = p.languages.filter((l) => l.percentage > 0.05);
    if (!langs.length) {
      if (y < yMax) this.put(y, x, [R("none reported", GRAY)]);
      return;
    }
    langs.forEach((l, i) => {
      const slot = LANG_SLOTS[i % LANG_SLOTS.length];
      const pct = `${l.percentage.toFixed(1)}%`;
      if (stacked) {
        // Name and percentage on one row, a full-width bar on the next.
        if (y + 1 >= yMax) return;
        this.put(y, x, [R(l.name.slice(0, w - pct.length - 1))]);
        this.put(y, x + w - pct.length, [R(pct)]);
        this.put(y + 1, x, this.barRuns(l.percentage, w, slot));
        y += 2;
      } else {
        if (y >= yMax) return;
        const labelW = 12;
        const barW = Math.max(6, w - labelW - pct.length - 1);
        this.put(y++, x, [R(l.name.slice(0, labelW - 1).padEnd(labelW)), ...this.barRuns(l.percentage, barW, slot), R(` ${pct}`)]);
      }
    });
  }

  private barRuns(pct: number, width: number, slot: number): CellRun[] {
    const filled = Math.round((pct / 100) * width);
    return [R("█".repeat(filled), slot), R("░".repeat(Math.max(0, width - filled)), GRAY)];
  }

  /** The keybar: on a split it is a legend, on a phone the buttons themselves, laid out evenly. */
  private drawKeys(y: number, yEnd: number, cols: number, keys: [string, string, () => void][]): void {
    this.put(y, 0, [R("─".repeat(cols), GRAY)]);
    const labelY = y + 1;
    if (this.isNarrow) {
      const cellW = Math.floor(cols / keys.length);
      keys.forEach(([k, label, act], i) => {
        const x0 = i * cellW;
        const x1 = i === keys.length - 1 ? cols : x0 + cellW;
        const text = `${k} ${label}`;
        const pad = Math.max(0, Math.floor((x1 - x0 - text.length) / 2));
        this.put(labelY, x0 + pad, [R(k, YELLOW, true), R(` ${label}`)]);
        if (i > 0) this.put(labelY, x0, [R("│", GRAY)]);
        this.hits.push({ y0: y, y1: yEnd, x0, x1, act });
      });
      return;
    }
    let x = 1;
    for (const [k, label, act] of keys) {
      const text = `${k} ${label}`;
      if (x + text.length > cols) break;
      this.put(labelY, x, [R(k, YELLOW, true), R(` ${label}`)]);
      this.hits.push({ y0: labelY, y1: labelY + 1, x0: x, x1: x + text.length, act });
      x += text.length + 3;
    }
  }

  /** `/ exa▮` with `esc cancel` against the right edge. */
  private drawFilterPrompt(y: number, cols: number): void {
    const hint = "esc cancel";
    this.put(y, 1, [R("/ ", YELLOW, true), R(this.filter.slice(-(cols - 6 - hint.length))), R(" ", DEFAULT_FG, false, true)]);
    if (this.filter.length + 6 + hint.length < cols) this.put(y, cols - 1 - hint.length, [R(hint, GRAY)]);
  }
}
