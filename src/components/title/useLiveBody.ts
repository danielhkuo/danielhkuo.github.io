"use client";

// The title's window once its prompt is live: it keeps the height it had and scrolls within itself, with its last row
// (the prompt) in view, as Terminal does. What a command prints pushes the neofetch up and out; the window never grows.

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

function bodyOf(root: RefObject<HTMLElement | null>): HTMLElement | null {
  const el = root.current?.querySelector(".nf-body");
  return el instanceof HTMLElement ? el : null;
}

/**
 * The body's border-box height with its fractions (offsetHeight rounds, and a window fixed a fraction shorter moves
 * the centred window by half of it). 0 while it is not rendered.
 */
function heightOf(body: HTMLElement): number {
  const cs = getComputedStyle(body);
  const h = parseFloat(cs.height);
  if (!Number.isFinite(h)) return 0;
  if (cs.boxSizing === "border-box") return h;
  const extra = [cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth];
  return extra.reduce((sum, v) => sum + (parseFloat(v) || 0), h);
}

/** Pins the body at `height` (its border box, whatever box-sizing it has) and lets it scroll. */
function pin(body: HTMLElement, height: number): void {
  body.style.boxSizing = "border-box";
  body.style.height = `${height}px`;
  body.classList.add("nf-live");
}

/**
 * Keeps the window body inside `root` at its resting height once `live`, scrolled to its last row as it changes.
 * Returns `lock`, which fixes the height now: call it just before the live rows replace the idle one.
 */
export function useLiveBody(root: RefObject<HTMLElement | null>, live: boolean): () => void {
  // The body's height while it rests, and the one fixed when it went live.
  const resting = useRef(0);
  const locked = useRef<number | null>(null);

  const lock = useCallback(() => {
    if (locked.current != null) return;
    const body = bodyOf(root);
    const height = (body && heightOf(body)) || resting.current;
    if (!height) return;
    locked.current = height;
    if (body) pin(body, height);
  }, [root]);

  // Every render: note the resting height until it is live, and keep the fixed one on the body after (React redraws the
  // body's attributes from props; only this hook knows the height).
  useLayoutEffect(() => {
    const body = bodyOf(root);
    if (!body) return;
    if (!live) {
      const height = locked.current == null ? heightOf(body) : 0;
      if (height > 0) resting.current = height;
      return;
    }
    if (locked.current == null && resting.current > 0) locked.current = resting.current;
    if (locked.current != null) pin(body, locked.current);
  });

  // Live, the last row stays in view: when something is printed or typed, and when the window is resized.
  useEffect(() => {
    const body = live ? bodyOf(root) : null;
    if (!body) return;
    const toEnd = () => {
      body.scrollTop = body.scrollHeight;
    };
    const resized = new ResizeObserver(toEnd);
    const changed = new MutationObserver(toEnd);
    resized.observe(body);
    changed.observe(body, { childList: true, subtree: true, characterData: true });
    toEnd();
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [live, root]);

  return lock;
}
