"use client";

import { useEffect } from "react";
import { Theme } from "@astryxdesign/core";
import { flexokiTheme } from "@/theme/flexoki";
import { followSystemTheme, useThemeProviderMode } from "@/lib/theme";

export default function AstryxThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reads the mode straight from <html data-astryx-media> (set before paint in
  // layout.tsx) and re-renders on toggle, via the same external store
  // ContactForm uses. 'system' on the server + hydration render, so the
  // markup matches the static export.
  const mode = useThemeProviderMode();

  // The pre-paint script read the system's scheme once; keep up with it from
  // here on, unless the visitor has chosen a mode in the terminal.
  useEffect(() => followSystemTheme(), []);

  return (
    <Theme theme={flexokiTheme} mode={mode}>
      {children}
    </Theme>
  );
}
