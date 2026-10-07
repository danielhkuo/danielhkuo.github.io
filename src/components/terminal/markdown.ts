// Markdown for the terminal, laid out the way glow lays it out: a two-cell
// margin, a bar for the title, bullets, code on its own ground, underlined
// links, wrapped at 80 columns. It reads the subset this site's own files are
// written in — headings, paragraphs, flat bullet lists, **strong**, `code`
// and [links](url) — not markdown at large.

import { textWidth } from "./claude/wrap.ts";
import type { TextRun } from "./types";

const MARGIN = 2;
const MAX_WIDTH = 80;

type Style = Omit<TextRun, "text">;

// glamour's dark style, as xterm-256 indices. Its title bar (228 on 63) and
// code ground (203 on 236) fall just short of 4.5:1 on the terminal's
// #1e1e1e, so each ground is one step darker. glow prints a link's target
// after its label; here the label is the hyperlink, so it takes the underline.
const H1: Style = { fg: 228, bg: 62, bold: true };
const HEADING: Style = { fg: 39, bold: true };
const CODE: Style = { fg: 203, bg: 235 };
const LINK: Style = { fg: 35, bold: true, underline: true };

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  // The paragraph or list that the next plain line would continue.
  let open: Block | null = null;
  for (const raw of source.split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) {
      open = null;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      open = null;
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (open?.kind !== "list") {
        open = { kind: "list", items: [] };
        blocks.push(open);
      }
      open.items.push(item[1]);
      continue;
    }
    if (open?.kind === "list") open.items[open.items.length - 1] += ` ${line}`;
    else if (open?.kind === "para") open.text += ` ${line}`;
    else {
      open = { kind: "para", text: line };
      blocks.push(open);
    }
  }
  return blocks;
}

/** A run and whether it is `solid`: text a row may not break inside. */
interface Piece {
  run: TextRun;
  solid: boolean;
}

/** A target safe to hand the browser: a web address or a mailbox, never a script. */
export function isWebLink(target: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(target);
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** A line of text as styled pieces, its `code`, **strong** and [links](url) taken out of `base`. */
function inline(source: string, base: Style = {}): Piece[] {
  const pieces: Piece[] = [];
  const plain = (text: string) => {
    if (text) pieces.push({ run: { ...base, text }, solid: false });
  };
  let at = 0;
  for (const m of source.matchAll(INLINE)) {
    plain(source.slice(at, m.index));
    if (m[1] !== undefined) pieces.push({ run: { ...CODE, text: ` ${m[1]} ` }, solid: true });
    else if (m[2] !== undefined) pieces.push({ run: { ...base, bold: true, text: m[2] }, solid: false });
    else if (isWebLink(m[4])) pieces.push({ run: { ...base, ...LINK, text: m[3], href: m[4] }, solid: false });
    else plain(m[3]);
    at = m.index + m[0].length;
  }
  plain(source.slice(at));
  return pieces;
}

interface Glyph {
  ch: string;
  w: number;
  from: TextRun;
  /** A space a row may break at, and drop. */
  gap: boolean;
}

/** One row's glyphs as runs: neighbours cut from the same run are one run again. */
function toRuns(line: readonly Glyph[]): TextRun[] {
  const runs: TextRun[] = [];
  let from: TextRun | null = null;
  for (const g of line) {
    if (g.from === from) runs[runs.length - 1].text += g.ch;
    else runs.push({ ...g.from, text: g.ch });
    from = g.from;
  }
  return runs;
}

/**
 * Word-wrap to `width` cells: rows break at spaces outside solid pieces, the
 * space going with the break, and a word wider than a row breaks where the
 * row ends.
 */
function wrap(pieces: readonly Piece[], width: number): TextRun[][] {
  const glyphs: Glyph[] = [];
  for (const { run, solid } of pieces) {
    for (const ch of run.text) glyphs.push({ ch, w: textWidth(ch), from: run, gap: ch === " " && !solid });
  }

  const rows: TextRun[][] = [];
  let line: Glyph[] = [];
  let used = 0;
  const flush = () => {
    rows.push(toRuns(line));
    line = [];
    used = 0;
  };

  let i = 0;
  while (i < glyphs.length) {
    const g = glyphs[i];
    if (g.gap) {
      if (used + 1 > width) flush();
      else {
        line.push(g);
        used += 1;
      }
      i++;
      continue;
    }
    let end = i;
    let wordW = 0;
    while (end < glyphs.length && !glyphs[end].gap) wordW += glyphs[end++].w;
    if (used + wordW <= width) {
      for (; i < end; i++) line.push(glyphs[i]);
      used += wordW;
      continue;
    }
    if (used > 0) {
      while (line.length && line[line.length - 1].gap) line.pop();
      flush();
      continue;
    }
    for (; i < end; i++) {
      if (used > 0 && used + glyphs[i].w > width) flush();
      line.push(glyphs[i]);
      used += glyphs[i].w;
    }
  }
  if (line.length) flush();
  return rows;
}

/** Render markdown to rows of styled text for a window `width` cells wide. */
export function renderMarkdown(source: string, width: number): TextRun[][] {
  const inner = Math.max(1, Math.min(width, MAX_WIDTH) - 2 * MARGIN);
  const margin = " ".repeat(MARGIN);
  const rows: TextRun[][] = [];
  const put = (prefix: string, block: TextRun[][]) => {
    for (const row of block) rows.push([{ text: prefix }, ...row]);
  };

  for (const block of parse(source)) {
    rows.push([]);
    if (block.kind === "list") {
      for (const item of block.items) {
        const [first, ...rest] = wrap(inline(item), Math.max(1, inner - 2));
        put(`${margin}• `, [first]);
        put(`${margin}  `, rest);
      }
    } else if (block.kind === "para") {
      put(margin, wrap(inline(block.text), inner));
    } else if (block.level === 1) {
      put(margin, wrap([{ run: { ...H1, text: ` ${block.text} ` }, solid: false }], inner));
    } else {
      put(margin, wrap(inline(`${"#".repeat(block.level)} ${block.text}`, HEADING), inner));
    }
  }
  if (rows.length) rows.push([]);
  return rows;
}
