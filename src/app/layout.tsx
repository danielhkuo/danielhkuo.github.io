import type { Metadata, Viewport } from "next";
import "./globals.css";
import { sneakyTimes, ibmPlexSans } from "./fonts";
import AstryxThemeProvider from "@/components/AstryxThemeProvider";
import { atomOneTheme } from "@/theme/atom-one";
import { ATTR, STORAGE_KEY, THEME_COLOR } from "@/lib/theme-constants";

// Bump on every favicon change — browsers cache icons aggressively and the
// query string is what forces a refetch. Keep in sync with site.webmanifest.
const iconVersion = "4";

export const metadata: Metadata = {
  title: "Daniel Kuo - Portfolio",
  description: "Kami-styled portfolio for Daniel Kuo, software engineer and product builder.",
  icons: {
    icon: [
      { url: `/favicon.ico?v=${iconVersion}` },
      { url: `/favicon-16x16.png?v=${iconVersion}`, sizes: "16x16", type: "image/png" },
      { url: `/favicon-32x32.png?v=${iconVersion}`, sizes: "32x32", type: "image/png" },
    ],
    apple: `/apple-touch-icon.png?v=${iconVersion}`,
  },
  manifest: `/site.webmanifest?v=${iconVersion}`,
};

// No themeColor here on purpose. Scheme-scoped meta tags track the OS, so a
// visitor whose stored choice disagrees with their OS got an address bar in the
// other theme — permanently, not just for a frame. A single meta is rendered in
// <head> below instead, and THEME_COLOR/applyTheme keep its content on the mode.
export const viewport: Viewport = {};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The pre-paint script below sets the `data-astryx-media` attribute on
    // <html>, so its attributes legitimately differ between server and
    // client on first paint.
    // The next/font variable classes go on <html>, not <body>: globals.css
    // declares --font-display-family / --font-body-family at :root, and a
    // var() there can only see custom properties defined on <html> itself.
    // On <body> they resolved to the literal fallbacks instead — and next/font
    // registers LOCAL fonts under a generated family name, so a human-readable
    // fallback like "Sneaky Times" never matches it and headings silently fell
    // through to Georgia.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sneakyTimes.variable} ${ibmPlexSans.variable}`}
    >
      <head>
        {/* The meta the script below rewrites. Must precede it: the script looks
            it up by name and a <head> is parsed in order. */}
        <meta name="theme-color" content={THEME_COLOR.light} />
        {/* Resolve the theme before first paint. Everything downstream — the
            globals.css color-scheme pin, this site's palette, and getTheme() in
            lib/theme.ts — reads the attribute this writes, so it is the single
            place the mode is decided.
            - data-astryx-media carries the mode.
            - data-astryx-theme makes <html> a scope root before paint, so the
              theme's @scope'd CSS also covers anything rendered outside the
              <Theme> wrapper. Astryx re-stamps it after hydration anyway; doing
              it here just closes the gap before that.
            No data-theme: reset.css does map it to color-scheme, but theme.css
            outranks that with an unscoped `:root { color-scheme: light dark }`
            in a later layer, so the write was inert — <html> is covered by the
            globals.css pin instead. Astryx's <Theme> owns that attribute after
            hydration and removes it while the mode is still 'system'.
            Both reads are guarded separately, and the mode starts at a real
            value: neither a storage-disabled browser nor a matchMedia throw can
            leave <html> with no attribute at all, which would drop the page back
            to following the OS. The key, the attribute name and the theme name
            are interpolated from lib/theme-constants.ts and the built theme, so
            this string cannot drift from the runtime toggle. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var e=document.documentElement,c=document.querySelector('meta[name="theme-color"]'),m='light';try{if(window.matchMedia('(prefers-color-scheme:dark)').matches)m='dark'}catch(_){}try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t==='dark'||t==='light')m=t}catch(_){}e.setAttribute(${JSON.stringify(ATTR)},m);e.setAttribute('data-astryx-theme',${JSON.stringify(atomOneTheme.name)});if(c)c.content=${JSON.stringify(THEME_COLOR)}[m]})()`,
          }}
        />
        {/* Preconnect to external domains for faster loading */}
        <link rel="preconnect" href="https://js.hcaptcha.com" />
        <link rel="preconnect" href="https://hcaptcha.com" />
      </head>
      <body className="antialiased">
        <AstryxThemeProvider>{children}</AstryxThemeProvider>
      </body>
    </html>
  );
}
