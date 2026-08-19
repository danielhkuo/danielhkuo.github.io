// Shared light/dark theme control. `data-astryx-media` on <html> drives the
// Astryx chocolate theme's unqualified `[data-astryx-media="dark"]` /
// `[data-astryx-media="light"]` selectors. A blocking inline script in
// layout.tsx applies the persisted choice before paint (no FOUC); this module
// is the runtime toggle used by the terminal and the HoverMenu, and also
// feeds `AstryxThemeProvider` (which manages the `<Theme mode>` wrapper).

import { useSyncExternalStore } from "react";
import { ATTR, STORAGE_KEY, THEME_COLOR, type ThemeMode } from "./theme-constants";

export type { ThemeMode };

// Not exported: onThemeChange is the only supported way to observe this.
const THEME_EVENT = "themechange";

export function getTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute(ATTR);
  return attr === "dark" ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): ThemeMode {
  if (typeof document === "undefined") return mode;
  document.documentElement.setAttribute(ATTR, mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — theme still applies for this session */
  }
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  return mode;
}

export function setTheme(mode: ThemeMode | "toggle"): ThemeMode {
  const next = mode === "toggle" ? (getTheme() === "dark" ? "light" : "dark") : mode;
  return applyTheme(next);
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
