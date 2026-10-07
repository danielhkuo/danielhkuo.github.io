// `ls`, as the one on a Mac prints: BSD ls with -F and -G always on, so a
// directory ends in "/" and takes a colour.

import { textWidth } from "./claude/wrap.ts";
import { lookup, strerror, type DirNode, type FsNode, type Path } from "./fs.ts";
import type { TextRun } from "./types";

export interface LsEnv {
  root: DirNode;
  cwd: Path;
  /** The window's width in cells: what the columns are fitted to. */
  cols: number;
  /** Decides whether a date shows its time or its year. */
  now: Date;
}

interface Flags {
  all: boolean;
  long: boolean;
  human: boolean;
  single: boolean;
}

/** Something to list, under the name it is listed by. */
interface Entry {
  label: string;
  node: FsNode;
}

// -G would use ANSI blue, which Terminal's Basic profile makes #492ee1 —
// unreadable on its own dark ground. This is the blue glow sets headings in.
const DIR_FG = 39;

/** BSD ls dates anything within this of now by its time, anything else by its year. */
const SIX_MONTHS_MS = 182 * 86_400_000;

function name(entry: Entry): TextRun {
  return entry.node.kind === "dir" ? { text: `${entry.label}/`, fg: DIR_FG } : { text: entry.label };
}

/** What an APFS volume reports: a directory links to itself, its parent and each entry. */
function links(node: FsNode): number {
  return node.kind === "dir" ? node.children.length + 2 : 1;
}

function size(node: FsNode): number {
  return node.kind === "dir" ? links(node) * 32 : node.size;
}

/** "412B", "1.4K", "142K": a size as -h prints it. */
function human(bytes: number): string {
  let n = bytes;
  let unit = 0;
  while (n >= 1024 && unit < 4) {
    n /= 1024;
    unit++;
  }
  return `${unit > 0 && n < 10 ? n.toFixed(1) : Math.round(n)}${"BKMGT"[unit]}`;
}

/** "Sep  8 12:00", or "Jan 15  2025" once it is six months off. UTC, so the same string everywhere. */
function date(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCDate()).padStart(2)}`;
  if (Math.abs(now.getTime() - d.getTime()) >= SIX_MONTHS_MS) return `${day}  ${d.getUTCFullYear()}`;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${day} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/**
 * Names in columns, as BSD ls sets them: each column runs to the tab stop
 * past the longest name, and the names fill down the first column before
 * starting the next. One per line when two columns would not fit.
 */
function columns(entries: readonly Entry[], cols: number, single: boolean): TextRun[][] {
  const names = entries.map(name);
  if (!names.length) return [];
  const widths = names.map((n) => textWidth(n.text));
  const colWidth = (Math.max(...widths) + 8) & ~7;
  if (single || cols < 2 * colWidth) return names.map((n) => [n]);

  const numRows = Math.ceil(names.length / Math.floor(cols / colWidth));
  const rows: TextRun[][] = [];
  for (let r = 0; r < numRows; r++) {
    const row: TextRun[] = [];
    for (let i = r; i < names.length; i += numRows) {
      row.push(names[i]);
      if (i + numRows < names.length) row.push({ text: " ".repeat(colWidth - widths[i]) });
    }
    rows.push(row);
  }
  return rows;
}

/** `-l`: mode, links, owner, group, size, date, name — the numbers right-aligned down the listing. */
function long(entries: readonly Entry[], flags: Flags, now: Date): TextRun[][] {
  const cells = entries.map((e) => ({
    mode: e.node.kind === "dir" ? "drwxr-xr-x" : "-rw-r--r--",
    links: String(links(e.node)),
    size: flags.human ? human(size(e.node)) : String(size(e.node)),
    date: date(e.node.mtime, now),
    name: name(e),
  }));
  const linksW = Math.max(...cells.map((c) => c.links.length));
  const sizeW = Math.max(...cells.map((c) => c.size.length));
  return cells.map((c) => [
    { text: `${c.mode}  ${c.links.padStart(linksW)} daniel  staff  ${c.size.padStart(sizeW)} ${c.date} ` },
    c.name,
  ]);
}

/** The `total` line: the listing's files in 512-byte blocks, allocated 4K at a time. */
function blocks(entries: readonly Entry[]): number {
  let total = 0;
  for (const { node } of entries) if (node.kind === "file") total += Math.ceil(node.size / 4096) * 8;
  return total;
}

/**
 * Run `ls`. Options: -a (with . and ..), -l (long), -h (sizes in units),
 * -1 (one per line); -A, -F and -G are accepted and change nothing. Operands
 * that are files list first, then each directory — under its name when there
 * was more than one operand.
 */
export function ls(args: readonly string[], env: LsEnv): { rows: TextRun[][]; errors: string[] } {
  const flags: Flags = { all: false, long: false, human: false, single: false };
  let at = 0;
  for (; at < args.length; at++) {
    const arg = args[at];
    if (arg === "--") {
      at++;
      break;
    }
    if (arg === "-" || !arg.startsWith("-")) break;
    for (const ch of arg.slice(1)) {
      if (ch === "a") flags.all = true;
      else if (ch === "l") flags.long = true;
      else if (ch === "h") flags.human = true;
      else if (ch === "1") flags.single = true;
      else if (!"AFG".includes(ch)) {
        return { rows: [], errors: [`ls: illegal option -- ${ch}`, "usage: ls [-1AFGahl] [file ...]"] };
      }
    }
  }
  const operands = at < args.length ? args.slice(at) : ["."];

  const errors: string[] = [];
  const files: Entry[] = [];
  const dirs: { label: string; node: DirNode; path: string[] }[] = [];
  for (const operand of [...operands].sort()) {
    const found = lookup(env.root, env.cwd, operand);
    if ("errno" in found) errors.push(`ls: ${operand}: ${strerror(found.errno)}`);
    else if (found.node.kind === "dir") dirs.push({ label: operand, node: found.node, path: found.path });
    else files.push({ label: operand, node: found.node });
  }

  const format = (entries: readonly Entry[]) =>
    flags.long ? long(entries, flags, env.now) : columns(entries, env.cols, flags.single);

  const rows: TextRun[][] = [];
  if (files.length) rows.push(...format(files));
  for (const d of dirs) {
    const entries: Entry[] = d.node.children.map((node) => ({ label: node.name, node }));
    if (flags.all) {
      const parent = lookup(env.root, d.path, "..");
      entries.unshift({ label: ".", node: d.node }, { label: "..", node: "errno" in parent ? d.node : parent.node });
    }
    if (rows.length) rows.push([]);
    if (operands.length > 1) rows.push([{ text: `${d.label}:` }]);
    if (flags.long) rows.push([{ text: `total ${blocks(entries)}` }]);
    rows.push(...format(entries));
  }
  return { rows, errors };
}
