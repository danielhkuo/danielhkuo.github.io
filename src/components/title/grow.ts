// The green light and Minimal version: the window grows to the screen, then the page underneath is the nano page.
// The frame's background is that page's panel, so the swap is the same dark ground. The text comes to the nano page's
// size as the window grows (a scale, so nothing reflows on the way), so the cut to /minimal changes no size.

import { nanoTextPx } from "./nanoText";

/** Long enough to read as the window filling the screen, short enough that the page is already there. */
export const GROW_MS = 320;

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

export function growToScreen(el: HTMLElement, onDone: () => void): () => void {
  const rect = el.getBoundingClientRect();
  const previous = el.getAttribute("style");
  const body = el.querySelector(".nf-body");
  const bodyWidth = body instanceof HTMLElement ? body.style.width : "";
  const bodyMax = body instanceof HTMLElement ? body.style.maxWidth : "";
  const bodyTransform = body instanceof HTMLElement ? body.style.transform : "";
  const bodyTransition = body instanceof HTMLElement ? body.style.transition : "";
  const bodyOrigin = body instanceof HTMLElement ? body.style.transformOrigin : "";
  let finished = false;
  let timer = 0;

  const restore = () => {
    if (previous === null) el.removeAttribute("style");
    else el.setAttribute("style", previous);
    if (body instanceof HTMLElement) {
      body.style.width = bodyWidth;
      body.style.maxWidth = bodyMax;
      body.style.transform = bodyTransform;
      body.style.transition = bodyTransition;
      body.style.transformOrigin = bodyOrigin;
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    onDone();
  };

  const onEnd = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === "width") finish();
  };

  // Pin it where it is, then let top, left, width and height run to the viewport. The body keeps its width so the
  // lines do not reflow; the title bar stays the top strip and stretches with the frame.
  const radius = getComputedStyle(el).borderRadius;
  el.style.transition = "none";
  el.style.position = "fixed";
  el.style.zIndex = "5";
  el.style.margin = "0";
  el.style.top = `${rect.top}px`;
  el.style.left = `${rect.left}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.borderRadius = radius;
  // The shadow stays: it goes off the screen's edges as the window fills it, rather than vanishing in the first frame.
  el.style.background = "var(--panel-ink)";
  el.style.overflow = "hidden";
  el.style.boxSizing = "border-box";
  // The size the page underneath will set its text at, against the window's own (smaller on a short screen).
  const scale = body instanceof HTMLElement
    ? nanoTextPx((q) => window.matchMedia(q).matches) / (parseFloat(getComputedStyle(body).fontSize) || 14)
    : 1;
  if (body instanceof HTMLElement) {
    body.style.width = `${rect.width}px`;
    body.style.maxWidth = `${rect.width}px`;
    body.style.boxSizing = "border-box";
    body.style.transformOrigin = "0 0";
    body.style.transition = "none";
    body.style.transform = "none";
  }
  void el.offsetWidth;
  el.style.transition = `top ${GROW_MS}ms ${EASE}, left ${GROW_MS}ms ${EASE}, width ${GROW_MS}ms ${EASE}, height ${GROW_MS}ms ${EASE}, border-radius ${GROW_MS}ms ${EASE}`;
  el.style.top = "0";
  el.style.left = "0";
  el.style.width = `${window.innerWidth}px`;
  el.style.height = `${window.innerHeight}px`;
  el.style.borderRadius = "0";
  if (body instanceof HTMLElement && Number.isFinite(scale) && scale > 0 && scale !== 1) {
    body.style.transition = `transform ${GROW_MS}ms ${EASE}`;
    body.style.transform = `scale(${scale})`;
  }

  el.addEventListener("transitionend", onEnd);
  timer = window.setTimeout(finish, GROW_MS + 80);
  return () => {
    if (finished) return;
    finished = true;
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    restore();
  };
}
