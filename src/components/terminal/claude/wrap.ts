/**
 * Word wrapping for styled text on a character grid, the way Ink lays out a
 * paragraph: break at spaces (dropped at the break), break a word wider than
 * a row mid-word, honour "\n", and indent continuation rows.
 */
import { DEFAULT_FG, type CellRun } from "../tty/screen.ts";
import { wcwidth } from "../tty/wcwidth.ts";

interface Glyph {
  ch: string;
  w: 1 | 2;
  fg: number;
  bold: boolean;
  inverse: boolean;
}

function toRuns(glyphs: Glyph[], pad: number): CellRun[] {
  const runs: CellRun[] = [];
  if (pad > 0) runs.push({ text: " ".repeat(pad), fg: DEFAULT_FG, bold: false });
  for (const g of glyphs) {
    const last = runs[runs.length - 1];
    if (last && last.fg === g.fg && last.bold === g.bold && Boolean(last.inverse) === g.inverse) {
      last.text += g.ch;
    } else {
      runs.push(g.inverse ? { text: g.ch, fg: g.fg, bold: g.bold, inverse: true } : { text: g.ch, fg: g.fg, bold: g.bold });
    }
  }
  return runs;
}

/** Cells a run of text occupies. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += wcwidth(ch.codePointAt(0) ?? 0);
  return w;
}

export function wrapRuns(runs: readonly CellRun[], width: number, indent = 0): CellRun[][] {
  const glyphs: Glyph[] = [];
  for (const r of runs) {
    for (const ch of r.text) {
      glyphs.push({
        ch,
        w: ch === "\n" ? 1 : wcwidth(ch.codePointAt(0) ?? 0),
        fg: r.fg,
        bold: r.bold,
        inverse: Boolean(r.inverse),
      });
    }
  }
  const rows: CellRun[][] = [];
  let line: Glyph[] = [];
  let lineW = 0;
  let first = true;
  const limit = () => Math.max(1, width - (first ? 0 : indent));
  const flush = () => {
    rows.push(toRuns(line, first ? 0 : indent));
    line = [];
    lineW = 0;
    first = false;
  };

  let i = 0;
  while (i < glyphs.length) {
    const g = glyphs[i];
    if (g.ch === "\n") {
      flush();
      i++;
      continue;
    }
    if (g.ch === " ") {
      if (lineW + 1 > limit()) flush();
      else {
        line.push(g);
        lineW++;
      }
      i++;
      continue;
    }
    let j = i;
    let wordW = 0;
    while (j < glyphs.length && glyphs[j].ch !== " " && glyphs[j].ch !== "\n") wordW += glyphs[j++].w;
    if (lineW + wordW <= limit()) {
      for (; i < j; i++) line.push(glyphs[i]);
      lineW += wordW;
      continue;
    }
    if (lineW > 0) {
      while (line.length && line[line.length - 1].ch === " ") line.pop();
      flush();
      continue;
    }
    // A single word wider than the row: hard-break it.
    while (i < j) {
      const g2 = glyphs[i];
      if (lineW + g2.w > limit()) flush();
      line.push(g2);
      lineW += g2.w;
      i++;
    }
  }
  if (line.length || rows.length === 0) flush();
  return rows;
}
