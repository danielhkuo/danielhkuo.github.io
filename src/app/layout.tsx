import type { Metadata, Viewport } from "next";
import "./globals.css";
import { sneakyTimes, ibmPlexSans } from "./fonts";
import AstryxThemeProvider from "@/components/AstryxThemeProvider";

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

// Mobile browser chrome (Android address bar, iOS Safari toolbar). The
// manifest's theme_color can only carry one value, so scheme-scoped meta tags
// are what actually let the chrome track light/dark. Values are --bg.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#282c34" },
  ],
};

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
        {/* Apply the persisted (or system) theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-astryx-media',d?'dark':'light')}catch(e){}`,
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
