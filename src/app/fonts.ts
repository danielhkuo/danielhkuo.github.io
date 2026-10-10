import localFont from "next/font/local";

/**
 * Display face — TeX Gyre Adventor Bold by the GUST e-foundry (GUST Font
 * License). It descends from URW Gothic L, and so from ITC Avant Garde Gothic:
 * circular bowls, a single-storey a, flat-cut terminals. Headings only — at
 * label sizes its caps go heavy and compete with the heading they sit under.
 *
 * The file is CTAN's texgyreadventor-bold.otf (v2.501) repacked as WOFF2 with
 * woff2_compress: a container change, with the outlines and name table as
 * shipped. Only Bold is here, so globals.css pins headings to 700; a heading
 * asking for any other weight would be drawn from this same file.
 */
export const adventor = localFont({
  src: "./fonts/TeXGyreAdventor-Bold.woff2",
  display: "swap",
  variable: "--font-adventor",
  weight: "700",
});

/**
 * Text face — Libron by Nico Verbruggen (SIL OFL), a Readerly/Newsreader
 * derivative drawn for e-readers. It sets everything outside the headings and
 * the terminal: prose, labels, form fields, buttons. It is low-contrast and
 * built for 10–14px, which is where nearly all of that text sits.
 *
 * The file is the v0.30 release's WOFF2, unmodified ("Libron" is a Reserved
 * Font Name — a subset or edited copy would have to be renamed). Only Regular
 * ships: nothing on the page sets this face bold or italic, and every file
 * listed here is preloaded. The release's Libron_Web.zip has Italic, Bold and
 * Bold Italic; add them as a `src` array before using either, or the browser
 * will synthesise them.
 */
export const libron = localFont({
  src: "./fonts/Libron-Regular.woff2",
  display: "swap",
  variable: "--font-libron",
  weight: "400",
  // next/font sizes a local face's loading fallback against Arial unless told
  // otherwise; a serif should hold its place with a serif.
  adjustFontFallback: "Times New Roman",
});
