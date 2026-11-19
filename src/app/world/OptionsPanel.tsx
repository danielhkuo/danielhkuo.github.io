"use client";

// The options: a small pixel panel (a modal dialog with native controls, drawn in the guides' glyphs) for hold or
// toggle boost, the pace, motion, the keys, the lesson, and leaving. Game layer: hand-drawn, not Astryx.

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_KEYS, REMAPPABLE, rebind, type Remappable } from "../../world/controls/bindings";
import { INK_SOFT, keyCap, plate, slip, text, VERMILION } from "../../world/controls/glyphs";
import { ACTION_WORDS, keyWord, type Device } from "../../world/controls/guides";
import type { PhaseKind } from "./session";
import type { Options } from "../../world/controls/options";
import styles from "./options.module.css";
import PixelGlyph from "./PixelGlyph";

export interface OptionsPanelProps {
  open: boolean;
  /** CSS pixels per glyph pixel. */
  px: number;
  options: Options;
  onChange(next: Options): void;
  /** Shows the first-flight lesson again (and closes the panel). */
  onTeach(): void;
  onClose(): void;
}

/** Words drawn in the pixel font (in palette slot `ink`), with the same words for readers. */
function Words({ children, px, say, ink }: { children: string; px: number; say?: string; ink?: number }) {
  return (
    <>
      <PixelGlyph sprite={text(children, ink)} px={px} />
      <span className={styles.sr}>{say ?? children}</span>
    </>
  );
}

/** The rubricated pilcrow before each action: soft at rest, vermilion under the pointer or the focus. */
function Mark({ px }: { px: number }) {
  return (
    <span className={styles.mark}>
      <PixelGlyph className={styles.markRest} sprite={text("¶", INK_SOFT)} px={px} />
      <PixelGlyph className={styles.markHot} sprite={text("¶", VERMILION)} px={px} />
    </span>
  );
}

interface ChoiceProps<T extends string> {
  name: string;
  legend: string;
  value: T;
  choices: readonly [T, string][];
  px: number;
  onPick(v: T): void;
}

/** Two or more ways, one picked: radio buttons drawn as plates, the picked one lit. */
function Choice<T extends string>({ name, legend, value, choices, px, onPick }: ChoiceProps<T>) {
  return (
    <fieldset className={styles.row}>
      <legend className={styles.legend}>
        <Words px={px}>{legend}</Words>
      </legend>
      <span className={styles.choices}>
        {choices.map(([v, say]) => (
          <label key={v} className={styles.choice}>
            <input className={styles.sr} type="radio" name={name} value={v} checked={value === v} onChange={() => onPick(v)} />
            <PixelGlyph sprite={plate(v, value === v)} px={px} />
            <span className={styles.sr}>{say}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

function Action({ children, onClick, px }: { children: ReactNode; onClick(): void; px: number }) {
  return (
    <button type="button" className={styles.action} onClick={onClick}>
      <Mark px={px} />
      {children}
    </button>
  );
}

/** Glyph pixels as the panel's CSS unit. */
function pxVar(px: number): CSSProperties {
  return { "--px": `${px}px` } as CSSProperties;
}

export default function OptionsPanel({ open, px, options, onChange, onTeach, onClose }: OptionsPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The action waiting for its new key, if any.
  const [waiting, setWaiting] = useState<Remappable | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Takes the next key before anything else hears it: Esc gives up, a key that cannot be bound is passed over.
  const take = useEffectEvent((e: KeyboardEvent) => {
    if (!waiting || e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setWaiting(null);
      return;
    }
    const keys = rebind(options.keys, waiting, e.key);
    if (!keys) return;
    onChange({ ...options, keys });
    setWaiting(null);
  });
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => take(e);
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [waiting]);

  const set = (patch: Partial<Options>) => onChange({ ...options, ...patch });

  return (
    <dialog
      ref={dialog}
      className={styles.panel}
      style={pxVar(px)}
      aria-labelledby="options-title"
      onCancel={(e) => {
        // Esc while a key is awaited gives up the wait, not the panel.
        if (waiting) e.preventDefault();
      }}
      onClose={() => {
        setWaiting(null);
        onClose();
      }}
    >
      <h2 id="options-title" className={styles.title}>
        <Words px={px}>options</Words>
      </h2>
      <Choice name="boost" legend="boost" value={options.boost} px={px} choices={[["hold", "Hold to boost"], ["toggle", "Press to start and stop boosting"]]} onPick={(boost) => set({ boost })} />
      <Choice name="pace" legend="pace" value={options.pace} px={px} choices={[["cruise", "Cruise at full speed"], ["gentle", "A gentler pace"]]} onPick={(pace) => set({ pace })} />
      <Choice name="motion" legend="motion" value={options.motion} px={px} choices={[["full", "Full motion"], ["reduced", "Reduced motion"]]} onPick={(motion) => set({ motion })} />
      <fieldset className={styles.keys}>
        <legend className={styles.keysTitle}>
          <Words px={px} ink={VERMILION}>
            keys
          </Words>
        </legend>
        <ul className={styles.keyGrid}>
          {REMAPPABLE.map((a) => (
            <li key={a} className={styles.keyRow}>
              <span className={styles.keyWord}>
                <Words px={px}>{ACTION_WORDS[a]}</Words>
              </span>
              <button
                type="button"
                className={styles.key}
                aria-label={waiting === a ? `Press a key for ${ACTION_WORDS[a]}, or Esc to keep ${keyWord(options.keys[a])}` : `${ACTION_WORDS[a]}: ${keyWord(options.keys[a])}. Change`}
                onClick={() => setWaiting(waiting === a ? null : a)}
              >
                <PixelGlyph sprite={waiting === a ? plate("press a key", true) : keyCap(options.keys[a])} px={px} />
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          <PixelGlyph sprite={text("arrows, shift, enter and esc always work")} px={px} />
          <span className={styles.sr}>The arrow keys, Shift, Enter and Esc always work.</span>
        </p>
      </fieldset>
      <p className={styles.actions}>
        <Action px={px} onClick={() => set({ keys: { ...DEFAULT_KEYS } })}>
          <Words px={px}>reset the keys</Words>
        </Action>
        <Action px={px} onClick={onTeach}>
          <Words px={px}>show the lesson again</Words>
        </Action>
        <Link className={styles.action} href="/">
          <Mark px={px} />
          <Words px={px}>leave the world</Words>
        </Link>
        <Action px={px} onClick={() => dialog.current?.close()}>
          <Words px={px} say="Close the options">close</Words>
        </Action>
      </p>
    </dialog>
  );
}

export interface CornerProps {
  px: number;
  device: Device;
  /** Esc leaves only while flying: coming down it pulls up, and landed it takes off. */
  phase: PhaseKind;
  /** Shown while the pointer moves, for a while after the page opens, and always on a touch screen. */
  shown: boolean;
  onOpen(): void;
}

/**
 * The ways out of the flight from the corner of the world: "[esc] leave" (while flying) and "[O] options" by keyboard,
 * the pad's own buttons by gamepad, and on a touch screen one plate that opens the options (where Leave is).
 */
export function Corner({ px, device, phase, shown, onOpen }: CornerProps) {
  const touch = device === "touch";
  const pad = device === "gamepad";
  return (
    <nav className={`${styles.corner} ${shown || touch ? styles.cornerShown : ""}`} style={pxVar(px)} aria-label="Leave or open the options">
      {touch || phase !== "flying" ? null : (
        <Link className={styles.cornerItem} href="/" aria-keyshortcuts="Escape">
          <PixelGlyph sprite={pad ? plate("view") : keyCap("Escape")} px={px} />
          <PixelGlyph sprite={slip("leave")} px={px} />
          <span className={styles.sr}>Leave the world</span>
        </Link>
      )}
      <button type="button" className={styles.cornerItem} onClick={onOpen} aria-keyshortcuts="O">
        <PixelGlyph sprite={touch ? plate("options") : pad ? plate("menu") : keyCap("o")} px={px} />
        {touch ? null : <PixelGlyph sprite={slip("options")} px={px} />}
        <span className={styles.sr}>Options</span>
      </button>
    </nav>
  );
}
