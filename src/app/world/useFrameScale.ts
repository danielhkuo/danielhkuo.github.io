"use client";

// The frame for the window, as a tiny store: how many frame pixels across and down, and how big each is on screen. It
// covers the visual viewport edge to edge (runtime/fit.ts), keeps its size while a phone's toolbars come and go, and is
// fitted again when the window really changes or the page comes back. Read by the frame loop each frame (the session's
// `frame`) and by React through useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { FRAME_PIXELS, fitFrame, refits, type FrameFit } from "../../world/runtime/fit";

/** The window's frame, and CSS pixels per frame pixel: its whole device-pixel scale over the device pixel ratio. */
export interface WindowFrame extends FrameFit {
  css: number;
}

const SERVER: WindowFrame = { w: 400, h: 225, scale: 1, css: 1 };
let current: WindowFrame | null = null;
/** The viewport (CSS pixels) the frame was last fitted to. */
let fitted = { w: 0, h: 0 };
const listeners = new Set<() => void>();

/** The viewport in CSS pixels: the visual viewport where there is one (a phone's, between its toolbars), else the window. */
function viewport(): { w: number; h: number } {
  const v = window.visualViewport;
  return v ? { w: Math.round(v.width), h: Math.round(v.height) } : { w: window.innerWidth, h: window.innerHeight };
}

/** ?pixels=<n> sets the frame's budget, to measure another (as ?stats and ?sights are previews). */
function budget(): number {
  const n = Number(new URLSearchParams(window.location.search).get("pixels") ?? NaN);
  return Number.isFinite(n) && n >= 1000 ? n : FRAME_PIXELS;
}

/** Fits the frame to the viewport when `refits` says to, or always when `force`; tells React when it changed. */
function fit(force: boolean): void {
  const now = viewport();
  if (current && !force && !refits(fitted, now)) return;
  fitted = now;
  const dpr = window.devicePixelRatio || 1;
  const f = fitFrame(now.w, now.h, dpr, budget());
  const css = f.scale / dpr;
  if (current && current.w === f.w && current.h === f.h && current.scale === f.scale && current.css === css) return;
  current = { ...f, css };
  for (const l of listeners) l();
}

/** The frame for the window now. */
export function getFrameFit(): WindowFrame {
  if (!current) fit(true);
  return current ?? SERVER;
}

const onResize = () => fit(false);
const onResume = () => {
  if (document.visibilityState === "visible") fit(true);
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    window.removeEventListener("pageshow", onResume);
    document.removeEventListener("visibilitychange", onResume);
  };
}

/** The window's frame, kept current in React. */
export function useFrameFit(): WindowFrame {
  return useSyncExternalStore(subscribe, getFrameFit, () => SERVER);
}
