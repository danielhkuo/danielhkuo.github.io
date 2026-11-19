"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SiteInfo, SlimProject, TerminalApi } from "../../components/terminal/types";
import { getTheme, setTheme } from "../../lib/theme";

export interface TerminalProps {
  /** What the terminal at the abbey is handed, as on the home page. */
  projects: SlimProject[];
  site: SiteInfo;
}

/** What the flight needs to know of the terminal: whether it holds the keys, and how to put it away. */
export interface TerminalLink {
  isOpen(): boolean;
  /** Closes it and gives focus back to whatever opened it (Esc, or its own close). */
  close(): void;
  /** Closes it where it stands, focus left alone (taking off). */
  dismiss(): void;
}

export interface TerminalDrawer {
  open: boolean;
  api: TerminalApi;
  /** Opens it; `trigger` gets focus back when it closes. */
  show(trigger: HTMLElement): void;
  link: TerminalLink;
}

/** The terminal kept at the abbey: open or not, the api it is handed, and the link the flight reads it through. */
export function useTerminalDrawer(terminal: TerminalProps): TerminalDrawer {
  const [open, setOpen] = useState(false);
  // Read by the flight's key handler, which outlives renders.
  const openRef = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);
  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    const el = trigger.current;
    if (el) window.setTimeout(() => el.focus(), 0);
  }, []);
  const isOpen = useCallback(() => openRef.current, []);
  const show = useCallback((el: HTMLElement) => {
    trigger.current = el;
    openRef.current = true;
    setOpen(true);
  }, []);

  const api: TerminalApi = useMemo(
    () => ({
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => terminal.projects,
      getTheme,
      setTheme,
      close: dismiss,
      site: terminal.site,
    }),
    [terminal, dismiss],
  );
  const link = useMemo(() => ({ isOpen, close, dismiss }), [isOpen, close, dismiss]);

  return { open, api, show, link };
}
