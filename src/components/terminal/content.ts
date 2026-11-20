// Single source of truth for the terminal's content. No React.

export const EMAIL = "danielhkuo@rice.edu";

export const LINKS = {
  github: "https://github.com/danielhkuo",
  // TODO(daniel): confirm the real LinkedIn URL — this is a placeholder guess.
  linkedin: "https://www.linkedin.com/in/danielhkuo/",
  email: `mailto:${EMAIL}`,
  resume: "/Daniel-Kuo-Resume.pdf",
} as const;

/** The bio: the header's `neofetch` table, the shell's `neofetch`, and ~/about.md. */
export const PROFILE = {
  name: "Daniel Kuo",
  title: "Full-stack product builder & team architect",
  previously: "Summer Analyst @ Goldman Sachs AWM",
  school: "Rice University · CS",
  location: "Houston, TX",
  building: "AI products · self-hosted systems · developer tools",
} as const;

/** One line for each of the five interests. The quest and the Codex read this list. */
export const INTERESTS: readonly { key: string; line: string }[] = [
  { key: "bonsai", line: "Daniel likes slow, careful work." },
  { key: "reading", line: "Daniel reads a lot." },
  { key: "faith", line: "Daniel thinks about faith, technology and what AI is." },
  { key: "homelab", line: "Daniel runs a home lab on Unraid." },
  { key: "basketball", line: "Daniel plays basketball and follows the Houston Rockets." },
];
