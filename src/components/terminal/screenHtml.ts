// Turning a screen row into markup: shared by the live grid (which sets
// innerHTML imperatively) and the static scrollback rendering (React).
// Colours 0–15 become `tfN` classes bound to the theme's --ansi-N palette;
// 16–255 are inline xterm cube/grey values.

import type { CSSProperties } from "react";
import { xtermToCss } from "./cbonsai/colors";
import { DEFAULT_FG, type CellRun } from "./cbonsai/screen";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isPlainBlank(run: CellRun): boolean {
  return run.fg === DEFAULT_FG && !run.bold && /^ *$/.test(run.text);
}

export function isPlain(run: CellRun): boolean {
  return run.fg === DEFAULT_FG && !run.bold;
}

export function runClass(run: CellRun): string {
  const parts: string[] = [];
  if (run.bold) parts.push("tb");
  if (run.fg >= 0 && run.fg < 16) parts.push(`tf${run.fg}`);
  return parts.join(" ");
}

export function runStyle(run: CellRun): CSSProperties | undefined {
  return run.fg >= 16 ? { color: xtermToCss(run.fg) } : undefined;
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
    const style = run.fg >= 16 ? ` style="color:${xtermToCss(run.fg)}"` : "";
    html += `<span class="${runClass(run)}"${style}>${text}</span>`;
  }
  return html;
}
