"use client";

import { useCallback, useSyncExternalStore } from "react";
import { fitScale } from "../../world/runtime/fit";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * CSS pixels per frame pixel for a w × h frame: the largest whole number of device pixels that fits the window, so the
 * frame stays hard-edged at any display scaling. 1 before the page is in a browser.
 */
export function useFrameScale(w: number, h: number): number {
  const read = useCallback(() => {
    const dpr = window.devicePixelRatio || 1;
    return fitScale(window.innerWidth * dpr, window.innerHeight * dpr, w, h) / dpr;
  }, [w, h]);
  return useSyncExternalStore(subscribe, read, () => 1);
}
