"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { nextMatch, rangeOf, said, spoken, textOf } from "./find";
import { GOTO, HELP } from "./ids";

/** nano's message on opening a file. */
function read(lines: number): string {
  return `[ Read ${lines} line${lines === 1 ? "" : "s"} ]`;
}

/** Leaving the file: back to the title menu. */
function leave() {
  window.location.assign("/");
}

/** The screen (Help or Go To Line) that is open, if one is. */
function openPanel(): HTMLElement | null {
  for (const id of [HELP, GOTO]) {
    const panel = document.getElementById(id);
    try {
      if (panel?.matches(":popover-open")) return panel;
    } catch {
      // A browser without popovers: nothing can be open.
    }
  }
  return null;
}

/** Open or close a screen from its Control key. Opening one closes the other: both are `auto` popovers. */
function toggle(id: string) {
  const panel = document.getElementById(id);
  if (!panel || !("showPopover" in panel)) return;
  if (panel.matches(":popover-open")) panel.hidePopover();
  else panel.showPopover();
}

const noSubscription = () => () => undefined;

/**
 * The foot of the screen: the status line, which becomes the Search prompt for ^F, and nano's two rows of shortcuts.
 * Every shortcut shown either works or is decoration hidden from screen readers.
 *
 * ^G and ^/ open their screens as HTML popovers and ^X is a link, so all three work before this script has loaded and
 * without it. ^F needs the script: until it has run, it is decoration in the same place and the same size, so nothing
 * moves when it becomes a button.
 */
export default function Footer({ lines }: { lines: number }) {
  // False while the server's HTML is all there is; true once this has hydrated.
  const live = useSyncExternalStore(noSubscription, () => true, () => false);
  const [prompt, setPrompt] = useState(false);
  const [message, setMessage] = useState(read(lines));
  const [told, setTold] = useState("");
  /** The last search, which an empty Enter repeats; the prompt shows it, as nano's does. */
  const [last, setLast] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** Where the next search starts: the end of the last match, in the text textOf() reads. */
  const cursor = useRef(0);
  /** What had focus when the prompt opened, to hand it back to. */
  const before = useRef<HTMLElement | null>(null);
  /** Set while the prompt closes itself, so its blur is not taken for a press elsewhere. */
  const closing = useRef(false);

  /**
   * Open the Search prompt and focus it. The prompt is put on screen synchronously so that the focus happens inside
   * the press that asked for it: an iPhone opens its keyboard only for a focus made during a press.
   *
   * `opener` is the key that was pressed, which focus goes back to: Safari does not focus a button on a click, so
   * what has focus then is not it.
   */
  const find = (opener?: HTMLElement) => {
    openPanel()?.hidePopover();
    if (!prompt) {
      before.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      flushSync(() => setPrompt(true));
    }
    // Without preventScroll, Safari scrolls the page as the field takes focus, though the field is at the top.
    inputRef.current?.focus({ preventScroll: true });
  };

  /** Close the prompt, show `note` on the status line, and give focus back. */
  const close = (note: string) => {
    closing.current = true;
    const back = before.current;
    before.current = null;
    if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else inputRef.current?.blur();
    setPrompt(false);
    setMessage(note);
    closing.current = false;
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    const query = inputRef.current?.value || last;
    if (!query) {
      close("[ Cancelled ]");
      return;
    }
    setLast(query);
    const main = document.querySelector("main");
    const { text, nodes } = main ? textOf(main) : { text: "", nodes: [] };
    const match = nextMatch(text, query, cursor.current);
    close(said(query, match));
    setTold(spoken(query, match));
    if (!match) return;
    cursor.current = match.end;
    const range = rangeOf(nodes, match.start, match.end);
    if (!range) return;
    // nano puts its cursor on the match: here the match is selected, and brought to the middle of the screen.
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.altKey || e.isComposing) return;
    const panel = openPanel();
    const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]") !== null;
    if (e.key === "Escape") {
      // An open screen closes itself on Esc; the prompt cancels; otherwise Esc leaves, as ^X does.
      if (panel || typing) return;
      e.preventDefault();
      leave();
      return;
    }
    if (!e.ctrlKey) return;
    switch (e.key.toLowerCase()) {
      case "g":
        toggle(HELP);
        break;
      case "/":
        toggle(GOTO);
        break;
      case "f":
        find();
        break;
      case "x":
        // In a field ^X is the field's own (cut).
        if (typing) return;
        if (panel) panel.hidePopover();
        else leave();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  useEffect(() => {
    const handle = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  // A screen that opens takes focus to its first link or button, so its keys are under the reader's hand; when it
  // closes the browser hands focus back. Choosing a section in Go To Line closes it and moves focus to that section.
  useEffect(() => {
    const panels = [HELP, GOTO].map((id) => document.getElementById(id)).filter((p): p is HTMLElement => p !== null);
    const opened = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      (e.currentTarget as HTMLElement).querySelector<HTMLElement>("a, button")?.focus();
    };
    const chosen = (e: MouseEvent) => {
      const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-goto]");
      const target = link && document.getElementById(link.dataset.goto ?? "");
      if (!link || !target) return;
      e.preventDefault();
      document.getElementById(GOTO)?.hidePopover();
      history.pushState(null, "", `#${target.id}`);
      target.scrollIntoView({ block: "start" });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    };
    for (const p of panels) p.addEventListener("toggle", opened);
    const goto = document.getElementById(GOTO);
    goto?.addEventListener("click", chosen);
    return () => {
      for (const p of panels) p.removeEventListener("toggle", opened);
      goto?.removeEventListener("click", chosen);
    };
  }, []);

  return (
    <footer className="nano-foot">
      {prompt && (
        <form className="nano-find" role="search" onSubmit={search}>
          <label htmlFor="nano-find">{last ? `Search [${last}]:` : "Search:"}</label>
          <input
            id="nano-find"
            ref={inputRef}
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close("[ Cancelled ]");
              }
            }}
            onBlur={(e) => {
              // A press anywhere else, or a phone's keyboard put away, cancels the search.
              if (!closing.current && !e.currentTarget.form?.contains(e.relatedTarget as Node | null)) {
                before.current = null;
                close("");
              }
            }}
          />
        </form>
      )}
      <p className="nano-status" role="status">
        {message && <span className="nano-message">{message}</span>}
        <span className="nano-sr">{told}</span>
      </p>
      <div className="nano-keys">
        <button type="button" className="nano-key" popoverTarget={HELP} aria-keyshortcuts="Control+G">
          <kbd aria-hidden="true">^G</kbd> Help
        </button>
        <Decoration shortcut="^O" name="Write Out" />
        {live ? (
          <button type="button" className="nano-key" onClick={(e) => find(e.currentTarget)} aria-keyshortcuts="Control+F">
            <kbd aria-hidden="true">^F</kbd> Where Is
          </button>
        ) : (
          <span className="nano-key" aria-hidden="true">
            <kbd>^F</kbd> Where Is
          </span>
        )}
        <Decoration shortcut="^K" name="Cut" />
        <Decoration shortcut="^T" name="Execute" />
        <Decoration shortcut="^C" name="Location" />
        <Link className="nano-key" href="/" prefetch={false} aria-keyshortcuts="Control+X Escape">
          <kbd aria-hidden="true">^X</kbd> Exit<span className="nano-sr"> to the title menu</span>
        </Link>
        <Decoration shortcut="^R" name="Read File" />
        <Decoration shortcut="^\" name="Replace" />
        <Decoration shortcut="^U" name="Paste" />
        <Decoration shortcut="^J" name="Justify" />
        <button type="button" className="nano-key" popoverTarget={GOTO} aria-keyshortcuts="Control+/">
          <kbd aria-hidden="true">^/</kbd> Go To Line
        </button>
      </div>
    </footer>
  );
}

/** One of nano's shortcuts that does nothing here: shown for the look, hidden from screen readers, never focused. */
function Decoration({ shortcut, name }: { shortcut: string; name: string }) {
  return (
    <span className="nano-key nano-deco" aria-hidden="true">
      <kbd>{shortcut}</kbd> {name}
    </span>
  );
}
