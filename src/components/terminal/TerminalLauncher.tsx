"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Terminal from "./Terminal";
import type { SiteInfo, SlimProject, TerminalApi } from "./types";
import { getTheme, setTheme } from "@/lib/theme";

/**
 * Owns terminal open-state, global shortcuts (⌘K / backtick), the floating
 * launch button, and the page bridge (`api`). Receives the build-time repo list
 * and build facts as serializable props from the server page. Other parts of
 * the UI (the neofetch header) request opening via a `terminal:open`
 * CustomEvent, optionally passing the trigger element for focus return.
 */
export default function TerminalLauncher({
  projects,
  site,
}: {
  projects: SlimProject[];
  site: SiteInfo;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const launchBtnRef = useRef<HTMLButtonElement>(null);

  // Mobile: lock the background from scrolling behind the fullscreen terminal.
  // overflow:hidden alone doesn't stop touch-scroll on iOS, so pin the body with
  // position:fixed and put the page back where it was on close.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const openTerminal = (trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setOpen(true);
  };

  const closeTerminal = () => {
    setOpen(false);
    const trigger = triggerRef.current;
    if (trigger) window.setTimeout(() => trigger.focus(), 0);
  };

  const toggle = (trigger: HTMLElement | null) => {
    if (open) closeTerminal();
    else openTerminal(trigger);
  };

  // Global shortcuts + external open requests. Effect Events, so the
  // listeners are attached once and still see the current `open`.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    // Esc closes the terminal from anywhere while it's open, regardless of
    // which element currently has focus.
    if (e.key === "Escape" && open) {
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
  });
  const onOpenRequest = useEffectEvent((e: Event) => {
    const detail = (e as CustomEvent<{ trigger?: HTMLElement }>).detail;
    openTerminal(detail?.trigger ?? null);
  });
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => onKey(e);
    const handleOpenRequest = (e: Event) => onOpenRequest(e);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("terminal:open", handleOpenRequest);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("terminal:open", handleOpenRequest);
    };
  }, []);

  const api: TerminalApi = useMemo(
    () => ({
      openUrl: (url) => {
        window.open(url, "_blank", "noopener");
      },
      getProjects: () => projects,
      getTheme,
      setTheme,
      close: () => setOpen(false),
      site,
    }),
    [projects, site],
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
