"use client";

import { Theme } from "@astryxdesign/core";
import { atomOneTheme } from "@/theme/atom-one";
import { useThemeProviderMode } from "@/lib/theme";

export default function AstryxThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reads the mode straight from <html data-astryx-media> (set before paint in
  // layout.tsx) and re-renders on toggle, via the same external store HoverMenu
  // and ContactForm use. 'system' on the server + hydration render, so the
  // markup matches the static export.
  const mode = useThemeProviderMode();

  return (
    <Theme theme={atomOneTheme} mode={mode}>
      {children}
    </Theme>
  );
}
