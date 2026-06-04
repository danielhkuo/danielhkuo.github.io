// Shared light/dark theme control. The `.dark` class on <html> drives the
// site-wide CSS-variable overrides in globals.css. A blocking inline script in
// layout.tsx applies the persisted choice before paint (no FOUC); this module
// is the runtime toggle used by the terminal and the HoverMenu.

import { useSyncExternalStore } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "theme";
export const THEME_EVENT = "themechange";

export function getTheme(): ThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode): ThemeMode {
  if (typeof document === "undefined") return mode;
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode / storage disabled — theme still applies for this session */
  }
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  return mode;
}

export function setTheme(mode: ThemeMode | "toggle"): ThemeMode {
  const next =
    mode === "toggle" ? (getTheme() === "dark" ? "light" : "dark") : mode;
  return applyTheme(next);
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ThemeMode>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

// --- React binding (useSyncExternalStore — no setState-in-effect, no
//     hydration mismatch; mirrors the LiveTime.tsx pattern) ---
const subscribeTheme = (notify: () => void) => onThemeChange(() => notify());
const getServerTheme = (): ThemeMode => "light";

/** Current theme as reactive state. `light` on the server, real value on client. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}
