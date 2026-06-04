"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Terminal from "./Terminal";
import type { SlimProject, TerminalApi } from "./types";
import { getTheme, setTheme } from "@/lib/theme";

/**
 * Owns terminal open-state, global shortcuts (⌘K / backtick), the floating
 * launch button, and the page bridge (`api`). Receives the build-time repo list
 * as a serializable prop from the server page. Other parts of the UI (the
 * #about shell hint, the HoverMenu entry) request opening via a `terminal:open`
 * CustomEvent, optionally passing the trigger element for focus return.
 */
export default function TerminalLauncher({
  projects,
}: {
  projects: SlimProject[];
}) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const launchBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const openTerminal = useCallback((trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? null;
    setOpen(true);
  }, []);

  const closeTerminal = useCallback(() => {
    setOpen(false);
    const trigger = triggerRef.current;
    if (trigger) window.setTimeout(() => trigger.focus(), 0);
  }, []);

  const toggle = useCallback(
    (trigger?: HTMLElement | null) => {
      if (openRef.current) closeTerminal();
      else openTerminal(trigger);
    },
    [openTerminal, closeTerminal],
  );

  // Global shortcuts + external open requests.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle((document.activeElement as HTMLElement) ?? null);
        return;
      }
      // backtick is a normal character while typing — only toggle otherwise.
      if (e.key === "`" && !typing) {
        e.preventDefault();
        toggle((document.activeElement as HTMLElement) ?? null);
      }
    };
    const onOpenRequest = (e: Event) => {
      const detail = (e as CustomEvent<{ trigger?: HTMLElement }>).detail;
      openTerminal(detail?.trigger ?? null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("terminal:open", onOpenRequest as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("terminal:open", onOpenRequest as EventListener);
    };
  }, [toggle, openTerminal]);

  const api: TerminalApi = useMemo(
    () => ({
      scrollToSection: (id) => {
        const el = id ? document.getElementById(id) : null;
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      },
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => projects,
      getTheme,
      setTheme,
      close: () => setOpen(false),
    }),
    [projects],
  );

  return (
    <>
      <button
        ref={launchBtnRef}
        type="button"
        className="term-launch"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Open terminal (⌘K)"
        onClick={() => openTerminal(launchBtnRef.current)}
      >
        <span className="glyph" aria-hidden>
          &gt;_
        </span>
        <span className="label">terminal</span>
        <span className="kbd" aria-hidden>
          ⌘K
        </span>
      </button>
      <Terminal open={open} onClose={closeTerminal} api={api} />
    </>
  );
}
