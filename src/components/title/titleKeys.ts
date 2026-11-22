// What a key does on the title once its window is the one terminal. While the live prompt has focus it answers for
// itself (promptKey); this is every other key.

/** A keydown, as much of it as the title reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
}

/** Where the title is when the key arrives. */
export interface TitleKeyState {
  /** "title" while the window is up. Leaving, flying and returning ignore keys. */
  mode: string;
  /** The intro is still playing: a key only skips it. */
  opening: boolean;
  /** The ways in are up, or the world is arriving, so ⏎ can go in. */
  ready: boolean;
  /** A `dialog[open]` is up and owns the keys. */
  dialogOpen: boolean;
  /** The live prompt has focus and takes the key itself. */
  promptFocused: boolean;
  /** What the event's target is: a field, a button or link, or anything else. */
  target: "field" | "control" | "other";
}

/** What the title should do with the key. */
export type TitleAction =
  | { kind: "none" }
  | { kind: "skip" }
  | { kind: "enter" }
  | { kind: "focus"; insert: string };

const NONE: TitleAction = { kind: "none" };
const SKIP: TitleAction = { kind: "skip" };
const ENTER: TitleAction = { kind: "enter" };

/**
 * What a keydown does on the title when the live prompt does not have focus.
 * The checks run in order: anything that is not the title's is left alone, then
 * ⌘K / backtick focus the prompt, then the opening, then ⏎, then a typed character.
 */
export function titleKey(state: TitleKeyState, e: KeyLike): TitleAction {
  if (state.mode !== "title") return NONE;
  if (e.defaultPrevented) return NONE;
  if (state.dialogOpen) return NONE;
  if (state.promptFocused) return NONE;
  if (state.target === "field") return NONE;
  // ⌘K and Ctrl+K focus the prompt. There is no second window to toggle.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") return { kind: "focus", insert: "" };
  if (e.ctrlKey || e.metaKey || e.altKey) return NONE;
  if (e.key === "`") return { kind: "focus", insert: "" };
  if (state.opening) return SKIP;
  if (e.key === "Enter") {
    if (state.target === "control") return NONE;
    return state.ready ? ENTER : NONE;
  }
  // One printable character. Space still presses a focused button or link.
  if (e.key.length === 1) {
    if (e.key === " " && state.target === "control") return NONE;
    return { kind: "focus", insert: e.key };
  }
  return NONE;
}

/**
 * The live prompt's own keys, ahead of the shell's. ⏎ on a blank line goes into
 * the world; Esc clears a line that has been typed. Anything else is the shell's.
 */
export function promptKey(line: string, key: string): "enter" | "clear" | null {
  if (key === "Enter" && line.trim() === "") return "enter";
  if (key === "Escape" && line !== "") return "clear";
  return null;
}
