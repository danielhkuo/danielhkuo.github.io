// Shared light/dark theme control. `data-astryx-media` on <html> drives the
// Astryx chocolate theme's unqualified `[data-astryx-media="dark"]` /
// `[data-astryx-media="light"]` selectors. A blocking inline script in
// layout.tsx decides the mode before paint (no FOUC); this module keeps it
// right afterwards, and also feeds `AstryxThemeProvider` (which manages the
// `<Theme mode>` wrapper).
//
// The page follows the system's colour scheme unless the visitor has chosen a
// mode — which only the terminal's `theme` command does. A choice is
// remembered across visits and holds until `theme auto` hands it back.

import { useSyncExternalStore } from "react";
import { ATTR, STORAGE_KEY, THEME_COLOR, type ThemeMode } from "./theme-constants.ts";

export type { ThemeMode };

// Not exported: onThemeChange is the only supported way to observe this.
const THEME_EVENT = "themechange";

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

export function getTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute(ATTR);
  return attr === "dark" ? "dark" : "light";
}

/** The scheme the OS or browser asks for. */
function systemTheme(): ThemeMode {
  return window.matchMedia(SYSTEM_DARK).matches ? "dark" : "light";
}

/** The mode the visitor chose, if they have chosen one. */
function chosenTheme(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : null;
  } catch {
    return null;
  }
}

/** Remember a choice, or with null forget it. */
function remember(mode: ThemeMode | null): void {
  try {
    if (mode) localStorage.setItem(STORAGE_KEY, mode);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / storage disabled — the theme still applies for this visit */
  }
}

/** Put a mode on the page: the attribute every layer reads, and the browser's own chrome. */
function show(mode: ThemeMode): ThemeMode {
  if (typeof document === "undefined") return mode;
  document.documentElement.setAttribute(ATTR, mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  return mode;
}

/**
 * Choose a mode by hand — "toggle" flips the one showing — or hand the choice
 * back with "auto", which forgets it and shows the system's scheme. Returns
 * the mode now showing.
 */
export function setTheme(mode: ThemeMode | "toggle" | "auto"): ThemeMode {
  if (mode === "auto") {
    remember(null);
    return show(systemTheme());
  }
  const next = mode === "toggle" ? (getTheme() === "dark" ? "light" : "dark") : mode;
  remember(next);
  return show(next);
}

/**
 * Keep up with the system's scheme as it changes — sunset, a settings switch
 * — for as long as the visitor has not chosen a mode. The pre-paint script
 * only reads it once, at load. Returns a function that stops following.
 */
export function followSystemTheme(): () => void {
  const query = window.matchMedia(SYSTEM_DARK);
  const follow = () => {
    if (!chosenTheme()) show(systemTheme());
  };
  query.addEventListener("change", follow);
  return () => query.removeEventListener("change", follow);
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ThemeMode>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

// --- React binding (useSyncExternalStore — no setState-in-effect, no
//     hydration mismatch) ---
const subscribeTheme = (notify: () => void) => onThemeChange(() => notify());
const getServerTheme = (): ThemeMode => "light";
const getServerProviderMode = (): ThemeMode | "system" => "system";

/** Current theme as reactive state. `light` on the server, real value on client. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}

/** `<Theme mode>` for AstryxThemeProvider. Same store as `useThemeMode`, but the
    server snapshot is `system` — that is what `<Theme>` renders without a mode,
    so the hydrating markup matches the static HTML exactly.
    The pin in globals.css covers the CSS side (every `light-dark()` token) from
    the pre-paint attribute, so the palette does not wait on this. The concrete
    value is still load-bearing for the JS side: Astryx's own `useTheme()`
    resolves `system` through a media query, not through our attribute, so any
    component reading tokens in JS (Spinner, Toast, Markdown) follows the OS
    until this lands. None are used here today — that is why the residual gap is
    theoretical rather than visible. */
export function useThemeProviderMode(): ThemeMode | "system" {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerProviderMode);
}
