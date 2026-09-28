"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { buildCommands, welcomeLines } from "./commands";
import ScreenView, { ScreenLine } from "./ScreenView";
import { tokenize } from "./shell";
import { Lights, ProxyIcon } from "./WindowChrome";
import type { CommandContext, ScreenProgram, TerminalApi, TerminalLine } from "./types";

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

// Terminal.app's Basic grid (see globals.css): a 7pt × 14pt cell, 10pt side and
// 8.5pt top/bottom insets — what the title's cols×rows is computed from.
const CELL_W = 7;
const LINE_H = 14;
const INSET_X = 20;
const INSET_Y = 17;

/** zsh's `%n@%m %1~ %# `: the cwd's last component, `~` at home. */
function prompt(path: string) {
  const dir = path.replace(/\/$/, "").split("/").pop() || "~";
  return `daniel@portfolio ${dir} % `;
}

/** Render text with `backtick` spans highlighted as accents. */
function renderRich(text: string) {
  const parts = text.split("`");
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="term-accent">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default function Terminal({
  open,
  onClose,
  api,
}: {
  open: boolean;
  onClose: () => void;
  api: TerminalApi;
}) {
  const [lines, setLines] = useState<TerminalLine[]>(() => welcomeLines());
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [navPath, setNavPath] = useState<string[]>([]);
  // A full-screen program (cbonsai) that has taken over the body, if any.
  const [program, setProgram] = useState<ScreenProgram | null>(null);
  // Caret index in the input, for the drawn block cursor.
  const [caret, setCaret] = useState(0);
  // The title's cols×rows, from the window's live size.
  const [dims, setDims] = useState({ cols: 80, rows: 24 });
  const [zoomed, setZoomed] = useState(false);
  // macOS greys an inactive window; the nearest a page gets is its own
  // browser window losing focus.
  const [inactive, setInactive] = useState(false);

  const dragOffset = useRef({ active: false, dx: 0, dy: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);

  // Rebuild the registry when the cwd changes (cheap; `cd` is rare) so command
  // closures always read the current path without touching a ref during render.
  const commands = useMemo(
    () => buildCommands(api, () => navPath, setNavPath),
    [api, navPath, setNavPath],
  );
  const commandNames = useMemo(
    () => Object.keys(commands).filter((n) => !commands[n].hidden),
    [commands],
  );

  const pushLine = useCallback(
    (line: TerminalLine) => setLines((ls) => [...ls, line]),
    [],
  );

  const makeCtx = useCallback(
    (): CommandContext => ({
      out: (t) => pushLine({ kind: "out", text: t }),
      ok: (t) => pushLine({ kind: "ok", text: t }),
      err: (t) => pushLine({ kind: "err", text: t }),
      rows: (rows, title) => pushLine({ kind: "rows", rows: [...rows], title }),
      clear: () => setLines([]),
      close: () => window.setTimeout(onClose, 120),
      program: (p) => setProgram(p),
    }),
    [pushLine, onClose],
  );

  // The program ended: restore the scrollback and append whatever it printed.
  // (Stable across renders under the React Compiler; ScreenView reads it
  // through a ref anyway.)
  const onProgramExit = (output?: TerminalLine[]) => {
    setProgram(null);
    if (output && output.length) setLines((ls) => [...ls, ...output]);
  };

  // While a program runs, keys go to it, not the page. Capture phase so the
  // launcher's backtick toggle does not fire; Escape and ⌘K are left alone so
  // the terminal can still be closed. A program that captures Escape gets it
  // first, and closes the window only by declining it (returning false) —
  // so the fake claude can interrupt and clear input with it while an Escape
  // on an idle prompt still closes the terminal, as the title bar promises.
  // Browser shortcuts (⌘R, ⌘W, ⌘C…) pass through; Ctrl-C is the program's
  // interrupt, as in a terminal.
  useEffect(() => {
    if (!program) return;
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
      if (e.key === "Escape" && consumed === false) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [program, onClose]);

  // ---- drag (desktop) ----
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragOffset.current.active) return;
      setPos({
        x: Math.max(0, e.clientX - dragOffset.current.dx),
        y: Math.max(0, e.clientY - dragOffset.current.dy),
      });
    };
    const onUp = () => {
      if (!dragOffset.current.active) return;
      dragOffset.current.active = false;
      setIsDragging(false);
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onBarMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Seed position from the current rect the first time, so dragging continues
    // smoothly from wherever the centered window sits (no window read at render).
    const rect = winRef.current?.getBoundingClientRect();
    const startX = pos ? pos.x : (rect?.left ?? 20);
    const startY = pos ? pos.y : (rect?.top ?? 20);
    if (!pos) setPos({ x: startX, y: startY });
    dragOffset.current = {
      active: true,
      dx: e.clientX - startX,
      dy: e.clientY - startY,
    };
    setIsDragging(true);
    document.body.style.userSelect = "none";
  };

  // ---- mobile: follow the visual viewport ----
  // iOS Safari does not shrink the layout viewport for the on-screen keyboard
  // (it ignores `interactive-widget`); it shrinks the VISUAL viewport and lets
  // the user pan it across the layout viewport, so anything position:fixed
  // slides under the keyboard and out the top. Two things keep that from
  // showing: the window itself covers the whole layout viewport (CSS, so a
  // pan only ever reveals more window), and the frame inside it — title bar,
  // body, input row — is placed at the visual viewport's offset and height.
  // The geometry is written straight to the element from the viewport's own
  // events, not through React state: that saves the render round trip, so
  // the frame is where the viewport is on the same frame it moved.
  useEffect(() => {
    if (!open) return;
    const view = window.visualViewport;
    const win = winRef.current;
    if (!view || !win) return;
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => {
      if (mq.matches) {
        win.style.setProperty("--term-top", `${Math.max(0, view.offsetTop)}px`);
        win.style.setProperty("--term-h", `${view.height}px`);
        // The keyboard covers the home indicator, so the input row can drop
        // its safe-area padding and sit right on the keyboard.
        const keyboardOpen = window.innerHeight - view.height > 120;
        if (keyboardOpen) win.dataset.keyboard = "";
        else delete win.dataset.keyboard;
      } else {
        win.style.removeProperty("--term-top");
        win.style.removeProperty("--term-h");
        delete win.dataset.keyboard;
      }
      // The body just changed height: keep the latest output against the input row.
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    };
    update();
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update);
    mq.addEventListener("change", update);
    return () => {
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update);
      mq.removeEventListener("change", update);
    };
  }, [open]);

  // cols×rows for the title, the way Terminal reports its size.
  useEffect(() => {
    if (!open) return;
    const win = winRef.current;
    if (!win) return;
    const ro = new ResizeObserver(() => {
      const bar = win.querySelector<HTMLElement>(".term-bar")?.offsetHeight ?? 32;
      const frame = win.querySelector<HTMLElement>(".term-frame");
      const h = frame && frame.offsetHeight ? frame.offsetHeight : win.clientHeight;
      const cols = Math.max(1, Math.floor((win.clientWidth - INSET_X) / CELL_W));
      const rows = Math.max(1, Math.floor((h - bar - INSET_Y) / LINE_H));
      setDims((d) => (d.cols === cols && d.rows === rows ? d : { cols, rows }));
    });
    ro.observe(win);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    const sync = () => setInactive(!document.hasFocus());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);

  // close when clicking anywhere outside the window (but not on the buttons that
  // open it, so a click on a trigger doesn't close-then-reopen). Attached only
  // while open; the opening click has already finished before this runs.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (winRef.current?.contains(target)) return;
      if (target.closest("[data-terminal-trigger]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  // focus the input whenever the terminal opens or a program hands it back
  useEffect(() => {
    if (open && !program) inputRef.current?.focus();
  }, [open, program]);

  // keep the latest output in view
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, open]);

  // ---- autocomplete ----
  const completion = useMemo(() => {
    const lead = input.replace(/^\s+/, "");
    if (!lead) return null;
    const trailingSpace = /\s$/.test(input);
    const tokens = lead.split(/\s+/);
    if (tokens.length === 1 && !trailingSpace) {
      const tok = tokens[0].toLowerCase();
      const match = commandNames.find((c) => c.startsWith(tok) && c !== tok);
      if (match) return { full: match, suffix: match.slice(tok.length), isCmd: true };
      return null;
    }
    const cmd = commands[tokens[0].toLowerCase()];
    if (!cmd || !cmd.args) return null;
    const opts = typeof cmd.args === "function" ? cmd.args() : cmd.args;
    const argTok = trailingSpace ? "" : (tokens[1] ?? "");
    const match = opts.find(
      (o) =>
        o.toLowerCase().startsWith(argTok.toLowerCase()) &&
        o.toLowerCase() !== argTok.toLowerCase(),
    );
    if (match)
      return {
        full: `${tokens[0]} ${match}`,
        suffix: match.slice(argTok.length),
        isCmd: false,
      };
    return null;
  }, [input, commands, commandNames]);

  const acceptCompletion = () => {
    if (!completion) return;
    let next = completion.full;
    const cmd = commands[next.split(/\s+/)[0]];
    if (completion.isCmd && cmd && cmd.args) next += " ";
    setInput(next);
  };

  const submit = () => {
    const raw = input.trim();
    const pathStr = navPath.length ? `~/${navPath.join("/")}` : "~/";
    setLines((ls) => [...ls, { kind: "cmd", text: input, path: pathStr }]);
    if (raw) {
      setHistory((h) => [...h, raw]);
      setHistIdx(-1);
      const tokens = tokenize(raw);
      const name = (tokens[0] ?? "").toLowerCase();
      const cmd = commands[name];
      const ctx = makeCtx();
      if (cmd) {
        try {
          cmd.run(tokens.slice(1), ctx);
        } catch (e) {
          ctx.err(`error: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        ctx.err(`command not found: ${name} — type \`help\``);
      }
    }
    setInput("");
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    if (e.key === "ArrowRight") {
      const el = e.currentTarget;
      if (completion && el.selectionStart === input.length) {
        e.preventDefault();
        acceptCompletion();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === -1) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(-1);
        setInput("");
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  };

  const focusEnd = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      /* some input types disallow selection range; ignore */
    }
  };

  if (!open) return null;

  const promptPath = navPath.length ? `~/${navPath.join("/")}` : "~/";
  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? input.length);
  const cursorAt = Math.min(caret, input.length);
  const suggest = completion && cursorAt === input.length ? completion : null;
  const positionStyle: CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : {};

  return (
    <div
      ref={winRef}
      className={`term-win${pos || zoomed ? "" : " term-centered"}${zoomed ? " term-zoomed" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="interactive terminal"
      data-inactive={inactive ? "" : undefined}
      style={positionStyle}
    >
      {/* On desktop the frame is display:contents — the window IS the frame.
          On phones it is the part of the window inside the visual viewport. */}
      <div className="term-frame">
      <div
        className={`term-bar${isDragging ? " dragging" : ""}`}
        onMouseDown={zoomed ? undefined : onBarMouseDown}
        onDoubleClick={() => setZoomed((z) => !z)}
      >
        <Lights onClose={onClose} onMinimize={onClose} onZoom={() => setZoomed((z) => !z)} />
        <ProxyIcon />
        {/* Terminal.app's title: cwd — process — size. The leading dash is a
            login shell's argv[0]; a running program puts its own name there. */}
        <div className="title">
          daniel — {program?.title ?? "-zsh"} — {dims.cols}×{dims.rows}
        </div>
        <button
          className="term-close"
          aria-label="close terminal"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {program ? (
        <ScreenView program={program} onExit={onProgramExit} />
      ) : (
      <div
        className="term-body"
        ref={bodyRef}
        onMouseDown={(e) => {
          e.preventDefault();
          focusEnd();
        }}
      >
        <div className="term-log" aria-live="polite">
        {lines.map((l, i) => {
          if (l.kind === "screen") {
            return <ScreenLine key={i} rows={l.rows} />;
          }
          if (l.kind === "cmd") {
            return (
              <div key={i} className="term-line cmd">
                <span className="term-ps">{prompt(l.path)}</span>{l.text}
              </div>
            );
          }
          if (l.kind === "rows") {
            return (
              <div key={i} className="term-block">
                {l.title && <div className="term-cols-title">{l.title}</div>}
                <div className="term-cols">
                  {l.rows.map((r, j) => (
                    <Fragment key={j}>
                      <div className="k">{r.k}</div>
                      <div className="v">{renderRich(r.v)}</div>
                    </Fragment>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className={`term-line ${l.kind}`}>
              {renderRich(l.text)}
            </div>
          );
        })}
        </div>
        <div className="term-inputrow">
          <span className="term-ps">{prompt(promptPath)}</span>
          <div className="term-inputwrap">
            <input
              ref={inputRef}
              className="term-input"
              value={input}
              spellCheck={false}
              autoComplete="off"
              aria-label="terminal input"
              onChange={(e) => {
                setInput(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={syncCaret}
              onKeyUp={syncCaret}
              onKeyDown={onKeyDown}
              onMouseDown={(e) => {
                e.preventDefault();
                focusEnd();
              }}
            />
            <div className="term-ghost" aria-hidden>
              <span className="typed">{input.slice(0, cursorAt)}</span>
              {/* At the end of the line the cursor sits on the suggestion's
                  first character, as zsh-autosuggestions draws it. */}
              <span className="term-cursor">
                {input[cursorAt] ?? (suggest ? suggest.suffix[0] : " ")}
              </span>
              <span className="typed">{input.slice(cursorAt + 1)}</span>
              {suggest && (
                <>
                  <span>{suggest.suffix.slice(1)}</span>
                  <span className="tabhint">tab</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}
