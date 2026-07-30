import { IBM_Plex_Sans } from "next/font/google";
import localFont from "next/font/local";

/**
 * Display face — Sneaky Times by Jules Durand / Collletttivo (SIL OFL).
 *
 * Static and single-weight (400), so there is no bold: asking for one makes the
 * browser synthesise it, which smears a high-contrast serif. `.font-display` in
 * globals.css pins the weight for that reason. Unlike the Aujournuit it
 * replaces there is no width axis, so nothing needs `font-stretch`.
 */
export const sneakyTimes = localFont({
  src: "./fonts/Sneaky-Times.woff2",
  display: "swap",
  variable: "--font-sneaky-times",
  weight: "400",
});

/**
 * Body — IBM Plex Sans, picked to match the Carbon-style squared-off UI. It is
 * a workhorse with actual character rather than a neutral default, and it
 * carries the same engineering-drawing tone as the boxy corners.
 */
export const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-ibm-plex-sans",
});
