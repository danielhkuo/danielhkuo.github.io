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
  // On phones, track the visual viewport so the input row stays above the
  // on-screen keyboard instead of being pushed off the bottom of the screen.
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);

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
  // the terminal can still be closed. Browser shortcuts (⌘R, ⌘W, ⌘C…) pass
  // through; Ctrl-C is the program's interrupt, as in a terminal.
  useEffect(() => {
    if (!program) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return;
      if (e.metaKey) return;
      if (e.ctrlKey && e.key.toLowerCase() !== "c") return;
      if (e.altKey) return;
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      program.key(e.key, e.ctrlKey);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [program]);

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

  // ---- mobile: pin height to the visual viewport so the keyboard can't hide input ----
  useEffect(() => {
    if (!open) return;
    const view = window.visualViewport;
    if (!view) return;
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => {
      // Only override the panel geometry while the on-screen keyboard is
      // actually open (visual viewport meaningfully shorter than the layout
      // viewport). Otherwise fall back to CSS (100dvh, top:0) so a stray
      // visualViewport offsetTop can't shift the panel down and clip the input.
      const keyboardOpen = window.innerHeight - view.height > 120;
      if (mq.matches && keyboardOpen) setVv({ h: view.height, top: view.offsetTop });
      else setVv(null);
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
  }, [lines, open, vv]);

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
  const positionStyle: CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : {};
  const viewportStyle = vv
    ? ({ "--term-h": `${vv.h}px`, "--term-top": `${vv.top}px` } as CSSProperties)
    : {};

  return (
    <div
      ref={winRef}
      className={`term-win${pos ? "" : " term-centered"}`}
      role="dialog"
      aria-modal="true"
      aria-label="interactive terminal"
      style={{ ...positionStyle, ...viewportStyle }}
    >
      <div
        className={`term-bar${isDragging ? " dragging" : ""}`}
        onMouseDown={onBarMouseDown}
      >
        <div className="lights" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        {/* Terminal.app's own title format — the leading dash is a login
            shell's argv[0], which is what it actually displays. */}
        <div className="title">daniel_kuo — -zsh</div>
        <div className="hint">
          close
          <span className="kbd" onClick={onClose}>
            esc
          </span>
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
        aria-live="polite"
        onMouseDown={(e) => {
          e.preventDefault();
          focusEnd();
        }}
      >
        {lines.map((l, i) => {
          if (l.kind === "screen") {
            return <ScreenLine key={i} rows={l.rows} />;
          }
          if (l.kind === "cmd") {
            return (
              <div key={i} className="term-line cmd">
                <span className="ps">{l.path} $</span> {l.text}
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
      )}

      {!program && (
      <div className="term-inputrow">
        <span className="ps">{`${promptPath} $`}</span>
        <div className="term-inputwrap">
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            spellCheck={false}
            autoComplete="off"
            aria-label="terminal input"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onMouseDown={(e) => {
              e.preventDefault();
              focusEnd();
            }}
          />
          {completion && (
            <div className="term-ghost" aria-hidden>
              <span className="typed">{input}</span>
              <span>{completion.suffix}</span>
              <span className="tabhint">tab</span>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
