"use client";

// The sound toggle: a pixel speaker in the top right corner, first in the DOM so it is the first tab stop (design §7).
// Game layer: hand drawn in CSS and SVG, not Astryx.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { SOUND_UI, type SoundControl } from "../../world/sound/control";
import type { SoundState } from "../../world/sound/types";
import { fell } from "./fonts";
import styles from "./sound.module.css";

/** The speaker, 13 × 7 pixels. `#` is ink; in the waiting icon `1`, `2`, `3` are the dots that light in turn. */
const ICONS: Record<"off" | "on" | "waiting", string[]> = {
  off: [
    "....#........",
    "...##..#...#.",
    "#####...#.#..",
    "#####....#...",
    "#####...#.#..",
    "...##..#...#.",
    "....#........",
  ],
  on: [
    "....#.....#..",
    "...##..#...#.",
    "#####...#...#",
    "#####...#...#",
    "#####...#...#",
    "...##..#...#.",
    "....#.....#..",
  ],
  waiting: [
    "....#........",
    "...##........",
    "#####........",
    "#####.1.2.3..",
    "#####........",
    "...##........",
    "....#........",
  ],
};

/** CSS pixels per icon pixel. */
const PX = 3;

function Icon({ kind }: { kind: "off" | "on" | "waiting" }) {
  const rects = [];
  const rows = ICONS[kind];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      if (c === ".") continue;
      rects.push(<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className={c === "#" ? undefined : styles[`dot${c}`]} />);
    }
  }
  return (
    <svg className={styles.icon} width={13 * PX} height={7 * PX} viewBox="0 0 13 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rects}
    </svg>
  );
}

const noStore = () => () => undefined;
const off = (): SoundState => "off";

/** An iPhone or iPad, by touch points and platform (iPadOS reports a Mac user agent). */
function isIos(): boolean {
  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export default function SoundToggle({ control }: { control: SoundControl | null }) {
  const state = useSyncExternalStore(control ? control.subscribe : noStore, control ? control.state : off, off);
  const hintId = useId();
  // Set by pointerdown, read by click: a pointer activation gives the focus back, a keyboard one keeps it.
  const byPointer = useRef(false);
  const [coarse, setCoarse] = useState(false);
  const [silentHint, setSilentHint] = useState(false);
  const ranOnce = useRef(false);

  useEffect(() => {
    const q = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  // The first time sound runs on an iPhone or iPad: a word about the silent switch, for six seconds.
  useEffect(() => {
    if (state !== "running" || ranOnce.current) return;
    ranOnce.current = true;
    if (!isIos()) return;
    const show = window.setTimeout(() => setSilentHint(true), 0);
    const hide = window.setTimeout(() => setSilentHint(false), 6000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [state]);

  const waiting = state === "waiting";
  const on = state === "running" || state === "suspended";
  const hint = waiting ? (coarse ? "Sound starts with your next tap" : "Sound starts with your next key press") : silentHint ? "No sound? Check that silent mode is off." : "";
  const ui = { [SOUND_UI]: "" };

  return (
    <div className={`${styles.sound} ${fell.variable}`} data-keep-clear="" {...ui}>
      {/* Always in the DOM: it is the switch's description and a polite live region. */}
      {/* role="status" is a polite live region of its own; no aria-live attribute, so the flight guide stays the page's one p[aria-live]. */}
      <p id={hintId} className={styles.hint} role="status" data-shown={hint ? "true" : "false"}>
        {hint}
      </p>
      <button
        type="button"
        role="switch"
        aria-checked={on || waiting}
        aria-label="Sound"
        aria-describedby={hintId}
        className={styles.toggle}
        data-state={state}
        onPointerDown={() => {
          byPointer.current = true;
        }}
        onKeyDown={() => {
          byPointer.current = false;
        }}
        onClick={(e) => {
          control?.toggle();
          // After a pointer activation the toggle gives up the focus, so the next Space lands the dragon and does not
          // switch the sound off; after a keyboard one it keeps it.
          if (byPointer.current) e.currentTarget.blur();
          byPointer.current = false;
        }}
      >
        <Icon kind={waiting ? "waiting" : on ? "on" : "off"} />
      </button>
    </div>
  );
}
