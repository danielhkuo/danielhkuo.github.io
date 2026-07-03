"use client";

import { useEffect, useState } from "react";
import { Theme } from "@astryxdesign/core";
import { chocolateTheme } from "@astryxdesign/theme-chocolate/built";
import { readStoredMode, onThemeChange, type ThemeMode } from "@/lib/theme";

export default function AstryxThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // 'system' on server + first client render → no hydration mismatch.
  const [mode, setMode] = useState<ThemeMode | "system">("system");

  useEffect(() => {
    // After mount, adopt the persisted/OS concrete mode and keep in sync with
    // the nav/terminal toggle (which call setTheme in lib/theme.ts).
    setMode(readStoredMode());
    return onThemeChange((m) => setMode(m));
  }, []);

  return (
    <Theme theme={chocolateTheme} mode={mode}>
      {children}
    </Theme>
  );
}
