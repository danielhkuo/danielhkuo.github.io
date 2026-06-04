import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daniel Kuo - Portfolio",
  description: "Kami-styled portfolio for Daniel Kuo, software engineer and product builder.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
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
