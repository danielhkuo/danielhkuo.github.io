"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { setTheme, useThemeMode } from "@/lib/theme";

const links = [
  { href: "#about", label: "About" },
  { href: "#work", label: "Work" },
  { href: "#contact", label: "Contact" },
];

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </g>
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 9.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function HoverMenu() {
  const [active, setActive] = useState("about");
  const theme = useThemeMode();

  useEffect(() => {
    const sections = links
      .map((link) => document.querySelector(link.href))
      .filter((section): section is Element => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible?.target.id) {
          setActive(visible.target.id);
        }
      },
      { rootMargin: "-35% 0px -55% 0px" },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const openTerminal = (e: MouseEvent<HTMLButtonElement>) =>
    window.dispatchEvent(
      new CustomEvent("terminal:open", { detail: { trigger: e.currentTarget } }),
    );

  return (
    <div className="fixed inset-x-0 top-4 z-50 px-4">
      <div className="capsule-shell mx-auto flex max-w-4xl items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={openTerminal}
          data-terminal-trigger=""
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 font-caps text-xs font-bold tracking-[var(--tracking-label)] text-accent hover:bg-[var(--tag-bg-soft)]"
        >
          <TerminalIcon />
          Terminal
        </button>
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary navigation">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`rounded-full px-4 py-2 font-caps text-xs tracking-[var(--tracking-label)] ${
                active === link.href.slice(1)
                  ? "bg-primary text-[var(--accent-on)] shadow-[var(--elev-ring-accent)]"
                  : "text-text-muted hover:bg-bg hover:text-text-primary"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme("toggle")}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="rounded-full p-2 text-text-muted hover:bg-bg hover:text-text-primary"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <a
            href="mailto:danielhkuo@rice.edu"
            className="rounded-full border border-primary bg-bg px-4 py-2 font-caps text-xs tracking-[var(--tracking-label)] text-primary hover:bg-primary hover:text-[var(--accent-on)]"
          >
            Email
          </a>
        </div>
      </div>
    </div>
  );
}
