"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { Card, HStack, Button, IconButton } from "@astryxdesign/core";
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
      <Card padding={1.5} className="mx-auto max-w-4xl rounded-full">
        <HStack gap={2} hAlign="between" vAlign="center">
          <Button
            label="Terminal"
            variant="ghost"
            icon={<TerminalIcon />}
            onClick={openTerminal}
            data-terminal-trigger=""
            aria-haspopup="dialog"
            className="rounded-full"
          />
          <HStack
            as="nav"
            gap={1}
            vAlign="center"
            className="hidden sm:flex"
            aria-label="Primary navigation"
          >
            {links.map((link) => (
              <Button
                key={link.href}
                label={link.label}
                href={link.href}
                variant={active === link.href.slice(1) ? "primary" : "ghost"}
                className="rounded-full"
              />
            ))}
          </HStack>
          <HStack gap={2} vAlign="center">
            <IconButton
              label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              icon={theme === "dark" ? <SunIcon /> : <MoonIcon />}
              variant="ghost"
              onClick={() => setTheme("toggle")}
              className="rounded-full"
            />
            <Button
              label="Email"
              href="mailto:danielhkuo@rice.edu"
              variant="secondary"
              className="rounded-full"
            />
          </HStack>
        </HStack>
      </Card>
    </div>
  );
}
