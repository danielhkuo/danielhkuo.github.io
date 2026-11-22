"use client";

// The live terminal inside the title's window. One shell for the life of the page: the window is hidden while the
// visitor flies, not unmounted, so the scrollback is still there when they come back.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { gridSize, type Cell } from "../terminal/grid";
import ScreenView from "../terminal/ScreenView";
import { PromptRow, ShellLog } from "../terminal/ShellView";
import type { TerminalApi } from "../terminal/types";
import { useShell } from "../terminal/useShell";
import { promptKey } from "./titleKeys";

/**
 * The window body's width in cells of the shell's monospace font, which the prompt's row carries.
 * `--term-cell` here is `1ch`, which getComputedStyle leaves as specified, so the cell is measured.
 * The count is the body's content box, the same one useTermWindow reports for the pop-up.
 */
function useBodyCols(inputRef: RefObject<HTMLInputElement | null>): number {
  const [cols, setCols] = useState(80);
  useEffect(() => {
    const body = inputRef.current?.closest(".nf-body");
    if (!(body instanceof HTMLElement)) return;
    let alive = true;
    const measure = () => {
      // While a full-screen program has the window there is no prompt row: the count stays.
      const row = inputRef.current?.closest(".term-inputrow");
      if (!alive || !(row instanceof HTMLElement)) return;
      const next = gridSize(body, cellOf(row)).cols;
      setCols((c) => (c === next ? c : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [inputRef]);
  return cols;
}

/** One cell of `el`'s font, in CSS pixels. The probe is not in the window, so it cannot resize it. */
function cellOf(el: HTMLElement): Cell {
  const cs = getComputedStyle(el);
  const probe = document.createElement("span");
  probe.textContent = "0000000000";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.font = cs.font;
  probe.style.letterSpacing = cs.letterSpacing;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  return {
    width: rect.width / 10 || 8,
    height: rect.height || parseFloat(cs.lineHeight) || 17,
  };
}

export default function TitleTerminal({
  api,
  onEnterWorld,
  focusRequest,
  insert,
  onBare,
}: {
  api: TerminalApi;
  /** ⏎ on an empty line. `slow` is Shift, as Enter world takes it. */
  onEnterWorld: (slow: boolean) => void;
  /** Each change focuses the prompt, caret at the end, after `insert` is typed. */
  focusRequest: number;
  /** Characters to type at the caret when `focusRequest` changes. "" focuses and types nothing. */
  insert: string;
  /** The window's static rows go: after `clear`, and while a full-screen program runs. */
  onBare: (bare: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cols = useBodyCols(inputRef);
  // After `clear` the window's static rows stay gone; a full-screen program hides them only while it runs.
  const cleared = useRef(false);
  const shell = useShell(api, () => inputRef.current?.blur(), cols, {
    greet: false,
    onClear: () => {
      cleared.current = true;
      onBare(true);
    },
    onProgram: (running) => onBare(running || cleared.current),
  });

  // The latest insert, read when the counter changes. A later render's insert belongs to a later request.
  const insertRef = useRef(insert);
  const shellRef = useRef(shell);
  useLayoutEffect(() => {
    insertRef.current = insert;
    shellRef.current = shell;
  });

  const seen = useRef(0);
  const pending = useRef<{ n: number; line: string } | null>(null);
  useLayoutEffect(() => {
    if (focusRequest === 0 || seen.current === focusRequest) return;
    seen.current = focusRequest;
    const sh = shellRef.current;
    const el = inputRef.current;
    const current = sh.input;
    const editing = el !== null && document.activeElement === el;
    const at = editing ? (el.selectionStart ?? current.length) : current.length;
    const end = editing ? (el.selectionEnd ?? current.length) : current.length;
    const next = current.slice(0, at) + insertRef.current + current.slice(end);
    pending.current = { n: focusRequest, line: next };
    if (next !== current) sh.setInput(next);
  }, [focusRequest]);

  useLayoutEffect(() => {
    const want = pending.current;
    if (!want || want.n !== focusRequest || shell.input !== want.line) return;
    pending.current = null;
    const node = inputRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const len = node.value.length;
    node.setSelectionRange(len, len);
    // The prompt is the last row. Keep it in the window, which scrolls within itself.
    const body = node.closest(".nf-body");
    if (body instanceof HTMLElement) body.scrollTop = body.scrollHeight;
  }, [focusRequest, shell.input]);

  if (shell.program) {
    return (
      <ScreenView
        program={shell.program}
        onExit={shell.endProgram}
        onClose={() => {
          // Esc the program declines ends it. The scrollback stays; the prompt comes back, unfocused.
          shell.endProgram();
          inputRef.current?.blur();
        }}
      />
    );
  }

  return (
    <>
      <ShellLog shell={shell} />
      <PromptRow
        shell={shell}
        inputRef={inputRef}
        onKeyDown={(e) => {
          const action = promptKey(e.currentTarget.value, e.key);
          if (action === "enter") {
            e.preventDefault();
            onEnterWorld(e.shiftKey);
            return true;
          }
          if (action === "clear") {
            e.preventDefault();
            shell.setInput("");
            return true;
          }
          // Tab completes when there is a suggestion. Otherwise it leaves the prompt, so the ways in stay reachable.
          if (e.key === "Tab" && (e.shiftKey || !shell.suggestion)) return true;
          return false;
        }}
      />
    </>
  );
}
