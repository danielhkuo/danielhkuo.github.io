"use client";

import { useEffect, useLayoutEffect, useRef, type PointerEvent, type WheelEvent } from "react";
import type { CellRun, Screen } from "./tty/screen";
import { isPlain, rowHtml, runClass, runStyle, trimRuns } from "./screenHtml";
import type { ProgramHost, ScreenProgram, TerminalLine } from "./types";

/**
 * The terminal body while a full-screen program runs: a fixed character
 * grid the size of the body, one `<div>` per row. Rows are rebuilt
 * imperatively from the program's screen when it asks for a paint, at most
 * once per animation frame, so React never reconciles the grid. Colours are
 * CSS classes bound to the theme's `--ansi-*` palette, so a theme switch
 * recolours a growing tree without a repaint.
 */

/** A finished screen in the scrollback (what `-p` prints). */
export function ScreenLine({ rows }: { rows: CellRun[][] }) {
  return (
    <div className="term-block">
      <pre className="term-grid" aria-label="cbonsai tree">
        {rows.map((runs, y) => (
          <div key={y} className="term-grid-row">
            {trimRuns(runs).map((run, i) =>
              isPlain(run) ? (
                run.text
              ) : (
                <span key={i} className={runClass(run)} style={runStyle(run)}>
                  {run.text}
                </span>
              ),
            )}
          </div>
        ))}
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

  const inputRef = useRef<HTMLInputElement>(null);

  // Programs that read text keep a real (invisible) input focused so phones
  // show their keyboard. Desktop keys arrive through the window listener and
  // are cancelled there; on-screen keyboards often report "Unidentified" keys,
  // so their text is taken from beforeinput instead.
  useEffect(() => {
    const el = inputRef.current;
    if (!program.textInput || !el) return;
    el.focus({ preventScroll: true });
    // Native listener: React's onBeforeInput is synthesised from legacy
    // textInput events and misses what on-screen keyboards actually send.
    const onBeforeInput = (ev: InputEvent) => {
      if (ev.inputType === "insertText" && ev.data) {
        for (const ch of ev.data) program.key(ch, false, false);
      } else if (ev.inputType === "insertLineBreak" || ev.inputType === "insertParagraph") {
        program.key("Enter", false, false);
      } else if (ev.inputType === "deleteContentBackward") {
        program.key("Backspace", false, false);
      }
      ev.preventDefault();
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [program]);

  const onPointerDown = (e: PointerEvent<HTMLPreElement>) => {
    if (program.textInput) inputRef.current?.focus({ preventScroll: true });
    else if (e.pointerType === "touch") program.key("tap", false);
  };

  const onWheel = (e: WheelEvent<HTMLPreElement>) => {
    if (!program.wheel) return;
    program.wheel(e.deltaY > 0 ? 3 : -3);
  };

  return (
    <div ref={bodyRef} className="term-body term-screen">
      <pre
        ref={preRef}
        className="term-grid term-grid-live"
        tabIndex={-1}
        role={program.textInput ? "application" : "img"}
        aria-label={program.textInput ? "terminal program" : "cbonsai bonsai tree"}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
      />
      {program.textInput && (
        <input
          ref={inputRef}
          className="term-hidden-input"
          aria-label="program input"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={() => undefined}
          value=""
        />
      )}
    </div>
  );
}
