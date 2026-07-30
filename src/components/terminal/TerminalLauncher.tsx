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
  // Scroll position the background is pinned at while the mobile fullscreen
  // terminal is open. `cd` updates it so we land on the navigated section once
  // the terminal closes and the lock is released.
  const scrollLockRef = useRef(0);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Mobile: lock the background from scrolling behind the fullscreen terminal.
  // overflow:hidden alone doesn't stop touch-scroll on iOS, so pin the body with
  // position:fixed and restore the (possibly `cd`-navigated) scroll on close.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const body = document.body;
    scrollLockRef.current = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollLockRef.current}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollLockRef.current);
    };
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
      // Esc closes the terminal from anywhere while it's open, regardless of
      // which element currently has focus.
      if (e.key === "Escape" && openRef.current) {
        e.preventDefault();
        closeTerminal();
        return;
      }
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
  }, [toggle, openTerminal, closeTerminal]);

  const api: TerminalApi = useMemo(
    () => ({
      scrollToSection: (id) => {
        const el = id ? document.getElementById(id) : null;
        // While the mobile scroll-lock pins the body (position:fixed),
        // scrollIntoView is a no-op — translate the element's viewport rect back
        // into a document offset and record it so we land there when the
        // terminal closes and the lock lifts. Derive the pin distance from
        // body.style.top (constant while open) rather than the mutable restore
        // target, so repeated `cd`s each resolve correctly.
        if (document.body.style.position === "fixed") {
          const HEADER_OFFSET = 112; // matches the sections' scroll-mt-28
          const pinned = -parseFloat(document.body.style.top || "0");
          scrollLockRef.current = el
            ? Math.max(0, el.getBoundingClientRect().top + pinned - HEADER_OFFSET)
            : 0;
          return;
        }
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
        data-terminal-trigger=""
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
