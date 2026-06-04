"use client";

import { useEffect, useState } from "react";

const links = [
  { href: "#about", label: "About" },
  { href: "#work", label: "Work" },
  { href: "#contact", label: "Contact" },
];

export default function HoverMenu() {
  const [active, setActive] = useState("about");

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

  return (
    <div className="fixed inset-x-0 top-4 z-50 px-4">
      <div className="capsule-shell mx-auto flex max-w-4xl items-center justify-between gap-3 px-3 py-2">
        <a
          href="#"
          className="rounded-full px-4 py-2 font-display text-lg font-medium text-text-primary hover:bg-bg"
          aria-label="Back to top"
        >
          DK
        </a>
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
        <a
          href="mailto:danielhkuo@rice.edu"
          className="rounded-full border border-primary bg-bg px-4 py-2 font-caps text-xs tracking-[var(--tracking-label)] text-primary hover:bg-primary hover:text-[var(--accent-on)]"
        >
          Email
        </a>
      </div>
    </div>
  );
}
