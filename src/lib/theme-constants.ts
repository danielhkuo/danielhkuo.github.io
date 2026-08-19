// The theme's shared vocabulary, kept free of React so the root layout — a
// Server Component — can import it. lib/theme.ts pulls in useSyncExternalStore,
// and importing that from layout.tsx is a build error.
//
// These exist as constants because the pre-paint script in layout.tsx is a
// STRING: it cannot import anything at runtime, so it interpolates these at
// build time. That keeps the one place the mode is decided before paint from
// drifting away from the runtime toggle in lib/theme.ts.

export type ThemeMode = "dark" | "light";

/** localStorage key holding the visitor's explicit choice, if any. */
export const STORAGE_KEY = "theme";

/** Attribute on <html> that every other layer reads as the source of truth. */
export const ATTR = "data-astryx-media";

/**
 * Mobile browser chrome (Android address bar, iOS Safari toolbar). Values are
 * --bg from globals.css. Applied to a single <meta name="theme-color"> that the
 * pre-paint script and applyTheme both rewrite — NOT the scheme-scoped pair
 * Next's `viewport` export can emit, because those key off the OS, leaving a
 * visitor whose stored choice disagrees with their OS permanently mismatched.
 */
export const THEME_COLOR: Record<ThemeMode, string> = {
  light: "#fafafa",
  dark: "#282c34",
};
