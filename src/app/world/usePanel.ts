"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelLink } from "./useFlight";

export interface Panel {
  open: boolean;
  show(): void;
  /** Call when the dialog has closed (Esc, its Close, or `toggle`). */
  closed(): void;
  link: PanelLink;
}

/** The options panel's open state, with a link the frame loop reads it through and toggles it by. */
export function usePanel(): Panel {
  const [open, setOpen] = useState(false);
  // Read by the frame loop and the key handler, which outlive renders.
  const openRef = useRef(false);
  const show = useCallback(() => {
    openRef.current = true;
    setOpen(true);
  }, []);
  const closed = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);
  const isOpen = useCallback(() => openRef.current, []);
  const toggle = useCallback(() => {
    openRef.current = !openRef.current;
    setOpen(openRef.current);
  }, []);
  const link = useMemo(() => ({ isOpen, toggle }), [isOpen, toggle]);
  return { open, show, closed, link };
}

/** True for `ms` after the page opens and after each move of the pointer; false once it has been still that long. */
export function useReveal(ms: number): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let timer = window.setTimeout(() => setShown(false), ms);
    const onMove = () => {
      setShown(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShown(false), ms);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
    };
  }, [ms]);
  return shown;
}
