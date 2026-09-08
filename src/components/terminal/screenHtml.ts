// Turning a screen row into markup: shared by the live grid (which sets
// innerHTML imperatively) and the static scrollback rendering (React).
// Colours 0–15 become `tfN` classes bound to the theme's --ansi-N palette;
// 16–255 are inline xterm cube/grey values.

import type { CSSProperties } from "react";
import { xtermToCss } from "./tty/colors";
import { DEFAULT_FG, type CellRun } from "./tty/screen";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isPlainBlank(run: CellRun): boolean {
  return run.fg === DEFAULT_FG && !run.bold && /^ *$/.test(run.text);
}

export function isPlain(run: CellRun): boolean {
  return run.fg === DEFAULT_FG && !run.bold && !run.inverse;
}

export function runClass(run: CellRun): string {
  const parts: string[] = [];
  if (run.bold) parts.push("tb");
  if (run.inverse) parts.push("ti");
  if (run.fg >= 0 && run.fg < 16) parts.push(`tf${run.fg}`);
  return parts.join(" ");
}

/** Inline colour for 16–255. Inverse runs set `--c` only, so the `.ti` rule can paint it as the background. */
export function runStyle(run: CellRun): CSSProperties | undefined {
  if (run.fg < 16) return undefined;
  const c = xtermToCss(run.fg);
  return run.inverse ? ({ "--c": c } as CSSProperties) : { color: c };
}

function runStyleAttr(run: CellRun): string {
  if (run.fg < 16) return "";
  const c = xtermToCss(run.fg);
  return run.inverse ? ` style="--c:${c}"` : ` style="color:${c}"`;
}

/** Runs without the trailing blank ones. */
export function trimRuns(runs: CellRun[]): CellRun[] {
  let end = runs.length;
  while (end > 0 && isPlainBlank(runs[end - 1])) end--;
  return end === runs.length ? runs : runs.slice(0, end);
}

/** One row as HTML with escaped text, trailing blank runs dropped. */
export function rowHtml(runs: CellRun[]): string {
  let html = "";
  for (const run of trimRuns(runs)) {
    const text = escapeHtml(run.text);
    if (isPlain(run)) {
      html += text;
      continue;
    }
    html += `<span class="${runClass(run)}"${runStyleAttr(run)}>${text}</span>`;
  }
  return html;
}
