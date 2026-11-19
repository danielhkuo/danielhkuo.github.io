"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import ScreenView from "@/components/terminal/ScreenView";
import type { Suggestion } from "@/components/terminal/shell";
import type { ScreenProgram, SiteInfo, SlimProject, TerminalApi } from "@/components/terminal/types";
import { useShell, type LogEntry, type ShellOptions } from "@/components/terminal/useShell";
import { getTheme, setTheme } from "@/lib/theme";
import type { Live } from "./Doc";
import { Line, Prompt } from "./Lines";
import { revealBy, visibleArea } from "./reveal";
import { FEATURED, summarize } from "./transcript";

const OPTIONS: ShellOptions = { rich: true, greet: false, featured: FEATURED };

/** Air kept between what is revealed and the edge of the view, in CSS pixels. */
const GAP = 8;

/**
 * How much shorter than the layout viewport the visual viewport must be for
 * a keyboard to be up. The layout viewport's height (the root's clientHeight)
 * held at 699 through every state measured; the visual viewport read 699 or
 * 739 without the keyboard and 389 with it.
 */
const KEYBOARD = 120;

/**
 * How much of the layout viewport an on-screen keyboard is covering, in CSS
 * pixels: 0 when there is none. A page zoomed in by a pinch also has a short
 * visual viewport, so its height is taken at the page's own scale first.
 */
function keyboardCover(viewport: VisualViewport | null): number {
  if (!viewport) return 0;
  const hidden = document.documentElement.clientHeight - viewport.height * viewport.scale;
  return hidden > KEYBOARD ? hidden : 0;
}

/**
 * Run `then` once the visible area is the one it will be read in.
 *
 * When a button takes a tap while a phone's keyboard is up, Safari drops the
 * prompt's focus and closes the keyboard, and the visible area grows once
 * the keyboard has gone. Scrolling to new output before that puts it where
 * the small area was, 310 px too low. So in that one case this waits for the
 * visual viewport to grow, or 800 ms. Anywhere else it runs at once. Returns
 * a function that calls the wait off.
 */
function whenSettled(prompt: HTMLElement | null, then: () => void): () => void {
  const viewport = window.visualViewport;
  const keyboardUp = () => keyboardCover(viewport) > 0;
  if (!viewport || document.activeElement === prompt || !keyboardUp()) {
    then();
    return () => undefined;
  }
  let timer = 0;
  const stop = () => {
    viewport.removeEventListener("resize", grown);
    window.clearTimeout(timer);
  };
  const finish = () => {
    stop();
    then();
  };
  const grown = () => {
    if (!keyboardUp()) finish();
  };
  viewport.addEventListener("resize", grown);
  timer = window.setTimeout(finish, 800);
  return stop;
}

/**
 * Whether client rects are measured from the visual viewport, as iOS WebKit
 * does (reveal.ts). The property is one only iOS WebKit has, in every browser
 * on an iPhone or iPad.
 */
function rectsFromVisualViewport(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("-webkit-touch-callout", "none");
}

/** `exit`, and the red light: the window closes onto the title menu. */
function leave() {
  window.location.assign("/");
}

function ignore() {}

type Hands = "keys" | "mouse" | "finger";

/**
 * What the visitor last used. Focus follows it: keys and a mouse get the
 * prompt, so typing can carry on; a finger does not, because focusing the
 * prompt opens a phone's keyboard, and that is the visitor's to ask for. It
 * starts as a finger, the one that focus can hurt.
 */
function useHands(): RefObject<Hands> {
  const hands = useRef<Hands>("finger");
  useEffect(() => {
    // A touch also sends mouse events after it, so a mouse press that
    // follows a touch at once is still the finger.
    let touched = -Infinity;
    const keys = () => {
      hands.current = "keys";
    };
    const touch = () => {
      touched = performance.now();
      hands.current = "finger";
    };
    const pointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") touch();
      else if (performance.now() - touched > 1000) hands.current = "mouse";
    };
    window.addEventListener("keydown", keys, true);
    window.addEventListener("touchstart", touch, { capture: true, passive: true });
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("touchstart", touch, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  return hands;
}

/** Whether the element in `ref` is on screen. `holder` is whatever decides which element that is. */
function useOnScreen(ref: RefObject<Element | null>, holder: unknown): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, holder]);
  return onScreen;
}

/**
 * How many characters fit across the session, for the commands that lay
 * their output out in columns (`ls`). Measured from the type as set.
 */
function useCols(ref: RefObject<HTMLElement | null>): number {
  const [cols, setCols] = useState(80);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(20);
    // Out of the flow and at the top of the page: left where it falls, after
    // the prompt, its line of height would be the last thing in the document.
    probe.style.cssText = "position:absolute;top:0;left:0;height:0;overflow:hidden;visibility:hidden;white-space:pre";
    root.appendChild(probe);
    const measure = () => {
      const cell = probe.getBoundingClientRect().width / 20;
      if (cell > 0) setCols(Math.max(20, Math.floor(root.clientWidth / cell)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, [ref]);
  return cols;
}

/** How the session asks for a scroll. */
interface Reveal {
  /** Bring the prompt itself into view: nothing was printed, but the prompt is wanted. */
  prompt(): void;
  /** Say how the command about to run was given: entered at the prompt, or pressed as a button. */
  by(entered: boolean): void;
}

/**
 * Scrolling to what the terminal prints, so that it can be read: the one
 * script on the path between a command and its output. Instant, as a
 * terminal prints.
 *
 * The geometry is the visual viewport's height and client rects. With an
 * iPhone's keyboard up, `innerHeight`, `scrollIntoView` and the viewport's
 * own position are all wrong or late (reveal.ts).
 *
 * `root` is the session, `end` the last thing in the document (the composer,
 * or the program running in its place) and `input` the prompt's field.
 */
function useReveal(
  {
    root,
    end,
    input,
  }: {
    root: RefObject<HTMLElement | null>;
    end: RefObject<HTMLElement | null>;
    input: RefObject<HTMLInputElement | null>;
  },
  { ran, entries, program }: { ran: boolean; entries: readonly LogEntry[]; program: ScreenProgram | null },
): Reveal {
  /** Bumped to ask for a scroll when nothing printed. */
  const [nudge, setNudge] = useState(0);
  /** Whether the next scroll starts from the prompt, not from the last command's echo. */
  const fromPrompt = useRef(false);
  /** Whether the last command was entered at the prompt: its reader is typing. */
  const typed = useRef(false);

  const reveal = useEffectEvent(() => {
    const last = end.current;
    if (!last) return;
    const echoes = root.current?.querySelectorAll<HTMLElement>(".mt-log > .mt-cmd");
    const from = !fromPrompt.current && echoes?.length ? echoes[echoes.length - 1] : last;
    fromPrompt.current = false;
    const view = visibleArea(window.visualViewport, window.innerHeight, rectsFromVisualViewport());
    // The title bar sticks to the top of the layout viewport and covers what is under it.
    const bar = document.querySelector(".mt-bar")?.getBoundingClientRect();
    if (bar && bar.bottom > view.top) view.top = Math.min(bar.bottom, view.bottom);
    // Someone typing keeps the prompt in view; someone who pressed a button is
    // reading. A program's pane is kept whole, whatever is above it.
    const keepEnd = typed.current || last.classList.contains("mt-screen");
    const by = revealBy(
      from.getBoundingClientRect().top - GAP,
      last.getBoundingClientRect().bottom + GAP,
      view,
      keepEnd,
    );
    if (Math.abs(by) >= 1) window.scrollBy({ top: by, left: 0, behavior: "instant" });
  });

  // After a command, and when a program takes the prompt's place or gives it
  // back. Not on the first render: the page opens at its top.
  useLayoutEffect(() => {
    if (ran || nudge > 0) return whenSettled(input.current, reveal);
  }, [ran, entries, program, nudge, input]);

  // A full-screen program is as tall as the visible area on a phone, so it
  // follows the keyboard. Only its height is sized this way, never where it
  // is: a late reading leaves it briefly too tall, and it cannot float.
  //
  // A program reads its text through a hidden field (ScreenView), and Safari
  // does not scroll to that field when the keyboard opens: the visible area
  // stays at the top of the layout viewport, with the lower half of the pane
  // under the keyboard. A script can only scroll the layout viewport, which
  // is already at the end of the page. So while the keyboard is up the page
  // ends that much lower (--mt-keyboard), and the pane is scrolled up clear.
  // The field itself is kept at the top of the pane (minimal.css), in view
  // throughout, so that Safari has no reason to pan to it at the first key.
  //
  // The pane is kept whole on screen as it settles: when the keyboard comes
  // or goes, and once more shortly after it opens. `reveal` moves nothing
  // once the pane is in place.
  useEffect(() => {
    const view = window.visualViewport;
    const pane = end.current;
    if (!program || !pane) return;
    const fit = () => {
      if (view) {
        const cover = keyboardCover(view);
        pane.style.setProperty("--mt-vvh", `${view.height}px`);
        pane.style.setProperty("--mt-keyboard", cover ? `${Math.round(cover) + 16}px` : "0px");
      }
      reveal();
    };
    fit();
    const observer = new ResizeObserver(() => reveal());
    observer.observe(pane);
    view?.addEventListener("resize", fit);
    const frame = requestAnimationFrame(() => reveal());
    const late = window.setTimeout(() => reveal(), 400);
    return () => {
      observer.disconnect();
      view?.removeEventListener("resize", fit);
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
    };
  }, [program, end]);

  return {
    prompt: () => {
      fromPrompt.current = true;
      setNudge((n) => n + 1);
    },
    by: (entered) => {
      typed.current = entered;
    },
  };
}

/**
 * The live end of the minimal version: what the visitor's own commands have
 * printed, then the row of commands, then the prompt. The page above it is
 * static HTML; this is the only part that needs JavaScript.
 *
 * The layout is what keeps it steady on a phone (the research doc has the
 * measurements). The document itself scrolls, and the prompt is the last
 * thing in it, so when the keyboard opens Safari scrolls the page and rests
 * the prompt on the bottom of the visible area by itself. Nothing here is
 * fixed or sticky at the bottom while the prompt has focus, and no script
 * positions anything. The one script in the path is `useReveal`, which
 * scrolls to new output.
 */
export default function Session({ projects, site }: { projects: SlimProject[]; site: SiteInfo }) {
  const rootRef = useRef<HTMLElement>(null);
  /** The composer, or the program running in its place: the last thing in the document. */
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const api = useMemo<TerminalApi>(
    () => ({
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => projects,
      getTheme,
      setTheme,
      close: leave,
      site,
    }),
    [projects, site],
  );
  const cols = useCols(rootRef);
  const shell = useShell(api, leave, cols, OPTIONS);
  const { program } = shell;

  /** The last line run, for when its own echo is gone (`clear`). */
  const [last, setLast] = useState<string | null>(null);
  const reveal = useReveal(
    { root: rootRef, end: endRef, input: inputRef },
    { ran: last !== null, entries: shell.entries, program },
  );
  /** The jump button is for when the prompt is off screen. */
  const atPrompt = useOnScreen(endRef, program);
  const hands = useHands();

  /** Give the prompt the keys of whoever has some. */
  const focusPrompt = () => {
    if (hands.current !== "finger") inputRef.current?.focus({ preventScroll: true });
  };

  const toPrompt = () => {
    reveal.prompt();
    focusPrompt();
  };

  // A program that ends hands the keys back to the prompt, as a terminal does.
  const hadProgram = useRef(false);
  useEffect(() => {
    if (hadProgram.current && !program && hands.current !== "finger") {
      inputRef.current?.focus({ preventScroll: true });
    }
    hadProgram.current = !!program;
  }, [program, hands]);

  const onKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toPrompt();
      return;
    }
    // Escape leaves a program that has no use for it.
    if (e.key === "Escape" && program && !program.captureEscape) shell.endProgram();
  });
  useEffect(() => {
    const handle = (e: globalThis.KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  /** Run a line: `entered` at the prompt, or pressed as a button. */
  const run = (line: string, entered = false) => {
    reveal.by(entered);
    setLast(line);
    shell.run(line);
    // A mouse press on a button leaves the keys with the prompt. Someone who
    // pressed it with the keyboard stays on the button; a finger gets no focus.
    if (!entered && hands.current === "mouse") focusPrompt();
  };

  /** Put a line on the prompt for its next word. */
  const fill = (line: string) => {
    shell.setInput(line);
    // With nothing to offer for the next word it has to be typed, so even a
    // finger gets the prompt, and its keyboard.
    if (shell.suggestFor(line).length === 0) inputRef.current?.focus({ preventScroll: true });
    else focusPrompt();
    reveal.prompt();
  };

  /** A button in the output was pressed: a command that needs a file goes on the prompt; anything else runs. */
  const press = (line: string) => {
    const word = line.trim();
    const lone = /\s/.test(word) ? undefined : shell.suggestFor(word).find((s) => s.label === word.toLowerCase());
    if (lone && !lone.run) fill(lone.line);
    else run(word);
  };
  const live: Live = { names: shell.names, press };

  /**
   * A press on a program that reads text asks for the keyboard. The program
   * keeps a hidden field focused for it (ScreenView), but a field focused by
   * script has no keyboard on a phone, and focusing it again may change
   * nothing. Letting go of the field and taking it back, inside the press,
   * is a focus the visitor made, and Safari opens the keyboard for those.
   */
  const summonKeyboard = (e: MouseEvent<HTMLElement>) => {
    if (!program?.textInput || (e.target as Element).closest("button")) return;
    const field = e.currentTarget.querySelector<HTMLInputElement>(".term-hidden-input");
    if (!field) return;
    if (document.activeElement === field) field.blur();
    field.focus({ preventScroll: true });
  };

  const output = shell.entries;
  let echo = -1;
  for (let i = output.length - 1; i >= 0 && echo < 0; i--) if (output[i].line.kind === "cmd") echo = i;
  const echoed = echo >= 0 ? output[echo].line : null;
  /** The command that started the running program, for its pane's title. */
  const running = (echoed?.kind === "cmd" && echoed.text.trim()) || program?.title || "program";
  let status = "";
  if (program) {
    const out = program.captureEscape ? "Use its own way out, or the quit button." : "Press Escape to leave it.";
    status = `${running} is running. ${out}`;
  } else if (echoed?.kind === "cmd") {
    status = summarize(
      echoed.text,
      output.slice(echo + 1).map((entry) => entry.line),
    );
  } else if (last) {
    status = summarize(last, []);
  }

  return (
    <section ref={rootRef} className="mt-session" aria-label="Terminal">
      <div className="mt-log">
        {output.map(({ id, line }) => (
          <Line key={id} line={line} live={live} />
        ))}
      </div>

      {program ? (
        // role=presentation: the press that summons a phone's keyboard is a
        // pointer convenience. With a real keyboard the program has the keys
        // already, and the quit button is the control.
        <div ref={endRef} className="mt-screen" role="presentation" onClick={summonKeyboard}>
          {/* The pane's own line: what is running, and a way out that needs
              no keyboard and does not depend on the program. */}
          <div className="mt-screen-bar">
            <span aria-hidden>{running}</span>
            <button type="button" className="mt-quit" onClick={() => shell.endProgram()}>
              quit<span className="mt-sr"> {running}</span>
            </button>
          </div>
          <ScreenView program={program} onExit={shell.endProgram} onClose={ignore} />
        </div>
      ) : (
        <div ref={endRef} className="mt-composer">
          <Offers offers={shell.suggestions} onRun={run} onFill={fill} />
          <PromptLine
            inputRef={inputRef}
            cwd={shell.cwd}
            input={shell.input}
            suggestion={shell.suggestion}
            setInput={shell.setInput}
            onKey={shell.key}
            onRun={(line) => run(line, true)}
          />
          {/* Without JavaScript nothing here can run, so nothing here is
              offered: the buttons, the prompt and the links to it are taken
              away, and a line says why. */}
          <noscript>
            <style>{".mt-offers,.mt-form,.mt-jump,.mt-skip{display:none}"}</style>
            <p className="mt-note">
              <span aria-hidden>% </span>The command prompt needs JavaScript. Everything its commands print is already
              on this page.
            </p>
          </noscript>
        </div>
      )}

      <p className="mt-sr" role="status">
        {status}
      </p>

      {/* The old terminal's launcher, now a link to the prompt at the end of
          the page. It is hidden while the prompt has focus (minimal.css), so
          nothing fixed shares the screen with a phone's keyboard.

          A link, so that it works before the page's script has loaded: the
          browser then jumps to the prompt itself. Once it has loaded, the
          press is taken over, to scroll by the visual viewport and to hand
          over the keys, and that is all the preventDefault is for. React
          Doctor reads it as a link that goes nowhere, so its rule is
          suppressed here. */}
      {/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
      <a
        className="term-launch mt-jump"
        href="#prompt"
        aria-label="Go to the command prompt"
        hidden={atPrompt}
        onClick={(e) => {
          e.preventDefault();
          toPrompt();
        }}
      >
        <span className="glyph" aria-hidden>
          &gt;_
        </span>
        <span className="label" aria-hidden>
          prompt
        </span>
        <span className="kbd" aria-hidden>
          ⌘K
        </span>
      </a>
    </section>
  );
}

/**
 * The row of commands above the prompt: what Tab would offer, as buttons, so
 * every command can be run without a keyboard. A phone has no Tab, and a
 * visitor who never opens the keyboard still needs a way in.
 *
 * One Tab stop, with the arrow keys moving inside it (the ARIA toolbar
 * pattern), so a keyboard user does not tab through eight buttons to reach
 * the prompt.
 *
 * A button that runs lets the browser do what it does with a tap: on a phone
 * the prompt loses focus and the keyboard closes, leaving the screen to the
 * output. One that only completes the line cancels the press, so the
 * keyboard stays for the next word.
 */
function Offers({
  offers,
  onRun,
  onFill,
}: {
  offers: readonly Suggestion[];
  onRun: (line: string) => void;
  onFill: (line: string) => void;
}) {
  const [at, setAt] = useState(0);
  if (!offers.length) return null;
  const active = Math.min(at, offers.length - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: offers.length - 1 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = (move + offers.length) % offers.length;
    setAt(next);
    e.currentTarget.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };

  const keep = (offer: Suggestion) => (e: SyntheticEvent) => {
    if (!offer.run) e.preventDefault();
  };

  return (
    <div className="mt-offers" role="toolbar" aria-label="Suggestions" aria-controls="prompt" onKeyDown={onKeyDown}>
      {offers.map((offer, i) => (
        <button
          key={offer.line}
          type="button"
          className="mt-offer"
          tabIndex={i === active ? 0 : -1}
          onPointerDown={keep(offer)}
          onMouseDown={keep(offer)}
          onFocus={() => setAt(i)}
          onClick={() => (offer.run ? onRun(offer.line) : onFill(offer.line))}
        >
          {offer.label}
          {!offer.run && !offer.label.endsWith("/") && <span aria-hidden> …</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The prompt: a form with one labelled text input. It is an ordinary input in
 * the flow of the page, never a hidden one fed by a fake screen, which is
 * what goes wrong in web terminals on phones.
 *
 * The input's text is 16 px: Safari zooms the page for anything smaller. The
 * block cursor is drawn over it (the native caret is hidden) and goes hollow
 * without focus, as Terminal's does. A line too long for the row shows the
 * native caret instead, since the drawn one cannot follow the input's own
 * scrolling.
 */
function PromptLine({
  inputRef,
  cwd,
  input,
  suggestion,
  setInput,
  onKey,
  onRun,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  cwd: string;
  input: string;
  suggestion: string;
  setInput: (line: string) => void;
  onKey: (key: string, atEnd: boolean) => boolean;
  onRun: (line: string) => void;
}) {
  // Where the drawn cursor sits, counted back from the end of the line.
  const [caretFromEnd, setCaretFromEnd] = useState(0);
  const [overflows, setOverflows] = useState(false);
  const caret = Math.max(0, input.length - caretFromEnd);

  const sync = (e: SyntheticEvent<HTMLInputElement>) => {
    const { selectionStart, value, scrollWidth, clientWidth } = e.currentTarget;
    setCaretFromEnd(value.length - (selectionStart ?? value.length));
    setOverflows(scrollWidth > clientWidth + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const { selectionStart, value } = e.currentTarget;
    const atEnd = selectionStart === value.length;
    // The form's submit runs the line.
    if (e.key === "Enter") return;
    // Tab completes only when there is something to complete; otherwise, and
    // with Shift, it moves focus on. The prompt is never a keyboard trap.
    if (e.key === "Tab" && (e.shiftKey || !suggestion)) return;
    if (e.key === "Escape") {
      e.currentTarget.blur();
      return;
    }
    if (onKey(e.key, atEnd)) e.preventDefault();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onRun(input);
  };

  const ghost = caret === input.length ? suggestion : "";

  return (
    <form
      className={overflows && input ? "mt-form mt-long" : "mt-form"}
      action="#prompt"
      autoComplete="off"
      onSubmit={onSubmit}
    >
      {/* The field's label is the prompt itself, so a press on it focuses the
          field, as a press beside the text does in a Terminal window. A
          screen reader hears "Command". */}
      <label className="mt-label" htmlFor="prompt">
        <span className="mt-sr">Command</span>
        <Prompt path={cwd} />
      </label>
      <span className="mt-inputwrap">
        <input
          ref={inputRef}
          id="prompt"
          className="mt-input"
          value={input}
          aria-describedby="prompt-hint"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="text"
          onChange={(e) => {
            setInput(e.target.value);
            sync(e);
          }}
          onSelect={sync}
          // History recall and completion replace the value, which moves the
          // caret without a select event.
          onKeyUp={sync}
          onKeyDown={onKeyDown}
        />
        <span className="mt-ghost" aria-hidden>
          <span className="mt-typed">{input.slice(0, caret)}</span>
          {/* At the end of the line the cursor sits on the suggestion's first
              character, as zsh-autosuggestions draws it. */}
          <span className="mt-cursor">{input[caret] ?? (ghost[0] || " ")}</span>
          <span className="mt-typed">{input.slice(caret + 1)}</span>
          {ghost && (
            <>
              <span>{ghost.slice(1)}</span>
              <span className="mt-tabhint">tab</span>
            </>
          )}
        </span>
      </span>
      {/* For a keyboard with no Return, and for switch access. */}
      <button type="submit" className="mt-enter" aria-label="Run the command" hidden={!input}>
        <span aria-hidden>⏎</span>
      </button>
      <span className="mt-sr" id="prompt-hint">
        Type a command and press Enter, or choose one of the suggestions before this field. Try help.
      </span>
    </form>
  );
}
