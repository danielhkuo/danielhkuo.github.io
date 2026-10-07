// The theme's shared vocabulary, kept free of React so the root layout — a
// Server Component — can import it. lib/theme.ts pulls in useSyncExternalStore,
// and importing that from layout.tsx is a build error.
//
// These exist as constants because the pre-paint script in layout.tsx is a
// STRING: it cannot import anything at runtime, so it interpolates these at
// build time. That keeps the one place the mode is decided before paint from
// drifting away from the runtime toggle in lib/theme.ts.

export type ThemeMode = "dark" | "light";

/**
 * localStorage key holding the mode the visitor chose with the terminal's
 * `theme`, if any; without one the page follows the system. Not "theme": that
 * key holds choices made with the nav's toggle, which is gone — honoured, they
 * would pin those visitors to a mode with no visible way back.
 */
export const STORAGE_KEY = "theme-choice";

/** Attribute on <html> that every other layer reads as the source of truth. */
export const ATTR = "data-astryx-media";

/**
 * Mobile browser chrome (Android address bar, iOS Safari toolbar). Values are
 * --bg from globals.css. Applied to a single <meta name="theme-color"> that the
 * pre-paint script and lib/theme.ts both rewrite — NOT the scheme-scoped pair
 * Next's `viewport` export can emit, because those key off the OS, leaving a
 * visitor whose stored choice disagrees with their OS permanently mismatched.
 */
export const THEME_COLOR: Record<ThemeMode, string> = {
  light: "#FFFCF0",
  dark: "#100F0F",
};
