"use client";

// Where the held dragon waits behind the title: just left of the ways in, level with Enter world and facing them, clear
// of the window, the button and the links. The ways keep their place in the layout while they wait (hidden, not gone),
// so the place is known before they come.

import { useLayoutEffect, useState, type RefObject } from "react";
import { HOLD_AT, type HoldAt } from "../../world/runtime/hold";

/** CSS pixels between the held head and the ways in, to its right. */
const HEAD_LEFT = 44;
/** Frame pixels kept between the window's bottom edge and the held head, whose crest stands above its anchor. */
const HEAD_CLEAR = 7;
/** Frame pixels kept under the held head for the body that trails down behind it, where the window allows. */
const TAIL_ROOM = 18;

export interface HoldPlaceParts {
  /** The window's frame, the ways in, and the Enter world button. */
  frame: () => HTMLElement | null;
  ways: RefObject<HTMLElement | null>;
  button: RefObject<HTMLElement | null>;
  /** False while the window leaves or grows: the dragon stays where it is. */
  steady: () => boolean;
}

/**
 * The held head's place as shares of the world's frame (fw × fh frame pixels, `css` CSS pixels each), measured whenever
 * the window or the ways change size; the observer reports once as it starts. HOLD_AT until then, and on a phone.
 */
export function useHoldPlace(parts: HoldPlaceParts, desk: boolean, fit: { w: number; h: number; css: number }): HoldAt {
  const [place, setPlace] = useState<HoldAt>(HOLD_AT);
  const { frame, ways, button, steady } = parts;
  useLayoutEffect(() => {
    const el = desk ? frame() : null;
    const row = ways.current;
    const enter = button.current;
    if (!el || !row || !enter) return;
    const observer = new ResizeObserver(() => {
      if (!steady()) return;
      const w = fit.w * fit.css;
      const h = fit.h * fit.css;
      if (!w || !h) return;
      const r = row.getBoundingClientRect();
      const b = enter.getBoundingClientRect();
      // Level with the button, but not so low that the body, trailing down behind the head, runs off the screen; and
      // never so high that the window hides the head. On a short screen the head wins: a clipped tail reads, a clipped
      // head does not.
      const level = Math.min(b.top + b.height / 2, h - TAIL_ROOM * fit.css);
      const y = Math.max(el.getBoundingClientRect().bottom + HEAD_CLEAR * fit.css, level);
      setPlace({ x: Math.max(0.04, (r.left - HEAD_LEFT) / w), y: Math.min(0.97, y / h) });
    });
    observer.observe(el);
    observer.observe(row);
    return () => observer.disconnect();
    // The parts are read through refs and stable callbacks: the place is measured again when the frame's fit changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, fit.w, fit.h, fit.css]);
  return place;
}
