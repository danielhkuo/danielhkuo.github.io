"use client";

// The flight's options as a tiny store: read from localStorage once, changed by the options panel, read by the frame
// loop each frame and by React through useSyncExternalStore.

import { useSyncExternalStore } from "react";
import { defaultOptions, readOptions, writeOptions, type Options, type Store } from "../../world/controls/options";

let current: Options | null = null;
const listeners = new Set<() => void>();
const SERVER = defaultOptions(false);

export function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The options in force. */
export function getOptions(): Options {
  if (!current) current = readOptions(storage(), prefersReducedMotion());
  return current;
}

/** Puts `next` in force and stores it. */
export function setOptions(next: Options): void {
  current = next;
  writeOptions(storage(), next);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The options, kept current in React. */
export function useOptions(): Options {
  return useSyncExternalStore(subscribe, getOptions, () => SERVER);
}
