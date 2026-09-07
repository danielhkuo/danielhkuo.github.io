/**
 * A character-cell screen and ncurses-style windows onto it.
 *
 * `Screen` is the terminal: a fixed rows×cols grid of glyphs with a colour
 * index and a bold flag, plus per-row dirty tracking so a renderer repaints
 * only what changed. `Win` is a window in the ncurses sense — an origin, a
 * size, a cursor and current attributes — whose writes land on the screen.
 * Windows may extend past the screen; the overhang is simply clipped, which
 * is what ncurses does on refresh.
 */
import { wcwidth } from "./wcwidth.ts";

/** Colour index meaning "the terminal's default foreground". */
export const DEFAULT_FG = -1;

/** A stretch of cells sharing one colour and weight. */
export interface CellRun {
  text: string;
  fg: number;
  bold: boolean;
}

/** One cell as `printstdscr` would emit it: glyph, colour, bold. */
export type PrintedCell = readonly [ch: string, fg: number, bold: boolean];

/** Compact row form used by the golden fixtures: text plus attribute runs. */
export interface PackedRow {
  t: string;
  a: [len: number, fg: number, bold: boolean][];
}

interface Rect {
  y0: number;
  x0: number;
  y1: number;
  x1: number;
}

export class Screen {
  readonly rows: number;
  readonly cols: number;
  /** Glyph per cell. "" marks the right half of a wide glyph. */
  readonly chars: string[];
  readonly fg: Int16Array;
  readonly bold: Uint8Array;
  private readonly dirty: Uint8Array;
  private dirtyCount = 0;
  /** Cells only `top` windows may write — the message panels sit above the tree panel. */
  private masks: Rect[] = [];

  constructor(rows: number, cols: number) {
    this.rows = Math.max(1, rows | 0);
    this.cols = Math.max(1, cols | 0);
    const n = this.rows * this.cols;
    this.chars = new Array<string>(n).fill(" ");
    this.fg = new Int16Array(n).fill(DEFAULT_FG);
    this.bold = new Uint8Array(n);
    this.dirty = new Uint8Array(this.rows).fill(1);
    this.dirtyCount = this.rows;
  }

  /** Blank every cell, drop the mask and mark everything dirty. */
  clear(): void {
    this.chars.fill(" ");
    this.fg.fill(DEFAULT_FG);
    this.bold.fill(0);
    this.dirty.fill(1);
    this.dirtyCount = this.rows;
    this.masks = [];
  }

  /** Reserve a rectangle for `top` writes only. */
  addMask(y0: number, x0: number, h: number, w: number): void {
    this.masks.push({ y0, x0, y1: y0 + h, x1: x0 + w });
  }

  private masked(y: number, x: number): boolean {
    for (const m of this.masks) {
      if (y >= m.y0 && y < m.y1 && x >= m.x0 && x < m.x1) return true;
    }
    return false;
  }

  private touch(y: number): void {
    if (this.dirty[y] === 0) {
      this.dirty[y] = 1;
      this.dirtyCount++;
    }
  }

  private blank(idx: number): void {
    this.chars[idx] = " ";
    this.fg[idx] = DEFAULT_FG;
    this.bold[idx] = 0;
  }

  /**
   * Write one glyph of `width` cells at (y, x). Out-of-range cells are
   * dropped; a glyph landing on half of a wide glyph blanks the other half.
   */
  put(y: number, x: number, ch: string, width: 1 | 2, fg: number, bold: boolean, top: boolean): void {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    if (!top && this.masked(y, x)) return;
    const row = y * this.cols;
    const idx = row + x;
    const chars = this.chars;
    // Overwriting the tail of a wide glyph: blank its head.
    if (chars[idx] === "" && x > 0) this.blank(idx - 1);
    // Overwriting the head of a wide glyph: blank its tail.
    if (x + 1 < this.cols && chars[idx + 1] === "") this.blank(idx + 1);
    chars[idx] = ch;
    this.fg[idx] = fg;
    this.bold[idx] = bold ? 1 : 0;
    if (width === 2 && x + 1 < this.cols && (top || !this.masked(y, x + 1))) {
      const tail = idx + 1;
      if (x + 2 < this.cols && chars[tail + 1] === "") this.blank(tail + 1);
      chars[tail] = "";
      this.fg[tail] = fg;
      this.bold[tail] = bold ? 1 : 0;
    }
    this.touch(y);
  }

  get hasDirty(): boolean {
    return this.dirtyCount > 0;
  }

  /** Indices of rows changed since the last call, clearing the flags. */
  takeDirty(): number[] {
    const out: number[] = [];
    if (this.dirtyCount === 0) return out;
    for (let y = 0; y < this.rows; y++) {
      if (this.dirty[y]) {
        out.push(y);
        this.dirty[y] = 0;
      }
    }
    this.dirtyCount = 0;
    return out;
  }

  cell(y: number, x: number): { ch: string; fg: number; bold: boolean } {
    const idx = y * this.cols + x;
    return { ch: this.chars[idx], fg: this.fg[idx], bold: this.bold[idx] === 1 };
  }

  /** Row `y` as runs of equal attributes, wide tails folded into their head. */
  rowRuns(y: number): CellRun[] {
    const runs: CellRun[] = [];
    const row = y * this.cols;
    let text = "";
    let fg = 0;
    let bold = false;
    let open = false;
    for (let x = 0; x < this.cols; x++) {
      const idx = row + x;
      const ch = this.chars[idx];
      if (ch === "") continue;
      const cfg = this.fg[idx];
      const cbold = this.bold[idx] === 1;
      if (open && cfg === fg && cbold === bold) {
        text += ch;
        continue;
      }
      if (open) runs.push({ text, fg, bold });
      text = ch;
      fg = cfg;
      bold = cbold;
      open = true;
    }
    if (open) runs.push({ text, fg, bold });
    return runs;
  }

  /** Every row as runs. */
  snapshot(): CellRun[][] {
    const out: CellRun[][] = [];
    for (let y = 0; y < this.rows; y++) out.push(this.rowRuns(y));
    return out;
  }

  /** Row `y` cell by cell as cbonsai's `printstdscr` walks it (wide tails skipped). */
  printedRow(y: number): PrintedCell[] {
    const out: PrintedCell[] = [];
    const row = y * this.cols;
    for (let x = 0; x < this.cols; x++) {
      const idx = row + x;
      const ch = this.chars[idx];
      if (ch === "") continue;
      out.push([ch, this.fg[idx], this.bold[idx] === 1]);
    }
    return out;
  }
}

/**
 * Pack printed cells for a fixture: text plus attribute runs. Spaces carry no
 * visible colour, so they are normalised to the default attributes; trailing
 * spaces are dropped.
 */
export function packRow(cells: readonly PrintedCell[]): PackedRow {
  let end = cells.length;
  while (end > 0 && cells[end - 1][0] === " ") end--;
  let t = "";
  const a: PackedRow["a"] = [];
  for (let i = 0; i < end; i++) {
    const [ch, rawFg, rawBold] = cells[i];
    const fg = ch === " " ? DEFAULT_FG : rawFg;
    const bold = ch === " " ? false : rawBold;
    t += ch;
    const last = a[a.length - 1];
    if (last && last[1] === fg && last[2] === bold) last[0]++;
    else a.push([1, fg, bold]);
  }
  return { t, a };
}

/**
 * An ncurses window: a rectangle on the screen with a cursor and current
 * attributes. Writes advance the cursor and wrap at the window's right edge;
 * at the bottom-right corner the character is placed and further output is
 * refused, as `waddch` does when scrolling is off.
 */
export class Win {
  cy = 0;
  cx = 0;
  fg: number = DEFAULT_FG;
  bold = false;

  private readonly screen: Screen;
  readonly y0: number;
  readonly x0: number;
  readonly height: number;
  readonly width: number;
  readonly top: boolean;

  private constructor(screen: Screen, y0: number, x0: number, height: number, width: number, top: boolean) {
    this.screen = screen;
    this.y0 = y0;
    this.x0 = x0;
    this.height = height;
    this.width = width;
    this.top = top;
  }

  /**
   * `newwin`: null when the origin or size is negative; a zero size means
   * "to the edge of the screen", as in ncurses.
   */
  static open(screen: Screen, h: number, w: number, y: number, x: number, top = false): Win | null {
    if (y < 0 || x < 0 || h < 0 || w < 0) return null;
    return new Win(screen, y, x, h === 0 ? screen.rows - y : h, w === 0 ? screen.cols - x : w, top);
  }

  /**
   * Put this window on the panel stack above everything drawn so far: its
   * cells (blank, as a new window's are) cover the screen beneath, and later
   * writes from windows below cannot show through.
   */
  raise(): void {
    this.screen.addMask(this.y0, this.x0, this.height, this.width);
    const fg = this.fg;
    const bold = this.bold;
    this.fg = DEFAULT_FG;
    this.bold = false;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) this.cell(y, x, " ", 1);
    }
    this.fg = fg;
    this.bold = bold;
  }

  get maxy(): number {
    return this.height - 1;
  }

  get maxx(): number {
    return this.width - 1;
  }

  /** `wattron(COLOR_PAIR)`: the colour is replaced, bold is kept. */
  color(fg: number): void {
    this.fg = fg;
  }

  /** `wmove`: fails outside the window. */
  move(y: number, x: number): boolean {
    if (y < 0 || x < 0 || y > this.maxy || x > this.maxx) return false;
    this.cy = y;
    this.cx = x;
    return true;
  }

  private cell(y: number, x: number, ch: string, width: 1 | 2): void {
    this.screen.put(this.y0 + y, this.x0 + x, ch, width, this.fg, this.bold, this.top);
  }

  /** `waddch` for one code point. Returns false once output is refused. */
  addch(ch: string): boolean {
    if (this.cy > this.maxy || this.cx > this.maxx) return false;
    if (ch === "\n") {
      this.clrtoeol();
      if (++this.cy > this.maxy) {
        this.cy = this.maxy;
        return false;
      }
      this.cx = 0;
      return true;
    }
    const width = wcwidth(ch.codePointAt(0) ?? 0);
    if (width === 2 && this.cx + 2 > this.width) {
      // A wide glyph that does not fit pads the line and wraps.
      while (this.cx <= this.maxx) this.cell(this.cy, this.cx++, " ", 1);
      if (++this.cy > this.maxy) {
        this.cy = this.maxy;
        this.cx = this.maxx;
        return false;
      }
      this.cx = 0;
    }
    this.cell(this.cy, this.cx, ch, width);
    this.cx += width;
    if (this.cx > this.maxx) {
      if (++this.cy > this.maxy) {
        this.cy = this.maxy;
        this.cx = this.maxx;
        return false;
      }
      this.cx = 0;
    }
    return true;
  }

  /** `waddstr`: stops at the first refused character. */
  addstr(s: string): boolean {
    for (const ch of s) {
      if (!this.addch(ch)) return false;
    }
    return true;
  }

  /** `mvwaddstr`: nothing is written if the move fails. */
  mvaddstr(y: number, x: number, s: string): boolean {
    if (!this.move(y, x)) return false;
    return this.addstr(s);
  }

  /** `wclrtoeol`. */
  clrtoeol(): void {
    for (let x = this.cx; x <= this.maxx; x++) this.cell(this.cy, x, " ", 1);
  }

  /** `wborder(ls, rs, ts, bs, tl, tr, bl, br)`. */
  border(ls: string, rs: string, ts: string, bs: string, tl: string, tr: string, bl: string, br: string): void {
    const my = this.maxy;
    const mx = this.maxx;
    for (let x = 1; x < mx; x++) {
      this.cell(0, x, ts, 1);
      this.cell(my, x, bs, 1);
    }
    for (let y = 1; y < my; y++) {
      this.cell(y, 0, ls, 1);
      this.cell(y, mx, rs, 1);
    }
    this.cell(0, 0, tl, 1);
    this.cell(0, mx, tr, 1);
    this.cell(my, 0, bl, 1);
    this.cell(my, mx, br, 1);
  }
}
