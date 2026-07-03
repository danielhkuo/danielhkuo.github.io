import type { Metadata } from "next";
import "./globals.css";
import { fraunces, albertSans } from "./fonts";
import AstryxThemeProvider from "@/components/AstryxThemeProvider";

const iconVersion = "2";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The pre-paint script below sets the `data-astryx-media` attribute on
    // <html>, so its attributes legitimately differ between server and
    // client on first paint.
    <html lang="en" suppressHydrationWarning>
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
        <link rel="dns-prefetch" href="https://tile.openstreetmap.org" />
      </head>
      <body className={`${fraunces.variable} ${albertSans.variable} antialiased`}>
        <AstryxThemeProvider>{children}</AstryxThemeProvider>
      </body>
    </html>
  );
}
