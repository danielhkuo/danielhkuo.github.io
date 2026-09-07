"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent } from "react";
import { xtermToCss } from "./cbonsai/colors";
import { DEFAULT_FG, type CellRun, type Screen } from "./cbonsai/screen";
import type { ProgramHost, ScreenProgram, TerminalLine } from "./types";

/**
 * The terminal body while a full-screen program runs: a fixed character
 * grid the size of the body, one `<div>` per row. Rows are rebuilt
 * imperatively from the program's screen when it asks for a paint, at most
 * once per animation frame, so React never reconciles the grid. Colours are
 * CSS classes bound to the theme's `--ansi-*` palette, so a theme switch
 * recolours a growing tree without a repaint.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isPlainBlank(run: CellRun): boolean {
  return run.fg === DEFAULT_FG && !run.bold && /^ *$/.test(run.text);
}

function runClass(run: CellRun): string {
  const parts: string[] = [];
  if (run.bold) parts.push("tb");
  if (run.fg >= 0 && run.fg < 16) parts.push(`tf${run.fg}`);
  return parts.join(" ");
}

function runStyle(run: CellRun): CSSProperties | undefined {
  return run.fg >= 16 ? { color: xtermToCss(run.fg) } : undefined;
}

/** One row as HTML, trailing blank runs dropped. */
export function rowHtml(runs: CellRun[]): string {
  let end = runs.length;
  while (end > 0 && isPlainBlank(runs[end - 1])) end--;
  let html = "";
  for (let i = 0; i < end; i++) {
    const run = runs[i];
    const text = escapeHtml(run.text);
    if (run.fg === DEFAULT_FG && !run.bold) {
      html += text;
      continue;
    }
    const cls = runClass(run);
    const style = run.fg >= 16 ? ` style="color:${xtermToCss(run.fg)}"` : "";
    html += `<span class="${cls}"${style}>${text}</span>`;
  }
  return html;
}

/** A finished screen in the scrollback (what `-p` prints). */
export function ScreenLine({ rows }: { rows: CellRun[][] }) {
  return (
    <div className="term-block">
      <pre className="term-grid" aria-label="cbonsai tree">
        {rows.map((runs, y) => {
          let end = runs.length;
          while (end > 0 && isPlainBlank(runs[end - 1])) end--;
          return (
            <div key={y} className="term-grid-row">
              {runs.slice(0, end).map((run, i) =>
                run.fg === DEFAULT_FG && !run.bold ? (
                  run.text
                ) : (
                  <span key={i} className={runClass(run)} style={runStyle(run)}>
                    {run.text}
                  </span>
                ),
              )}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export default function ScreenView({
  program,
  onExit,
}: {
  program: ScreenProgram;
  onExit: (output?: TerminalLine[]) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const onExitRef = useRef(onExit);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const pre = preRef.current;
    if (!body || !pre) return;

    // Measure one cell and the body's content box; the grid is fixed from here on.
    const probe = document.createElement("div");
    probe.className = "term-grid-row";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.textContent = "0000000000";
    pre.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    pre.removeChild(probe);
    const cellW = rect.width / 10 || 8;
    const lineH = rect.height || 17;
    const cs = getComputedStyle(body);
    const innerW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const innerH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cols = Math.max(1, Math.floor(innerW / cellW));
    const rows = Math.max(1, Math.floor(innerH / lineH));

    let raf = 0;
    let exited = false;
    let screen: Screen | null = null;
    const rowEls: HTMLDivElement[] = [];

    const flush = () => {
      raf = 0;
      if (!screen || rowEls.length === 0) return;
      for (const y of screen.takeDirty()) rowEls[y].innerHTML = rowHtml(screen.rowRuns(y));
    };

    const host: ProgramHost = {
      paint: () => {
        if (raf === 0 && !exited) raf = requestAnimationFrame(flush);
      },
      exit: (output) => {
        if (exited) return;
        exited = true;
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        onExitRef.current(output);
      },
    };

    screen = program.start({ rows, cols }, host);
    // A program can finish inside start() (`-p` without `-l`): nothing to show.
    if (exited) return;

    for (let y = 0; y < rows; y++) {
      const el = document.createElement("div");
      el.className = "term-grid-row";
      el.style.height = `${lineH}px`;
      rowEls.push(el);
      pre.appendChild(el);
    }
    flush();
    pre.focus({ preventScroll: true });

    return () => {
      exited = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      program.stop();
      pre.replaceChildren();
    };
  }, [program]);

  const onPointerDown = (e: PointerEvent<HTMLPreElement>) => {
    if (e.pointerType === "touch") program.key("tap", false);
  };

  return (
    <div ref={bodyRef} className="term-body term-screen">
      <pre
        ref={preRef}
        className="term-grid term-grid-live"
        tabIndex={-1}
        role="img"
        aria-label="cbonsai bonsai tree"
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
