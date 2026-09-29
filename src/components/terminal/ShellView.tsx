"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { isPlain, runClass, runStyle, trimRuns } from "./screenHtml";
import { promptFor } from "./shell";
import type { CellRun } from "./tty/screen";
import type { TerminalLine } from "./types";
import type { Shell } from "./useShell";

/**
 * The terminal body at the shell prompt: the scrollback, then the prompt line
 * directly under it — a real shell's input line is just the next row of the
 * buffer. It stays scrolled to the bottom, and a click anywhere in it focuses
 * the prompt, as it does in a Terminal window.
 */
export default function ShellView({ shell }: { shell: Shell }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the drawn block cursor sits (the native caret is hidden), counted
  // back from the end of the line — where the caret stays while typing.
  const [caretFromEnd, setCaretFromEnd] = useState(0);
  const caret = Math.max(0, shell.input.length - caretFromEnd);

  // The prompt takes focus whenever it appears: the terminal opening, or a
  // program handing the body back.
  useEffect(() => focusAtEnd(inputRef.current), []);

  // Keep the bottom row in view, as Terminal does: new output grows the log,
  // and a phone keyboard or a resize changes the body.
  useEffect(() => {
    const body = bodyRef.current;
    const log = logRef.current;
    if (!body || !log) return;
    const observer = new ResizeObserver(() => {
      body.scrollTop = body.scrollHeight;
    });
    observer.observe(body);
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  const syncCaret = (e: SyntheticEvent<HTMLInputElement>) => {
    const { selectionStart, value } = e.currentTarget;
    setCaretFromEnd(value.length - (selectionStart ?? value.length));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const { selectionStart, value } = e.currentTarget;
    if (shell.key(e.key, selectionStart === value.length)) e.preventDefault();
  };

  return (
    // role=presentation: click-to-focus is a pointer convenience. The prompt
    // is the control, and it already has focus.
    <div
      ref={bodyRef}
      className="term-body"
      role="presentation"
      onMouseDown={(e) => {
        e.preventDefault();
        focusAtEnd(inputRef.current);
      }}
    >
      <div ref={logRef} className="term-log" aria-live="polite">
        {shell.entries.map(({ id, line }) => (
          <LogLine key={id} line={line} />
        ))}
      </div>
      <div className="term-inputrow">
        <span className="term-ps">{promptFor(shell.cwd)}</span>
        <div className="term-inputwrap">
          <input
            ref={inputRef}
            className="term-input"
            value={shell.input}
            spellCheck={false}
            autoComplete="off"
            aria-label="terminal input"
            onChange={(e) => {
              shell.setInput(e.target.value);
              syncCaret(e);
            }}
            onSelect={syncCaret}
            // History recall and completion replace the value, which moves
            // the caret without a select event.
            onKeyUp={syncCaret}
            onKeyDown={onKeyDown}
          />
          <InputGhost input={shell.input} caret={caret} suggestion={shell.suggestion} />
        </div>
      </div>
    </div>
  );
}

/** Focus the prompt with the caret at the end of the line. */
function focusAtEnd(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** One scrollback line. */
function LogLine({ line }: { line: TerminalLine }) {
  switch (line.kind) {
    case "screen":
      return <ScreenLine rows={line.rows} />;
    case "cmd":
      return (
        <div className="term-line cmd">
          <span className="term-ps">{promptFor(line.path)}</span>
          {line.text}
        </div>
      );
    case "rows":
      return (
        <div className="term-block">
          {line.title && <div className="term-cols-title">{line.title}</div>}
          <div className="term-cols">
            {line.rows.map((r, j) => (
              <Fragment key={j}>
                <div className="k">{r.k}</div>
                <div className="v">{renderRich(r.v)}</div>
              </Fragment>
            ))}
          </div>
        </div>
      );
    default:
      return <div className={`term-line ${line.kind}`}>{renderRich(line.text)}</div>;
  }
}

/** A finished screen in the scrollback (what `cbonsai -p` prints). */
function ScreenLine({ rows }: { rows: CellRun[][] }) {
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

/**
 * Drawn over the input: the block cursor on the character at `caret`, and the
 * suggestion after the text. Typed characters are transparent here — the
 * input itself shows them.
 */
function InputGhost({ input, caret, suggestion }: { input: string; caret: number; suggestion: string }) {
  // The suggestion only shows while the caret is at the end of the line.
  const suggest = caret === input.length ? suggestion : "";
  return (
    <div className="term-ghost" aria-hidden>
      <span className="typed">{input.slice(0, caret)}</span>
      {/* At the end of the line the cursor sits on the suggestion's first
          character, as zsh-autosuggestions draws it. */}
      <span className="term-cursor">{input[caret] ?? (suggest[0] || " ")}</span>
      <span className="typed">{input.slice(caret + 1)}</span>
      {suggest && (
        <>
          <span>{suggest.slice(1)}</span>
          <span className="tabhint">tab</span>
        </>
      )}
    </div>
  );
}

/**
 * Terminal text with its `backtick` spans highlighted. Plain segments are
 * bare strings, which need no key. The segments of an immutable string never
 * reorder, so the index is a stable key for the spans. React Doctor can't
 * tell, so its index-key rule is suppressed here.
 */
function renderRich(text: string) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      // react-doctor-disable-next-line react-doctor/no-array-index-as-key
      <span key={i} className="term-accent">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
