import type { Metadata } from "next";
import { Cormorant_Garamond, Cormorant_SC, EB_Garamond } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const ebGaramond = EB_Garamond({
  variable: "--font-eb",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const cormorantSC = Cormorant_SC({
  variable: "--font-cormorant-sc",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Daniel Kuo - Portfolio",
  description: "Digital print portfolio showcasing projects and work",
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
      <body
        className={`${cormorant.variable} ${ebGaramond.variable} ${cormorantSC.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
