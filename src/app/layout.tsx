import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daniel Kuo - Portfolio",
  description: "Kami-styled portfolio for Daniel Kuo, software engineer and product builder.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The pre-paint script below toggles the `dark` class on <html>, so its
    // className legitimately differs between server and client on first paint.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the persisted (or system) theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        {/* Preconnect to external domains for faster loading */}
        <link rel="preconnect" href="https://js.hcaptcha.com" />
        <link rel="preconnect" href="https://hcaptcha.com" />
        <link rel="dns-prefetch" href="https://tile.openstreetmap.org" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
