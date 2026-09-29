"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { gridSize, type Cell } from "./grid";
import { rowHtml } from "./screenHtml";
import type { Screen } from "./tty/screen";
import type { ProgramHost, ScreenProgram, TerminalLine } from "./types";

/**
 * The terminal body while a full-screen program runs: a fixed character
 * grid the size of the body, one `<div>` per row. Rows are rebuilt
 * imperatively from the program's screen when it asks for a paint, at most
 * once per animation frame, so React never reconciles the grid. Colours are
 * CSS classes bound to the theme's `--ansi-*` palette, so a theme switch
 * recolours a growing tree without a repaint.
 *
 * The grid follows the body: a ResizeObserver re-measures when the window is
 * dragged or a phone keyboard changes the height, and when the row or column
 * COUNT changes the program gets its SIGWINCH (`resize`) and the row elements
 * are added or dropped to match. Pixel changes that do not cross a cell
 * boundary cost nothing.
 *
 * All of the program's input arrives here: desktop keys, taps, the wheel, and
 * text from on-screen keyboards.
 */

/** Key names that are modifiers on their own, never a key press to a program. */
const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "Symbol",
  "Dead",
  "Unidentified",
]);

export default function ScreenView({
  program,
  onExit,
  onClose,
}: {
  program: ScreenProgram;
  onExit: (output?: TerminalLine[]) => void;
  /** Close the terminal window: what an Escape the program declines does. */
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** One cell's size, measured when the grid is built; taps map through it. */
  const cellRef = useRef<Cell>({ width: 8, height: 17 });
  /** Focuses or blurs the hidden input to match `program.textInput`; set up with the grid. */
  const syncInputRef = useRef<() => void>(() => undefined);
  const exitProgram = useEffectEvent(onExit);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const pre = preRef.current;
    if (!body || !pre) return;

    // Measure one cell as drawn; the grid is however many fit in the body.
    const probe = document.createElement("div");
    probe.className = "term-grid-row";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.textContent = "0000000000";
    pre.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    pre.removeChild(probe);
    const cell: Cell = { width: rect.width / 10 || 8, height: rect.height || 17 };
    cellRef.current = cell;
    const measure = () => gridSize(body, cell);
    let { rows, cols } = measure();

    let raf = 0;
    let exited = false;
    let screen: Screen | null = null;
    const rowEls: HTMLDivElement[] = [];

    // Programs that read text keep a real (invisible) input focused so phones
    // show their keyboard. A program may want that only while a text field is
    // open, so this is re-checked after every paint and on every tap.
    const syncInput = () => {
      const el = inputRef.current;
      if (!el) return;
      if (program.textInput) {
        if (document.activeElement !== el) el.focus({ preventScroll: true });
      } else if (document.activeElement === el) {
        el.blur();
        pre.focus({ preventScroll: true });
      }
    };
    syncInputRef.current = syncInput;

    const flush = () => {
      raf = 0;
      if (!screen || rowEls.length === 0) return;
      for (const y of screen.takeDirty()) rowEls[y].innerHTML = rowHtml(screen.rowRuns(y));
      syncInput();
    };

    const addRow = () => {
      const el = document.createElement("div");
      el.className = "term-grid-row";
      el.style.height = `${cell.height}px`;
      rowEls.push(el);
      pre.appendChild(el);
    };

    // The body changed size. Only a change in the cell COUNT reaches the
    // program; the observer fires for every pixel while dragging, so this is
    // what keeps a resize cheap. Coalesced to a frame like a paint.
    let resizeRaf = 0;
    const onResize = () => {
      resizeRaf = 0;
      if (exited || !screen) return;
      const next = measure();
      if (next.rows === rows && next.cols === cols) return;
      ({ rows, cols } = next);
      if (program.resize) screen = program.resize(next);
      else screen.resize(rows, cols);
      if (exited) return;
      while (rowEls.length > rows) (rowEls.pop() as HTMLDivElement).remove();
      while (rowEls.length < rows) addRow();
      // The new screen is fully dirty, so this repaints every row.
      if (raf !== 0) cancelAnimationFrame(raf);
      flush();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (resizeRaf === 0) resizeRaf = requestAnimationFrame(onResize);
          });

    const host: ProgramHost = {
      paint: () => {
        if (raf === 0 && !exited) raf = requestAnimationFrame(flush);
      },
      exit: (output) => {
        if (exited) return;
        exited = true;
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        exitProgram(output);
      },
    };

    screen = program.start({ rows, cols }, host);
    // A program can finish inside start() (`-p` without `-l`): nothing to show.
    if (exited) return;

    for (let y = 0; y < rows; y++) addRow();
    flush();
    pre.focus({ preventScroll: true });
    observer?.observe(body);

    return () => {
      exited = true;
      observer?.disconnect();
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      program.stop();
      pre.replaceChildren();
    };
  }, [program]);

  // While a program runs, keys go to it, not the page. Capture phase so the
  // launcher's backtick toggle does not fire; Escape and ⌘K are left alone so
  // the terminal can still be closed. A program that captures Escape gets it
  // first, and closes the window only by declining it (returning false) —
  // so the fake claude can interrupt and clear input with it while an Escape
  // on an idle prompt still closes the terminal.
  // Browser shortcuts (⌘R, ⌘W, ⌘C…) pass through; Ctrl-C is the program's
  // interrupt, as in a terminal.
  const closeWindow = useEffectEvent(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !program.captureEscape) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return;
      if (e.metaKey) return;
      // Programs that read text get the usual line-editing control keys;
      // everything else stays with the browser except Ctrl-C.
      const ctrlOk = program.textInput ? "acdeklruw" : "c";
      if (e.ctrlKey && !ctrlOk.includes(e.key.toLowerCase())) return;
      if (e.altKey) return;
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const consumed = program.key(e.key, e.ctrlKey, e.shiftKey);
      if (e.key === "Escape" && consumed === false) closeWindow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [program]);

  // Desktop keys arrive through the window listener above and are cancelled
  // there; on-screen keyboards often report "Unidentified" keys, so their
  // text is taken from the hidden input's beforeinput instead.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (program.textInput) el.focus({ preventScroll: true });
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
    if (program.tap) {
      const rect = e.currentTarget.getBoundingClientRect();
      const { width, height } = cellRef.current;
      program.tap(
        Math.floor((e.clientY - rect.top) / height),
        Math.floor((e.clientX - rect.left) / width),
      );
      // Inside the gesture, so a phone keyboard may open if the tap asked for text.
      syncInputRef.current();
      return;
    }
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
      <input
        ref={inputRef}
        className="term-hidden-input"
        aria-label="program input"
        tabIndex={-1}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={() => undefined}
        value=""
      />
    </div>
  );
}
